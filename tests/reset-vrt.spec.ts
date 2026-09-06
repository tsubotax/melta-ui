/**
 * リセットCSS差し替え VRT（DADS 取り込み V1、監査モード）
 *
 * 保証したいこと: melta の生成 UI は、ホストサイトがどのリセットCSS
 * （Normalize / Bootstrap Reboot / Tailwind Preflight / Eric Meyer / kiso.css）を
 * 使っていても見た目が変わらない。
 *
 * 方式（DADS design-system-example-components-html の reset-css-vrt.js を踏襲）:
 * - スナップショットファイルは持たない。同一セッション内で
 *   「リセットなし」と「リセットを melta スタックより前に注入」を撮り比べる
 * - fixture は契約 htmlSample から実行時に組み立てる（コピー drift を作らない）。
 *   CSS 環境は showcase と同一（Tailwind CDN + ds-config.js + ds-theme.css）
 * - pixelmatch threshold 0 + includeAA で literal 比較。フレークしたら
 *   閾値を緩めて保証文言を「有意差 0px」に変える（docs/lint-and-reset-vrt-adoption-plan.md V1）
 *
 * 実行: npm run test:reset-vrt（通常の npm test からは除外されている）
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEN_DIR = join(ROOT, "tests", "fixtures", "reset-vrt-generated");

const RESETS = [
  "normalize.css",
  "bootstrap-reboot.css",
  "tailwind-preflight.css",
  "meyer-reset.css",
  "kiso.css",
] as const;

/** 契約 htmlSample を全部並べた fixture body を組み立てる */
function buildBody(): string {
  const dir = join(ROOT, "design", "contracts", "components");
  const sections: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".contract.json"))) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const samples = Object.entries(c.htmlSample ?? {}).filter(
      ([, v]) => typeof v === "string"
    ) as [string, string][];
    if (samples.length === 0) continue;
    const blocks = samples
      .map(([key, html]) => `<div data-sample="${c.id}:${key}" class="p-2">${html}</div>`)
      .join("\n");
    sections.push(`<section class="p-4">${blocks}</section>`);
  }
  return sections.join("\n");
}

/**
 * fixture HTML を生成する。resetFile を渡すと melta スタック（CDN + config + theme）より
 * **前**に <link> で注入する（= ホストのリセットが先に読まれる実サイト条件の再現）
 */
function buildFixture(body: string, resetFile?: string): string {
  const resetLink = resetFile
    ? `<link rel="stylesheet" href="/tests/fixtures/resets/${resetFile}">`
    : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
${resetLink}
<script src="https://cdn.tailwindcss.com"></script>
<script src="/scripts/ds-config.js"></script>
<link rel="stylesheet" href="/scripts/ds-theme.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* 決定性の固定: アニメーション・キャレットを止める（比較対象はレイアウト/静的描画） */
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
</style>
</head>
<body>
${body}
</body></html>`;
}

/** ページを開いて安定化を待ち、fullPage screenshot を PNG で返す */
async function shoot(page: Page, path: string): Promise<PNG> {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Tailwind CDN の JIT がクラス走査 → <style> 注入を終えるまでの猶予 + レンダリング確定
  await page.waitForTimeout(500);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const buf = await page.screenshot({ fullPage: true });
  return PNG.sync.read(buf);
}

/** literal 比較。差分数と diff PNG を返す */
function diff(a: PNG, b: PNG): { count: number; png: PNG | null } {
  if (a.width !== b.width || a.height !== b.height) {
    return { count: Math.abs(a.width * a.height - b.width * b.height) || 1, png: null };
  }
  const out = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, out.data, a.width, a.height, {
    threshold: 0,
    includeAA: true,
  });
  return { count, png: out };
}

/**
 * PNG を testInfo.outputPath() に書き出してから path で attach する。
 *
 * `attach(name, { body })` はデフォルトの list reporter だと中間ファイルを作らないため、
 * CI で test-results/ を upload しても画像が 1 枚も残らない（error-context.md だけになる）。
 * outputPath 経由なら test-results/<テスト dir>/ に実ファイルが残り、artifact から回収できる。
 */
async function attachPng(testInfo: TestInfo, name: string, png: PNG): Promise<void> {
  const file = testInfo.outputPath(name);
  writeFileSync(file, PNG.sync.write(png));
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

test.describe("reset-swap VRT: ホストのリセットCSSに影響されない", () => {
  const body = buildBody();

  test.beforeAll(() => {
    mkdirSync(GEN_DIR, { recursive: true });
    writeFileSync(join(GEN_DIR, "baseline.html"), buildFixture(body));
    for (const r of RESETS) {
      writeFileSync(join(GEN_DIR, `with-${r}.html`), buildFixture(body, r));
    }
  });

  test("A/A: 同一条件の 2 回撮影が diff 0（環境の決定性検証）", async ({ page }, testInfo) => {
    const a = await shoot(page, "/tests/fixtures/reset-vrt-generated/baseline.html");
    const b = await shoot(page, "/tests/fixtures/reset-vrt-generated/baseline.html");
    const { count, png } = diff(a, b);
    if (count > 0 && png) {
      await attachPng(testInfo, "aa-diff.png", png);
    }
    expect(count, "A/A が 0 でない = この環境ではピクセル比較自体が信頼できない").toBe(0);
  });

  for (const reset of RESETS) {
    test(`${reset} を前挿入しても見た目が変わらない`, async ({ page }, testInfo) => {
      const baseline = await shoot(page, "/tests/fixtures/reset-vrt-generated/baseline.html");
      const withReset = await shoot(page, `/tests/fixtures/reset-vrt-generated/with-${reset}.html`);
      const { count, png } = diff(baseline, withReset);
      if (count > 0) {
        await attachPng(testInfo, "baseline.png", baseline);
        await attachPng(testInfo, "with-reset.png", withReset);
        if (png) await attachPng(testInfo, "diff.png", png);
      }
      expect(count, `${reset} の前挿入で ${count}px の差分`).toBe(0);
    });
  }
});
