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

export type SourceType = "html" | "jsx";

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

export function checkHtml(source: string, sourceType: SourceType = "html"): CheckHtmlResult {
  let violations = lintSource(source);
  // 合成 lint（ネスト modal / interactive 内 interactive 等）は DOM パース前提なので
  // html のみ。JSX は AST が必要な別物（lint-generated.ts と同じ扱い）
  if (sourceType === "html") {
    violations = violations.concat(lintComposition(source));
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warnCount = violations.length - errorCount;

  const rules = getAllRules();
  const autoCount = rules.filter((r) => isAutoDetectable(r) && !r.requiresContext).length;
  const attrCount = rules.filter((r) => r.htmlAttrCheck != null).length;
  const compositionCount = rules.filter((r) => r.detector === "composition").length;
  const automatedTotal =
    autoCount + attrCount + (sourceType === "html" ? compositionCount : 0);
  const manualCount = rules.length - automatedTotal;

  return {
    passed: errorCount === 0,
    errorCount,
    warnCount,
    violations,
    coverage: {
      automated: `${rules.length} ルール中 ${automatedTotal} 件を自動検査（class: ${autoCount} / html-attr: ${attrCount}${sourceType === "html" ? ` / composition: ${compositionCount}` : ""}）`,
      notAutomated: `残り ${manualCount} 件はこのツールでは検査されない（interaction test 担保 / 静的検出不能 / 文脈依存の manual を含む。経路は各ルールの automationStatus 参照）。violations が空でも完全準拠の保証ではないため、必要に応じて get_rules({detector:"manual"}) を確認すること`,
    },
  };
}
