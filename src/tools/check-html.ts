/**
 * check_html — 生成した HTML/JSX ソース全体を lint する MCP ツール。
 *
 * check_rule（class 文字列単体のチェック）と違い、CI / lint-generated CLI /
 * PostToolUse hook と同一の合成（lintSource = class lint + html-attr lint、
 * .html はさらに composition lint）を通す。これで「生成 → 自己検証 → 修正」の
 * ループが MCP 内で完結する。
 *
 * 「violations が空 = 完全準拠」と誤読されないよう、応答には常に coverage
 * （自動検査の範囲と、検査できない manual ルールの存在）を含める。
 */

import { lintSource, type LintViolation } from "../utils/lint-core.js";
import { lintComposition } from "../utils/composition-lint.js";
import { getAllRules } from "../utils/loader.js";
import { isAutoDetectable } from "../utils/matcher.js";
import { assertViolationSeverity } from "../utils/rule-diagnostics.js";

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
    `[melta-ui] check_html の sourceType が不正です: ${JSON.stringify(value)}。` +
      `許容値は ${SOURCE_TYPES.map((s) => `"${s}"`).join(" / ")}（省略時は "html"）`
  );
}

export interface CheckHtmlResult {
  passed: boolean;
  errorCount: number;
  warnCount: number;
  violations: LintViolation[];
  coverage: {
    automated: string;
    notAutomated: string;
  };
}

export function checkHtml(source: string, sourceType?: SourceType): CheckHtmlResult {
  // undefined だけを省略とみなす（?? だと null も "html" に丸まる）
  const st = sourceType === undefined ? "html" : assertSourceType(sourceType);
  let violations = lintSource(source);
  // 合成 lint（ネスト modal / interactive 内 interactive 等）は DOM パース前提なので
  // html のみ。JSX は AST が必要な別物（lint-generated.ts と同じ扱い）
  if (st === "html") {
    violations = violations.concat(lintComposition(source));
  }

  // 未知 severity は warn に丸められて passed: true を生む。ruleset は
  // 読み込み時に検証済みなので、ここは engine 側不整合に対する到達不能防御。
  for (const v of violations) {
    assertViolationSeverity(v.severity, v.ruleId);
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warnCount = violations.length - errorCount;

  const rules = getAllRules();
  // カバレッジは rule ID の集合演算で数える。単純な件数の足し算だと、
  // 複数の検査経路に該当するルール（例: class detector と htmlAttrCheck の両方を持つ）が
  // 二重計上され、manualCount が負にもなりうる。
  // melta 自身の ruleset では重複ゼロだが、第三者 ruleset では普通に起こる。
  // 各集合は「実際に走る条件」と一致させること（宣言があるだけで走らない spec は数えない）。
  const classIds = new Set<string>();
  const attrIds = new Set<string>();
  const compositionIds = new Set<string>();
  for (const r of rules) {
    if (isAutoDetectable(r) && !r.requiresContext) classIds.add(r.id);
    if (r.detector === "html-attr" && r.htmlAttrCheck != null) attrIds.add(r.id);
    if (r.detector === "composition" && r.compositionCheck != null) compositionIds.add(r.id);
  }
  const automatedIds = new Set<string>([
    ...classIds,
    ...attrIds,
    ...(st === "html" ? compositionIds : []),
  ]);
  const autoCount = classIds.size;
  const attrCount = attrIds.size;
  const compositionCount = compositionIds.size;
  const automatedTotal = automatedIds.size;
  const manualCount = rules.length - automatedTotal;

  return {
    passed: errorCount === 0,
    errorCount,
    warnCount,
    violations,
    coverage: {
      automated: `${rules.length} ルール中 ${automatedTotal} 件を自動検査（class: ${autoCount} / html-attr: ${attrCount}${st === "html" ? ` / composition: ${compositionCount}` : ""}）`,
      // 未検査の内訳は detector="manual" だけではない（spec を持たない html-attr /
      // composition ルールも含む）。get_rules({detector:"manual"}) だけを案内すると
      // 該当ルールに辿り着けないため、実際に発見できる経路を書く。
      // jsx では composition が丸ごと未検査になる。件数からは除外済みだが、
      // 「jsx だから外れた」ことを説明文でも明示しないと違反ゼロが完全準拠に見える。
      notAutomated:
        `残り ${manualCount} 件はこのツールでは検査されない（detector="manual" のほか、検査 spec を持たない html-attr / composition ルールと、pattern を持たない class ルールを含む。interaction test 担保 / 静的検出不能 / 文脈依存。理由は各ルールの automationStatus 参照）。` +
        (st === "jsx"
          ? `sourceType="jsx" のため composition ルール ${compositionCount} 件は未検査（DOM パース前提のため。HTML として検査するなら sourceType="html"）。`
          : "") +
        `violations が空でも完全準拠の保証ではないため、必要に応じて get_rules() で全件を取得し automationStatus を確認すること`,
    },
  };
}
