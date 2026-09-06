/**
 * composition-lint.ts の統合テスト（S2: 合成・関係次元の検出）
 *
 * rules.json（実 SSOT）→ loader → composition-lint の経路で、単一 class マッチでは
 * 届かない「ネスト modal」を DOM パースで検出できることを検証する。
 *
 * 最重要の非回帰: 複数の role=dialog が兄弟として並ぶだけ（正規のショーケース、
 * docs/index.html に5個ある）を誤検知しないこと。「子孫ネスト」だけを違反にする。
 */

import { test, expect } from "@playwright/test";
import { lintComposition } from "../src/utils/composition-lint.js";
import { getAllRules } from "../src/utils/loader.js";

function ruleIds(html: string): string[] {
  return lintComposition(html).map((v) => v.ruleId);
}

test.describe("composition-lint S2: ネスト modal（MODAL_NO_NESTED 蘇生）", () => {
  test("role=dialog の子孫に role=dialog があれば検知", () => {
    const html = `<div role="dialog"><div class="p-4"><section role="dialog">inner</section></div></div>`;
    expect(ruleIds(html)).toContain("MODAL_NO_NESTED");
  });

  test("直接の子でも検知", () => {
    expect(ruleIds(`<div role="dialog"><div role="dialog">x</div></div>`)).toContain(
      "MODAL_NO_NESTED"
    );
  });

  test("single / double quote 混在でも検知（パーサが正規化）", () => {
    expect(ruleIds(`<div role='dialog'><div role="dialog">x</div></div>`)).toContain(
      "MODAL_NO_NESTED"
    );
  });

  test("検知は error severity", () => {
    const v = lintComposition(`<div role="dialog"><div role="dialog">x</div></div>`);
    expect(v.find((x) => x.ruleId === "MODAL_NO_NESTED")?.severity).toBe("error");
  });

  test("3階層ネストは1違反に集約し、ネスト箇所数を token に含める（仕様）", () => {
    // 深いネスト時に違反を要素数だけ出さず、selector 単位で1件＋件数表示にする設計。
    // dialog>dialog>dialog は祖先を持つ dialog が2つ＝「ネスト 2 箇所」。
    const html = `<div role="dialog"><div role="dialog"><div role="dialog">x</div></div></div>`;
    const v = lintComposition(html).filter((x) => x.ruleId === "MODAL_NO_NESTED");
    expect(v).toHaveLength(1);
    expect(v[0].token).toContain("2");
  });
});

test.describe("composition-lint S2: 誤検知ガード（兄弟・単一は素通り）", () => {
  test("role=dialog が兄弟として複数並ぶだけ（ショーケース）は素通り", () => {
    const html = `<div role="dialog">A</div><div role="dialog">B</div><div role="dialog">C</div>`;
    expect(ruleIds(html)).not.toContain("MODAL_NO_NESTED");
  });

  test("単一の role=dialog は素通り", () => {
    expect(lintComposition(`<div role="dialog">only</div>`)).toEqual([]);
  });

  test("role=dialog が無い HTML は素通り", () => {
    expect(lintComposition(`<div class="p-4"><button>x</button></div>`)).toEqual([]);
  });

  test("HTML コメント内の入れ子 role=dialog は要素でないので非検知", () => {
    // node-html-parser はコメントを comment node 扱いし querySelectorAll に出さない。
    // 将来パーサ差し替え時の回帰ガード。
    const html = `<div role="dialog">real<!-- <div role="dialog">commented</div> --></div>`;
    expect(ruleIds(html)).not.toContain("MODAL_NO_NESTED");
  });
});

test.describe("composition-lint S2: ネスト interactive（A11Y_NO_NESTED_INTERACTIVE）", () => {
  test("button の中の button を検知", () => {
    expect(ruleIds("<button>x<button>y</button></button>")).toContain(
      "A11Y_NO_NESTED_INTERACTIVE"
    );
  });

  test("a の中の button（クリック領域の入れ子）を検知", () => {
    expect(ruleIds('<a href="#"><button>y</button></a>')).toContain(
      "A11Y_NO_NESTED_INTERACTIVE"
    );
  });

  test("role=button の中の a を検知（カンマセレクタ）", () => {
    expect(ruleIds('<div role="button"><a href="#">x</a></div>')).toContain(
      "A11Y_NO_NESTED_INTERACTIVE"
    );
  });

  test("インタラクティブ要素が兄弟として並ぶだけは素通り", () => {
    expect(ruleIds('<button>a</button><a href="#">b</a>')).not.toContain(
      "A11Y_NO_NESTED_INTERACTIVE"
    );
  });

  test("button 内の非インタラクティブ要素（svg/span）は素通り", () => {
    expect(lintComposition("<button><svg></svg><span>x</span></button>")).toEqual(
      []
    );
  });

  test("href 無しの裸 <a>（非インタラクティブ）の入れ子は素通り（a[href] に限定）", () => {
    // <a> without href はリンクとして機能しないので interactive 扱いしない（Codex 指摘）
    expect(ruleIds("<a><a>x</a></a>")).not.toContain("A11Y_NO_NESTED_INTERACTIVE");
  });
});

test.describe("composition-lint S2: spec の round-trip", () => {
  test("MODAL_NO_NESTED の selector が JSON から正しく復元される", () => {
    // rules.json の "[role=\\"dialog\\"]" エスケープが壊れていないことの回帰ガード
    const rule = getAllRules().find((r) => r.id === "MODAL_NO_NESTED");
    expect(rule?.detector).toBe("composition");
    expect(rule?.compositionCheck).toEqual({
      kind: "nested-selector",
      selector: '[role="dialog"]',
    });
  });
});

// ---------- dom-attr-required（P1-5: dead な a11y ルールの蘇生） ----------

test.describe("composition-lint P1-5: icon-only button の aria-label（BTN_ICON_ONLY_ARIA_REQUIRED）", () => {
  test("svg だけで aria-label 無しの button を検知", () => {
    const html = '<button><svg viewBox="0 0 24 24"><path d="M3 3"/></svg></button>';
    expect(ruleIds(html)).toContain("BTN_ICON_ONLY_ARIA_REQUIRED");
  });

  test("aria-label があれば素通り", () => {
    const html = '<button aria-label="閉じる"><svg viewBox="0 0 24 24"><path d="M3 3"/></svg></button>';
    expect(ruleIds(html)).not.toContain("BTN_ICON_ONLY_ARIA_REQUIRED");
  });

  test("title 属性でも素通り（requireAnyAttr）", () => {
    const html = '<button title="コピー"><svg><path d="M3 3"/></svg></button>';
    expect(ruleIds(html)).not.toContain("BTN_ICON_ONLY_ARIA_REQUIRED");
  });

  test("テキストを持つ button（icon+text）は icon-only でないので素通り", () => {
    const html = '<button><svg><path d="M3 3"/></svg>保存</button>';
    expect(ruleIds(html)).not.toContain("BTN_ICON_ONLY_ARIA_REQUIRED");
  });

  test("svg を持たない（テキストボタン）は対象外", () => {
    const html = '<button>送信</button>';
    expect(ruleIds(html)).not.toContain("BTN_ICON_ONLY_ARIA_REQUIRED");
  });
});

test.describe("composition-lint P1-5: × ボタンの aria-label（TAG_X_ARIA_LABEL_REQUIRED）", () => {
  test("テキストが × だけで aria-label 無しの button を検知", () => {
    expect(ruleIds('<button>×</button>')).toContain("TAG_X_ARIA_LABEL_REQUIRED");
    expect(ruleIds('<button>✕</button>')).toContain("TAG_X_ARIA_LABEL_REQUIRED");
  });

  test("aria-label があれば素通り", () => {
    expect(ruleIds('<button aria-label="タグを削除">×</button>')).not.toContain("TAG_X_ARIA_LABEL_REQUIRED");
  });

  test("× 以外のテキストを含む button は素通り", () => {
    expect(ruleIds('<button>× 削除</button>')).not.toContain("TAG_X_ARIA_LABEL_REQUIRED");
  });
});

test.describe("composition-lint P1-5: skeleton の aria-busy（SKELETON_ARIA_BUSY_REQUIRED）", () => {
  test("skeleton-pulse が自身/祖先に aria-busy を持たなければ検知", () => {
    const html = '<div><div class="h-4 bg-slate-200 skeleton-pulse"></div></div>';
    expect(ruleIds(html)).toContain("SKELETON_ARIA_BUSY_REQUIRED");
  });

  test("祖先コンテナに aria-busy があれば素通り（ancestor-or-self）", () => {
    const html = '<div aria-busy="true" role="status"><div class="skeleton-pulse"></div></div>';
    expect(ruleIds(html)).not.toContain("SKELETON_ARIA_BUSY_REQUIRED");
  });

  test("skeleton-pulse 自身に aria-busy があれば素通り", () => {
    const html = '<div class="skeleton-pulse" aria-busy="true"></div>';
    expect(ruleIds(html)).not.toContain("SKELETON_ARIA_BUSY_REQUIRED");
  });

  test("skeleton-pulse が無い HTML は対象外", () => {
    expect(ruleIds('<div class="animate-pulse"></div>')).not.toContain("SKELETON_ARIA_BUSY_REQUIRED");
  });
});

test.describe("composition-lint P1-5: impossible-static 分類", () => {
  test("意味依存の 3 ルールは automationStatus=impossible-static で明示される", () => {
    const ids = ["SPACE_NO_MISSING_ARIA_CURRENT", "TAG_FILTER_ARIA_SELECTED_REQUIRED", "STEPPER_ARIA_CURRENT_REQUIRED"];
    for (const id of ids) {
      const rule = getAllRules().find((r) => r.id === id);
      expect(rule?.automationStatus, id).toBe("impossible-static");
    }
  });

  test("MODAL_ROLE_DIALOG_REQUIRED は静的不能だが interaction test で covered-by-test", () => {
    const rule = getAllRules().find((r) => r.id === "MODAL_ROLE_DIALOG_REQUIRED");
    expect(rule?.automationStatus).toBe("covered-by-test"); // tests/modal.spec.ts が担保
  });

  test("modal の focus trap / Esc close も covered-by-test（2026-07 棚卸しで宣言漏れを解消）", () => {
    // 宣言に機械的証拠を要求する: この 2 件の実体は tests/modal.spec.ts の
    // 「Tab が開いたモーダル内で focus trap される」「Escape で閉じ、focus がトリガーに復帰する」。
    // modal.spec.ts からテストを消すならこの宣言も戻すこと
    for (const id of ["MODAL_FOCUS_TRAP_REQUIRED", "MODAL_ESC_CLOSE_REQUIRED"]) {
      const rule = getAllRules().find((r) => r.id === id);
      expect(rule?.automationStatus, id).toBe("covered-by-test");
    }
  });

  test("蘇生した 3 ルールは composition + auto", () => {
    const ids = ["BTN_ICON_ONLY_ARIA_REQUIRED", "TAG_X_ARIA_LABEL_REQUIRED", "SKELETON_ARIA_BUSY_REQUIRED"];
    for (const id of ids) {
      const rule = getAllRules().find((r) => r.id === id);
      expect(rule?.detector, id).toBe("composition");
      expect(rule?.compositionCheck?.kind, id).toBe("dom-attr-required");
      expect(rule?.automationStatus, id).toBe("auto");
    }
  });

  test("A11Y_NAV_ARIA_LABEL_REQUIRED も composition + dom-attr-required + auto", () => {
    // checklist.md の [評価不可候補: ルール無し] を解消したルール。detector / kind /
    // automationStatus のどれかが変わると「auto と宣言しているのに検出しない」に戻るので固定する。
    const rule = getAllRules().find((r) => r.id === "A11Y_NAV_ARIA_LABEL_REQUIRED");
    expect(rule?.detector).toBe("composition");
    expect(rule?.compositionCheck?.kind).toBe("dom-attr-required");
    expect(rule?.automationStatus).toBe("auto");
    // when 述語なし = すべての nav / role=navigation が候補（qualifies が全件 true）
    expect(rule?.compositionCheck?.when).toBeUndefined();
  });
});

test.describe("composition B2: A11Y_DISABLED_REQUIRES_ARIA（DADS 取り込み・disabled 併記規範）", () => {
  test("<button disabled> 単独は warn 検知", () => {
    const v = lintComposition('<button disabled class="h-10 px-4">保存</button>');
    const hit = v.find((x) => x.ruleId === "A11Y_DISABLED_REQUIRES_ARIA");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("warn");
  });

  test("aria-disabled=\"true\" 併記なら clean", () => {
    const v = lintComposition(
      '<button disabled aria-disabled="true" class="opacity-50 cursor-not-allowed h-10 px-4">保存</button>'
    );
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_DISABLED_REQUIRES_ARIA");
  });

  test("aria-disabled 単独（native なし = タブ順維持パターン）はこのルールの対象外", () => {
    const v = lintComposition('<button aria-disabled="true" class="h-10 px-4">保存</button>');
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_DISABLED_REQUIRES_ARIA");
  });

  test("button 以外（input 等）は対象外（フォーム送信除外のネイティブ用途を残す）", () => {
    const v = lintComposition('<input disabled value="x"><div disabled>x</div>');
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_DISABLED_REQUIRES_ARIA");
  });
});

test.describe("composition B3: BTN_MIN_TAP_TARGET 自動検出化（dom-class-required）", () => {
  const EXPANSION = "relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2";

  test("h-8 テキストボタンに拡張クラスが無ければ error 検知", () => {
    const v = lintComposition('<button class="h-8 px-3 text-[0.875rem]">保存</button>');
    const hit = v.find((x) => x.ruleId === "BTN_MIN_TAP_TARGET");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("error");
  });

  test("h-10（medium 40px）も 44px 未達なので検知対象", () => {
    const v = lintComposition('<button class="h-10 px-4">保存</button>');
    expect(v.map((x) => x.ruleId)).toContain("BTN_MIN_TAP_TARGET");
  });

  test("拡張クラス（after:h-11）があれば clean", () => {
    const v = lintComposition(`<button class="h-8 px-3 ${EXPANSION}">保存</button>`);
    expect(v.map((x) => x.ruleId)).not.toContain("BTN_MIN_TAP_TARGET");
  });

  test("h-12（48px）はそもそも selector 対象外", () => {
    const v = lintComposition('<button class="h-12 px-6">保存</button>');
    expect(v.map((x) => x.ruleId)).not.toContain("BTN_MIN_TAP_TARGET");
  });

  test("icon-only ボタン（テキスト無し + svg）は excludeWhen で第一弾対象外", () => {
    const v = lintComposition(
      '<button class="w-10 h-10" aria-label="閉じる"><svg viewBox="0 0 24 24"></svg></button>'
    );
    expect(v.map((x) => x.ruleId)).not.toContain("BTN_MIN_TAP_TARGET");
  });

  test("min-h-11 でも要件を満たす（requireAnyClass の別解）", () => {
    const v = lintComposition('<button class="h-8 min-h-11 px-3">保存</button>');
    expect(v.map((x) => x.ruleId)).not.toContain("BTN_MIN_TAP_TARGET");
  });
});

test.describe("composition: A11Y_NAV_ARIA_LABEL_REQUIRED（nav のアクセシブルネーム必須）", () => {
  test("aria-label 無しの <nav> は error 検知", () => {
    const v = lintComposition('<nav class="flex-1 px-3 py-4"><a href="#">ダッシュボード</a></nav>');
    const hit = v.find((x) => x.ruleId === "A11Y_NAV_ARIA_LABEL_REQUIRED");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("error");
  });

  test("aria-label があれば clean", () => {
    const v = lintComposition(
      '<nav aria-label="メインナビゲーション" class="flex-1 px-3 py-4"><a href="#">ダッシュボード</a></nav>'
    );
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_NAV_ARIA_LABEL_REQUIRED");
  });

  test("aria-labelledby（見出し参照）でも clean", () => {
    const v = lintComposition(
      '<h2 id="nav-heading">サイトナビゲーション</h2><nav aria-labelledby="nav-heading"><a href="#">ホーム</a></nav>'
    );
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_NAV_ARIA_LABEL_REQUIRED");
  });

  test('role="navigation" の div も検知対象（selector の第 2 項）', () => {
    const v = lintComposition('<div role="navigation"><a href="#">ホーム</a></div>');
    const hit = v.find((x) => x.ruleId === "A11Y_NAV_ARIA_LABEL_REQUIRED");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("error");
  });

  test("aria-label 付きの nav が 2 つ並ぶ（sidebar + breadcrumb）は clean", () => {
    // ランドマークが複数ある正規の画面を誤検知しないこと（このルールが守りたい形そのもの）
    const v = lintComposition(
      '<nav aria-label="メインナビゲーション"><a href="#">ダッシュボード</a></nav>' +
        '<nav aria-label="パンくずリスト"><ol><li><a href="#">ホーム</a></li></ol></nav>'
    );
    expect(v.map((x) => x.ruleId)).not.toContain("A11Y_NAV_ARIA_LABEL_REQUIRED");
  });

  test("aria-label が空文字なら検知（存在するだけでは名前にならない）", () => {
    const v = lintComposition('<nav aria-label=""><a href="#">ホーム</a></nav>');
    expect(v.map((x) => x.ruleId)).toContain("A11Y_NAV_ARIA_LABEL_REQUIRED");
  });
});
