import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAutoDetectable } from "./matcher.js";
import type {
  Tokens,
  ComponentsData,
  ScreensData,
  ProhibitionRule,
  RuleEntry,
  RulesFile,
  RuleFilter,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * アセット root の解決。既定は「dist/src の2階層上」（melta-ui リポ構造）。
 * vendor 先（別リポに engine を組み込む場合）は MELTA_ROOT 環境変数で
 * design/contracts・metadata・package.json を持つディレクトリを指定して上書きする。
 */
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : resolve(__dirname, "../..");

let tokensCache: Tokens | null = null;
let componentsCache: ComponentsData | null = null;
let screensCache: ScreensData | null = null;
let packageCache: { name: string; version: string } | null = null;

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

export function loadTokens(): Tokens {
  if (!tokensCache) {
    tokensCache = JSON.parse(
      readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
    );
  }
  return tokensCache!;
}

export function loadComponents(): ComponentsData {
  if (!componentsCache) {
    componentsCache = JSON.parse(
      readFileSync(resolve(root, "metadata/components.json"), "utf-8")
    );
  }
  return componentsCache!;
}

export function loadScreens(): ScreensData {
  if (!screensCache) {
    screensCache = JSON.parse(
      readFileSync(resolve(root, "metadata/screens.json"), "utf-8")
    );
  }
  return screensCache!;
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
