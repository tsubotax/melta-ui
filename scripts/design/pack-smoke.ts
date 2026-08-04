/**
 * pack-smoke.ts — consumer 視点の配布物 smoke test
 *
 * npm publish 前に「tarball を install した消費者から見て壊れていないか」を機械検査する。
 * 1.4.0 で起きた事故（npm 上の tarball が古い contracts を同梱したまま stale 化）を
 * 物理的に再発させないためのゲート。
 *
 * 検査項目:
 * 1. `npm pack` で tarball を生成できる（prepack = build が通る）
 * 2. 同梱の design/contracts/package.json の version がリポの contracts version と一致する
 * 3. 展開先の dist/utils/lint-core.js を deep import して lint が実際に動く
 *
 * 罠メモ: pipefail 下で「長い出力 | grep」は SIGPIPE 141 で誤失敗するため、
 * このスクリプトは子プロセス出力をすべて変数に落としてから検査する（パイプを使わない）。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

let failures = 0;

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`  ❌ ${msg}`);
  failures++;
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

const workDir = mkdtempSync(join(tmpdir(), "melta-pack-smoke-"));
const extractDir = join(workDir, "extract");

async function main(): Promise<void> {
  section("1. npm pack（prepack = build 込み）");

  // 出力はパイプせず変数に落とす（pipefail × SIGPIPE 回避）
  const packStdout = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", workDir],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const tarball = join(workDir, parsePackJson(packStdout).filename);
  if (!existsSync(tarball)) {
    fail(`tarball が生成されませんでした: ${tarball}`);
    return;
  }
  ok(`tarball 生成: ${parsePackJson(packStdout).filename}`);

  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
  const pkgDir = join(extractDir, "package");
  if (!existsSync(pkgDir)) {
    fail(`tarball の展開に失敗しました: ${pkgDir} がありません`);
    return;
  }
  ok("tarball を展開");

  section("2. 同梱 contracts の version 一致（stale 配布の物理防止）");

  const repoContractsPath = resolve(root, "design/contracts/package.json");
  const packedContractsPath = join(pkgDir, "design/contracts/package.json");
  const repoContractsVersion = JSON.parse(readFileSync(repoContractsPath, "utf-8")).version;

  if (!existsSync(packedContractsPath)) {
    fail(
      "tarball に design/contracts/package.json が同梱されていません。" +
        "同梱 contracts の version が消費者から確認できず、stale 検知もできません" +
        "（package.json の files に design/contracts/package.json を追加すること）"
    );
  } else {
    const packedContractsVersion = JSON.parse(
      readFileSync(packedContractsPath, "utf-8")
    ).version;
    if (packedContractsVersion !== repoContractsVersion) {
      fail(
        `同梱 contracts の version 不一致: tarball=${packedContractsVersion} / repo=${repoContractsVersion}`
      );
    } else {
      ok(`同梱 contracts version = ${packedContractsVersion}（リポと一致）`);
    }
  }

  section("3. deep import した lint-core が実際に動く");

  const lintCorePath = join(pkgDir, "dist/utils/lint-core.js");
  if (!existsSync(lintCorePath)) {
    fail(`tarball に dist/utils/lint-core.js が同梱されていません: ${lintCorePath}`);
  } else {
    const mod = (await import(pathToFileURL(lintCorePath).href)) as {
      lintSource: (source: string) => unknown[];
    };
    // text-black は rules.json の禁止クラス。展開先の rules.json を読めていれば必ず検出される
    const violations = mod.lintSource('<p class="text-black">配布物 smoke</p>');
    if (violations.length < 1) {
      fail("deep import した lint-core が text-black を検出できませんでした（アセット同梱漏れの疑い）");
    } else {
      ok(`deep import + lint 実行 OK（violations = ${violations.length}）`);
    }
  }
}

main()
  .catch((e) => {
    fail(`予期しないエラー: ${(e as Error).stack ?? String(e)}`);
  })
  .finally(() => {
    rmSync(workDir, { recursive: true, force: true });
    section("Summary");
    console.log(`  Failures: ${failures}`);
    console.log(`\n  ${failures === 0 ? "✅ PACK SMOKE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
    process.exit(failures > 0 ? 1 : 0);
  });
