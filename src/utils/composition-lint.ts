/**
 * 合成 lint（S2: 合成・関係次元の検出）
 *
 * Q1〜Q6 の class / attr 検出は「部品単体の合法性」しか見ない。だが AI 生成 UI の
 * 崩壊は「部品をどう組んだか」——ネスト深さ・出現回数・色数・要素間の関係——という
 * 合成次元に宿る（監査 D4-01 / section E）。単一 class 文字列マッチでは原理的に
 * 届かないので、ここだけ DOM をパース（node-html-parser）して関係を見る。
 *
 * 設計:
 * - 対象は完全な HTML 文書/フラグメント（.html）。JSX/.tsx の合成は AST が要る別物
 *   （S4/babel）なので、呼び出し側で .html に限定して渡す。
 * - rules.json の detector="composition" + compositionCheck spec に従って判定する。
 *   spec を持つ合成ルールだけが対象（持たないものは従来どおり未検出）。
 * - 第一弾は nested-selector（ネスト modal = MODAL_NO_NESTED 蘇生）のみ。
 *   色数 / CTA 数 / カード深さは閾値較正が要るので段階導入する。
 */

import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { getAllRules } from "./loader.js";
import { COMPOSITION_CHECK_KINDS, COMPOSITION_PREDICATES } from "./detectors.js";
import { assertViolationSeverity, unsupportedCheckKind } from "./rule-diagnostics.js";
import type { CompositionCheck, LintViolation, RuleEntry } from "./types.js";

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

/** el に、自分自身を除く selector マッチの祖先がいるか */
function hasMatchingAncestor(el: HTMLElement, selector: string): boolean {
  let p = el.parentNode as HTMLElement | null;
  while (p) {
    // text node 等は matches を持たない
    if (typeof p.matches === "function" && p.matches(selector)) return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

/** el 自身、または scope 次第で祖先のいずれかが attr のどれかを持つか */
function hasAnyAttr(el: HTMLElement, attrs: string[], includeAncestors: boolean): boolean {
  const has = (node: HTMLElement) =>
    typeof node.getAttribute === "function" &&
    attrs.some((a) => {
      const v = node.getAttribute(a);
      return v != null && v !== "";
    });
  if (has(el)) return true;
  if (!includeAncestors) return false;
  let p = el.parentNode as HTMLElement | null;
  while (p) {
    if (has(p)) return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

/** ログ用に要素の開始タグを短く整形する */
function tagSnippet(el: HTMLElement): string {
  const open = el.outerHTML.slice(0, el.outerHTML.indexOf(">") + 1) || `<${el.rawTagName}>`;
  const t = open.replace(/\s+/g, " ").trim();
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

/** when 述語: この要素が候補（検査対象）に該当するか */
function qualifies(el: HTMLElement, when: string | undefined, glyphs: string[]): boolean {
  if (!when) return true;
  if (when === "icon-only") {
    // テキストを持たず svg/img/use（アイコン）だけを子孫に持つ = アイコンのみのボタン
    const text = (el.text ?? "").trim();
    if (text.length > 0) return false;
    return typeof el.querySelector === "function" && el.querySelector("svg, img, use") != null;
  }
  if (when === "text-glyph") {
    // テキストが glyphs（× 等）のみで構成される = ラベル無しの記号ボタン
    const text = (el.text ?? "").replace(/\s+/g, "");
    if (text.length === 0) return false;
    return [...text].every((c) => glyphs.includes(c));
  }
  // 未知の述語で true を返すと、excludeWhen 経由では全候補が除外されて
  // 「検査したつもりで 0 件」になる。ruleset は load 時に enum 検証済みなので
  // ここに来るのは engine 側の不整合（到達不能防御）。
  throw new Error(
    `[melta-ui] internal error: 未知の合成述語 ${JSON.stringify(when)} が qualifies に渡りました。\n` +
      `  実装済み: ${COMPOSITION_PREDICATES.join(" / ")}`
  );
}

/**
 * engine v1 が実装している合成検査の kind。
 * capability 表（detectors.ts）から導出する — ここで別定義を持たない。
 * rule.schema.json の compositionCheck.kind enum との一致は
 * tests/rule-diagnostics.spec.ts が機械照合する。
 */
export const SUPPORTED_COMPOSITION_KINDS = Object.keys(COMPOSITION_CHECK_KINDS);

/** 1 ルール分の合成検査を実行し、違反トークン列を返す */
function runCheck(check: CompositionCheck, root: HTMLElement, ruleId: string): string[] {
  if (check.kind === "nested-selector") {
    // selector マッチ要素のうち、同 selector の祖先を持つもの（= ネスト）を違反にする。
    // 兄弟として複数あるだけ（正規のショーケース）は祖先を持たないので拾わない。
    const matched = root.querySelectorAll(check.selector);
    const nested = matched.filter((el) => hasMatchingAncestor(el, check.selector));
    // 同じ違反を何件も出さず、ネストが1つでもあれば selector を token に1件返す
    return nested.length > 0 ? [`${check.selector}（ネスト ${nested.length} 箇所）`] : [];
  }

  if (check.kind === "dom-class-required") {
    // selector マッチ要素のうち excludeWhen 述語に該当しないものを候補とし、
    // requireAnyClass のいずれの class も持たないものを違反にする
    // （例: h-8/h-10 ボタンにタップ領域拡張 after:h-11 が無い）。
    const glyphs = check.glyphs ?? [];
    const hits: string[] = [];
    for (const el of root.querySelectorAll(check.selector)) {
      if (check.excludeWhen && qualifies(el, check.excludeWhen, glyphs)) continue;
      const classes = (el.getAttribute("class") ?? "").split(/\s+/);
      if (check.requireAnyClass.some((c) => classes.includes(c))) continue;
      hits.push(tagSnippet(el));
    }
    return hits;
  }

  if (check.kind === "dom-attr-required") {
    // selector マッチ要素のうち when 述語を満たすものを候補とし、
    // requireAnyAttr のいずれも（scope 次第で祖先も含めて）持たないものを違反にする。
    const includeAncestors = check.scope === "ancestor-or-self";
    const glyphs = check.glyphs ?? [];
    const hits: string[] = [];
    for (const el of root.querySelectorAll(check.selector)) {
      if (!qualifies(el, check.when, glyphs)) continue;
      if (hasAnyAttr(el, check.requireAnyAttr, includeAncestors)) continue;
      hits.push(tagSnippet(el));
    }
    return hits;
  }

  // 未知の kind を静かに 0 件で返すと「検査した」と誤認される。診断付きで落とす。
  throw unsupportedCheckKind({
    ruleId,
    specName: "compositionCheck",
    kind: (check as { kind?: unknown }).kind,
    supported: SUPPORTED_COMPOSITION_KINDS,
  });
}

/**
 * HTML 文字列を合成ルールで検査する。
 * detector="composition" かつ compositionCheck spec を持つルールだけが対象。
 */
export function lintComposition(html: string): LintViolation[] {
  const rules = getAllRules().filter(
    (r) => r.detector === "composition" && r.compositionCheck != null
  );
  if (rules.length === 0) return [];

  const root = parse(html);

  const violations: LintViolation[] = [];
  for (const rule of rules) {
    for (const token of runCheck(rule.compositionCheck!, root, rule.id)) {
      violations.push(toViolation(rule, token));
    }
  }
  return violations;
}
