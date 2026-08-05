/**
 * BTN_MIN_TAP_TARGET の ::after タップ領域拡張パターンの受け入れテスト（DADS 取り込み B3）
 *
 * 契約（button.contract.json sizes.small/medium）が配る
 * `relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2`
 * の**パターン意味論**を実ブラウザで検証する。Tailwind CDN に依存しない同義の
 * 素 CSS で fixture を組む（CI の外部依存を避ける。クラス→CSS の対応は契約が SSOT）。
 *
 * 検証項目（docs/lint-and-reset-vrt-adoption-plan.md B3 の受け入れ条件）:
 * 1. 見た目のジオメトリ不変（getBoundingClientRect は h-8 = 32px のまま）
 * 2. 拡張領域（ボタン上下の張り出し帯）のクリックがボタンに落ちる（elementFromPoint + click）
 * 3. overflow:hidden 祖先では拡張領域が切れる（既知の制約の実挙動を固定）
 * 4. disabled（pointer-events-none）では拡張領域もイベント無効
 */

import { test, expect } from "@playwright/test";

const FIXTURE = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; padding: 100px; }
  .btn {
    position: relative; /* relative */
    display: inline-flex; align-items: center; justify-content: center;
    height: 32px; /* h-8 */ padding: 0 12px; border: 0; background: #2b70ef; color: #fff;
  }
  .btn::after {
    content: ""; position: absolute; /* after:absolute */
    left: 0; right: 0; /* after:inset-x-0 */
    top: 50%; /* after:top-1/2 */
    height: 44px; /* after:h-11 */
    transform: translateY(-50%); /* after:-translate-y-1/2 */
  }
  .btn[aria-disabled="true"] { pointer-events: none; opacity: 0.5; }
  .clip { overflow: hidden; height: 32px; width: 200px; }
</style></head><body>
  <button id="plain" class="btn" type="button">保存</button>
  <div style="height:40px"></div>
  <div class="clip"><button id="clipped" class="btn" type="button">切られる</button></div>
  <div style="height:40px"></div>
  <button id="disabled" class="btn" type="button" disabled aria-disabled="true">無効</button>
</body></html>`;

test.describe("tap-target: ::after 拡張パターンの意味論", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(FIXTURE);
  });

  test("見た目のジオメトリは h-8（32px）のまま変わらない", async ({ page }) => {
    const box = await page.locator("#plain").boundingBox();
    expect(box!.height).toBe(32);
  });

  test("ボタン上端の 6px 上（拡張帯）でも elementFromPoint がボタンに落ちる", async ({ page }) => {
    const hit = await page.evaluate(() => {
      const btn = document.getElementById("plain")!;
      const r = btn.getBoundingClientRect();
      const above = document.elementFromPoint(r.left + r.width / 2, r.top - 4);
      const below = document.elementFromPoint(r.left + r.width / 2, r.bottom + 4);
      return { above: above?.id, below: below?.id };
    });
    expect(hit.above).toBe("plain");
    expect(hit.below).toBe("plain");
  });

  test("拡張帯のクリックで click イベントが発火し event.target はボタン自身", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { hits: string[] }).hits = [];
      document.getElementById("plain")!.addEventListener("click", (e) => {
        (window as unknown as { hits: string[] }).hits.push((e.target as HTMLElement).id);
      });
    });
    const box = (await page.locator("#plain").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y - 4); // 上 6px 帯の内側
    const hits = await page.evaluate(() => (window as unknown as { hits: string[] }).hits);
    expect(hits).toEqual(["plain"]);
  });

  test("overflow:hidden 祖先内では拡張帯が切られる（既知の制約）", async ({ page }) => {
    const hit = await page.evaluate(() => {
      const btn = document.getElementById("clipped")!;
      const r = btn.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top - 4)?.id ?? "(other)";
    });
    expect(hit).not.toBe("clipped");
  });

  test("disabled（pointer-events-none）では拡張帯もヒットしない", async ({ page }) => {
    const hit = await page.evaluate(() => {
      const btn = document.getElementById("disabled")!;
      const r = btn.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top - 4)?.id ?? "(body)";
    });
    expect(hit).not.toBe("disabled");
  });
});
