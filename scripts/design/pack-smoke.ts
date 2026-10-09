/**
 * pack-smoke.ts — consumer 視点の配布物 smoke test
 *
 * npm publish 前に「tarball を install した消費者から見て壊れていないか」を機械検査する。
 * 1.4.0 で起きた事故（melta-contracts だけが registry で進み、melta-ds-mcp は古い contracts を
 * 同梱したまま stale 化）を物理的に再発させないためのゲート。
 *
 * 検査項目:
 * 1. `npm pack` で tarball を生成できる（prepack = build が通る）
 * 2. registry の melta-contracts とリポの contracts version の同期
 *    - registry > リポ → fail（リポが stale。contracts を取り込んでから publish する）
 *    - リポ > registry → warn（joint release の途中。contracts を先に publish する）
 *    - 取得不能 → warn（オフライン。CI はネットワークありなので実質必須検査）
 * 3. 同梱スキーマ 3 種が tarball に入っていて JSON として読める
 * 4. tmp consumer に `npm install <tarball>` して、公開 entry（melta-ds-mcp/lint-core）と
 *    互換 passthrough（melta-ds-mcp/dist/utils/lint-core.js）の両 specifier で lint が動く。
 *    あわせて主の公開 entry（melta-ds-mcp/lint）の lint() が composition 違反を返すこと、
 *    bin（melta-lint）が node だけで起動し CI gate / hook と同じ判定を返すことを確かめる
 *
 * 罠メモ: pipefail 下で「長い出力 | grep」は SIGPIPE 141 で誤失敗するため、
 * このスクリプトは子プロセス出力をすべて変数に落としてから検査する（パイプを使わない）。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

/** tarball に必ず入っていてほしいスキーマ（vendor 先が自前契約を検証するための公開資産） */
const REQUIRED_SCHEMAS = [
  "design/schemas/component-contract.schema.json",
  "design/schemas/recipe.schema.json",
  "design/schemas/rule.schema.json",
];

const LINT_SAMPLE = '<p class="text-black">配布物 smoke</p>';

/**
 * composition だけが拾う違反の検体（ネスト modal = MODAL_NO_NESTED）。class / html-attr の違反を
 * 含めないので、lint() が error を返せば「公開 entry と bin が composition を含む」ことの証明になる。
 * lintSource でも同じ違反が出る検体にすると、composition の有無を見分けられなくなる
 */
const COMPOSITION_SAMPLE = '<div role="dialog"><div role="dialog">配布物 smoke</div></div>';
const COMPOSITION_RULE = "MODAL_NO_NESTED";
/** 違反ゼロの検体（bin の exit 0 側の対照） */
const CLEAN_SAMPLE = '<p class="text-body">配布物 smoke</p>';

let failures = 0;
let warnings = 0;

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`  ❌ ${msg}`);
  failures++;
}

function warn(msg: string): void {
  console.warn(`  ⚠️  WARN: ${msg}`);
  warnings++;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

/** npm pack --json の stdout から JSON 部分だけ取り出す（lifecycle script の出力が混ざるため） */
function parsePackJson(stdout: string): { filename: string } {
  const start = stdout.indexOf("[");
  if (start < 0) {
    throw new Error(`npm pack --json の出力に JSON が見つかりません:\n${stdout}`);
  }
  const parsed = JSON.parse(stdout.slice(start)) as Array<{ filename: string }>;
  if (!parsed[0]?.filename) {
    throw new Error(`npm pack --json の出力に filename がありません:\n${stdout}`);
  }
  return parsed[0];
}

/** semver 比較（a > b で 1）。prerelease は同じ core の release より小さい */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split("-", 2);
    return { core: core.split(".").map((n) => parseInt(n, 10) || 0), pre };
  };
  const va = split(a);
  const vb = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === undefined) return 1; // release > prerelease
  if (vb.pre === undefined) return -1;
  return va.pre > vb.pre ? 1 : -1;
}

/** 作業ディレクトリ。import 時に副作用で作らないよう main() 内で確保する */
let workDir = "";

async function main(): Promise<void> {
  workDir = mkdtempSync(join(tmpdir(), "melta-pack-smoke-"));
  const extractDir = join(workDir, "extract");
  const consumerDir = join(workDir, "consumer");

  section("1. npm pack（prepack = build 込み）");

  // 出力はパイプせず変数に落とす（pipefail × SIGPIPE 回避）
  const packStdout = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const packFilename = parsePackJson(packStdout).filename;
  const tarball = join(workDir, packFilename);
  if (!existsSync(tarball)) {
    fail(`tarball が生成されませんでした: ${tarball}`);
    return;
  }
  ok(`tarball 生成: ${packFilename}`);

  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
  const pkgDir = join(extractDir, "package");
  if (!existsSync(pkgDir)) {
    fail(`tarball の展開に失敗しました: ${pkgDir} がありません`);
    return;
  }
  ok("tarball を展開");

  section("2. registry の melta-contracts とリポの同期（stale 配布の検知）");

  // lockfile の root version 不整合は「1.5.0 を publish したのに lock は 1.4.0」という
  // リリース commit の信頼性問題として実際に2回起きた（melta-app 0.5.3 / melta-ui 1.5.0、
  // どちらも Codex レビューで発覚）。ここで機械検査して再発を止める。
  const pkgVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"))
    .version as string;
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf-8"));
  if (lock.version !== pkgVersion || lock.packages?.[""]?.version !== pkgVersion) {
    fail(
      `package-lock.json の version が package.json (${pkgVersion}) と不一致です ` +
        `(root=${lock.version} / packages[""]=${lock.packages?.[""]?.version})。` +
        `npm install --package-lock-only で同期すること`
    );
  } else {
    ok(`lockfile の version 同期: ${pkgVersion}`);
  }

  const repoContractsVersion = JSON.parse(
    readFileSync(resolve(root, "design/contracts/package.json"), "utf-8")
  ).version as string;

  // CI では registry 到達を必須にする（--require-network / env）。取得失敗を warn で流すと
  // 「同期検査を実施できないまま緑」になり、stale 再発防止ゲートが実質無効化されるため。
  const requireNetwork =
    process.argv.includes("--require-network") ||
    process.env.MELTA_PACK_SMOKE_REQUIRE_NETWORK === "1";
  let registryVersion: string | null = null;
  try {
    registryVersion = execFileSync("npm", ["view", "melta-contracts", "version"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const msg =
      `registry の melta-contracts version を取得できませんでした: ` +
      `${(e as Error).message.split("\n")[0]}`;
    if (requireNetwork) {
      fail(`${msg}（--require-network 指定のため failure。CI はネットワーク必須）`);
    } else {
      warn(`${msg}（オフライン想定で継続）`);
    }
  }

  if (registryVersion) {
    const diff = compareSemver(registryVersion, repoContractsVersion);
    if (diff > 0) {
      fail(
        `リポの contracts が stale です: registry=${registryVersion} > repo=${repoContractsVersion}。` +
          `melta-contracts の更新を取り込んでから melta-ds-mcp を publish すること`
      );
    } else if (diff < 0) {
      warn(
        `リポの contracts が registry より新しい: repo=${repoContractsVersion} > registry=${registryVersion}。` +
          `joint release の途中なら melta-contracts を先に publish すること`
      );
    } else {
      ok(`contracts version 同期: registry = repo = ${repoContractsVersion}`);
    }
  }

  section("3. 同梱スキーマ");

  for (const rel of REQUIRED_SCHEMAS) {
    const abs = join(pkgDir, rel);
    if (!existsSync(abs)) {
      fail(`tarball に ${rel} が同梱されていません（package.json の files を確認）`);
      continue;
    }
    try {
      JSON.parse(readFileSync(abs, "utf-8"));
      ok(`${rel} 同梱 + JSON parse OK`);
    } catch (e) {
      fail(`${rel} が JSON として読めません: ${(e as Error).message}`);
    }
  }

  section("4. consumer install → specifier 経由の import");

  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      { name: "melta-pack-smoke-consumer", version: "0.0.0", private: true, type: "module" },
      null,
      2
    ),
    "utf-8"
  );
  try {
    execFileSync(
      "npm",
      ["install", tarball, "--no-audit", "--no-fund", "--prefer-offline", "--loglevel=error"],
      { cwd: consumerDir, stdio: "inherit" }
    );
  } catch (e) {
    fail(
      `consumer への npm install が失敗しました（依存の取得にネットワーク or npm cache が要る）: ` +
        `${(e as Error).message.split("\n")[0]}`
    );
    return;
  }
  ok("tmp consumer に tarball を install");

  // exports map を迂回しないよう、絶対パスではなく specifier で import する
  const probePath = join(consumerDir, "probe.mjs");
  writeFileSync(
    probePath,
    `import { lintSource as viaExportEntry } from "melta-ds-mcp/lint-core";\n` +
      `import { lintSource as viaDeepImport } from "melta-ds-mcp/dist/utils/lint-core.js";\n` +
      `import { lint } from "melta-ds-mcp/lint";\n` +
      `const html = ${JSON.stringify(LINT_SAMPLE)};\n` +
      `const nested = ${JSON.stringify(COMPOSITION_SAMPLE)};\n` +
      `const rule = ${JSON.stringify(COMPOSITION_RULE)};\n` +
      `const viaLint = lint(nested, { sourceType: "html" });\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  exportEntry: viaExportEntry(html).length,\n` +
      `  deepImport: viaDeepImport(html).length,\n` +
      `  lintComposition: viaLint.violations.filter((v) => v.ruleId.includes(rule)).length,\n` +
      `  lintPassed: viaLint.passed,\n` +
      `  lintSourceComposition: viaExportEntry(nested).filter((v) => v.ruleId.includes(rule)).length,\n` +
      `}));\n`,
    "utf-8"
  );

  let probeOut = "";
  try {
    probeOut = execFileSync(process.execPath, [probePath], {
      cwd: consumerDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (e) {
    fail(`consumer からの import に失敗しました: ${(e as Error).message.split("\n")[0]}`);
    return;
  }

  const jsonStart = probeOut.indexOf("{");
  const counts = JSON.parse(probeOut.slice(jsonStart < 0 ? 0 : jsonStart)) as {
    exportEntry: number;
    deepImport: number;
    lintComposition: number;
    lintPassed: boolean;
    lintSourceComposition: number;
  };
  // text-black は rules.json の禁止クラス。同梱アセットを読めていれば必ず検出される
  if (counts.exportEntry < 1) {
    fail("melta-ds-mcp/lint-core（公開 entry）が text-black を検出できませんでした");
  } else {
    ok(`melta-ds-mcp/lint-core で lint 発火（violations = ${counts.exportEntry}）`);
  }
  if (counts.deepImport < 1) {
    fail(
      "melta-ds-mcp/dist/utils/lint-core.js（互換 passthrough）が text-black を検出できませんでした"
    );
  } else {
    ok(`melta-ds-mcp/dist/utils/lint-core.js で lint 発火（violations = ${counts.deepImport}）`);
  }

  // 主の公開 entry。npm 経路の消費者が check_html / CI / hook と同じ判定（composition 込み）を持てること
  if (counts.lintSourceComposition > 0) {
    fail(
      `検体が lintSource でも ${COMPOSITION_RULE} を返します。composition の有無を見分けられないので検体を差し替えること`
    );
  }
  if (counts.lintComposition < 1 || counts.lintPassed) {
    fail(
      `melta-ds-mcp/lint の lint() がネスト modal（${COMPOSITION_RULE}）を検出できませんでした ` +
        `（composition 違反 = ${counts.lintComposition} / passed = ${counts.lintPassed}）。公開 entry が composition を含んでいない`
    );
  } else {
    ok(
      `melta-ds-mcp/lint の lint() が composition 違反を検出（${COMPOSITION_RULE} = ${counts.lintComposition}、lintSource 単体では ${counts.lintSourceComposition}）`
    );
  }

  section("5. bin（melta-lint）を node だけで起動");

  // tsx も TS ソースも無い消費者環境で、CI gate / PostToolUse hook と同じ判定が出ること。
  // .bin の shim 経由で叩くので、shebang と npm が付ける実行権限まで含めて確かめる
  const bin = join(consumerDir, "node_modules", ".bin", "melta-lint");
  if (!existsSync(bin)) {
    fail(`node_modules/.bin/melta-lint がありません（package.json の bin を確認）`);
    return;
  }
  const nestedFile = join(consumerDir, "nested-modal.html");
  const cleanFile = join(consumerDir, "clean.html");
  writeFileSync(nestedFile, COMPOSITION_SAMPLE, "utf-8");
  writeFileSync(cleanFile, CLEAN_SAMPLE, "utf-8");
  // 出力は変数に落としてから検査する（パイプを使わない）
  const runBin = (args: string[], input?: string) =>
    spawnSync(bin, args, { cwd: consumerDir, encoding: "utf-8", timeout: 60000, input });
  /** 失敗時の手がかり。CLI の stdout は空行から始まるので trim してから 1 行目を取る */
  const firstLine = (r: ReturnType<typeof runBin>) =>
    (r.stderr || r.stdout || String(r.error ?? "")).trim().split("\n")[0];

  const nested = runBin([nestedFile]);
  if (nested.status === 1 && nested.stdout.includes(COMPOSITION_RULE)) {
    ok(`melta-lint がネスト modal で exit 1（${COMPOSITION_RULE} を検出）`);
  } else {
    fail(
      `melta-lint がネスト modal を落としませんでした（exit ${nested.status}）: ${firstLine(nested)}`
    );
  }

  const clean = runBin([cleanFile]);
  if (clean.status === 0) {
    ok("melta-lint が違反なしの検体で exit 0");
  } else {
    fail(
      `melta-lint が違反なしの検体で exit ${clean.status}: ${firstLine(clean)}`
    );
  }

  const hook = runBin(["--hook", nestedFile]);
  let hookDecision: string | undefined;
  try {
    hookDecision = (JSON.parse(hook.stdout) as { decision?: string }).decision;
  } catch {
    hookDecision = undefined;
  }
  if (hook.status === 0 && hookDecision === "block") {
    ok("melta-lint --hook <file> がネスト modal で block の JSON を返す");
  } else {
    fail(
      `melta-lint --hook <file> が block を返しませんでした（exit ${hook.status} / stdout: ${hook.stdout.slice(0, 200)}）`
    );
  }

  // plugin と Claude Code の hook はこちら: 引数なしの --hook に PostToolUse の JSON を stdin で渡す
  const hookStdin = runBin(["--hook"], JSON.stringify({ tool_input: { file_path: nestedFile } }));
  let hookStdinDecision: string | undefined;
  try {
    hookStdinDecision = (JSON.parse(hookStdin.stdout) as { decision?: string }).decision;
  } catch {
    hookStdinDecision = undefined;
  }
  if (hookStdin.status === 0 && hookStdinDecision === "block") {
    ok("melta-lint --hook（stdin の PostToolUse JSON）がネスト modal で block の JSON を返す");
  } else {
    fail(
      `melta-lint --hook（stdin）が block を返しませんでした（exit ${hookStdin.status} / stdout: ${hookStdin.stdout.slice(0, 200)}）`
    );
  }
}

// CLI 実行時のみ走らせる（compareSemver 等をテストから import できるようにする）
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      fail(`予期しないエラー: ${(e as Error).stack ?? String(e)}`);
    })
    .finally(() => {
      if (workDir) rmSync(workDir, { recursive: true, force: true });
      section("Summary");
      console.log(`  Failures: ${failures}`);
      console.log(`  Warnings: ${warnings}`);
      console.log(`\n  ${failures === 0 ? "✅ PACK SMOKE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
      process.exit(failures > 0 ? 1 : 0);
    });
}
