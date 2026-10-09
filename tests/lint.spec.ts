/**
 * 単一 lint API（src/utils/lint.ts の lint()）の検査。
 *
 * 最重要の保証: npm 公開 entry（melta-ds-mcp/lint）の lint() が、MCP check_html・CI の
 * lint CLI・PostToolUse hook と同じ判定を返すこと。以前は npm 経路の lintSource だけが
 * composition（ネスト modal 等）を含まず、同じ HTML の合否が経路で食い違っていた。
 */

import { test, expect } from "@playwright/test";
import {
  lint,
  sourceTypeForPath,
  SOURCE_TYPES,
  assertSourceType,
} from "../src/utils/lint.js";
import { lintSource } from "../src/utils/lint-core.js";
import { lintComposition } from "../src/utils/composition-lint.js";
import { checkHtml, SOURCE_TYPES as SOURCE_TYPES_VIA_CHECK_HTML } from "../src/tools/check-html.js";

const NESTED_MODAL = '<div role="dialog"><section role="dialog">nested</section></div>';

test.describe("lint(): composition を含む単一判定", () => {
  test("html（既定）ではネスト modal の composition 違反を返し、lintSource 単体は返さない", () => {
    const ids = lint(NESTED_MODAL).violations.map((v) => v.ruleId);
    expect(ids).toContain("MODAL_NO_NESTED");
    // lint-core（class + html-attr）だけでは拾えないことの対照。ここが拾えるようになったら
    // この検査は composition の有無を見分けられなくなるので、検体を差し替えること
    expect(lintSource(NESTED_MODAL).map((v) => v.ruleId)).not.toContain("MODAL_NO_NESTED");
    expect(lint(NESTED_MODAL).passed).toBe(false);
  });

  test("明示の sourceType: \"html\" も既定と同じ結果", () => {
    expect(lint(NESTED_MODAL, { sourceType: "html" })).toEqual(lint(NESTED_MODAL));
  });

  test("jsx では composition を通さない（class + html-attr のみ）", () => {
    const result = lint(NESTED_MODAL, { sourceType: "jsx" });
    expect(result.violations.map((v) => v.ruleId)).not.toContain("MODAL_NO_NESTED");
    expect(result.sourceType).toBe("jsx");
    // class lint は jsx でも効く
    const withClass = lint('<div className="text-black">x</div>', { sourceType: "jsx" });
    expect(withClass.violations.map((v) => v.ruleId)).toContain("COLOR_NO_TEXT_BLACK");
  });

  test("結果に適用した sourceType を明示する（省略時は html）", () => {
    expect(lint("<p>x</p>").sourceType).toBe("html");
    expect(lint("<p>x</p>", {}).sourceType).toBe("html");
  });
});

test.describe("lint() と check_html の同一判定（4 経路の要）", () => {
  // tests/check-html.spec.ts の fixture を流用。class / composition / interactive ネスト / 違反なし
  const FIXTURES = [
    '<div class="text-black shadow-2xl"><p class="text-body">x</p></div>',
    NESTED_MODAL,
    '<button><a href="#">nested interactive</a></button>',
    '<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">clean</div>',
  ];

  for (const [i, html] of FIXTURES.entries()) {
    for (const sourceType of SOURCE_TYPES) {
      test(`fixture ${i} (${sourceType}): violations が順序込みで一致し、件数と合否も一致`, () => {
        const viaLint = lint(html, { sourceType });
        const viaCheckHtml = checkHtml(html, sourceType);
        expect(viaCheckHtml.violations).toEqual(viaLint.violations);
        expect(viaCheckHtml.errorCount).toBe(viaLint.errorCount);
        expect(viaCheckHtml.warnCount).toBe(viaLint.warnCount);
        expect(viaCheckHtml.passed).toBe(viaLint.passed);
      });
    }
  }

  // 上の一致検査は check_html が lint() から乖離しないことを見る（check_html は lint() を呼ぶので、
  // lint() 自体が composition を落としても一致は崩れない）。lint() の中身はここで独立に固定する
  for (const [i, html] of FIXTURES.entries()) {
    test(`fixture ${i}: html は lintSource → lintComposition の順の連結、jsx は lintSource のみ`, () => {
      expect(lint(html, { sourceType: "html" }).violations).toEqual(
        lintSource(html).concat(lintComposition(html))
      );
      expect(lint(html, { sourceType: "jsx" }).violations).toEqual(lintSource(html));
    });
  }

  test("fixture が両方向を含む（全部 clean / 全部違反だと一致検査が空回りする）", () => {
    const passed = FIXTURES.map((html) => lint(html).passed);
    expect(passed).toContain(true);
    expect(passed).toContain(false);
  });
});

test.describe("lint(): passed / errorCount / warnCount の整合", () => {
  const SAMPLES = [
    NESTED_MODAL,
    '<div class="text-black">x</div>',
    '<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">clean</div>',
    '<div class="bg-[rgb(255,0,0)] border-t-4">evasion + color bar</div>',
  ];

  for (const [i, html] of SAMPLES.entries()) {
    test(`sample ${i}: passed は errorCount === 0 と一致し、件数の和は violations 数`, () => {
      const r = lint(html);
      expect(r.passed).toBe(r.errorCount === 0);
      expect(r.errorCount).toBe(r.violations.filter((v) => v.severity === "error").length);
      expect(r.errorCount + r.warnCount).toBe(r.violations.length);
    });
  }

  test("warn だけなら passed: true（warn は合否に影響しない）", () => {
    // 任意値の背景色は warn（COLOR_NO_ARBITRARY_BG_HEX）。severity が変わったら検体を見直す
    const r = lint('<div class="bg-[rgb(255,0,0)]">x</div>');
    expect(r.warnCount).toBeGreaterThan(0);
    expect(r.errorCount).toBe(0);
    expect(r.passed).toBe(true);
  });
});

test.describe("lint(): 入力検証（fail-open を作らない）", () => {
  for (const bad of ["htlm", "HTML", "banana", ""]) {
    test(`未知の sourceType ${JSON.stringify(bad)} は throw する`, () => {
      expect(() => lint(NESTED_MODAL, { sourceType: bad as never })).toThrow(/sourceType/);
    });
  }

  test("null は省略扱いにしない（?? で html に丸めない）", () => {
    expect(() => lint(NESTED_MODAL, { sourceType: null as never })).toThrow(/sourceType/);
  });

  test("source が文字列でなければ throw する（Buffer を渡した等）", () => {
    expect(() => lint(Buffer.from(NESTED_MODAL) as never)).toThrow(/source は文字列/);
  });

  test("assertSourceType は許容値をそのまま返す", () => {
    for (const st of SOURCE_TYPES) expect(assertSourceType(st)).toBe(st);
  });

  test("check_html からの re-export は lint.ts と同一の配列（二重 SSOT を持たない）", () => {
    expect(SOURCE_TYPES_VIA_CHECK_HTML).toBe(SOURCE_TYPES);
  });
});

test.describe("sourceTypeForPath: 拡張子 → sourceType", () => {
  const CASES: Array<[string, "html" | "jsx" | null]> = [
    ["examples/dashboard.html", "html"],
    ["src/App.tsx", "jsx"],
    ["src/App.jsx", "jsx"],
    ["src/App.vue", "jsx"],
    // 対象外
    ["src/index.ts", null],
    ["README.md", null],
    ["page.htm", null],
    ["page.html.bak", null],
    // 大文字小文字は区別する（lint CLI の TARGET_EXT と同じ扱い）
    ["PAGE.HTML", null],
  ];
  for (const [path, expected] of CASES) {
    test(`${path} → ${JSON.stringify(expected)}`, () => {
      expect(sourceTypeForPath(path)).toBe(expected);
    });
  }
});
