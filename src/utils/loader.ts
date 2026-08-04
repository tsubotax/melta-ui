import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAutoDetectable } from "./matcher.js";
import type {
  Tokens,
  ComponentsData,
  ProhibitionRule,
  RuleEntry,
  RulesFile,
  RuleFilter,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MELTA_ROOT_FLAG = "--melta-root";

/**
 * アセット root の解決。優先順位は
 *   1. `--melta-root=<path>`（`--melta-root <path>` も可）— MCP の起動コマンドに直接書ける
 *   2. `MELTA_ROOT` 環境変数（従来経路。互換維持）
 *   3. パッケージ相対（dist/src の2階層上 = melta-ui リポ構造）
 * vendor 先（別リポに engine を組み込む場合）は 1 か 2 で
 * design/contracts・metadata・package.json を持つディレクトリを指定して上書きする。
 */
function resolveRoot(): { root: string; via: string } {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith(`${MELTA_ROOT_FLAG}=`)) {
      const value = arg.slice(MELTA_ROOT_FLAG.length + 1);
      if (value) return { root: resolve(value), via: `${MELTA_ROOT_FLAG}=${value}` };
    }
    // スペース区切り形式（`--melta-root /path`）。次要素がフラグなら値なしとみなす
    if (arg === MELTA_ROOT_FLAG) {
      const value = argv[i + 1];
      if (value && !value.startsWith("-")) {
        return { root: resolve(value), via: `${MELTA_ROOT_FLAG} ${value}` };
      }
    }
  }
  if (process.env.MELTA_ROOT) {
    return { root: resolve(process.env.MELTA_ROOT), via: `MELTA_ROOT=${process.env.MELTA_ROOT}` };
  }
  return { root: resolve(__dirname, "../.."), via: "パッケージ相対" };
}

const { root, via: rootVia } = resolveRoot();

/**
 * アセット読み込み失敗時の診断メッセージ。
 * 「どのファイルを・どこに期待したか」と「root の差し替え方」を必ず添える。
 */
function assetLoadError(relPath: string, absPath: string, e: unknown): Error {
  return new Error(
    `[melta-ui] ${relPath} の読み込みに失敗しました (${absPath}): ${(e as Error).message}\n` +
      `  アセット root = ${root}（解決経路: ${rootVia}）\n` +
      `  vendor 先では ${MELTA_ROOT_FLAG}=<path> か MELTA_ROOT=<path> で ` +
      `design/contracts・metadata・package.json を持つディレクトリを指定してください。`
  );
}

let tokensCache: Tokens | null = null;
let componentsCache: ComponentsData | null = null;
let packageCache: { name: string; version: string } | null = null;
let designConstitutionCache: string | null = null;

/**
 * package.json を runtime 読みで取得する。
 * 将来 npm publish で dist/ だけ配布する場合は embed 化（resolveJsonModule で
 * import / ビルド時置換）に切り替えること。現状は runtime 読みで十分。
 */
export function loadPackage(): { name: string; version: string } {
  if (!packageCache) {
    packageCache = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf-8")
    );
  }
  return packageCache!;
}

/**
 * AI 向け入口である DESIGN.md をそのまま返す。
 * package.json の files に DESIGN.md が含まれるため、repo / npm の両経路で同じ内容を読む。
 */
export function loadDesignConstitution(): string {
  if (designConstitutionCache === null) {
    const designPath = resolve(root, "DESIGN.md");
    try {
      designConstitutionCache = readFileSync(designPath, "utf-8");
    } catch (e) {
      throw new Error(
        `[melta-ui] DESIGN.md の読み込みに失敗しました (${designPath}): ${(e as Error).message}`
      );
    }
  }
  return designConstitutionCache;
}

export function loadTokens(): Tokens {
  if (!tokensCache) {
    const tokensPath = resolve(root, "design/contracts/tokens.json");
    try {
      tokensCache = JSON.parse(readFileSync(tokensPath, "utf-8")) as Tokens;
    } catch (e) {
      throw assetLoadError("design/contracts/tokens.json", tokensPath, e);
    }
  }
  return tokensCache!;
}

export function loadComponents(): ComponentsData {
  if (!componentsCache) {
    const componentsPath = resolve(root, "metadata/components.json");
    try {
      componentsCache = JSON.parse(readFileSync(componentsPath, "utf-8")) as ComponentsData;
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
    const rulesPath = resolve(root, "design/contracts/rules.json");
    try {
      rulesFileCache = JSON.parse(readFileSync(rulesPath, "utf-8")) as RulesFile;
    } catch (e) {
      throw new Error(
        `[melta-ui] design/contracts/rules.json の読み込みに失敗しました: ${(e as Error).message}`
      );
    }
  }
  return rulesFileCache!;
}

/**
 * 全ルール（manual含む89件）を返す。filter で絞り込み可能。
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
 * 自動検出可能なルール（tailwind-class / tailwind-class-prefix）のみ返す。
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
