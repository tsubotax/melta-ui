import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // reset-vrt は監査モード（B4）: 通常の npm test から除外し、
  // npm run test:reset-vrt（playwright.reset-vrt.config.ts）で opt-in 実行する。
  // green 化して CI required に昇格するまでこの分離を維持（docs/dads-adoption-plan.md V1）
  testIgnore: ["**/reset-vrt.spec.ts"],
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },
  webServer: {
    command: "npx http-server . -p 3333 -s",
    port: 3333,
    reuseExistingServer: true,
  },
});
