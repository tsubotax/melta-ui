/**
 * ruleset 由来の不正を「無言の素通り」でなく診断付きの失敗にするための共通ヘルパ。
 *
 * 背景（Phase 2 実測）: engine は第三者の ruleset を読めるようになる一方、
 * 壊れた ruleset に対する防御がランタイムに一切なかった。
 * 未知 detector / 未知 check kind / 不正 severity はいずれも例外にならず、
 * 「検査されなかった」のに `passed: true` が返るという最悪の形で表面化していた。
 *
 * ここで扱うのは engine が **構造的に評価不能** な入力だけ。
 * 「ルールに違反している」ことの報告は LintViolation の役目で、こちらは対象外。
 *
 * ※ S0 時点では「engine が実際に読むフィールド」に絞った narrow な検査。
 *   ruleset 全体の schema 検証（ajv）は S3 で resolver の合成後に入る。
 *   そのとき **形の検査（assertValidRules 系）は ajv へ移し**、
 *   到達不能防御（assertViolationSeverity / qualifies の未知述語）だけがここに残る。
 */

import {
  ALL_MATCH_SOURCES,
  BUNDLE_SCHEMA_VERSION,
  CHECK_KIND_SHAPES,
  DETECTOR_CAPABILITIES,
  KNOWN_DETECTORS,
  KNOWN_SEVERITIES,
  SPEC_OWNER,
  isKnownDetector,
  isKnownSeverity,
} from "./detectors.js";
import type {
  CheckKindShape,
  DetectorCapability,
  KnownDetector,
  MatchSource,
} from "./detectors.js";
import { hasMatchSource } from "./matcher.js";
import type { RuleEntry } from "./types.js";

// severity の全集合は capability 表（detectors.ts）が正。
// 既存 import を壊さないようここから re-export する。
export { KNOWN_SEVERITIES, isKnownSeverity } from "./detectors.js";
export type { KnownSeverity } from "./detectors.js";

/**
 * ruleset 不正の共通エラー。
 * 「どのルールの・どのフィールドが・なぜ評価不能か」と「engine が解釈できる値」を必ず添える。
 */
export function rulesetError(params: {
  ruleId: string;
  field: string;
  problem: string;
  supported?: readonly string[];
  source?: string;
}): Error {
  const lines = [
    `[melta-ui] ruleset を評価できません: ルール ${params.ruleId} の ${params.field} — ${params.problem}`,
  ];
  if (params.supported) {
    lines.push(`  engine v1 が解釈できる値: ${params.supported.join(" / ")}`);
  }
  if (params.source) {
    lines.push(`  該当ファイル: ${params.source}`);
  }
  lines.push(
    "  ruleset 側を修正するか、この検査に対応した engine を使ってください（黙って素通りさせない方針です）。"
  );
  return new Error(lines.join("\n"));
}


/**
 * rules 配列の最小構造検査。
 * 不正 severity は「error 件数 0 に丸められて passed: true」を生むため、
 * ruleset を読んだ時点で落とす（S3 の schema 検証が入るまでの前哨）。
 */
/**
 * bundle の互換性宣言を検査する（S2 W7）。
 *
 * - `schemaVersion`: bundle の構造バージョン。engine の実装と食い違ったら fail-fast。
 *   宣言が無ければ初版（1）とみなす（既存 melta の rules.json は宣言を持たない）
 * - `engineCompat`: bundle が要求する engine の名前とバージョン範囲。
 *   ここでは「宣言があれば形が正しいこと」までを見る（実際の範囲照合は S4 の resolver で行う）
 */
export function assertBundleCompat(file: unknown, source: string): void {
  const meta = (file ?? {}) as Record<string, unknown>;

  if (meta.schemaVersion != null) {
    if (typeof meta.schemaVersion !== "number" || !Number.isInteger(meta.schemaVersion)) {
      throw new Error(
        `[melta-ui] bundle を評価できません: schemaVersion は整数が必要です（実際は ${JSON.stringify(meta.schemaVersion)}）\n` +
          `  該当ファイル: ${source}`
      );
    }
    if (meta.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
      throw new Error(
        `[melta-ui] bundle の schemaVersion ${meta.schemaVersion} は、この engine が解釈できる ` +
          `${BUNDLE_SCHEMA_VERSION} と異なります。\n` +
          `  該当ファイル: ${source}\n` +
          "  engine か bundle のどちらかを合わせてください（黙って別バージョンの解釈で動かさない方針です）。"
      );
    }
  }

  if (meta.engineCompat != null) {
    // 意味論（S2 で確定）: **engine パッケージのバージョンに対する semver range**。
    // engine 名は含めない（bundle は 1 つの engine 実装を前提にする。複数 engine を
    // 想定するなら { engine, range } へ拡張するが、v1 のスコープ外）。
    // ここでは文法だけを見る。実際の範囲照合は S4 の resolver が engine の version と突き合わせる。
    if (typeof meta.engineCompat !== "string" || meta.engineCompat.trim().length === 0) {
      throw new Error(
        `[melta-ui] bundle を評価できません: engineCompat は空でない文字列が必要です（実際は ${JSON.stringify(meta.engineCompat)}）\n` +
          `  該当ファイル: ${source}`
      );
    }
    if (!SEMVER_RANGE.test(meta.engineCompat.trim())) {
      throw new Error(
        `[melta-ui] bundle を評価できません: engineCompat ${JSON.stringify(meta.engineCompat)} は semver range として解釈できません\n` +
          `  該当ファイル: ${source}\n` +
          '  engine パッケージのバージョン範囲を書いてください（例 ">=1", "^1.2.0", ">=1 <2", "1.x"）。engine 名は含めません。'
      );
    }
  }
}

/**
 * engineCompat に許す semver range の文法（保守的なサブセット）。
 * 比較演算子つき範囲・キャレット/チルダ・x-range・スペース結合・`||` を許し、
 * `"banana"` のような任意文字列は弾く。厳密な解釈は S4 の resolver が行う。
 */
const SEMVER_COMPARATOR = String.raw`(?:[<>]=?|=|\^|~)?\s*\d+(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?`;
const SEMVER_RANGE = new RegExp(
  `^${SEMVER_COMPARATOR}(?:\\s+${SEMVER_COMPARATOR})*(?:\\s*\\|\\|\\s*${SEMVER_COMPARATOR}(?:\\s+${SEMVER_COMPARATOR})*)*$`
);

export function assertValidRules(rules: unknown, source: string): asserts rules is RuleEntry[] {
  if (!Array.isArray(rules)) {
    throw new Error(
      `[melta-ui] ruleset を評価できません: rules が配列ではありません（${typeof rules}）\n` +
        `  該当ファイル: ${source}`
    );
  }
  const seenIds = new Set<string>();
  rules.forEach((rule, i) => {
    const id = typeof rule?.id === "string" && rule.id.length > 0 ? rule.id : `#${i}`;
    if (typeof rule?.id !== "string" || rule.id.length === 0) {
      throw rulesetError({
        ruleId: id,
        field: "id",
        problem: "文字列の id が必要です",
        source,
      });
    }
    // ID 重複はカバレッジを rule ID の集合で数える設計と噛み合わず、
    // automated 件数が実際より少なく出る（= 検査範囲を過小申告する）。
    if (seenIds.has(rule.id)) {
      throw rulesetError({
        ruleId: id,
        field: "id",
        problem:
          "同じ id のルールが複数あります" +
          "（カバレッジ集計が rule ID の集合演算のため、検査範囲を過小申告する）",
        source,
      });
    }
    seenIds.add(rule.id);
    // requiresContext は lint-core が truthy 判定で「文脈依存なので lint 対象外」に
    // 振り分ける制御フラグ。文字列 "false" のような値でも真になり、
    // ルールが無診断で検査対象から外れる（= passed:true）。boolean 以外は受けない。
    if (rule?.requiresContext != null && typeof rule.requiresContext !== "boolean") {
      throw rulesetError({
        ruleId: id,
        field: "requiresContext",
        problem:
          `${JSON.stringify(rule.requiresContext)} は使えません（boolean か省略のみ）。` +
          "truthy 判定で検査対象から外れるため、文字列を書くとルールが黙って無効になる",
        source,
      });
    }
    if (!isKnownSeverity(rule?.severity)) {
      throw rulesetError({
        ruleId: id,
        field: "severity",
        problem: `未知の値 ${JSON.stringify(rule?.severity)}（error 件数に数えられず passed: true になる）`,
        supported: KNOWN_SEVERITIES,
        source,
      });
    }
    // 未知 detector はどの検査経路のフィルタにも掛からず、
    // 「1 件も検査されなかった」のに passed: true を返す最悪の形になる。
    if (!isKnownDetector(rule?.detector)) {
      throw rulesetError({
        ruleId: id,
        field: "detector",
        problem:
          `engine v1 は ${JSON.stringify(rule?.detector)} を実装していません` +
          "（どの検査経路にも掛からず、検査されないまま合格扱いになる）",
        supported: KNOWN_DETECTORS,
        source,
      });
    }
    // detector と check spec の食い違いも黙って無視しない。
    // 例: detector="tailwind-class" に htmlAttrCheck を併記しても spec は絶対に走らない。
    for (const [specName, owner] of Object.entries(SPEC_OWNER)) {
      if (rule[specName as keyof RuleEntry] != null && rule.detector !== owner) {
        throw rulesetError({
          ruleId: id,
          field: specName,
          problem:
            `detector="${rule.detector}" のルールに ${specName} が宣言されていますが、` +
            `この spec は detector="${owner}" でしか実行されません（宣言が黙って無視される）`,
          supported: [owner],
          source,
        });
      }
    }
    // pattern 系フィールドの中身を検証する。
    // 空文字は両側に穴を開ける: pattern:"" は matches の truthy 判定で永久に未検出
    // （なのに自動検査済みと数えられる）、prefixPatterns:[""] は startsWith("") が
    // 常に true なので全 class を違反にする。どちらも診断で落とす。
    assertMatchSourceShape(rule, id, source);

    // pattern 系フィールドを宣言しているのに、この detector の matches() が
    // それを読まない組み合わせも黙って無視しない。
    // 例: detector="tailwind-class-segment" + pattern のみ → matches は matchPatterns しか
    // 読まないので永久に未検出。しかも isAutoDetectable が true を返すと
    // 「自動検査済み」として集計され、検査されていないのに合格扱いになる。
    const capability: DetectorCapability = DETECTOR_CAPABILITIES[rule.detector as KnownDetector];
    assertSpecRequirement(rule, capability, id, source);
    assertCheckSpecShape(rule, id, source);

    // フィールド単位で照合する。「1 つでも読まれるフィールドがあれば OK」にすると、
    // 例えば tailwind-class-segment に matchPatterns と pattern を併記したとき
    // pattern だけが黙って無視される（部分的な false negative）。
    // autoDetectable=false の detector（manual / html-attr / composition）は
    // matchSources が空なので、pattern 系の宣言はすべてここで弾かれる。
    const unusable = ALL_MATCH_SOURCES.filter(
      (f) =>
        hasMatchSource(rule as RuleEntry, f) &&
        !(capability.matchSources as readonly MatchSource[]).includes(f)
    );
    if (unusable.length > 0) {
      throw rulesetError({
        ruleId: id,
        field: unusable.join(" / "),
        problem:
          `detector="${rule.detector}" の検査は ${unusable.join(" / ")} を参照しません` +
          "（宣言しても読まれず、検査されないまま合格扱いになる）",
        supported:
          capability.matchSources.length > 0
            ? capability.matchSources
            : ["（この detector は pattern 系フィールドを使いません）"],
        source,
      });
    }

    // 併記（matchPatterns と pattern など）はエラーにしない。
    // 併記時にどのフィールドが読まれるかの正確な意味論は
    // **matcher.matches() の doc comment を正とする**（フィールドごとに終端条件が違い、
    // prefixPatterns だけは miss のとき次へ進む）。
    //
    // ⚠️ 実測で判明した melta 自身の三重不整合（S1+S2 で解消する）:
    //   - validate.ts:276 は tailwind-class-prefix に pattern を必須にしている
    //   - matcher は matchPatterns があれば pattern を読まない
    //   - COLOR_NO_DARK_BG_GRAY / MOTION_NO_LONG_DURATION の pattern は
    //     "bg-gray-[3-9]00" のような正規表現記法だが、matcher は startsWith で
    //     リテラル前方一致として扱うため単独でもマッチしない
    // ここを厳格化すると melta 自身が落ちるので、capability 表から
    // validate.ts を導出する S1+S2 で「必須性」ごと再定義する。
    // 逆向き（spec を要求する detector なのに spec が無い）は **エラーにしない**。
    // 実測: melta の html-attr 11 件中 4 件は意図的に spec を持たない
    // （MODAL_ROLE_DIALOG_REQUIRED 等、「何を modal とみなすか」が文脈依存で
    //   静的には表現できないもの。宣言だけ残して検査は人間 / テストに委ねる既存イディオム）。
    // これは「壊れた ruleset」ではなく「engine が評価できない範囲」なので、
    // 落とすのではなくカバレッジ上 manual として数え、S3 の capability 診断で
    // 「宣言はあるが評価されない」を機械可読に報告する対象にする。
  });
}

/**
 * pattern 系フィールドの形を検証する。
 * 「宣言はあるが engine から見ると無意味 / 危険」な値を弾く。
 */
export function assertMatchSourceShape(
  rule: Record<string, unknown>,
  ruleId: string,
  source?: string
): void {
  for (const field of ALL_MATCH_SOURCES) {
    const value = rule[field];
    if (value == null) continue;

    if (field === "pattern") {
      assertUsableToken(value, ruleId, field, source);
      continue;
    }

    if (!Array.isArray(value)) {
      throw rulesetError({
        ruleId,
        field,
        problem: `配列が必要です（${typeof value}）`,
        source,
      });
    }
    value.forEach((item, i) => assertUsableToken(item, ruleId, `${field}[${i}]`, source));
  }
}

/**
 * class token として意味を持つ文字列か。
 *
 * tokenize() は空白で split するため、空文字・空白のみ・前後に空白を含む値は
 * どの token とも一致しない。それでも hasMatchSource は「宣言あり」と数えるので、
 * 自動検査済みなのに永久に未検出（= passed:true）という最悪の形になる。
 * prefixPatterns の空文字はさらに悪く、前方一致が常に成立して全 class が違反になる。
 */
function assertUsableToken(
  value: unknown,
  ruleId: string,
  field: string,
  source?: string
): void {
  if (typeof value !== "string") {
    throw rulesetError({
      ruleId,
      field,
      problem: `${JSON.stringify(value)} は使えません（文字列が必要、実際は ${typeof value}）`,
      source,
    });
  }
  if (value.length === 0) {
    throw rulesetError({
      ruleId,
      field,
      problem:
        "空文字は使えません。" +
        "どの token とも一致しないまま自動検査済みと数えられ、前方一致では逆に全 class が違反になる",
      source,
    });
  }
  // 空白は「前後」だけでなく「内部」も不可。入力の class 文字列は空白で token 化されるため、
  // 空白を含む値（"text-black bg-white" / "bg- gray" / "\t"）はどの token とも一致しない。
  if (/\s/.test(value)) {
    throw rulesetError({
      ruleId,
      field,
      problem:
        `${JSON.stringify(value)} は使えません（空白を含む）。` +
        "検査対象の class は空白で token に分割されるため、空白を含む値はどの token とも一致せず、" +
        "検査されないまま自動検査済みと数えられる",
      source,
    });
  }
}

/**
 * check spec（htmlAttrCheck / compositionCheck）の kind ごとの形を検証する。
 *
 * kind の whitelist だけでは足りない。実装は spec のフィールドを直接埋め込むため、
 * 欠落すると `<undefined\b` のような正規表現を無言で実行したり、
 * 空配列で全件違反になったりする。lint を走らせるまで気づけないので load 時に見る。
 * ※ S3 で ajv の discriminated union 検証へ移す（このモジュールからは削除する側）。
 */
export function assertCheckSpecShape(
  rule: Record<string, unknown>,
  ruleId: string,
  source?: string
): void {
  for (const [specName, kindTable] of Object.entries(CHECK_KIND_SHAPES)) {
    const spec = rule[specName] as Record<string, unknown> | undefined;
    if (spec == null) continue;

    const kind = spec.kind;
    if (typeof kind !== "string" || !Object.hasOwn(kindTable, kind)) {
      throw unsupportedCheckKind({
        ruleId,
        specName,
        kind,
        supported: Object.keys(kindTable),
        source,
      });
    }

    const shape: CheckKindShape = kindTable[kind];

    // capability 表に無いキーは engine が読まない。typo（exludeWhen）や
    // kind 違いのフィールド（dom-class-required に when）を黙って無視すると、
    // 「書いたのに効かない」を作る。S0 の方針をこの階層にも適用する。
    const allowedKeys = new Set<string>([
      "kind",
      ...(shape.string ?? []),
      ...(shape.stringArray ?? []),
      ...(shape.tokenArray ?? []),
      ...(shape.optionalString ?? []),
      ...(shape.optionalStringArray ?? []),
      ...(shape.charArray ?? []),
      ...Object.keys(shape.enums ?? {}),
    ]);
    const extraKeys = Object.keys(spec).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      throw rulesetError({
        ruleId,
        field: `${specName}.${extraKeys.join(" / ")}`,
        problem:
          `kind="${kind}" の検査は ${extraKeys.join(" / ")} を読みません` +
          "（typo か別 kind のフィールド。書いても効かないまま検査したつもりになる）",
        supported: [...allowedKeys],
        source,
      });
    }
    // engine が分岐に使う述語・スコープ。未知値は「該当なし」側に倒れて
    // 候補ゼロ（silent false negative）になったり、暗黙の既定値で動いたりする。
    for (const [field, allowed] of Object.entries(shape.enums ?? {})) {
      const v = spec[field];
      if (v == null) continue;
      if (typeof v !== "string" || !allowed.includes(v)) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem:
            `${JSON.stringify(v)} は engine が実装していません` +
            "（未知の値は候補ゼロや暗黙の既定値になり、検査したつもりで何も検査されない）",
          supported: allowed,
          source,
        });
      }
    }
    for (const field of shape.optionalString ?? []) {
      const v = spec[field];
      if (v == null) continue;
      if (typeof v !== "string" || v.trim().length === 0) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem: `省略はできますが、書くなら空でない文字列が必要です（実際は ${JSON.stringify(v)}）`,
          source,
        });
      }
    }
    for (const field of shape.charArray ?? []) {
      const v = spec[field];
      if (v == null) continue;
      if (!Array.isArray(v) || v.length === 0) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem: `省略はできますが、書くなら空でない配列が必要です（実際は ${JSON.stringify(v)}）`,
          source,
        });
      }
      v.forEach((item, i) => {
        // 実装は対象テキストの空白を除去し、1 コードポイントずつ突き合わせる。
        // 2 文字以上や空白入りの要素は永久に一致せず、候補ゼロで素通りする。
        const ok = typeof item === "string" && [...item].length === 1 && !/\s/.test(item);
        if (!ok) {
          throw rulesetError({
            ruleId,
            field: `${specName}.${field}[${i}]`,
            problem:
              `${JSON.stringify(item)} は使えません（1 文字ちょうど・空白なしが必要）。` +
              "照合は 1 コードポイント単位のため、複数文字や空白を含む値は決して一致しない",
            source,
          });
        }
      });
    }
    for (const field of shape.optionalStringArray ?? []) {
      const v = spec[field];
      if (v == null) continue;
      if (!Array.isArray(v) || v.length === 0) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem: `省略はできますが、書くなら空でない配列が必要です（実際は ${JSON.stringify(v)}）`,
          source,
        });
      }
      v.forEach((item, i) => {
        // 空白のみの要素（glyphs: [" "] 等）は、実装が空白を除去してから
        // 突き合わせるため候補が常にゼロになる = 検査したつもりで素通り。
        if (typeof item !== "string" || item.trim().length === 0) {
          throw rulesetError({
            ruleId,
            field: `${specName}.${field}[${i}]`,
            problem:
              `空でない文字列が必要です（実際は ${JSON.stringify(item)}）。` +
              "空白のみの値は照合前に除去され、候補が 1 つも該当しなくなる",
            source,
          });
        }
      });
    }
    for (const cond of shape.requiredWhen ?? []) {
      if (spec[cond.field] !== cond.equals) continue;
      const v = spec[cond.requires];
      if (v == null || (Array.isArray(v) && v.length === 0)) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${cond.requires}`,
          problem:
            `${cond.field}="${cond.equals}" のときは ${cond.requires} が必要です` +
            "（無いと候補が 1 つも該当せず、検査したつもりで素通りする）",
          source,
        });
      }
    }
    for (const field of shape.string ?? []) {
      const v = spec[field];
      if (typeof v !== "string" || v.trim().length === 0) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem:
            `kind="${kind}" は ${field} を必要とします（空でない文字列）。実際は ${JSON.stringify(v)}` +
            "（欠けると undefined を埋め込んだ検査を無言で実行する）",
          source,
        });
      }
    }
    for (const field of [...(shape.stringArray ?? []), ...(shape.tokenArray ?? [])]) {
      const asToken = (shape.tokenArray ?? []).includes(field);
      const v = spec[field];
      if (!Array.isArray(v) || v.length === 0) {
        throw rulesetError({
          ruleId,
          field: `${specName}.${field}`,
          problem:
            `kind="${kind}" は ${field} を必要とします（空でない配列）。実際は ${JSON.stringify(v)}` +
            "（空だと候補が 1 つも満たせず全件違反になる）",
          source,
        });
      }
      v.forEach((item, i) => {
        if (typeof item !== "string" || item.trim().length === 0) {
          throw rulesetError({
            ruleId,
            field: `${specName}.${field}[${i}]`,
            problem: `空でない文字列が必要です（実際は ${JSON.stringify(item)}）`,
            source,
          });
        }
        // class 名 / 属性名は空白で分割された単位と完全一致で比較される。
        // "h-11 after:h-11" のように複数 token をまとめた値は決して一致しない。
        if (asToken && /\s/.test(item)) {
          throw rulesetError({
            ruleId,
            field: `${specName}.${field}[${i}]`,
            problem:
              `${JSON.stringify(item)} は使えません（空白を含む）。` +
              "空白で分割された 1 つの token と完全一致で比較されるため、決して一致しない。" +
              "複数指定したい場合は配列の別要素に分けてください",
            source,
          });
        }
      });
    }
  }
}

/**
 * capability 表が spec を必須と宣言している detector に spec があるかを検証する。
 * 現状はどの detector も specRequired=false（宣言のみのルールを許容する既存イディオムのため）だが、
 * capability 表を SSOT と呼ぶ以上、true にしたら実際に効く実装を持たせておく。
 */
export function assertSpecRequirement(
  rule: Record<string, unknown>,
  capability: Pick<DetectorCapability, "specField" | "specRequired">,
  ruleId: string,
  source?: string
): void {
  if (!capability.specRequired || capability.specField == null) return;
  if (rule[capability.specField] == null) {
    throw rulesetError({
      ruleId,
      field: capability.specField,
      problem: `この detector は ${capability.specField} を必須としています（無いと 1 件も検査されない）`,
      source,
    });
  }
}

/**
 * check spec の kind が engine 未対応だったときのエラー。
 * 従来は分岐にフォールスルーして誤った検査を無言で走らせるか、静かに 0 件を返していた。
 */
export function unsupportedCheckKind(params: {
  ruleId: string;
  specName: string;
  kind: unknown;
  supported: readonly string[];
  source?: string;
}): Error {
  return rulesetError({
    ruleId: params.ruleId,
    field: `${params.specName}.kind`,
    problem: `engine v1 は ${JSON.stringify(params.kind)} を実装していません`,
    supported: params.supported,
    source: params.source,
  });
}

/**
 * ruleset 由来の文字列から RegExp を組む。
 * 壊れた正規表現は素の SyntaxError で lint 全体を落としていたため、
 * どのルールのどのフィールドが原因かを添えて投げ直す。
 */
export function compileRuleRegExp(params: {
  pattern: string;
  flags?: string;
  ruleId: string;
  field: string;
}): RegExp {
  try {
    return new RegExp(params.pattern, params.flags);
  } catch (e) {
    throw rulesetError({
      ruleId: params.ruleId,
      field: params.field,
      // 組み立て後のパターンも出す。複数フィールドから合成する検査
      // （element-present の tag / attr / attrValue 等）では、
      // フィールド名だけだとどの値が原因か特定できないため。
      problem:
        `正規表現として不正です: ${(e as Error).message}\n` +
        `  engine が組み立てたパターン: /${params.pattern}/${params.flags ?? ""}`,
    });
  }
}

/**
 * 到達不能防御。ruleset は読み込み時に検証済みなので、ここに来るのは engine 側のバグ。
 */
export function assertViolationSeverity(severity: unknown, ruleId: string): void {
  if (!isKnownSeverity(severity)) {
    throw new Error(
      `[melta-ui] internal error: ルール ${ruleId} が未知の severity ${JSON.stringify(severity)} で違反を生成しました。\n` +
        "  ruleset は読み込み時に検証済みのはずで、ここに到達するのは engine 側の不整合です。"
    );
  }
}
