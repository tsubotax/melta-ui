/**
 * 共通 lint core（①' 検出器一本化）
 *
 * AI 生成物（.html / .tsx / .jsx / .vue）の class 文字列を抽出し、
 * rules.json の自動検出ルールを matcher.ts(tokenize/matches) 経由で適用する。
 *
 * 旧構成の問題（red-team / Codex review で判明）:
 * - hook-check-rule.sh が matcher.ts を使わず独自の `cls.includes(p)` で判定し、
 *   "top-0" を "p-0" に誤検出する既知バグ(matcher.spec.ts:201 相当)を再導入していた
 * - .html かつ class="..." だけが対象で、.tsx の className / single-quote / backtick が素通り
 *
 * この module を hook / lint-generated CLI / benchmark score が共有することで、
 * 判定ロジックを一箇所（matcher.ts）に集約し drift をなくす。
 */

import { tokenize, matches, isAutoDetectable } from "./matcher.js";
import { getAllRules } from "./loader.js";
import { lintHtmlAttrs } from "./attr-lint.js";
import { assertViolationSeverity } from "./rule-diagnostics.js";
import type { RuleEntry, LintViolation } from "./types.js";

// LintViolation は types.ts に移動（attr-lint と共有するため）。
// 後方互換のため lint-core からも re-export する（lint-generated.ts 等が参照）。
export type { LintViolation } from "./types.js";

/**
 * ソース文字列から class 文字列群を抽出する。
 *
 * 対応:
 * - HTML:  class="a b"  /  class='a b'
 * - JSX:   className="a b"  /  className={'a b'}  /  className={`a b`}
 * - Vue:   :class="a b"（静的部分のみ。式は best-effort）
 *
 * 既知の限界（regex 抽出の構造的天井。完全対応は AST ベース = S4 の領域）:
 * - `className={clsx('a', cond && 'b')}` のようなクォート無し式は拾えない
 * - `className={`a ${x}`}` のテンプレ補間 `${x}` の中身は展開できない
 * - Vue `:class="{ 'a': cond }"` の object/array 構文は静的抽出できない
 * これらは検出漏れ（false negative）であり、誤検出（false positive）にはしない。
 */
export function extractClassStrings(source: string): string[] {
  // HTML コメント内の class を誤検出しないよう、抽出前にコメントを除去する
  const cleaned = source.replace(/<!--[\s\S]*?-->/g, "");

  const out: string[] = [];
  // class / className / :class の値部分（", ', ` で囲まれた範囲）を拾う。
  // 属性名の直前が単語構成文字 / `-` の場合（data-class, myclass 等）は除外。
  const attrRe =
    /(?<![\w-])(?:class|className|:class)\s*=\s*(?:\{\s*)?(["'`])([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(cleaned)) !== null) {
    out.push(m[2]);
  }
  return out;
}

/**
 * ソース文字列を lint し、自動検出ルール違反を返す。
 *
 * **範囲は class lint + html-attr lint まで。composition lint（ネスト modal /
 * interactive 内 interactive 等、DOM パース前提の合成検査）は含まない。**
 * composition は MCP `check_html`（src/tools/check-html.ts）と CI の lint CLI
 * （scripts/design/lint-generated.ts）が本関数の結果に別途足している。
 * したがって本関数の `[]` は「class / html-attr の違反なし」であって、CI や
 * check_html と同じ判定ではない。npm 公開 entry（melta-ds-mcp/lint-core）から
 * これを呼ぶ消費者は、composition が要るなら check_html を使うこと。
 * composition 込みの単一 API 化は Phase 2 S4 で扱う（2026-08-17 時点で未解決）。
 *
 * @param source 生成物のソース（HTML/JSX/Vue 文字列）
 * @returns 違反リスト（error / warn 混在。呼び出し側で severity 判定）
 */
export function lintSource(source: string): LintViolation[] {
  // 自動検出可能 かつ 文脈非依存のルールのみ。
  // requiresContext:true（py-0.5 はボタンのみ NG 等）は context-free な生成物 lint
  // では誤検出になるため除外する（contract lint と同じ扱い）。完全な文脈判定は
  // 合成 detector(S2)の領域。
  const rules = getAllRules().filter(
    (r) => isAutoDetectable(r) && !r.requiresContext
  );

  const violations: LintViolation[] = [];
  const seen = new Set<string>(); // ruleId+token の重複排除

  for (const classString of extractClassStrings(source)) {
    for (const ctx of tokenize(classString)) {
      for (const rule of rules) {
        if (!matches(rule, ctx)) continue;
        const key = `${rule.id}::${ctx.raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push(toViolation(rule, ctx.raw));
      }
    }
  }

  // class マッチでは拾えない html-attr ルール（Q5）を属性検査で追加する
  violations.push(...lintHtmlAttrs(source));

  return violations;
}

function toViolation(rule: RuleEntry, token: string): LintViolation {
  assertViolationSeverity(rule.severity, rule.id);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    token,
    category: rule.category,
    reason: rule.description,
    alternative: rule.alternative,
  };
}
