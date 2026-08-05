/**
 * detector capability 表 — engine が「何を実装しているか」の単一ソース。
 *
 * 実測（Phase 2）で、detector の全集合は 5 箇所に重複定義されていた
 * （rule.schema.json / types.ts の union 2 箇所 / server.ts の MCP enum / validate.ts）。
 * 現時点では全部一致しているが同期機構はゼロで、派生述語（matcher の
 * AUTO_DETECTABLE_DETECTORS）とコメントは既にズレていた。
 *
 * ここを唯一の真理にして、consumer は導出で追従する。
 * S0 では matcher と ruleset 検証をここに寄せ、
 * types.ts / server.ts / validate.ts の導出は S1 で行う。
 *
 * 汎用化（第三者 ruleset）の観点では、この表は
 * 「engine v1 が評価できる detector と、その detector が実際に参照するフィールド」の宣言。
 * ここに無い detector や、宣言しても参照されないフィールドは
 * **黙って素通りさせず診断で落とす**（G-C）。
 */

/** matcher.matches() が参照しうる pattern 系フィールド */
export type MatchSource = "pattern" | "matchPatterns" | "prefixPatterns";

export interface DetectorCapability {
  /** class 文字列マッチ（matcher.matches）で判定できるか */
  autoDetectable: boolean;
  /**
   * この detector の matches() が実際に参照するフィールド。
   * 宣言されていても**ここに無いフィールドは読まれない**（= 書いても効かない）。
   * autoDetectable=false の detector では空。
   *
   * **並び順は matches() の評価順**。ただし各フィールドの終端条件は同じではない
   * （prefixPatterns は miss なら次へ進み、matchPatterns は存在するだけで終端する）。
   * 正確な意味論は matcher.matches() の doc comment を正とする。
   * 順序だけでこの非対称を表現できないことが、S1+S2 で「必須性ごと再定義」する理由。
   */
  matchSources: readonly MatchSource[];
  /**
   * この detector の検査を駆動する check spec のフィールド名。不要なら null。
   * 「所有関係」であって必須性ではない（specRequired を参照）。
   */
  specField: "htmlAttrCheck" | "compositionCheck" | null;
  /**
   * spec が無いルールを不正とみなすか。
   * 実測: melta の html-attr 11 件中 4 件は意図的に spec を持たない
   * （文脈依存で静的表現できないものを「宣言だけ残す」既存イディオム）。
   * よって現状は全 detector で false。「許容するが未検査」は S3 の capability 診断で露出させる。
   */
  specRequired: boolean;
  /** 何を見る detector か（診断メッセージ用） */
  summary: string;
}

export const DETECTOR_CAPABILITIES = {
  "tailwind-class": {
    autoDetectable: true,
    matchSources: ["matchPatterns", "pattern"],
    specField: null,
    specRequired: false,
    summary: "class token の完全一致",
  },
  "tailwind-class-prefix": {
    autoDetectable: true,
    matchSources: ["prefixPatterns", "matchPatterns", "pattern"],
    specField: null,
    specRequired: false,
    summary: "class token の前方一致（+ opacity modifier）",
  },
  "tailwind-class-segment": {
    autoDetectable: true,
    matchSources: ["matchPatterns"],
    specField: null,
    specRequired: false,
    summary: "class token を区切りで分割した segment の一致",
  },
  "html-attr": {
    autoDetectable: false,
    matchSources: [],
    specField: "htmlAttrCheck",
    specRequired: false,
    summary: "属性の有無・値（htmlAttrCheck spec があるものだけ検査される）",
  },
  composition: {
    autoDetectable: false,
    matchSources: [],
    specField: "compositionCheck",
    specRequired: false,
    summary: "DOM 上の要素間の関係（compositionCheck spec があるものだけ検査される）",
  },
  manual: {
    autoDetectable: false,
    matchSources: [],
    specField: null,
    specRequired: false,
    summary: "静的検査の対象外（人間 / テストが担保）",
  },
} as const satisfies Record<string, DetectorCapability>;

export type KnownDetector = keyof typeof DETECTOR_CAPABILITIES;

/** engine v1 が解釈できる detector の全集合 */
export const KNOWN_DETECTORS = Object.keys(DETECTOR_CAPABILITIES) as KnownDetector[];

/** class 文字列マッチで自動検出できる detector（AUTO_DETECTABLE_DETECTORS の実体） */
export const AUTO_DETECTABLE_DETECTORS = KNOWN_DETECTORS.filter(
  (d) => DETECTOR_CAPABILITIES[d].autoDetectable
);

/**
 * check spec の kind ごとに、engine の実装が実際に読むフィールド。
 * ここも capability 表の一部（= engine が何を実装しているかの宣言）。
 *
 * required を欠くと「undefined を埋め込んだ正規表現を無言で実行」や
 * 「空配列で全件違反」になるため、load 時に検証する。
 * string = 空でない文字列 / stringArray = 空でない文字列の非空配列。
 */
export interface CheckKindShape {
  /** 必須・空でない文字列 */
  string?: readonly string[];
  /** 必須・空でない文字列の非空配列 */
  stringArray?: readonly string[];
  /**
   * 必須・非空配列で、要素は**空白を含まない** token。
   * class 名 / 属性名は空白で分割された単位と完全一致で比較されるため、
   * "h-11 after:h-11" のような複数 token をまとめた値は決して一致しない。
   */
  tokenArray?: readonly string[];
  /** 省略可。あれば空でない文字列 */
  optionalString?: readonly string[];
  /** 省略可。あれば空でない文字列の非空配列 */
  optionalStringArray?: readonly string[];
  /**
   * 省略可。あれば非空配列で、要素は**1 コードポイントの文字**。
   * 実装は対象テキストを 1 コードポイントずつ照合するため、
   * 2 文字以上の要素（"×✕"）や空白入り（" × "）は永久に一致しない。
   */
  charArray?: readonly string[];
  /** 省略可。あればこの値のいずれか（engine が分岐に使う述語・スコープ） */
  enums?: Readonly<Record<string, readonly string[]>>;
  /** 条件付き必須（field が equals のとき requires が必要） */
  requiredWhen?: readonly { field: string; equals: string; requires: string }[];
}

/** 合成 lint の候補述語（composition-lint.qualifies が実装しているもの） */
export const COMPOSITION_PREDICATES = ["icon-only", "text-glyph"] as const;

/** 合成 lint の探索スコープ */
export const COMPOSITION_SCOPES = ["self", "ancestor-or-self"] as const;

export const HTML_ATTR_CHECK_KINDS = {
  "attr-value-forbidden": { string: ["attr", "valueRegex"] },
  "attr-value-contains": { string: ["attr", "valueRegex"] },
  // tag は省略可（省略時は任意のタグ）。ただし空文字は無効な検査を組む
  "attr-present": { string: ["attr"], optionalString: ["tag"] },
  "tag-present": { string: ["tag"] },
  "tag-missing-attr": { string: ["tag", "requiredAttr"] },
  "element-present": { string: ["tag", "attr", "attrValue"] },
} as const satisfies Record<string, CheckKindShape>;

export const COMPOSITION_CHECK_KINDS = {
  "nested-selector": { string: ["selector"] },
  "dom-class-required": {
    string: ["selector"],
    tokenArray: ["requireAnyClass"],
    charArray: ["glyphs"],
    enums: { excludeWhen: COMPOSITION_PREDICATES },
    // text-glyph は glyphs の集合で判定するため、無いと候補ゼロで黙って素通りする
    requiredWhen: [{ field: "excludeWhen", equals: "text-glyph", requires: "glyphs" }],
  },
  "dom-attr-required": {
    string: ["selector"],
    tokenArray: ["requireAnyAttr"],
    charArray: ["glyphs"],
    enums: { when: COMPOSITION_PREDICATES, scope: COMPOSITION_SCOPES },
    requiredWhen: [{ field: "when", equals: "text-glyph", requires: "glyphs" }],
  },
} as const satisfies Record<string, CheckKindShape>;

/** spec フィールド名 → その kind 表 */
export const CHECK_KIND_SHAPES: Record<string, Record<string, CheckKindShape>> = {
  htmlAttrCheck: HTML_ATTR_CHECK_KINDS,
  compositionCheck: COMPOSITION_CHECK_KINDS,
};

/** pattern 系フィールドの全集合（「宣言したのに読まれない」判定に使う） */
export const ALL_MATCH_SOURCES: readonly MatchSource[] = [
  "pattern",
  "matchPatterns",
  "prefixPatterns",
];

/** spec フィールド名 → それを所有する detector の逆引き */
export const SPEC_OWNER: Record<string, KnownDetector> = Object.fromEntries(
  KNOWN_DETECTORS.filter((d) => DETECTOR_CAPABILITIES[d].specField != null).map((d) => [
    DETECTOR_CAPABILITIES[d].specField as string,
    d,
  ])
);

/**
 * 既知 detector 判定。
 * `in` 演算子は prototype chain も見るため、detector: "constructor" / "toString" が
 * 既知扱いになって「検査されないまま合格」に戻ってしまう。自前プロパティだけを見る。
 */
export function isKnownDetector(value: unknown): value is KnownDetector {
  return typeof value === "string" && Object.hasOwn(DETECTOR_CAPABILITIES, value);
}
