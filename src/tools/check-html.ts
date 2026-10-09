/**
 * check_html — 生成した HTML/JSX ソース全体を lint する MCP ツール。
 *
 * check_rule（class 文字列単体のチェック）と違い、CI / lint CLI（melta-lint）/
 * PostToolUse hook / npm 公開 entry（melta-ds-mcp/lint）と同じ `lint()`
 * （src/utils/lint.ts。class lint + html-attr lint、.html はさらに composition lint）を通す。
 * 合否はここで合成せず lint() の結果をそのまま使う。これで「生成 → 自己検証 → 修正」の
 * ループが MCP 内で完結し、CI と判定が食い違わない。
 *
 * 「violations が空 = 完全準拠」と誤読されないよう、応答には常に coverage
 * （自動検査の範囲と、検査できない manual ルールの存在）を含める。
 */

import { lint, type LintViolation, type SourceType } from "../utils/lint.js";
import { getAllRules } from "../utils/loader.js";
import { isAutoDetectable } from "../utils/matcher.js";

// SOURCE_TYPES / assertSourceType / SourceType は lint.ts へ移した。
// 既存の import 元（src/server.ts、tests/mcp-server.spec.ts 等）を壊さないよう re-export する。
export { SOURCE_TYPES, assertSourceType } from "../utils/lint.js";
export type { SourceType } from "../utils/lint.js";

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
  // sourceType の検証（undefined = 省略 → "html"、null / 未知の値は throw）と
  // severity の防御は lint() 側に一本化している
  const { passed, errorCount, warnCount, violations, sourceType: st } = lint(source, {
    sourceType,
  });

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
    passed,
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
