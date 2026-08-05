import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAutoDetectable } from "./matcher.js";
import { assertBundleCompat, assertValidRules } from "./rule-diagnostics.js";
import type {
  Tokens,
  ComponentsData,
  ProhibitionRule,
  RuleEntry,
  RulesFile,
  RuleFilter,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * アセット root の解決。優先順位は
 *   1. `setMeltaRoot()` による明示指定（CLI entry の `--melta-root` はここに集約される）
 *   2. `MELTA_ROOT` 環境変数（従来経路。互換維持）
 *   3. パッケージ相対（dist/src の2階層上 = melta-ui リポ構造）
 * vendor 先（別リポに engine を組み込む場合）は 1 か 2 で
 * design/contracts・metadata・package.json を持つディレクトリを指定して上書きする。
 *
 * 解決は lazy（初回アクセス時）。loader 自身は process.argv を読まない —
 * argv の解釈はホストの同名オプションを誤採用しうるので CLI entry（src/index.ts）の責務。
 */
let rootInfo: { root: string; via: string } | null = null;

function getRootInfo(): { root: string; via: string } {
  if (!rootInfo) {
    rootInfo = process.env.MELTA_ROOT
      ? { root: resolve(process.env.MELTA_ROOT), via: `MELTA_ROOT=${process.env.MELTA_ROOT}` }
      : { root: resolve(__dirname, "../.."), via: "パッケージ相対" };
  }
  return rootInfo;
}

function meltaRoot(): string {
  return getRootInfo().root;
}

/**
 * アセット root を明示指定する。アセットを読み込む前に呼ぶこと
 * （呼んだ時点で読み込み済みキャッシュは破棄される）。
 * @param path root ディレクトリ。design/contracts・metadata・package.json を持つこと
 * @param via 診断メッセージに出す解決経路の説明（例: `--melta-root=/path`）
 */
export function setMeltaRoot(path: string, via = "setMeltaRoot()"): void {
  if (!path) {
    throw new Error("[melta-ui] setMeltaRoot: root path が空です");
  }
  rootInfo = { root: resolve(path), via };
  resetAssetCaches();
}

/**
 * 現在の root と、その解決経路を返す。
 * 診断メッセージのほか、4 層が同じ root を解決していることを外から確認する用途
 * （`--print-config` 相当）を想定している。
 */
export function getMeltaRootInfo(): { root: string; via: string } {
  return { ...getRootInfo() };
}

/**
 * 明示指定を解除し、既定の解決（MELTA_ROOT → パッケージ相対）に戻す。
 * setMeltaRoot は env より優先されるため、テストで差し替えたあと
 * process.cwd() で「戻したつもり」になると env 指定の worker を汚染する。
 */
export function resetMeltaRoot(): void {
  rootInfo = null;
  resetAssetCaches();
}

/**
 * アセット読み込み失敗時の診断メッセージ。
 * 「どのファイルを・どこに期待したか」と「root の差し替え方」を必ず添える。
 */
function assetLoadError(relPath: string, absPath: string, e: unknown): Error {
  const { root, via } = getRootInfo();
  return new Error(
    `[melta-ui] ${relPath} の読み込みに失敗しました (${absPath}): ${(e as Error).message}\n` +
      `  アセット root = ${root}（解決経路: ${via}）\n` +
      `  vendor 先では --melta-root=<path> か MELTA_ROOT=<path> で ` +
      `design/contracts・metadata・package.json を持つディレクトリを指定してください。`
  );
}

let tokensCache: Tokens | null = null;
let componentsCache: ComponentsData | null = null;
let packageCache: { name: string; version: string } | null = null;
let designConstitutionCache: string | null = null;

function resetAssetCaches(): void {
  tokensCache = null;
  componentsCache = null;
  packageCache = null;
  designConstitutionCache = null;
  rulesFileCache = null;
  rulesCache = null;
}

/**
 * package.json を runtime 読みで取得する。
 * 将来 npm publish で dist/ だけ配布する場合は embed 化（resolveJsonModule で
 * import / ビルド時置換）に切り替えること。現状は runtime 読みで十分。
 */
export function loadPackage(): { name: string; version: string } {
  if (!packageCache) {
    const packagePath = resolve(meltaRoot(), "package.json");
    try {
      packageCache = JSON.parse(readFileSync(packagePath, "utf-8"));
    } catch (e) {
      throw assetLoadError("package.json", packagePath, e);
    }
  }
  return packageCache!;
}

/**
 * AI 向け入口である DESIGN.md をそのまま返す。
 * package.json の files に DESIGN.md が含まれるため、repo / npm の両経路で同じ内容を読む。
 */
/**
 * doc（DESIGN.md）を bundle が同梱しているか。
 * MCP は resource を無条件に列挙していたため、doc を持たない bundle では
 * 「list には出るが read すると必ず ENOENT」という壊れた resource が残っていた。
 * 列挙の可否をここで判定できるようにする（存在検査なので throw しない）。
 */
export function hasDesignConstitution(): boolean {
  return existsSync(resolve(meltaRoot(), "DESIGN.md"));
}

export function loadDesignConstitution(): string {
  if (designConstitutionCache === null) {
    const designPath = resolve(meltaRoot(), "DESIGN.md");
    try {
      designConstitutionCache = readFileSync(designPath, "utf-8");
    } catch (e) {
      throw assetLoadError("DESIGN.md", designPath, e);
    }
  }
  return designConstitutionCache;
}

export function loadTokens(): Tokens {
  if (!tokensCache) {
    const tokensPath = resolve(meltaRoot(), "design/contracts/tokens.json");
    try {
      tokensCache = JSON.parse(readFileSync(tokensPath, "utf-8")) as Tokens;
      // bundle のどのアセットに宣言されていても同じ互換ゲートを通す
      assertBundleCompat(tokensCache, tokensPath);
    } catch (e) {
      throw assetLoadError("design/contracts/tokens.json", tokensPath, e);
    }
  }
  return tokensCache!;
}

export function loadComponents(): ComponentsData {
  if (!componentsCache) {
    const componentsPath = resolve(meltaRoot(), "metadata/components.json");
    try {
      componentsCache = JSON.parse(readFileSync(componentsPath, "utf-8")) as ComponentsData;
      assertBundleCompat(componentsCache, componentsPath);
    } catch (e) {
      throw assetLoadError("metadata/components.json", componentsPath, e);
    }
  }
  return componentsCache!;
}

let rulesFileCache: RulesFile | null = null;
let rulesCache: ProhibitionRule[] | null = null;

/**
 * design/contracts/rules.json (SSOT) を生のまま読む。
 * P0 で MCP resource / get_rules tool に公開する基盤。
 */
export function loadRules(): RulesFile {
  if (!rulesFileCache) {
    const rulesPath = resolve(meltaRoot(), "design/contracts/rules.json");
    let parsed: RulesFile;
    try {
      parsed = JSON.parse(readFileSync(rulesPath, "utf-8")) as RulesFile;
    } catch (e) {
      throw assetLoadError("design/contracts/rules.json", rulesPath, e);
    }
    // 構造が壊れた ruleset を「読めたこと」にしない。不正 severity は
    // error 件数 0 に丸められて passed: true を返すため、ここで落とす。
    // ※ S3 で resolver の合成後に ajv の全 schema 検証へ差し替える前哨。
    assertBundleCompat(parsed, rulesPath);
    assertValidRules(parsed?.rules, rulesPath);
    rulesFileCache = parsed;
  }
  return rulesFileCache!;
}

/**
 * 全ルール（manual 含む全件）を返す。filter で絞り込み可能。
 * MCP `get_rules` tool / `melta://rules` resource の実体。
 */
export function getAllRules(filter?: RuleFilter): RuleEntry[] {
  let rules = loadRules().rules;
  if (filter?.category) rules = rules.filter((r) => r.category === filter.category);
  if (filter?.severity) rules = rules.filter((r) => r.severity === filter.severity);
  if (filter?.detector) rules = rules.filter((r) => r.detector === filter.detector);
  return rules;
}

/**
 * Prohibition rules loaded from design/contracts/rules.json (SSOT).
 * 自動検出可能なルール（判定は matcher.isAutoDetectable が単一の真理）のみ返す。
 * matchPatterns がある場合は展開する。
 */
export function getProhibitionRules(): ProhibitionRule[] {
  if (rulesCache) return rulesCache;

  const rulesFile = loadRules();
  const result: ProhibitionRule[] = [];
  for (const rule of rulesFile.rules) {
    // 自動検出可能なルールのみ（判定は matcher.isAutoDetectable に一本化）
    if (!isAutoDetectable(rule)) {
      continue;
    }

    if (rule.matchPatterns && rule.matchPatterns.length > 0) {
      for (const mp of rule.matchPatterns) {
        result.push({
          ruleId: rule.id,
          severity: rule.severity,
          pattern: mp,
          reason: rule.description,
          alternative: rule.alternative,
        });
      }
    } else if (rule.pattern != null) {
      result.push({
        ruleId: rule.id,
        severity: rule.severity,
        pattern: rule.pattern,
        reason: rule.description,
        alternative: rule.alternative,
      });
    }
    // prefixPatterns（前方一致の回避経路検知）は pattern / matchPatterns に追加で展開する
    if (rule.prefixPatterns && rule.prefixPatterns.length > 0) {
      for (const pp of rule.prefixPatterns) {
        result.push({
          ruleId: rule.id,
          severity: rule.severity,
          pattern: pp,
          reason: rule.description,
          alternative: rule.alternative,
        });
      }
    }
  }

  rulesCache = result;
  return rulesCache;
}
