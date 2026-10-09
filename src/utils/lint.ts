/**
 * 単一 lint API（class + html-attr + composition の合成判定）
 *
 * **MCP `check_html`（src/tools/check-html.ts）、CI の lint CLI（src/cli/lint-generated.ts =
 * `melta-lint` bin）、PostToolUse hook（scripts/design/hook-check-rule.sh → lint CLI の --hook）、
 * npm 公開 entry（`melta-ds-mcp/lint`）の 4 経路が、すべてこの `lint()` を呼ぶ。**
 * 合否の判定経路はここ 1 つで、呼び出し側で lintSource / lintComposition を自前で
 * 足し合わせない（足し方が経路ごとに違うと「MCP では PASS、CI では FAIL」が起きる）。
 *
 * 以前は lintSource（class + html-attr）だけが npm 公開 entry（`melta-ds-mcp/lint-core`）で、
 * composition は check_html と lint CLI がそれぞれ自前で concat していた。そのため npm 経路の
 * 消費者だけ composition（ネスト modal 等）が抜け、同じ HTML の合否が経路で食い違っていた。
 */

import { lintSource } from "./lint-core.js";
import { lintComposition } from "./composition-lint.js";
import { assertViolationSeverity } from "./rule-diagnostics.js";
import type { LintViolation } from "./types.js";

export type { LintViolation } from "./types.js";

/**
 * 許容する sourceType。MCP tool schema の enum もここから導出する（二重 SSOT を持たない）。
 * "html" は composition lint も走る / "jsx" は class + html-attr のみ（AST が要るため未対応）。
 */
export const SOURCE_TYPES = ["html", "jsx"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * sourceType の runtime 検証。以前は型キャストのみで、"htlm" のような typo が
 * composition 検査を無言で外して passed: true を返していた（未知値 = fail-open）。
 * 省略（undefined）は呼び出し側で "html" に倒す。null は省略ではないので拒否する。
 */
export function assertSourceType(value: unknown): SourceType {
  if (typeof value === "string" && (SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as SourceType;
  }
  throw new Error(
    `[melta-ui] sourceType が不正です: ${JSON.stringify(value)}。` +
      `許容値は ${SOURCE_TYPES.map((s) => `"${s}"`).join(" / ")}（省略時は "html"）`
  );
}

export interface LintOptions {
  /** 省略時は "html"（composition まで検査する）。null や未知の値は throw する */
  sourceType?: SourceType;
}

export interface LintResult {
  /** errorCount === 0。warn は合否に影響しない */
  passed: boolean;
  errorCount: number;
  warnCount: number;
  /** class / html-attr の違反が先、composition の違反が後（この順序も 4 経路で同一） */
  violations: LintViolation[];
  /** 実際に適用した sourceType（省略時の既定 "html" を含めて明示する） */
  sourceType: SourceType;
}

/**
 * ソース文字列を lint する。check_html / CI / hook / npm 公開 entry の唯一の判定経路。
 *
 * - class lint + html-attr lint は常に走る（lintSource）
 * - `sourceType: "html"`（既定）なら composition lint（ネスト modal / interactive 内
 *   interactive 等。DOM パース前提）も走る。"jsx" では走らない
 *
 * `passed: true` は「自動検査できるルールで error がない」であって完全準拠の保証ではない。
 * manual ルールやブランド適合は判定しない（check_html の coverage 参照）。
 */
export function lint(source: string, options?: LintOptions): LintResult {
  // Buffer 等を渡されたときに TypeError で落ちるより、原因が分かる形で止める
  if (typeof source !== "string") {
    throw new Error(`[melta-ui] lint の source は文字列で渡してください（受け取った型: ${typeof source}）`);
  }
  // undefined だけを省略とみなす（?? だと null も "html" に丸まる）
  const raw = options?.sourceType;
  const sourceType = raw === undefined ? "html" : assertSourceType(raw);

  let violations = lintSource(source);
  // 合成 lint（ネスト modal / interactive 内 interactive 等）は DOM パース前提なので
  // html のみ。JSX は AST が必要な別物
  if (sourceType === "html") {
    violations = violations.concat(lintComposition(source));
  }

  // 未知 severity は warn に丸められて passed: true を生む。ruleset は
  // 読み込み時に検証済みなので、ここは engine 側不整合に対する到達不能防御。
  for (const v of violations) {
    assertViolationSeverity(v.severity, v.ruleId);
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warnCount = violations.length - errorCount;

  return {
    passed: errorCount === 0,
    errorCount,
    warnCount,
    violations,
    sourceType,
  };
}

/**
 * ファイルパスの拡張子から sourceType を決める。lint CLI / hook はこれで lint() に渡す。
 *
 * - `.html` → "html"（composition まで検査）
 * - `.tsx` / `.jsx` / `.vue` → "jsx"（class + html-attr のみ）
 * - それ以外 → null（検査対象外。呼び出し側で扱いを決める）
 *
 * 大文字小文字は区別する（lint CLI の TARGET_EXT と同じ扱い）。
 */
export function sourceTypeForPath(path: string): SourceType | null {
  if (/\.html$/.test(path)) return "html";
  if (/\.(tsx|jsx|vue)$/.test(path)) return "jsx";
  return null;
}
