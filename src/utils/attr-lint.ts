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
import { HTML_ATTR_CHECK_KINDS } from "./detectors.js";
import {
  assertViolationSeverity,
  compileRuleRegExp,
  unsupportedCheckKind,
} from "./rule-diagnostics.js";
import type { HtmlAttrCheck, LintViolation, RuleEntry } from "./types.js";

/** 属性名の直前が単語構成文字 / `-` なら別属性（data-scope 等）→ 除外する境界 */
const ATTR_BOUNDARY = "(?<![\\w-])";

/** token をログ向けに短く切る */
function snippet(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
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

/**
 * engine v1 が実装している html-attr 検査の kind。
 * capability 表（detectors.ts）から導出する — ここで別定義を持たない。
 * rule.schema.json の htmlAttrCheck.kind enum との一致は
 * tests/rule-diagnostics.spec.ts が機械照合する。
 */
export const SUPPORTED_ATTR_KINDS = Object.keys(HTML_ATTR_CHECK_KINDS);

/** 1 ルール分の html-attr 検査を実行し、違反トークン列を返す */
function runCheck(check: HtmlAttrCheck, source: string, ruleId: string): string[] {
  const hits: string[] = [];

  if (check.kind === "attr-value-forbidden") {
    // 例: tabindex="3" / tabIndex={3}。値が valueRegex にマッチしたら違反。
    const re = compileRuleRegExp({
      pattern: `${ATTR_BOUNDARY}${check.attr}\\s*=\\s*[{"'\\\`]?\\s*([^"'\\\`}\\s>]+)`,
      flags: "gi",
      ruleId,
      field: "htmlAttrCheck.attr",
    });
    const valRe = compileRuleRegExp({
      pattern: check.valueRegex,
      ruleId,
      field: "htmlAttrCheck.valueRegex",
    });
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (valRe.test(m[1])) hits.push(`${check.attr}="${m[1]}"`);
    }
    return hits;
  }

  if (check.kind === "attr-value-contains") {
    // 例: style="background:#2250df"。クォート内の値全体を取り、valueRegex を含めば違反。
    // attr-value-forbidden と違い、空白を含む多語の値（inline style 宣言列）を対象にする。
    const re = compileRuleRegExp({
      pattern: `${ATTR_BOUNDARY}${check.attr}\\s*=\\s*"([^"]*)"|${ATTR_BOUNDARY}${check.attr}\\s*=\\s*'([^']*)'`,
      flags: "gi",
      ruleId,
      field: "htmlAttrCheck.attr",
    });
    const valRe = compileRuleRegExp({
      pattern: check.valueRegex,
      flags: "i",
      ruleId,
      field: "htmlAttrCheck.valueRegex",
    });
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
    const tagRe = compileRuleRegExp({
      pattern: `<(?:${tagName})\\b([^>]*)>`,
      flags: "g",
      ruleId,
      field: "htmlAttrCheck.tag",
    });
    const attrRe = compileRuleRegExp({
      pattern: `${ATTR_BOUNDARY}(?:${check.attr})(?![\\w-])`,
      flags: "i",
      ruleId,
      field: "htmlAttrCheck.attr",
    });
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(source)) !== null) {
      const attrsOnly = m[1].replace(/"[^"]*"|'[^']*'/g, '""');
      if (attrRe.test(attrsOnly)) hits.push(snippet(m[0]));
    }
    return hits;
  }

  if (check.kind === "tag-present") {
    // 例: <style> ブロックの存在。1 ファイルに複数あっても token を畳んで1件にする。
    const re = compileRuleRegExp({
      pattern: `<${check.tag}\\b`,
      flags: "i",
      ruleId,
      field: "htmlAttrCheck.tag",
    });
    if (re.test(source)) hits.push(`<${check.tag}>`);
    return hits;
  }

  if (check.kind === "tag-missing-attr") {
    // 例: <th> が scope を持たない。開始タグごとに requiredAttr の有無を見る。
    // `<th\b` の word boundary で <thead> 等は除外される。
    // 既知の制約(Codex review): 属性値内に生の `>` を含む(<th title="a>b">)と
    // [^>]* が最初の `>` で切れて誤判定しうる。実 UI では稀(本来 &gt;)で、
    // 完全対応は cheerio 化(S2)で自然に解消する想定。
    const tagRe = compileRuleRegExp({
      pattern: `<${check.tag}\\b([^>]*)>`,
      flags: "gi",
      ruleId,
      field: "htmlAttrCheck.tag",
    });
    const attrRe = compileRuleRegExp({
      pattern: `${ATTR_BOUNDARY}${check.requiredAttr}\\s*=`,
      flags: "i",
      ruleId,
      field: "htmlAttrCheck.requiredAttr",
    });
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(source)) !== null) {
      if (!attrRe.test(m[1])) hits.push(snippet(m[0]));
    }
    return hits;
  }

  if (check.kind === "element-present") {
    // 例: <input type="date">
    const re = compileRuleRegExp({
      pattern: `<${check.tag}\\b[^>]*${ATTR_BOUNDARY}${check.attr}\\s*=\\s*[{"'\\\`]?\\s*${check.attrValue}\\b`,
      flags: "gi",
      ruleId,
      field: "htmlAttrCheck.tag / attr / attrValue",
    });
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      hits.push(snippet(m[0]));
    }
    return hits;
  }

  // 未知の kind が element-present 分岐へフォールスルーすると、undefined を
  // 埋め込んだ正規表現で「誤った検査を無言で実行」してしまう。診断付きで落とす。
  throw unsupportedCheckKind({
    ruleId,
    specName: "htmlAttrCheck",
    kind: (check as { kind?: unknown }).kind,
    supported: SUPPORTED_ATTR_KINDS,
  });
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
    for (const token of runCheck(rule.htmlAttrCheck!, cleaned, rule.id)) {
      const key = `${rule.id}::${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(toViolation(rule, token));
    }
  }
  return violations;
}
