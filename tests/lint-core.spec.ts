/**
 * lint-core.ts の統合テスト（Q2: arbitrary 値検知）
 *
 * rules.json（実 SSOT）→ loader → matcher → lint-core の経路を通しで検証する。
 * hook-check-rule.sh / lint-generated.ts はこの lintSource を共有するので、
 * ここが Q2（arbitrary 値による色・影・font の検知すり抜け塞ぎ）の回帰ガードになる。
 *
 * 最重要の非回帰: DESIGN.md が正規記法として推奨する font-size の arbitrary 値
 * （text-[1rem] / text-[0.875rem] / text-[10px]）を誤検知しないこと。
 * これが守れないと contract/docs の 70+ 箇所が一斉に false positive になる。
 */

import { test, expect } from "@playwright/test";
import { lintSource } from "../src/utils/lint-core.js";

function ruleIds(source: string): string[] {
  return lintSource(source).map((v) => v.ruleId);
}

test.describe("lint-core Q2: arbitrary 値で色・影・font 禁止を回避できない", () => {
  test("text-[#000000] は COLOR_NO_ARBITRARY_TEXT_HEX で検知", () => {
    expect(ruleIds('<div class="text-[#000000]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_TEXT_HEX"
    );
  });

  test("bg-[#3b82f6] は COLOR_NO_ARBITRARY_BG_HEX で検知", () => {
    expect(ruleIds('<div class="bg-[#3b82f6]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_BG_HEX"
    );
  });

  test("border-[#e5e7eb] は COLOR_NO_ARBITRARY_BORDER_HEX で検知", () => {
    expect(ruleIds('<div class="border-[#e5e7eb]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_BORDER_HEX"
    );
  });

  test("shadow-[0_0_40px_#0ff] は SPACE_NO_ARBITRARY_SHADOW で検知", () => {
    expect(ruleIds('<div class="shadow-[0_0_40px_#0ff]"></div>')).toContain(
      "SPACE_NO_ARBITRARY_SHADOW"
    );
  });

  test("font-[300] は TYPO_NO_ARBITRARY_FONT で検知", () => {
    expect(ruleIds('<div class="font-[300]"></div>')).toContain(
      "TYPO_NO_ARBITRARY_FONT"
    );
  });

  test("variant 付き（hover:/md:）でも剥がして検知", () => {
    expect(ruleIds('<div class="hover:text-[#ff0000] md:bg-[#fff]"></div>')).toEqual(
      expect.arrayContaining([
        "COLOR_NO_ARBITRARY_TEXT_HEX",
        "COLOR_NO_ARBITRARY_BG_HEX",
      ])
    );
  });

  test("className（JSX）でも検知", () => {
    expect(ruleIds('<div className="text-[#000]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_TEXT_HEX"
    );
  });

  test("検知された arbitrary 値は warn 止まり（error にしない）", () => {
    const v = lintSource('<div class="text-[#000000] shadow-[1px_1px]"></div>');
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.severity === "warn")).toBe(true);
  });
});

test.describe("lint-core Q2: 正規の arbitrary 値を誤検知しない（最重要の非回帰）", () => {
  // DESIGN.md Quick Ref が text-[1rem] 等を font-size の正規記法として推奨している。
  // #始まりの色だけを対象にすることで、これらを誤爆しない。
  test("font-size の arbitrary 値（text-[1rem] / text-[0.875rem] / text-[10px]）は素通り", () => {
    expect(lintSource('<div class="text-[1rem] text-[0.875rem] text-[10px]"></div>')).toEqual(
      []
    );
  });

  test("レイアウト系 arbitrary 値（w-[1200px] / h-[40px]）は Q2 の対象外", () => {
    // 固定幅は Q4(responsive) の領域で、Q2 では拾わない
    const ids = ruleIds('<div class="w-[1200px] h-[40px]"></div>');
    expect(ids).not.toContain("COLOR_NO_ARBITRARY_TEXT_HEX");
    expect(ids).not.toContain("COLOR_NO_ARBITRARY_BG_HEX");
  });

  test("トークン経由の正規クラスは全て素通り", () => {
    expect(
      lintSource(
        '<div class="bg-white text-slate-900 border-slate-200 shadow-sm font-medium rounded-lg"></div>'
      )
    ).toEqual([]);
  });

  test("border-[1px]（太さ指定）は #始まりでないので素通り", () => {
    expect(ruleIds('<div class="border-[1px]"></div>')).not.toContain(
      "COLOR_NO_ARBITRARY_BORDER_HEX"
    );
  });
});

test.describe("lint-core Q5: html-attr ルールの部分蘇生（属性検査）", () => {
  test("正の tabindex は A11Y_NO_TABINDEX_POSITIVE で検知", () => {
    expect(ruleIds('<a href="#" tabindex="3">x</a>')).toContain(
      "A11Y_NO_TABINDEX_POSITIVE"
    );
  });

  test("JSX の tabIndex={2}（camelCase + brace）も検知", () => {
    expect(ruleIds("<td tabIndex={2}>x</td>")).toContain(
      "A11Y_NO_TABINDEX_POSITIVE"
    );
  });

  test("scope 欠落の <th> は TABLE_TH_SCOPE_REQUIRED で検知", () => {
    expect(ruleIds("<tr><th>名前</th></tr>")).toContain(
      "TABLE_TH_SCOPE_REQUIRED"
    );
  });

  test("native date input は DATEPICKER_NO_NATIVE_INPUT で検知", () => {
    expect(ruleIds('<input type="date" />')).toContain(
      "DATEPICKER_NO_NATIVE_INPUT"
    );
  });

  test("html-attr ルールの severity は宣言どおり（tabindex/th=error, datepicker=warn）", () => {
    const v = lintSource(
      '<th>H</th><a tabindex="5">x</a><input type="date" />'
    );
    const byId = Object.fromEntries(v.map((x) => [x.ruleId, x.severity]));
    expect(byId.TABLE_TH_SCOPE_REQUIRED).toBe("error");
    expect(byId.A11Y_NO_TABINDEX_POSITIVE).toBe("error");
    expect(byId.DATEPICKER_NO_NATIVE_INPUT).toBe("warn");
  });
});

test.describe("lint-core Q5: 属性検査の誤検知ガード（false positive を出さない）", () => {
  test("<thead> は <th> と誤検知しない（word boundary）", () => {
    expect(ruleIds("<thead><tr><td>x</td></tr></thead>")).not.toContain(
      "TABLE_TH_SCOPE_REQUIRED"
    );
  });

  test("scope を持つ <th> は素通り", () => {
    expect(ruleIds('<th scope="col">A</th>')).not.toContain(
      "TABLE_TH_SCOPE_REQUIRED"
    );
  });

  test("tabindex=0 / tabindex=-1 は許可値なので素通り", () => {
    expect(ruleIds('<a tabindex="0">x</a><b tabindex="-1">y</b>')).not.toContain(
      "A11Y_NO_TABINDEX_POSITIVE"
    );
  });

  test("data-tabindex は別属性なので誤検知しない（negative lookbehind）", () => {
    expect(ruleIds('<div data-tabindex="9">x</div>')).not.toContain(
      "A11Y_NO_TABINDEX_POSITIVE"
    );
  });

  test("type=text の input は datepicker ルールに当たらない", () => {
    expect(ruleIds('<input type="text" />')).not.toContain(
      "DATEPICKER_NO_NATIVE_INPUT"
    );
  });

  test("htmlAttrCheck を持たない html-attr ルールは従来どおり未検出（role=dialog 等）", () => {
    // MODAL_ROLE_DIALOG_REQUIRED は文脈依存で spec 未付与＝活性化しない
    const v = lintSource('<div class="fixed inset-0 bg-black/50">modal</div>');
    expect(v.map((x) => x.ruleId)).not.toContain("MODAL_ROLE_DIALOG_REQUIRED");
  });
});

test.describe("lint-core Q6: inline style / <style> の escape hatch 検知", () => {
  test("inline style の hardcoded hex color を検知", () => {
    expect(ruleIds('<div style="background:#2250df;">x</div>')).toContain(
      "COLOR_NO_INLINE_STYLE_HARDCODE"
    );
  });

  test("inline style の hardcoded rgb color を検知", () => {
    expect(ruleIds('<div style="color: rgb(5,150,105);">x</div>')).toContain(
      "COLOR_NO_INLINE_STYLE_HARDCODE"
    );
  });

  test("<style> ブロックを検知", () => {
    expect(ruleIds("<style>.x{color:red}</style>")).toContain(
      "PHILOSOPHY_NO_STYLE_BLOCK"
    );
  });

  test("Q6 は warn 止まり", () => {
    const v = lintSource('<div style="background:#fff"></div><style>.a{}</style>');
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.severity === "warn")).toBe(true);
  });
});

test.describe("lint-core Q6: 誤検知ガード（var() / 寸法は素通り）", () => {
  test("CSS 変数 var(--...) の inline style は素通り", () => {
    expect(lintSource('<span style="color:var(--text-default);">x</span>')).toEqual(
      []
    );
  });

  test("var() の hex フォールバックは素通り（プロパティ直後アンカー）", () => {
    // color:var(--x, #2250df) は color: の直後が var なので非検知
    expect(
      ruleIds('<span style="color:var(--sidebar-active-color, #2250df);">x</span>')
    ).not.toContain("COLOR_NO_INLINE_STYLE_HARDCODE");
  });

  test("寸法・表示系の inline style は素通り", () => {
    expect(
      lintSource('<div style="width:1.125rem;height:16px;display:none">x</div>')
    ).toEqual([]);
  });

  test("<styled-component> は <style> と誤検知しない（word boundary）", () => {
    expect(ruleIds("<styled-div>x</styled-div>")).not.toContain(
      "PHILOSOPHY_NO_STYLE_BLOCK"
    );
  });
});

test.describe("lint-core P0-1: 任意値の回避経路（rgb/hsl/oklch/named color）も検知", () => {
  test("bg-[rgb(255,0,0)] は COLOR_NO_ARBITRARY_BG_HEX で検知", () => {
    expect(ruleIds('<div class="bg-[rgb(255,0,0)]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_BG_HEX"
    );
  });

  test("text-[hsl(0,0%,20%)] は COLOR_NO_ARBITRARY_TEXT_HEX で検知", () => {
    expect(ruleIds('<div class="text-[hsl(0,0%,20%)]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_TEXT_HEX"
    );
  });

  test("border-[black] は COLOR_NO_ARBITRARY_BORDER_HEX で検知", () => {
    expect(ruleIds('<div class="border-[black]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_BORDER_HEX"
    );
  });

  test("text-[oklch(0.2_0_0)] は COLOR_NO_ARBITRARY_TEXT_HEX で検知", () => {
    expect(ruleIds('<div class="text-[oklch(0.2_0_0)]"></div>')).toContain(
      "COLOR_NO_ARBITRARY_TEXT_HEX"
    );
  });

  test("負例: bg-[url(...)] / grid-cols-[repeat(3,1fr)] は検知されない", () => {
    expect(ruleIds('<div class="bg-[url(/hero.png)]"></div>')).toEqual([]);
    expect(ruleIds('<div class="grid-cols-[repeat(3,1fr)]"></div>')).toEqual([]);
  });

  test("負例: text-[1rem]（フォントサイズの正規記法）は引き続き検知されない", () => {
    expect(ruleIds('<button class="text-[1rem]">OK</button>')).toEqual([]);
  });
});

test.describe("lint-core B1: Baseline Widely available ルール（DADS 取り込み）", () => {
  test("[anchor-name:--menu] は BASELINE_NO_ANCHOR_POSITIONING で検知", () => {
    expect(ruleIds('<div class="[anchor-name:--menu]"></div>')).toContain(
      "BASELINE_NO_ANCHOR_POSITIONING"
    );
  });

  test("[position-area:bottom] も prefixPatterns で検知", () => {
    expect(ruleIds('<div class="[position-area:bottom]"></div>')).toContain(
      "BASELINE_NO_ANCHOR_POSITIONING"
    );
  });

  test("popover 属性は BASELINE_NO_POPOVER_ATTR で検知（値付き/値なし両方）", () => {
    expect(ruleIds('<div popover id="menu"></div>')).toContain(
      "BASELINE_NO_POPOVER_ATTR"
    );
    expect(ruleIds('<div popover="manual"></div>')).toContain(
      "BASELINE_NO_POPOVER_ATTR"
    );
  });

  test("commandfor / command 属性は BASELINE_NO_INVOKER_COMMANDS で検知", () => {
    expect(
      ruleIds('<button commandfor="dlg" command="show-modal">開く</button>')
    ).toContain("BASELINE_NO_INVOKER_COMMANDS");
    expect(ruleIds('<button command="close">閉じる</button>')).toContain(
      "BASELINE_NO_INVOKER_COMMANDS"
    );
  });

  test("[view-transition-name:hero] は BASELINE_NO_VIEW_TRANSITION で検知", () => {
    expect(ruleIds('<img class="[view-transition-name:hero]" src="a.png" alt="">')).toContain(
      "BASELINE_NO_VIEW_TRANSITION"
    );
  });

  test("[text-box-trim:both] は BASELINE_NO_TEXT_BOX_TRIM で検知", () => {
    expect(ruleIds('<h1 class="[text-box-trim:both]">見出し</h1>')).toContain(
      "BASELINE_NO_TEXT_BOX_TRIM"
    );
  });

  test("負例: 属性値文字列内の popover は検知されない（attr-present の引用符除去）", () => {
    expect(ruleIds('<button title="popover を開く" aria-label="popover">開く</button>')).toEqual(
      []
    );
  });

  test("負例: data-popover / data-command は ATTR_BOUNDARY で検知されない", () => {
    expect(ruleIds('<div data-popover="x" data-command="y"></div>')).toEqual([]);
  });

  test("負例: class 値の中の popover-content 等（引用符内）は検知されない", () => {
    expect(ruleIds('<div class="popover-content rounded-lg p-4"></div>')).toEqual([]);
  });
});
