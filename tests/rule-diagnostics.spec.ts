/**
 * 壊れた ruleset が「無診断で素通り」しないことの回帰テスト（Phase 2 / S0）。
 *
 * 実測で、engine は第三者 ruleset の構造的破損に対しほぼ全て silent no-op で、
 * しかも check_html が passed: true を返しうる状態だった。
 * 「無出力 = 成功」のテストしか無いとこの手の死は検出できないため、
 * 各ケースで「落ちること」と「診断に何が含まれるか」の両方を固定する。
 *
 * 旧実装に対する陽性（= 修正前なら必ず fail する）のは
 * 「ruleset の構造的破損」「loader の診断」の describe。
 * 「診断ヘルパ単体」は新規 API の仕様固定、
 * カバレッジの不変条件テストは回帰防止であり、旧実装を落とす性質のものではない。
 */

import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadDesignConstitution,
  loadPackage,
  resetMeltaRoot,
  setMeltaRoot,
} from "../src/utils/loader.js";
import { checkHtml } from "../src/tools/check-html.js";
import { lintSource } from "../src/utils/lint-core.js";
import { lintComposition } from "../src/utils/composition-lint.js";
import {
  KNOWN_SEVERITIES,
  assertMatchSourceShape,
  assertSpecRequirement,
  assertValidRules,
  assertViolationSeverity,
  compileRuleRegExp,
  unsupportedCheckKind,
} from "../src/utils/rule-diagnostics.js";
import { KNOWN_DETECTORS } from "../src/utils/detectors.js";
import { matches } from "../src/utils/matcher.js";
import { SUPPORTED_ATTR_KINDS } from "../src/utils/attr-lint.js";
import { SUPPORTED_COMPOSITION_KINDS } from "../src/utils/composition-lint.js";

/** rules.json だけを持つ最小 root を作り、loader をそこへ向ける */
function useRuleset(rules: unknown[]): string {
  return useRulesetRaw(JSON.stringify({ version: "0.0.0-fixture", rules }, null, 2));
}

/** rules.json の中身を生で差し込む（壊れた JSON の検証用） */
function useRulesetRaw(rulesJson: string): string {
  const root = mkdtempSync(join(tmpdir(), "melta-ruleset-"));
  mkdirSync(resolve(root, "design/contracts"), { recursive: true });
  writeFileSync(resolve(root, "design/contracts/rules.json"), rulesJson);
  setMeltaRoot(root, "test fixture");
  return root;
}

/** 有効な最小ルール（テストごとに壊したいフィールドだけ上書きする） */
function validRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "FIXTURE_OK",
    category: "color",
    severity: "error",
    description: "x",
    detector: "tailwind-class",
    pattern: "text-black",
    alternative: "y",
    contractLint: "skip",
    ...overrides,
  };
}

test.afterEach(() => {
  // loader の root はモジュールスコープで、worker は他 spec を続けて実行する。
  // process.cwd() を「戻した」ことにすると、MELTA_ROOT 付きで走る worker を
  // 明示指定で汚染する（setMeltaRoot は env より優先される）。既定解決へ戻す。
  resetMeltaRoot();
});

test.describe("ruleset の構造的破損は診断付きで落ちる", () => {
  test("未知 severity は load 時に落ちる（従来は warn に丸められ passed: true）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_SEVERITY",
        category: "color",
        severity: "fatal",
        description: "x",
        detector: "tailwind-class",
        pattern: "text-black",
        alternative: "y",
        contractLint: "skip",
      },
    ]);

    let thrown: Error | null = null;
    try {
      checkHtml('<div class="text-black">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "未知 severity の ruleset が素通りしている").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_SEVERITY");
    expect(thrown!.message).toContain("severity");
    expect(thrown!.message).toContain("error / warn");
  });

  test("未知の htmlAttrCheck.kind は落ちる（従来は undefined 混じりの検査を無言実行）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_ATTR_KIND",
        category: "form",
        severity: "error",
        description: "x",
        detector: "html-attr",
        alternative: "y",
        contractLint: "skip",
        htmlAttrCheck: { kind: "not-implemented-kind", attr: "type" },
      },
    ]);

    let thrown: Error | null = null;
    try {
      lintSource('<input type="date">');
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "未知 kind が素通りしている").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_ATTR_KIND");
    expect(thrown!.message).toContain("htmlAttrCheck.kind");
    // engine が解釈できる値の一覧を診断に含める（第三者が直せる形にする）
    expect(thrown!.message).toContain("element-present");
  });

  test("未知の compositionCheck.kind は落ちる（従来は静かに 0 件）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_COMPOSITION_KIND",
        category: "modal",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: { kind: "not-implemented-kind", selector: "div" },
      },
    ]);

    let thrown: Error | null = null;
    try {
      lintComposition("<div><div>x</div></div>");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "未知 kind が静かに 0 件を返している").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_COMPOSITION_KIND");
    expect(thrown!.message).toContain("compositionCheck.kind");
    expect(thrown!.message).toContain("nested-selector");
  });

  test("未知 detector は落ちる（従来はどの経路にも掛からず passed: true）", () => {
    useRuleset([validRule({ id: "FIXTURE_BAD_DETECTOR", detector: "css-selector" })]);

    let thrown: Error | null = null;
    let result: ReturnType<typeof checkHtml> | null = null;
    try {
      result = checkHtml('<div class="text-black">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(
      thrown,
      `未知 detector が素通りしている（passed=${result?.passed}, violations=${result?.violations.length}）`
    ).not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_DETECTOR");
    expect(thrown!.message).toContain("detector");
    expect(thrown!.message).toContain("tailwind-class");
    expect(thrown!.message).toContain("manual");
  });

  test("Object.prototype のキーを detector に書いても既知扱いにならない", () => {
    // `value in obj` は prototype chain を見るため、"constructor" / "toString" が
    // 既知 detector をすり抜けて「検査されないまま合格」に戻る穴があった。
    for (const protoKey of ["constructor", "toString", "hasOwnProperty"]) {
      useRuleset([validRule({ id: `FIXTURE_PROTO_${protoKey}`, detector: protoKey })]);

      let thrown: Error | null = null;
      let result: ReturnType<typeof checkHtml> | null = null;
      try {
        result = checkHtml('<div class="text-black">x</div>', "html");
      } catch (e) {
        thrown = e as Error;
      }

      expect(
        thrown,
        `detector="${protoKey}" が既知扱いで素通りしている（passed=${result?.passed}）`
      ).not.toBeNull();
      expect(thrown!.message).toContain("detector");
      resetMeltaRoot();
    }
  });

  test("この detector が参照しないフィールドだけのルールは落ちる（永久に未検出のまま合格扱い）", () => {
    // tailwind-class-segment の matches は matchPatterns しか読まない。
    // pattern だけ書いても永久にマッチせず、しかも自動検査済みとして数えられていた。
    useRuleset([
      {
        id: "FIXTURE_UNUSED_MATCH_SOURCE",
        category: "color",
        severity: "error",
        description: "x",
        detector: "tailwind-class-segment",
        pattern: "purple",
        alternative: "y",
        contractLint: "skip",
      },
    ]);

    let thrown: Error | null = null;
    try {
      checkHtml('<div class="bg-purple-500">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "参照されないフィールド宣言が黙って無視されている").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_UNUSED_MATCH_SOURCE");
    expect(thrown!.message).toContain("pattern");
    expect(thrown!.message).toContain("matchPatterns");
  });

  test("pattern 系を1つも持たない class ルールは落とさない（宣言のみ = 評価範囲外）", () => {
    // spec なし html-attr と同じ扱い。宣言だけあって検査されないことは不正ではない。
    useRuleset([
      {
        id: "FIXTURE_CLASS_DECLARED_ONLY",
        category: "color",
        severity: "error",
        description: "x",
        detector: "tailwind-class",
        alternative: "y",
        contractLint: "skip",
      },
    ]);

    const result = checkHtml("<div>x</div>", "html");
    expect(result.coverage.automated).toContain("1 ルール中 0 件");
  });

  test("空文字の pattern は落ちる（自動検査済みと数えられるのに永久に未検出）", () => {
    useRuleset([validRule({ id: "FIXTURE_EMPTY_PATTERN", pattern: "" })]);

    let thrown: Error | null = null;
    let result: ReturnType<typeof checkHtml> | null = null;
    try {
      result = checkHtml('<div class="text-black">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(
      thrown,
      `空文字 pattern が素通りしている（passed=${result?.passed}, automated=${result?.coverage.automated}）`
    ).not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_EMPTY_PATTERN");
    expect(thrown!.message).toContain("pattern");
  });

  test("空文字の prefixPatterns は落ちる（前方一致が常に成立し全 class が違反になる）", () => {
    useRuleset([
      validRule({
        id: "FIXTURE_EMPTY_PREFIX",
        detector: "tailwind-class-prefix",
        pattern: undefined,
        prefixPatterns: [""],
      }),
    ]);

    let thrown: Error | null = null;
    let result: ReturnType<typeof checkHtml> | null = null;
    try {
      result = checkHtml('<div class="bg-white rounded-xl">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(
      thrown,
      `空文字 prefixPattern が素通りしている（violations=${result?.violations.length}）`
    ).not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_EMPTY_PREFIX");
    expect(thrown!.message).toContain("prefixPatterns[0]");
  });

  test("この detector が使わない pattern 系の宣言は個別に落ちる（部分的な false negative）", () => {
    // segment は matchPatterns しか読まない。matchPatterns があっても pattern の併記は無意味。
    useRuleset([
      validRule({
        id: "FIXTURE_PARTIAL_UNUSED",
        detector: "tailwind-class-segment",
        matchPatterns: ["purple"],
        pattern: "red",
      }),
    ]);
    expect(() => checkHtml('<div class="bg-purple-500">x</div>', "html")).toThrow(
      /FIXTURE_PARTIAL_UNUSED[\s\S]*pattern/
    );
  });

  test("class 検査を持たない detector の pattern 宣言も落ちる", () => {
    useRuleset([
      validRule({ id: "FIXTURE_MANUAL_WITH_PATTERN", detector: "manual", pattern: "text-black" }),
    ]);
    expect(() => checkHtml("<div>x</div>", "html")).toThrow(
      /FIXTURE_MANUAL_WITH_PATTERN[\s\S]*pattern/
    );
  });

  test("kind の必須フィールド欠落は load 時に落ちる（従来は undefined 入りの検査を無言実行）", () => {
    useRuleset([
      {
        id: "FIXTURE_KIND_MISSING_FIELD",
        category: "form",
        severity: "error",
        description: "x",
        detector: "html-attr",
        alternative: "y",
        contractLint: "skip",
        htmlAttrCheck: { kind: "tag-present" }, // tag が無い
      },
    ]);
    expect(() => checkHtml("<div>x</div>", "html")).toThrow(
      /FIXTURE_KIND_MISSING_FIELD[\s\S]*htmlAttrCheck\.tag/
    );
  });

  test("composition の空配列も落ちる（候補を満たせず全件違反になる）", () => {
    useRuleset([
      {
        id: "FIXTURE_EMPTY_REQUIRE",
        category: "button",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: { kind: "dom-class-required", selector: "button", requireAnyClass: [] },
      },
    ]);
    expect(() => checkHtml("<button>x</button>", "html")).toThrow(
      /FIXTURE_EMPTY_REQUIRE[\s\S]*requireAnyClass/
    );
  });

  test("未知 kind は lint を走らせなくても load 時点で落ちる", () => {
    useRuleset([
      {
        id: "FIXTURE_KIND_AT_LOAD",
        category: "modal",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: { kind: "zzz", selector: "div" },
      },
    ]);
    // .html でない = lintComposition を通らない経路でも落ちること
    expect(() => checkHtml('<div class="text-black">x</div>', "jsx")).toThrow(
      /FIXTURE_KIND_AT_LOAD[\s\S]*compositionCheck\.kind/
    );
  });

  test("値の内部に空白を含む pattern は落ちる（token 分割でどれとも一致しない）", () => {
    // 内部・前後・空白のみ をまとめて拒否する（token 分割の観点ではどれも同じ死に方）
    for (const bad of ["text-black bg-white", "bg- gray", "text-black\t", " text-black ", "\t", " "]) {
      useRuleset([validRule({ id: "FIXTURE_INNER_WS", pattern: bad })]);
      expect(
        () => checkHtml('<div class="text-black">x</div>', "html"),
        `${JSON.stringify(bad)} が受理されている`
      ).toThrow(/FIXTURE_INNER_WS[\s\S]*空白/);
      resetMeltaRoot();
    }
  });

  test("engine が実装していない述語は落ちる（excludeWhen の typo で全候補が除外される）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_PREDICATE",
        category: "button",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: {
          kind: "dom-class-required",
          selector: "button",
          requireAnyClass: ["after:h-11"],
          excludeWhen: "icon-onlyy", // typo
        },
      },
    ]);
    expect(() => checkHtml("<button>x</button>", "html")).toThrow(
      /FIXTURE_BAD_PREDICATE[\s\S]*excludeWhen[\s\S]*icon-only/
    );
  });

  test("未知の scope は落ちる（暗黙に self として動く）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_SCOPE",
        category: "button",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: {
          kind: "dom-attr-required",
          selector: "button",
          requireAnyAttr: ["aria-label"],
          scope: "ancestor",
        },
      },
    ]);
    expect(() => checkHtml("<button>x</button>", "html")).toThrow(
      /FIXTURE_BAD_SCOPE[\s\S]*scope[\s\S]*ancestor-or-self/
    );
  });

  test("when=text-glyph で glyphs が無いと落ちる（候補ゼロで素通りする）", () => {
    useRuleset([
      {
        id: "FIXTURE_MISSING_GLYPHS",
        category: "tag",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: {
          kind: "dom-attr-required",
          selector: "button",
          requireAnyAttr: ["aria-label"],
          when: "text-glyph",
        },
      },
    ]);
    expect(() => checkHtml("<button>×</button>", "html")).toThrow(
      /FIXTURE_MISSING_GLYPHS[\s\S]*glyphs/
    );
  });

  test("attr-present の tag は省略できるが空文字は落ちる", () => {
    useRuleset([
      {
        id: "FIXTURE_EMPTY_TAG",
        category: "baseline",
        severity: "error",
        description: "x",
        detector: "html-attr",
        alternative: "y",
        contractLint: "skip",
        htmlAttrCheck: { kind: "attr-present", attr: "popover", tag: "" },
      },
    ]);
    expect(() => checkHtml("<div popover>x</div>", "html")).toThrow(
      /FIXTURE_EMPTY_TAG[\s\S]*htmlAttrCheck\.tag/
    );
  });

  test("requireAnyClass に複数 token をまとめた値は落ちる（完全一致で絶対に一致しない）", () => {
    useRuleset([
      {
        id: "FIXTURE_MULTI_TOKEN",
        category: "button",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: {
          kind: "dom-class-required",
          selector: "button",
          requireAnyClass: ["h-11 after:h-11"],
        },
      },
    ]);
    expect(() => checkHtml("<button>x</button>", "html")).toThrow(
      /FIXTURE_MULTI_TOKEN[\s\S]*requireAnyClass\[0\][\s\S]*空白/
    );
  });

  test("glyphs の空白のみ要素は落ちる（照合前に除去され候補ゼロになる）", () => {
    useRuleset([
      {
        id: "FIXTURE_BLANK_GLYPH",
        category: "tag",
        severity: "error",
        description: "x",
        detector: "composition",
        alternative: "y",
        contractLint: "skip",
        compositionCheck: {
          kind: "dom-attr-required",
          selector: "button",
          requireAnyAttr: ["aria-label"],
          when: "text-glyph",
          glyphs: [" "],
        },
      },
    ]);
    expect(() => checkHtml("<button>×</button>", "html")).toThrow(
      /FIXTURE_BLANK_GLYPH[\s\S]*glyphs\[0\]/
    );
  });

  test("capability 表に無いキーは落ちる（typo / 別 kind のフィールド）", () => {
    for (const extra of [
      { exludeWhen: "icon-only" }, // typo
      { when: "icon-only" }, // dom-class-required は when を読まない
    ]) {
      useRuleset([
        {
          id: "FIXTURE_EXTRA_KEY",
          category: "button",
          severity: "error",
          description: "x",
          detector: "composition",
          alternative: "y",
          contractLint: "skip",
          compositionCheck: {
            kind: "dom-class-required",
            selector: "button",
            requireAnyClass: ["after:h-11"],
            ...extra,
          },
        },
      ]);
      expect(
        () => checkHtml("<button>x</button>", "html"),
        `${JSON.stringify(extra)} が黙って無視されている`
      ).toThrow(/FIXTURE_EXTRA_KEY[\s\S]*読みません/);
      resetMeltaRoot();
    }
  });

  test("requiresContext が boolean でないと落ちる（truthy 判定で検査対象から外れる）", () => {
    // "false" は文字列なので truthy → lint-core が「文脈依存」として除外し、
    // ルールが 1 度も評価されないまま passed:true になる。
    useRuleset([validRule({ id: "FIXTURE_BAD_CONTEXT", requiresContext: "false" })]);

    let thrown: Error | null = null;
    let result: ReturnType<typeof checkHtml> | null = null;
    try {
      result = checkHtml('<div class="text-black">x</div>', "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(
      thrown,
      `requiresContext:"false" が素通りしている（passed=${result?.passed}）`
    ).not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_CONTEXT");
    expect(thrown!.message).toContain("requiresContext");
  });

  test("glyphs の要素は 1 文字ちょうどでないと落ちる（1 コードポイント単位で照合される）", () => {
    for (const bad of ["×✕", " × ", ""]) {
      useRuleset([
        {
          id: "FIXTURE_BAD_GLYPH",
          category: "tag",
          severity: "error",
          description: "x",
          detector: "composition",
          alternative: "y",
          contractLint: "skip",
          compositionCheck: {
            kind: "dom-attr-required",
            selector: "button",
            requireAnyAttr: ["aria-label"],
            when: "text-glyph",
            glyphs: [bad],
          },
        },
      ]);
      expect(
        () => checkHtml("<button>×</button>", "html"),
        `glyphs:[${JSON.stringify(bad)}] が受理されている`
      ).toThrow(/FIXTURE_BAD_GLYPH[\s\S]*glyphs\[0\]/);
      resetMeltaRoot();
    }
  });

  test("重複した rule ID は落ちる（カバレッジが検査範囲を過小申告する）", () => {
    useRuleset([
      validRule({ id: "FIXTURE_DUP" }),
      validRule({ id: "FIXTURE_DUP", pattern: "shadow-2xl" }),
    ]);

    let thrown: Error | null = null;
    try {
      checkHtml("<div>x</div>", "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "重複 ID が素通りしている").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_DUP");
    expect(thrown!.message).toContain("id");
  });

  test("detector と check spec の食い違いは落ちる（宣言が黙って無視される）", () => {
    // detector は class だが htmlAttrCheck を併記。この spec は絶対に実行されない。
    useRuleset([
      validRule({
        id: "FIXTURE_SPEC_MISMATCH",
        htmlAttrCheck: { kind: "tag-present", tag: "style" },
      }),
    ]);

    let thrown: Error | null = null;
    try {
      checkHtml("<style>x</style>", "html");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown, "食い違った spec 宣言が黙って無視されている").not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_SPEC_MISMATCH");
    expect(thrown!.message).toContain("htmlAttrCheck");
    expect(thrown!.message).toContain("html-attr");
  });

  test("spec を持たない html-attr ルールは落とさない（宣言のみ = 評価範囲外の既存イディオム）", () => {
    // melta の MODAL_ROLE_DIALOG_REQUIRED 等 4 件がこの形。壊れた ruleset ではないので
    // 落とさず、カバレッジ上 manual として数える。
    useRuleset([
      {
        id: "FIXTURE_DECLARED_ONLY",
        category: "modal",
        severity: "error",
        description: "x",
        detector: "html-attr",
        alternative: "y",
        contractLint: "skip",
      },
    ]);

    const result = checkHtml("<div>x</div>", "html");
    expect(result.coverage.automated).toContain("1 ルール中 0 件");
    expect(result.coverage.notAutomated).toContain("残り 1 件");
  });

  test("壊れた正規表現は原因ルールとフィールドを添えて落ちる（従来は素の SyntaxError）", () => {
    useRuleset([
      {
        id: "FIXTURE_BAD_REGEX",
        category: "accessibility",
        severity: "error",
        description: "x",
        detector: "html-attr",
        alternative: "y",
        contractLint: "skip",
        htmlAttrCheck: { kind: "attr-value-forbidden", attr: "tabindex", valueRegex: "([0-9" },
      },
    ]);

    let thrown: Error | null = null;
    try {
      lintSource('<div tabindex="3">x</div>');
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("FIXTURE_BAD_REGEX");
    expect(thrown!.message).toContain("valueRegex");
  });
});

test.describe("カバレッジ集計は rule ID の集合演算", () => {
  test("melta 自身の ruleset で automatedTotal が総数を超えない", () => {
    const result = checkHtml("<div>x</div>", "html");
    const m = result.coverage.automated.match(/^(\d+) ルール中 (\d+) 件/);
    expect(m, `想定した書式ではない: ${result.coverage.automated}`).not.toBeNull();
    const total = Number(m![1]);
    const automated = Number(m![2]);
    expect(automated).toBeLessThanOrEqual(total);
    expect(result.coverage.notAutomated).toMatch(/残り \d+ 件/);
    const manual = Number(result.coverage.notAutomated.match(/残り (\d+) 件/)![1]);
    expect(manual).toBe(total - automated);
  });
});

test.describe("loader の診断（アセット欠落・不正 JSON）", () => {
  /** 全アセットの診断が満たすべき最低ライン */
  function expectAssetDiagnostics(message: string, relPath: string, root: string) {
    expect(message).toContain(relPath); // どのファイルか
    expect(message).toContain(root); // どこを見に行ったか（絶対パス）
    expect(message).toContain("test fixture"); // どう解決した root か（via）
    expect(message).toContain("--melta-root"); // どう差し替えるか
    expect(message).toContain("MELTA_ROOT");
  }

  test("package.json が無い root は診断付きで落ちる（従来は生の ENOENT）", () => {
    const root = useRuleset([validRule()]);
    let thrown: Error | null = null;
    try {
      loadPackage();
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expectAssetDiagnostics(thrown!.message, "package.json", root);
  });

  test("DESIGN.md が無い root の診断も同じ流儀（従来は root も差し替え方法も無し）", () => {
    const root = useRuleset([validRule()]);
    let thrown: Error | null = null;
    try {
      loadDesignConstitution();
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expectAssetDiagnostics(thrown!.message, "DESIGN.md", root);
  });

  test("rules.json が壊れた JSON の診断も同じ流儀（従来はパスすら出ない）", () => {
    const root = useRulesetRaw('{"version":"0.0.0-fixture","rules":[');
    let thrown: Error | null = null;
    try {
      checkHtml("<div>x</div>", "html");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expectAssetDiagnostics(thrown!.message, "design/contracts/rules.json", root);
  });
});

test.describe("フィールド併記時の評価順（非対称な実挙動の仕様固定）", () => {
  const ctx = (base: string) => ({ raw: base, base, variants: [], important: false });

  test("prefixPatterns は外れたら次のフィールドへ進む（fallthrough）", () => {
    const rule = {
      id: "R",
      detector: "tailwind-class-prefix",
      severity: "error",
      prefixPatterns: ["bg-[rgb("],
      matchPatterns: ["bg-gray-300"],
    } as never;
    // prefixPatterns にヒット
    expect(matches(rule, ctx("bg-[rgb(1,2,3)]"))).toBe(true);
    // prefixPatterns は外れるが matchPatterns にヒット = 後続まで評価される
    expect(matches(rule, ctx("bg-gray-300"))).toBe(true);
  });

  test("matchPatterns は存在した時点で終端（外れても pattern は読まれない）", () => {
    const rule = {
      id: "R",
      detector: "tailwind-class-prefix",
      severity: "error",
      matchPatterns: ["bg-gray-300"],
      pattern: "bg-gray-",
    } as never;
    expect(matches(rule, ctx("bg-gray-300"))).toBe(true);
    // pattern が読まれるなら true になるはずだが、matchPatterns で終端するため false
    expect(matches(rule, ctx("bg-gray-500"))).toBe(false);
  });

  test("pattern は matchPatterns が無いときにだけ読まれる", () => {
    const rule = {
      id: "R",
      detector: "tailwind-class-prefix",
      severity: "error",
      pattern: "bg-gray-",
    } as never;
    expect(matches(rule, ctx("bg-gray-500"))).toBe(true);
  });
});

test.describe("ランタイムの実装一覧と schema の一致（多重定義の drift 防止）", () => {
  const schema = JSON.parse(
    readFileSync(resolve(process.cwd(), "design/schemas/rule.schema.json"), "utf-8")
  );

  test("detector の全集合が rule.schema.json と一致する", () => {
    const schemaDetectors: string[] = schema.properties.rules.items.properties.detector.enum;
    expect([...KNOWN_DETECTORS].sort()).toEqual([...schemaDetectors].sort());
  });

  test("htmlAttrCheck.kind の実装一覧が schema と一致する", () => {
    const schemaKinds: string[] =
      schema.properties.rules.items.properties.htmlAttrCheck.properties.kind.enum;
    expect([...SUPPORTED_ATTR_KINDS].sort()).toEqual([...schemaKinds].sort());
  });

  test("compositionCheck.kind の実装一覧が schema と一致する", () => {
    const schemaKinds: string[] =
      schema.properties.rules.items.properties.compositionCheck.properties.kind.enum;
    expect([...SUPPORTED_COMPOSITION_KINDS].sort()).toEqual([...schemaKinds].sort());
  });

  test("severity の全集合が schema と一致する", () => {
    const schemaSeverities: string[] = schema.properties.rules.items.properties.severity.enum;
    expect([...KNOWN_SEVERITIES].sort()).toEqual([...schemaSeverities].sort());
  });
});

test.describe("診断ヘルパ単体", () => {
  test("rules が配列でない ruleset を拒否する", () => {
    expect(() => assertValidRules({ nope: true }, "/tmp/x.json")).toThrow(/配列ではありません/);
  });

  test("id を持たないルールを拒否する", () => {
    expect(() => assertValidRules([{ severity: "error" }], "/tmp/x.json")).toThrow(/id/);
  });

  test("compileRuleRegExp は壊れたパターンに文脈を付ける", () => {
    expect(() =>
      compileRuleRegExp({ pattern: "([0-9", ruleId: "R1", field: "htmlAttrCheck.valueRegex" })
    ).toThrow(/R1[\s\S]*valueRegex/);
  });

  test("unsupportedCheckKind は engine が解釈できる値を列挙する", () => {
    const e = unsupportedCheckKind({
      ruleId: "R2",
      specName: "htmlAttrCheck",
      kind: "zzz",
      supported: ["tag-present", "element-present"],
    });
    expect(e.message).toContain("R2");
    expect(e.message).toContain("zzz");
    expect(e.message).toContain("tag-present / element-present");
  });

  test("assertSpecRequirement は specRequired=true の capability で実際に効く", () => {
    // 現状はどの detector も specRequired=false だが、capability 表を SSOT と呼ぶ以上
    // true にしたら効く実装であることを固定しておく（未使用フィールドにしない）。
    const required = { specField: "htmlAttrCheck", specRequired: true } as const;
    expect(() => assertSpecRequirement({}, required, "R4")).toThrow(/htmlAttrCheck/);
    expect(() =>
      assertSpecRequirement({ htmlAttrCheck: { kind: "tag-present" } }, required, "R4")
    ).not.toThrow();
    // 現行の melta 既定（false）では宣言のみのルールを落とさない
    const optional = { specField: "htmlAttrCheck", specRequired: false } as const;
    expect(() => assertSpecRequirement({}, optional, "R4")).not.toThrow();
  });

  test("assertMatchSourceShape は配列でない matchPatterns を拒否する", () => {
    expect(() =>
      assertMatchSourceShape({ matchPatterns: "not-an-array" }, "R5")
    ).toThrow(/配列が必要/);
  });

  test("assertViolationSeverity は engine 側不整合を internal error として落とす", () => {
    expect(() => assertViolationSeverity("fatal", "R3")).toThrow(/internal error[\s\S]*R3/);
    expect(() => assertViolationSeverity("warn", "R3")).not.toThrow();
  });
});
