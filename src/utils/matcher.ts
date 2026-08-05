/**
 * Tailwind-aware rule matcher（P1a）
 *
 * rules.json の自動検出ルール（detectors.ts の capability 表で
 * autoDetectable=true と宣言された detector）を
 * Tailwind class string に対して適用するための共通 utility。
 * check_rule と P1b の contract lint の双方が使う。
 *
 * 旧実装（src/tools/check-rule.ts の cls.includes）の問題:
 * - "top-0" が pattern "p-0" (SPACE_NO_P0_CARDS) に誤検出される
 * - "hover:bg-blue-500" の variant prefix が剥がれず、prefix matcher の挙動が不安定
 *
 * 新実装の方針:
 * - class token を Tailwind-aware に正規化（variant / important / arbitrary 対応）
 * - detector 別にマッチング規則を分離
 *   - tailwind-class: base との完全一致
 *   - tailwind-class-prefix: base の prefix 一致
 */

import { DETECTOR_CAPABILITIES, isKnownDetector } from "./detectors.js";
import type { MatchSource } from "./detectors.js";
import type { MatchContext, RuleEntry } from "./types.js";

/**
 * Tailwind class string を MatchContext[] に正規化する。
 *
 * 対応する変換:
 * - 通常 variant: "hover:bg-blue-500" → variants=["hover"], base="bg-blue-500"
 * - 複数 variant: "md:hover:bg-blue-500" → variants=["md","hover"], base="bg-blue-500"
 * - !important: "!text-black" → important=true, base="text-black"
 * - variant + !important: "md:!text-black" → variants=["md"], important=true, base="text-black"
 * - arbitrary variant: "[&>*]:p-0" → variants=["[&>*]"], base="p-0"
 * - arbitrary value: "space-x-[12px]" → base="space-x-[12px]" (variant にしない)
 */
export function tokenize(classString: string): MatchContext[] {
  return classString
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(parseToken);
}

function parseToken(raw: string): MatchContext {
  const variants: string[] = [];
  let rest = raw;

  while (true) {
    if (rest.startsWith("[")) {
      const closeIdx = findMatchingBracket(rest, 0);
      if (closeIdx !== -1 && rest[closeIdx + 1] === ":") {
        variants.push(rest.substring(0, closeIdx + 1));
        rest = rest.substring(closeIdx + 2);
        continue;
      }
      // 対応する `]:` がない（孤立した `[` で始まる token）→ そのまま base 扱い
      break;
    }

    const colonIdx = findVariantColon(rest);
    if (colonIdx > 0) {
      variants.push(rest.substring(0, colonIdx));
      rest = rest.substring(colonIdx + 1);
      continue;
    }
    break;
  }

  const important = rest.startsWith("!");
  const base = important ? rest.substring(1) : rest;
  return { raw, base, variants, important };
}

/** ネスト対応の角括弧ペア検索。ペアが見つからなければ -1 */
function findMatchingBracket(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * variant 用の `:` 位置を探す。
 * - `[...]` 内部の `:` はスキップ
 * - `!` が出てきたら variant 部分は終わり（base に来た）
 */
function findVariantColon(s: string): number {
  let i = 0;
  while (i < s.length) {
    if (s[i] === "[") {
      const close = findMatchingBracket(s, i);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (s[i] === ":") return i;
    if (s[i] === "!") return -1;
    i++;
  }
  return -1;
}

/**
 * rule が ctx に対してマッチするか判定する。
 *
 * - tailwind-class: base が pattern または matchPatterns のいずれかと完全一致
 * - tailwind-class-prefix: base が pattern で始まる / matchPatterns と完全一致（+ /modifier）/
 *   prefixPatterns で始まる、のいずれか
 * - html-attr / manual: class matching では検出不可（false）
 */
/**
 * rule が matches() で自動検出可能か（= class 文字列マッチで判定できるか）の単一述語。
 *
 * lint-core / check_rule(MCP) / getProhibitionRules / contract lint が
 * 各自で detector 名と pattern の有無を散在的に判定していたのを一本化する。
 * detector を増やしたとき consumer 全体が追従するよう、判定はここ1箇所に集約する。
 */
export function isAutoDetectable(rule: RuleEntry): boolean {
  if (!isKnownDetector(rule.detector)) return false;
  const capability = DETECTOR_CAPABILITIES[rule.detector];
  if (!capability.autoDetectable) return false;
  // 「pattern 系を何か持っている」ではなく「この detector の matches() が
  // 実際に参照するフィールドを持っている」で判定する。
  // 例: tailwind-class-segment は matchPatterns しか読まないので、
  // pattern だけのルールを automated と数えると永久に未検出のまま合格扱いになる。
  return capability.matchSources.some((f) => hasMatchSource(rule, f));
}

/**
 * ルールを「実際に照合されるパターン文字列」の列へ展開する。
 *
 * 展開規則は loader.getProhibitionRules の実装が正で、
 * カバレッジ報告・legacy 互換レポートもここから数える
 * （かつて report 側が prefixPatterns を数えず、実数 65 に対し 44 と報告していた）。
 */
export function expandRulePatterns(rule: RuleEntry): string[] {
  const out: string[] = [];
  if (rule.matchPatterns && rule.matchPatterns.length > 0) {
    out.push(...rule.matchPatterns);
  } else if (rule.pattern != null) {
    out.push(rule.pattern);
  }
  out.push(...(rule.prefixPatterns ?? []));
  return out;
}

/**
 * rule が指定の pattern 系フィールドを実質的に持っているか。
 *
 * 空文字は「持っていない」とみなす。matches() 側は `if (rule.pattern)` の
 * truthy 判定なので、pattern:"" を「有り」と数えると
 * 自動検査済みなのに永久に未検出（= passed:true）になる。
 * 空文字宣言そのものは assertValidRules が不正として弾く。
 */
export function hasMatchSource(rule: RuleEntry, field: MatchSource): boolean {
  if (field === "pattern") return typeof rule.pattern === "string" && rule.pattern.length > 0;
  const list = rule[field];
  return Array.isArray(list) && list.some((p) => typeof p === "string" && p.length > 0);
}

/**
 * **フィールド併記時の実挙動（仕様として固定。tests/rule-diagnostics.spec.ts が回帰を守る）**:
 * - `prefixPatterns` は **ヒットしたときだけ** 判定を返す（外れたら次のフィールドへ進む = fallthrough）
 * - `matchPatterns` は **存在した時点で終端**（外れても false を返し、pattern は読まれない = short-circuit）
 * - `pattern` は matchPatterns が無いときにだけ読まれる
 *
 * この非対称は capability 表の matchSources の並び順だけでは表現できない。
 * 「どのフィールドが必須か」ごと再定義するのは S1+S2
 * （internal/phase2-plan.md の §S1+S2 に記録した三重不整合を参照）。
 */
export function matches(rule: RuleEntry, ctx: MatchContext): boolean {
  if (rule.detector === "tailwind-class") {
    if (rule.matchPatterns && rule.matchPatterns.length > 0) {
      return rule.matchPatterns.includes(ctx.base);
    }
    if (rule.pattern) {
      return ctx.base === rule.pattern;
    }
    return false;
  }

  if (rule.detector === "tailwind-class-segment") {
    // base を "-" で分割し、いずれかの segment が matchPatterns に完全一致したら違反。
    // 色ファミリー（purple/violet 等）を property 非依存で検出するための detector。
    // segment 単位の完全一致なので substring 誤検出（top-0→p-0 系）は起きない。
    // 例: "bg-purple-500" → ["bg","purple","500"]、"from-purple-400" → ["from","purple","400"]
    if (!rule.matchPatterns || rule.matchPatterns.length === 0) return false;
    const segments = ctx.base.split("-");
    return segments.some((seg) => rule.matchPatterns!.includes(seg));
  }

  if (rule.detector === "tailwind-class-prefix") {
    // prefixPatterns は純粋な前方一致（bg-[rgb( / text-[hsl( 等、任意値による
    // パレット回避経路の検知用）。matchPatterns の完全一致セマンティクスを
    // 変えると bg-gray-300x 偽陽性ガードが壊れるため、別フィールドで追加する。
    if (rule.prefixPatterns?.some((p) => ctx.base.startsWith(p))) {
      return true;
    }
    if (rule.matchPatterns && rule.matchPatterns.length > 0) {
      // matchPatterns は具体クラス名の列。完全一致 + opacity modifier (`/`) のみ
      // 拡張を許可する。`bg-gray-300x` のような偽 token を拾わないため。
      return rule.matchPatterns.some(
        (p) => ctx.base === p || ctx.base.startsWith(`${p}/`)
      );
    }
    if (rule.pattern) {
      // pattern 直接指定（例: "bg-blue-"）は末尾区切り意図の prefix なので
      // startsWith のままで意図通り（`bg-blue-500` も `bg-blue-500/20` も対象）
      return ctx.base.startsWith(rule.pattern);
    }
    return false;
  }

  return false;
}
