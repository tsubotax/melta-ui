/**
 * html-attr lint（Q5: 宣言だけで死んでいた html-attr ルールの部分蘇生）
 *
 * lint-core.ts の class 文字列マッチでは拾えない「属性の有無・値」を、
 * rules.json の htmlAttrCheck spec に従って raw source(HTML/JSX) に対して検査する。
 *
 * 設計の前提:
 * - cheerio 等の DOM パーサは未導入（S2 で導入予定）。よって正規表現ベース。
 * - presence/absence/値で機械判定できる最小集合のみ活性化する。
 *   role=dialog を要する modal の特定のような「何を modal とみなすか」の文脈依存判定は
 *   表現できないため対象外（htmlAttrCheck を付けない＝従来どおり dead のまま）。
 * - JSX(.tsx/.jsx) の属性名差異（tabIndex 等）は attr 名を case-insensitive 照合で吸収する。
 * - false negative（拾い漏れ）は許容するが、false positive は出さない方針。
 *   data-* 等の前置詞付き属性を誤検出しないよう negative lookbehind で境界を守る。
 */

import { getAllRules } from "./loader.js";
import type { HtmlAttrCheck, LintViolation, RuleEntry } from "./types.js";

/** 属性名の直前が単語構成文字 / `-` なら別属性（data-scope 等）→ 除外する境界 */
const ATTR_BOUNDARY = "(?<![\\w-])";

/** token をログ向けに短く切る */
function snippet(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

function toViolation(rule: RuleEntry, token: string): LintViolation {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    token,
    category: rule.category,
    reason: rule.description,
    alternative: rule.alternative,
  };
}

/** 1 ルール分の html-attr 検査を実行し、違反トークン列を返す */
function runCheck(check: HtmlAttrCheck, source: string): string[] {
  const hits: string[] = [];

  if (check.kind === "attr-value-forbidden") {
    // 例: tabindex="3" / tabIndex={3}。値が valueRegex にマッチしたら違反。
    const re = new RegExp(
      `${ATTR_BOUNDARY}${check.attr}\\s*=\\s*[{"'\\\`]?\\s*([^"'\\\`}\\s>]+)`,
      "gi"
    );
    const valRe = new RegExp(check.valueRegex);
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (valRe.test(m[1])) hits.push(`${check.attr}="${m[1]}"`);
    }
    return hits;
  }

  if (check.kind === "attr-value-contains") {
    // 例: style="background:#2250df"。クォート内の値全体を取り、valueRegex を含めば違反。
    // attr-value-forbidden と違い、空白を含む多語の値（inline style 宣言列）を対象にする。
    const re = new RegExp(`${ATTR_BOUNDARY}${check.attr}\\s*=\\s*"([^"]*)"|${ATTR_BOUNDARY}${check.attr}\\s*=\\s*'([^']*)'`, "gi");
    const valRe = new RegExp(check.valueRegex, "i");
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const value = m[1] ?? m[2] ?? "";
      if (valRe.test(value)) hits.push(`${check.attr}="${snippet(value)}"`);
    }
    return hits;
  }

  if (check.kind === "attr-present") {
    // 属性が存在するだけで違反（例: popover / commandfor = Baseline 未達機能）。
    // 属性値文字列内の同名語（title="popover を開く" 等）を拾わないよう、
    // 開始タグを抽出したうえで引用符内の値を潰してから属性名を照合する。
    // attr は正規表現の選択肢（(?:commandfor|command)）を許す。長い方を先に書く前提。
    const tagName = check.tag ?? "[a-zA-Z][\\w-]*";
    const tagRe = new RegExp(`<(?:${tagName})\\b([^>]*)>`, "g");
    const attrRe = new RegExp(`${ATTR_BOUNDARY}(?:${check.attr})(?![\\w-])`, "i");
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(source)) !== null) {
      const attrsOnly = m[1].replace(/"[^"]*"|'[^']*'/g, '""');
      if (attrRe.test(attrsOnly)) hits.push(snippet(m[0]));
    }
    return hits;
  }

  if (check.kind === "tag-present") {
    // 例: <style> ブロックの存在。1 ファイルに複数あっても token を畳んで1件にする。
    const re = new RegExp(`<${check.tag}\\b`, "i");
    if (re.test(source)) hits.push(`<${check.tag}>`);
    return hits;
  }

  if (check.kind === "tag-missing-attr") {
    // 例: <th> が scope を持たない。開始タグごとに requiredAttr の有無を見る。
    // `<th\b` の word boundary で <thead> 等は除外される。
    // 既知の制約(Codex review): 属性値内に生の `>` を含む(<th title="a>b">)と
    // [^>]* が最初の `>` で切れて誤判定しうる。実 UI では稀(本来 &gt;)で、
    // 完全対応は cheerio 化(S2)で自然に解消する想定。
    const tagRe = new RegExp(`<${check.tag}\\b([^>]*)>`, "gi");
    const attrRe = new RegExp(`${ATTR_BOUNDARY}${check.requiredAttr}\\s*=`, "i");
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(source)) !== null) {
      if (!attrRe.test(m[1])) hits.push(snippet(m[0]));
    }
    return hits;
  }

  // element-present: 例 <input type="date">
  const re = new RegExp(
    `<${check.tag}\\b[^>]*${ATTR_BOUNDARY}${check.attr}\\s*=\\s*[{"'\\\`]?\\s*${check.attrValue}\\b`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    hits.push(snippet(m[0]));
  }
  return hits;
}

/**
 * raw source(HTML/JSX) を html-attr ルールで検査する。
 * htmlAttrCheck spec を持つ html-attr ルールだけが対象（spec 無しは従来どおり未検出）。
 */
export function lintHtmlAttrs(source: string): LintViolation[] {
  // class 抽出と同様、HTML コメント内を誤検出しないよう除去する
  const cleaned = source.replace(/<!--[\s\S]*?-->/g, "");

  const rules = getAllRules().filter(
    (r) => r.detector === "html-attr" && r.htmlAttrCheck != null
  );

  const violations: LintViolation[] = [];
  const seen = new Set<string>(); // ruleId+token の重複排除
  for (const rule of rules) {
    for (const token of runCheck(rule.htmlAttrCheck!, cleaned)) {
      const key = `${rule.id}::${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(toViolation(rule, token));
    }
  }
  return violations;
}
