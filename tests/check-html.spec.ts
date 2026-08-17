/**
 * check_html（MCP ツール）の統合テスト + check_rule / search の P1-2 改善分。
 *
 * 最重要の保証: checkHtml は lint-generated.ts（CI gate / PostToolUse hook）と
 * 同一の合成（lintSource + .html は lintComposition）であること。
 * ここが乖離すると「MCP では PASS、CI では FAIL」という最悪の体験になる。
 */

import { test, expect } from "@playwright/test";
import { checkHtml } from "../src/tools/check-html.js";
import { checkRule } from "../src/tools/check-rule.js";
import { search } from "../src/tools/search.js";
import { lintSource } from "../src/utils/lint-core.js";
import { lintComposition } from "../src/utils/composition-lint.js";

test.describe("check_html: lint-generated と同一判定", () => {
  const FIXTURES = [
    '<div class="text-black shadow-2xl"><p class="text-body">x</p></div>',
    '<div role="dialog"><section role="dialog">nested</section></div>',
    '<button><a href="#">nested interactive</a></button>',
    '<div class="bg-[rgb(255,0,0)] border-t-4">evasion + color bar</div>',
    '<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">clean</div>',
  ];

  for (const [i, html] of FIXTURES.entries()) {
    test(`fixture ${i}: violations が lintSource + lintComposition の合成と一致`, () => {
      const expected = lintSource(html).concat(lintComposition(html));
      const result = checkHtml(html, "html");
      expect(result.violations).toEqual(expected);
      expect(result.errorCount).toBe(
        expected.filter((v) => v.severity === "error").length
      );
      expect(result.warnCount).toBe(expected.length - result.errorCount);
      expect(result.passed).toBe(result.errorCount === 0);
    });
  }

  test("composition 違反（ネスト modal）を検知する", () => {
    const result = checkHtml(
      '<div role="dialog"><div role="dialog">x</div></div>'
    );
    expect(result.violations.map((v) => v.ruleId)).toContain("MODAL_NO_NESTED");
    expect(result.passed).toBe(false);
  });

  test("jsx モードでは composition lint を通さない（lint-generated と同じ扱い）", () => {
    const jsx = '<div role="dialog"><div role="dialog">x</div></div>';
    const result = checkHtml(jsx, "jsx");
    expect(result.violations.map((v) => v.ruleId)).not.toContain("MODAL_NO_NESTED");
    // class lint は jsx でも効く
    const withClass = checkHtml('<div className="text-black">x</div>', "jsx");
    expect(withClass.violations.map((v) => v.ruleId)).toContain("COLOR_NO_TEXT_BLACK");
  });

  // sourceType の runtime 検証。以前は型キャストだけで、"htlm" のような typo が
  // composition 検査を無言で外して passed: true を返していた（2026-08-17 Codex 監査で実測）。
  test.describe("sourceType の runtime 検証（fail-open 閉塞）", () => {
    const nested = '<div role="dialog"><div role="dialog">x</div></div>';

    for (const bad of ["htlm", "HTML", "banana", ""]) {
      test(`未知の sourceType ${JSON.stringify(bad)} は throw する（無言で通さない）`, () => {
        expect(() => checkHtml(nested, bad as never)).toThrow(/sourceType/);
      });
    }

    test("null は省略扱いにしない（?? で html に丸めない）", () => {
      expect(() => checkHtml(nested, null as never)).toThrow(/sourceType/);
    });

    test("省略（undefined）は従来どおり html として composition が走る", () => {
      const result = checkHtml(nested, undefined);
      expect(result.violations.map((v) => v.ruleId)).toContain("MODAL_NO_NESTED");
    });

    test("jsx の coverage は composition が未検査であることを明示する", () => {
      const result = checkHtml(nested, "jsx");
      expect(result.coverage.notAutomated).toMatch(/jsx.*composition|composition.*jsx/);
    });
  });

  test("違反ゼロでも coverage を必ず返す（No violations = 完全準拠の誤読防止）", () => {
    const result = checkHtml('<div class="p-4">clean</div>');
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    // ルール総数は焼き付けない（rules.json への追加でこのテストが壊れないように。実数は rules.length 由来）
    expect(result.coverage.automated).toMatch(/\d+ ルール中 \d+ 件を自動検査/);
    expect(result.coverage.notAutomated).toContain("manual");
    expect(result.coverage.notAutomated).toContain("get_rules");
  });
});

test.describe("check_rule: requiresContext ルールの conditional 化（P1-2）", () => {
  test("py-0.5 は conditional:true + 文脈依存の注記付きで返る", () => {
    const violations = checkRule("py-0.5");
    const v = violations.find((x) => x.ruleId === "SPACE_NO_PY_05_BTN");
    expect(v).toBeTruthy();
    expect(v!.conditional).toBe(true);
    expect(v!.reason).toContain("文脈依存");
  });

  test("文脈非依存ルール（text-black）には conditional が付かない", () => {
    const violations = checkRule("text-black");
    const v = violations.find((x) => x.ruleId === "COLOR_NO_TEXT_BLACK");
    expect(v).toBeTruthy();
    expect(v!.conditional).toBeUndefined();
    expect(v!.reason).not.toContain("文脈依存");
  });
});

test.describe("search: 空クエリ reject と件数上限（P1-2）", () => {
  test("空クエリ / 空白のみは 0 件を返す（全件マッチ防止）", () => {
    expect(search("").results).toEqual([]);
    expect(search("   ").total).toBe(0);
  });

  test("結果は最大 20 件に truncate され total と truncated で通知される", () => {
    // "e" のような汎用文字は大量マッチする
    const r = search("e");
    expect(r.results.length).toBeLessThanOrEqual(20);
    if (r.total > 20) {
      expect(r.truncated).toBe(true);
    }
  });

  test("通常クエリは従来通りヒットする", () => {
    const r = search("primary");
    expect(r.total).toBeGreaterThan(0);
    expect(r.results[0]).toHaveProperty("type");
  });
});
