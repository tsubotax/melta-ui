import { defineConfig } from "@playwright/test";

/**
 * リセットCSS差し替え VRT 専用 config（DADS 取り込み V1、監査モード）。
 * 実行: npm run test:reset-vrt
 *
 * 通常 config と分ける理由:
 * - 監査段階では落ちる前提のスペックなので npm test（CI test job）を壊さない
 * - ピクセル比較の決定性のため viewport / deviceScaleFactor を固定する
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/reset-vrt.spec.ts"],
  timeout: 60000,
  // ピクセル比較は逐次で（並列だと CDN JIT / フォント読み込みのタイミング揺れが増える）
  workers: 1,
  use: {
    baseURL: "http://localhost:3333",
    headless: true,
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npx http-server . -p 3333 -s",
    port: 3333,
    reuseExistingServer: true,
  },
});
