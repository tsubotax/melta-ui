/** Token value with Tailwind class mapping */
export interface TokenValue {
  value: string | number | string[];
  tailwind?: string;
  cssVar?: string;
  px?: number;
  rem?: string;
  size?: string;
  lineHeight?: string;
  [key: string]: unknown;
}

/** tokens.json root structure */
export interface Tokens {
  version: string;
  color: {
    primary: Record<string, TokenValue>;
    body: TokenValue;
    semantic: {
      light: Record<string, TokenValue>;
      dark: Record<string, TokenValue>;
    };
    status: Record<string, Record<string, TokenValue>>;
  };
  typography: {
    fontFamily: Record<string, TokenValue>;
    fontSize: Record<string, TokenValue>;
    fontWeight: Record<string, TokenValue>;
    letterSpacing: Record<string, TokenValue>;
    lineHeight: Record<string, TokenValue>;
  };
  spacing: Record<string, TokenValue>;
  elevation: Record<string, TokenValue>;
  radius: Record<string, TokenValue>;
  motion: {
    duration: Record<string, TokenValue>;
    easing: Record<string, TokenValue>;
  };
  zIndex: Record<string, TokenValue>;
  wireframe?: Record<string, TokenValue>;
}

/** Component variant */
export interface ComponentVariant {
  name: string;
  tailwind: string;
}

/** Component size */
export interface ComponentSize {
  name: string;
  tailwind: string;
}

/** Component accessibility spec */
export interface ComponentAccessibility {
  role: string;
  required: string[];
  focusRing: string;
}

/** state ごとの生成仕様（P2-1）。tailwind は base/variant からの差分クラスのみ */
export interface StateSpec {
  description: string;
  tailwind: string;
  ariaChanges?: string;
  htmlNote?: string;
}

/** anatomy part（object 形式時の各パーツ。Phase1 移行形 — 簡易は string[] 据置） */
export interface AnatomyPart {
  description: string;
  element?: string;
  roles?: string;
  tailwind?: string;
}

/** Single component metadata */
export interface ComponentMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  docPath: string;
  /** Phase1 移行形: 簡易は string[]、複合は part 名→AnatomyPart の object */
  anatomy?: string[] | Record<string, AnatomyPart>;
  variants: ComponentVariant[];
  sizes: ComponentSize[];
  /** UI 状態の列挙（melta-app が codegen で読む。byte-identical 維持） */
  states?: string[];
  /** state ごとの生成仕様（opt-in）。keys(stateSpecs) ⊆ states を validate.ts が担保 */
  stateSpecs?: Record<string, StateSpec>;
  /** プラットフォーム分岐の意味論宣言（規範部、P3）。分岐の具象値は recipes 側 */
  platformSemantics?: Record<string, string>;
  /** APP(RN) 実装の状態宣言。implemented ⇔ recipes/app 存在を validate が担保。差分表の生成元 */
  appStatus?: "implemented" | "planned" | "not-planned";
  /** web からの写像形態（appStatus と直交）。省略時 native。adapted は appNote に変換先必須 */
  appMapping?: "native" | "adapted";
  /** appStatus / appMapping の補足（adapted の変換先 / not-planned の理由） */
  appNote?: string;
  /** プラットフォーム別具象レシピ（P3）。app = RN styleRefs（recipes/app/ 由来）。web の tailwind は variants に既存 */
  recipes?: { app?: Record<string, unknown> };
  accessibility: ComponentAccessibility;
  prohibited: string[];
  htmlSample: string | Record<string, string>;
}

/** components.json root structure */
export interface ComponentsData {
  version: string;
  components: ComponentMeta[];
}

/**
 * html-attr ルールの機械可読検出仕様（Q5）。
 * cheerio 等の DOM パーサ未導入のため正規表現ベースで presence/absence/値を判定する。
 * 文脈依存（role=dialog を要する modal の特定など）は表現できず、対象外。
 */
export type HtmlAttrCheck =
  /** attr の値（空白区切りの単一トークン）が valueRegex にマッチしたら違反（例: tabindex の正値） */
  | { kind: "attr-value-forbidden"; attr: string; valueRegex: string }
  /** attr の値（クォート内全体）が valueRegex を含めば違反（例: inline style 内の hardcoded color） */
  | { kind: "attr-value-contains"; attr: string; valueRegex: string }
  /** tag が requiredAttr を持たなければ違反（例: <th> の scope 欠落） */
  | { kind: "tag-missing-attr"; tag: string; requiredAttr: string }
  /** tag[attr=attrValue] が存在したら違反（例: <input type="date"> の native datepicker） */
  | { kind: "element-present"; tag: string; attr: string; attrValue: string }
  /** tag が存在するだけで違反（例: 生 CSS の <style> ブロック） */
  | { kind: "tag-present"; tag: string }
  /**
   * attr が任意の要素（tag 指定時はその要素）に存在するだけで違反（例: popover / commandfor）。
   * attr は正規表現の選択肢（(?:commandfor|command) 等）を許す（Baseline 検知で複数属性を1ルールに束ねるため）
   */
  | { kind: "attr-present"; attr: string; tag?: string };

/**
 * 合成検出（S2）の機械可読 spec。
 * 単一 class 文字列では届かない「要素間の関係・出現回数・ネスト・色数」を
 * DOM パース（node-html-parser）して判定する。対象は完全な HTML 文書/フラグメント。
 */
export type CompositionCheck =
  /** selector にマッチする要素の子孫に、同じ selector が現れたら違反（例: ネスト modal） */
  | { kind: "nested-selector"; selector: string }
  /**
   * selector にマッチする要素が requireAnyAttr のいずれも持たなければ違反（a11y 属性の欠落）。
   * - scope: 属性の存在場所。"self"（既定）or "ancestor-or-self"（コンテナに付いていれば可）
   * - when: 候補を絞る述語。"icon-only"=テキスト無し&svg/img 子を持つ / "text-glyph"=テキストが glyphs のみ
   * - glyphs: when="text-glyph" 用のグリフ集合（例: × ✕）
   * DOM 必須かつ「何が active/modal か」のような意味依存を含まない、静的に検出可能なものだけに使う。
   */
  | {
      kind: "dom-attr-required";
      selector: string;
      requireAnyAttr: string[];
      scope?: "self" | "ancestor-or-self";
      when?: "icon-only" | "text-glyph";
      glyphs?: string[];
    }
  /**
   * selector にマッチする要素が requireAnyClass のいずれの class も持たなければ違反
   * （例: 小サイズボタンのタップ領域拡張 after:h-11 の欠落）。
   * - excludeWhen: 候補から除外する述語（icon-only = 幅拡張が別式のため第一弾対象外）
   */
  | {
      kind: "dom-class-required";
      selector: string;
      requireAnyClass: string[];
      excludeWhen?: "icon-only" | "text-glyph";
      glyphs?: string[];
    };

/** rules.json の rule entry（SSOT raw 型） */
export interface RuleEntry {
  id: string;
  category: string;
  severity: "error" | "warn";
  description: string;
  detector: "tailwind-class" | "tailwind-class-prefix" | "tailwind-class-segment" | "html-attr" | "composition" | "manual";
  pattern: string | null;
  matchPatterns?: string[];
  /** tailwind-class-prefix 専用の純粋な前方一致パターン（任意値回避経路の検知用）。matchPatterns（完全一致 + /modifier）とは意味論が異なる */
  prefixPatterns?: string[];
  alternative: string;
  /** P1b contract lint での適用方針。required（rules.json schema でも required 化済み） */
  contractLint: "enforce" | "warn" | "skip";
  /** true の場合、ルールは特定の文脈でのみ NG。contract lint からは skip するが、AI には参照させたい */
  requiresContext?: boolean;
  /** detector="html-attr" のうち機械判定できるものに付与（Q5）。属性検査の spec */
  htmlAttrCheck?: HtmlAttrCheck;
  /** detector="composition" に付与（S2）。DOM 合成検査の spec */
  compositionCheck?: CompositionCheck;
  /**
   * 現在の自動検証状態（P1-5、棚卸しは 2026-07）。カバレッジ集計の意味を明示する:
   * - "auto": class/attr/composition で静的に自動検出される
   * - "covered-by-test": 静的検出はしないが Playwright 等の interaction test で担保
   * - "impossible-static": 「どれが active/modal/selected か」等の意味依存で静的検出は原理的に不能
   *   （静的検出可能性の軸。runtime test での検証とは独立 — MODAL_ROLE_DIALOG_REQUIRED が実証）
   * - "llm-judge-candidate": 現在は自動検証なし。将来の LLM 審査（shadow judge）候補（計画であり稼働中の検証ではない）
   * - "human-only": 現在は自動検証なし。人間レビューでのみ守る
   * 省略時は detector から導出（manual 以外で pattern/check を持てば auto 相当）。
   */
  automationStatus?: "auto" | "covered-by-test" | "impossible-static" | "llm-judge-candidate" | "human-only";
}

/** lint-core / attr-lint が返す 1 件の違反 */
export interface LintViolation {
  ruleId: string;
  severity: "error" | "warn";
  /** 違反した実際の class token / 属性スニペット（raw） */
  token: string;
  category: string;
  reason: string;
  alternative: string;
}

/** rules.json ファイル全体 */
export interface RulesFile {
  version: string;
  rules: RuleEntry[];
}

/** get_rules / getAllRules で使う絞り込み条件 */
export interface RuleFilter {
  category?: string;
  severity?: "error" | "warn";
  detector?: "tailwind-class" | "tailwind-class-prefix" | "tailwind-class-segment" | "html-attr" | "composition" | "manual";
}

/**
 * Tailwind class token の正規化結果。
 * matcher.tokenize() の出力 / matcher.matches() の入力。
 *
 * 例: "hover:!bg-blue-500" → { raw: "hover:!bg-blue-500", base: "bg-blue-500",
 *                              variants: ["hover"], important: true }
 */
export interface MatchContext {
  raw: string;
  base: string;
  variants: string[];
  important: boolean;
}

/** check_rule が使う展開済みルール型（matchPatterns 展開後） */
export interface ProhibitionRule {
  ruleId: string;
  severity: "error" | "warn";
  pattern: string;
  reason: string;
  alternative: string;
}

/** check_rule の violation 出力 */
export interface Violation {
  ruleId: string;
  severity: "error" | "warn";
  class: string;
  reason: string;
  alternative: string;
  /** requiresContext ルール由来。特定の文脈（例: py-0.5 はボタンのみ）でのみ違反 */
  conditional?: boolean;
}

/** P4 benchmark 用 — provider abstraction signature（B8 前倒し） */
export interface GenerationResult {
  text: string;
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
    result: unknown;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  latencyMs: number;
  resourcesAccessed?: string[];
}

/** generate のオプション。ベンチの条件（cold / designmd / full）で tools 有無を切り替える */
export interface GenerateOptions {
  /** MCP ツールを渡すか（false なら静的コンテキストのみ。デフォルト true で後方互換） */
  useTools?: boolean;
  /** サンプリング temperature（trial 間の自然なばらつきを得るため。未指定は provider 既定） */
  temperature?: number;
}

export interface ModelProvider {
  id: string;
  generate(
    system: string,
    prompt: string,
    opts?: GenerateOptions
  ): Promise<GenerationResult>;
}
