/**
 * contract-compat.ts — melta-contracts の互換ゲート（golden diff）
 *
 * npm に公開済みの melta-contracts@latest と HEAD の design/contracts/ を比較し、
 * 破壊的変更を分類して semver bump を機械強制する。契約は schema でなく instance なので
 * json-schema-diff 系ツールは使わず、契約の意味論に沿った自作 diff で判定する
 * （Codex レビュー 2026-07-02 反映）。
 *
 * 分類:
 * - breaking（major 必須）: token path の削除・型変更 / component contract の削除 /
 *   variant・size・state の削除 / rule id の削除・severity・detector・pattern・
 *   prefixPatterns の変更。rename は自動推定せず「削除 + 追加 = breaking」扱い
 * - non-breaking（bump 必須）: 追加・値変更。HEAD version > npm latest を要求
 * - 差分なし: version 据置を許可
 *
 * 比較対象は SSOT のみ（tokens.json / rules.json / components/*.contract.json）。
 * tokens.dtcg.json は生成物なので対象外。
 *
 * ネットワーク不可（オフライン / npm 障害）時は既定で warn + skip。
 * CI では --require-network を渡して取得失敗を error にする。
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : resolve(__dirname, "../..");

// --- 型 ---

export interface ContractSurface {
  id: string;
  variants: string[];
  sizes: string[];
  states: string[];
  /** APP 実装状態（Codex レビュー #5: implemented からの後退は consumer 破壊なので semantic surface で扱う） */
  appStatus?: string;
  appMapping?: string;
}

export interface RuleSurface {
  id: string;
  severity: string;
  detector: string;
  pattern: string | undefined;
  prefixPatterns: string[] | undefined;
  /** 以下も検出意味そのもの（Codex レビュー #1）。変更 = breaking */
  matchPatterns: string[] | undefined;
  htmlAttrCheck: unknown;
  compositionCheck: unknown;
  contractLint: string | undefined;
}

export interface Bundle {
  version: string;
  tokens: Record<string, unknown>;
  rules: Map<string, RuleSurface>;
  contracts: Map<string, ContractSurface>;
  /** SSOT ファイルの正規化スナップショット（relpath → JSON.stringify(parsed)）。
   *  表面（variants/states 等）に映らないフィールド変更でも bump を強制するための golden 比較用 */
  raw: Map<string, string>;
  /** components/ の relpath → contract id（file rename を contract 削除と区別するため） */
  componentFileIds: Map<string, string>;
}

export interface CompatDiff {
  breaking: string[];
  compatible: string[];
}

// --- 読み込み ---

export function loadBundle(dir: string): Bundle {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
  const tokens = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf-8"));
  const rulesJson = JSON.parse(readFileSync(join(dir, "rules.json"), "utf-8"));
  const raw = new Map<string, string>();
  raw.set("tokens.json", JSON.stringify(tokens));
  raw.set("rules.json", JSON.stringify(rulesJson));
  const rules = new Map<string, RuleSurface>();
  for (const r of rulesJson.rules) {
    rules.set(r.id, {
      id: r.id,
      severity: r.severity,
      detector: r.detector,
      pattern: r.pattern,
      prefixPatterns: r.prefixPatterns,
      matchPatterns: r.matchPatterns,
      htmlAttrCheck: r.htmlAttrCheck,
      compositionCheck: r.compositionCheck,
      contractLint: r.contractLint,
    });
  }
  const contracts = new Map<string, ContractSurface>();
  const componentsDir = join(dir, "components");
  const componentFileIds = new Map<string, string>();
  for (const file of readdirSync(componentsDir).filter((f) => f.endsWith(".contract.json"))) {
    const c = JSON.parse(readFileSync(join(componentsDir, file), "utf-8"));
    raw.set(`components/${file}`, JSON.stringify(c));
    componentFileIds.set(`components/${file}`, c.id);
    contracts.set(c.id, {
      id: c.id,
      variants: c.variants ? Object.keys(c.variants) : [],
      sizes: c.sizes ? Object.keys(c.sizes) : [],
      states: c.states ?? [],
      appStatus: c.appStatus,
      appMapping: c.appMapping,
    });
  }
  // recipes（P3〜）: web/app のプラットフォーム別具象レシピも公開ファイルなので golden 対象。
  // 0.1.0 以前の tarball には存在しないため existsSync で吸収する
  for (const platform of ["web", "app"]) {
    const recipesDir = join(dir, "recipes", platform);
    if (!existsSync(recipesDir)) continue;
    for (const file of readdirSync(recipesDir).filter((f) => f.endsWith(".recipe.json"))) {
      raw.set(
        `recipes/${platform}/${file}`,
        JSON.stringify(JSON.parse(readFileSync(join(recipesDir, file), "utf-8")))
      );
    }
  }
  return { version: pkg.version, tokens, rules, contracts, raw, componentFileIds };
}

// --- token flatten ---

/** leaf = 非オブジェクト値。配列は 1 leaf として JSON 比較する（順序も意味を持つため）。 */
export function flattenTokens(obj: Record<string, unknown>, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [p, v] of flattenTokens(value as Record<string, unknown>, path)) out.set(p, v);
    } else {
      // 値の前に型タグを付けて「型変更」を値変更と区別可能にする
      out.set(path, `${Array.isArray(value) ? "array" : typeof value}:${JSON.stringify(value)}`);
    }
  }
  return out;
}

// --- token ノード参照（recipes / validate と共有） ---

/** tokens.json のノードパスを walk（例: "color.primary.500"）。無ければ undefined。 */
export function tokenNodeAt(tokens: unknown, path: string): unknown {
  let node: unknown = tokens;
  for (const seg of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * token leaf 判定: 参照可能な token = `value`（大半）か `size`（fontSize）を持つ object。
 * group ノード（color.primary 等）はどちらも持たないため false（Codex レビュー #2:
 * 途中ノード参照が存在チェックを通る穴を塞ぐ）。
 */
export function isTokenLeaf(node: unknown): boolean {
  return node !== null && typeof node === "object" && ("value" in node || "size" in node);
}

// --- diff 本体 ---

function setDiff(latest: string[], head: string[]): { removed: string[]; added: string[] } {
  const headSet = new Set(head);
  const latestSet = new Set(latest);
  return {
    removed: latest.filter((v) => !headSet.has(v)),
    added: head.filter((v) => !latestSet.has(v)),
  };
}

export function diffBundles(latest: Bundle, head: Bundle): CompatDiff {
  const breaking: string[] = [];
  const compatible: string[] = [];

  // 1. tokens: path 削除・型変更 = breaking / 追加・値変更 = compatible
  const latestTokens = flattenTokens(latest.tokens);
  const headTokens = flattenTokens(head.tokens);
  for (const [path, tagged] of latestTokens) {
    const headTagged = headTokens.get(path);
    if (headTagged === undefined) {
      breaking.push(`token 削除: ${path}`);
    } else if (headTagged !== tagged) {
      const latestType = tagged.slice(0, tagged.indexOf(":"));
      const headType = headTagged.slice(0, headTagged.indexOf(":"));
      if (latestType !== headType) {
        breaking.push(`token 型変更: ${path} (${latestType} → ${headType})`);
      } else {
        compatible.push(`token 値変更: ${path}`);
      }
    }
  }
  for (const path of headTokens.keys()) {
    if (!latestTokens.has(path)) compatible.push(`token 追加: ${path}`);
  }

  // 2. contracts: 削除 / variant・size・state の削除 = breaking / 追加 = compatible
  for (const [id, latestC] of latest.contracts) {
    const headC = head.contracts.get(id);
    if (!headC) {
      breaking.push(`contract 削除: ${id}`);
      continue;
    }
    for (const axis of ["variants", "sizes", "states"] as const) {
      const { removed, added } = setDiff(latestC[axis], headC[axis]);
      for (const v of removed) breaking.push(`contract ${id}: ${axis} 削除: ${v}`);
      for (const v of added) compatible.push(`contract ${id}: ${axis} 追加: ${v}`);
    }
    // appStatus 遷移: implemented からの後退（planned / not-planned / 削除）は
    // melta-app 利用者のコンポーネントが消える予告 = breaking。前進・その他は compatible で明示
    if (latestC.appStatus !== headC.appStatus) {
      if (latestC.appStatus === "implemented" && headC.appStatus !== "implemented") {
        breaking.push(`contract ${id}: appStatus 後退 (implemented → ${headC.appStatus ?? "なし"})`);
      } else {
        compatible.push(`contract ${id}: appStatus 変更 (${latestC.appStatus ?? "なし"} → ${headC.appStatus ?? "なし"})`);
      }
    }
    if (latestC.appMapping !== headC.appMapping) {
      compatible.push(`contract ${id}: appMapping 変更 (${latestC.appMapping ?? "native"} → ${headC.appMapping ?? "native"})`);
    }
  }
  for (const id of head.contracts.keys()) {
    if (!latest.contracts.has(id)) compatible.push(`contract 追加: ${id}`);
  }

  // 3. rules: id 削除・severity・detector・pattern・prefixPatterns 変更 = breaking / 追加 = compatible
  for (const [id, latestR] of latest.rules) {
    const headR = head.rules.get(id);
    if (!headR) {
      breaking.push(`rule 削除: ${id}`);
      continue;
    }
    for (const field of ["severity", "detector", "pattern", "contractLint"] as const) {
      if (latestR[field] !== headR[field]) {
        breaking.push(`rule ${id}: ${field} 変更 (${latestR[field]} → ${headR[field]})`);
      }
    }
    for (const field of ["prefixPatterns", "matchPatterns", "htmlAttrCheck", "compositionCheck"] as const) {
      if (JSON.stringify(latestR[field]) !== JSON.stringify(headR[field])) {
        breaking.push(`rule ${id}: ${field} 変更`);
      }
    }
  }
  for (const id of head.rules.keys()) {
    if (!latest.rules.has(id)) compatible.push(`rule 追加: ${id}`);
  }

  // 4. golden 比較: 表面に映らないフィールド変更（stateSpecs / anatomy / tailwind 等）でも
  //    ファイル内容が変わっていれば bump を強制する。公開ファイルの削除は breaking。
  //    components/ の削除は 2. の「contract 削除」と重複する場合だけ skip し、
  //    id が生きたままファイル名だけ変わる rename（公開 import path の破壊）は独立に検出する
  const deletedContractIds = new Set([...latest.contracts.keys()].filter((id) => !head.contracts.has(id)));
  for (const [file, snapshot] of latest.raw) {
    const headSnapshot = head.raw.get(file);
    if (headSnapshot === undefined) {
      const contractId = latest.componentFileIds.get(file);
      if (contractId !== undefined && deletedContractIds.has(contractId)) continue; // 2. で報告済み
      breaking.push(`公開ファイル削除: ${file}${contractId ? `（contract ${contractId} は存続 = rename。import path 破壊）` : ""}`);
    } else if (headSnapshot !== snapshot) {
      compatible.push(`ファイル内容変更: ${file}`);
    }
  }
  for (const file of head.raw.keys()) {
    if (!latest.raw.has(file) && !file.startsWith("components/")) {
      compatible.push(`ファイル追加: ${file}`);
    }
  }

  return { breaking, compatible };
}

// --- semver ---

export function parseSemver(v: string): [number, number, number] {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`semver として解釈できません: ${v}`);
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

export function semverGreater(a: string, b: string): boolean {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/**
 * diff の内容に対して HEAD version が十分に bump されているかを判定。理由文字列 or null を返す。
 * 0.x 台は npm caret の慣習（^0.1.0 = <0.2.0）に合わせ、breaking = minor bump で足りる。
 * 1.x 以降は breaking = major bump 必須。
 */
export function bumpViolation(diff: CompatDiff, latestVersion: string, headVersion: string): string | null {
  if (diff.breaking.length > 0) {
    const [lMajor, lMinor] = parseSemver(latestVersion);
    const [hMajor, hMinor] = parseSemver(headVersion);
    const satisfied = lMajor === 0 ? hMajor > 0 || hMinor > lMinor : hMajor > lMajor;
    if (!satisfied) {
      const needed = lMajor === 0 ? "minor bump（0.x 台の breaking シグナル）" : "major bump";
      return `破壊的変更 ${diff.breaking.length} 件に対して ${needed} がありません（npm latest ${latestVersion} → HEAD ${headVersion}）`;
    }
    return null;
  }
  if (diff.compatible.length > 0 && !semverGreater(headVersion, latestVersion)) {
    return `互換変更 ${diff.compatible.length} 件に対して version bump がありません（npm latest ${latestVersion} → HEAD ${headVersion}）`;
  }
  return null;
}

// --- npm 取得 ---

function fetchLatestBundle(pkgName: string): { bundle: Bundle; dir: string } {
  const version = execSync(`npm view ${pkgName} version`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tmp = mkdtempSync(join(tmpdir(), "melta-compat-"));
  execSync(`npm pack ${pkgName}@${version} --pack-destination "${tmp}" --silent`, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  execSync(`tar -xzf "${join(tmp, `${pkgName}-${version}.tgz`)}" -C "${tmp}"`, { stdio: "pipe" });
  const dir = join(tmp, "package");
  if (!existsSync(join(dir, "tokens.json"))) throw new Error("npm tarball に tokens.json がありません");
  return { bundle: loadBundle(dir), dir: tmp };
}

// --- main ---

function main(): number {
  const requireNetwork = process.argv.includes("--require-network");
  const headDir = resolve(root, "design/contracts");
  const head = loadBundle(headDir);

  console.log("\n=== Contract Compat Gate (npm latest vs HEAD) ===\n");

  let latest: Bundle;
  let cleanup: string | null = null;
  try {
    const fetched = fetchLatestBundle("melta-contracts");
    latest = fetched.bundle;
    cleanup = fetched.dir;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (requireNetwork) {
      console.error(`  ❌ npm latest の取得に失敗（--require-network 指定のため error）: ${message}`);
      return 1;
    }
    console.warn(`  ⚠️  npm latest を取得できないため互換検査を skip（オフライン?）: ${message}`);
    return 0;
  }

  try {
    const diff = diffBundles(latest, head);

    for (const b of diff.breaking) console.log(`  ❌ BREAKING: ${b}`);
    for (const c of diff.compatible) console.log(`  ・ compatible: ${c}`);
    if (diff.breaking.length === 0 && diff.compatible.length === 0) {
      console.log("  ✓ npm latest と HEAD に差分なし");
    }

    const violation = bumpViolation(diff, latest.version, head.version);
    if (violation) {
      console.error(`\n  ❌ ${violation}`);
      console.error("     design/contracts/package.json の version を上げてください（rename は削除+追加 = breaking 扱い）");
      return 1;
    }

    console.log(
      `\n  ✓ 互換ゲート PASSED: breaking ${diff.breaking.length} / compatible ${diff.compatible.length}（npm ${latest.version} → HEAD ${head.version}）`
    );
    return 0;
  } finally {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
