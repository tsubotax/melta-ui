/**
 * package.json の exports map が消費者側の解決を壊していないかの検査。
 *
 * exports を新設すると、宣言していない path は「存在しても import できない」状態になる。
 * 既存の deep import（melta-ds-mcp/dist/utils/lint-core.js 等）を壊さないことを
 * 実際の Node 解決器で確認する。dist のビルド状態に依存しないよう、
 * リポの exports をそのまま持つ stub パッケージを tmp に組んで解決だけを見る。
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { compareSemver } from "../scripts/design/pack-smoke.js";

/** exports の解決先（"./dist/*" 等の pattern を含む）を stub ファイルとして用意する */
const STUB_FILES = [
  "dist/index.js",
  "dist/utils/lint-core.js",
  "dist/utils/loader.js",
  "design/contracts/tokens.json",
  "design/contracts/rules.json",
  "metadata/components.json",
];

function createStubConsumer(): { consumerEntry: string; cleanup: () => void } {
  const workDir = mkdtempSync(join(tmpdir(), "melta-exports-"));
  const pkgDir = join(workDir, "pkg");
  const consumerDir = join(workDir, "consumer");
  const realPkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    // exports はリポの実物をそのまま使う（ここが検査対象）
    JSON.stringify(
      {
        name: realPkg.name,
        version: realPkg.version,
        type: realPkg.type,
        exports: realPkg.exports,
      },
      null,
      2
    ),
    "utf-8"
  );
  for (const rel of STUB_FILES) {
    const abs = join(pkgDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, rel.endsWith(".json") ? "{}" : "export {};\n", "utf-8");
  }

  mkdirSync(join(consumerDir, "node_modules"), { recursive: true });
  symlinkSync(pkgDir, join(consumerDir, "node_modules", realPkg.name), "dir");

  return {
    consumerEntry: join(consumerDir, "index.js"),
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

test.describe("npm 配布の exports map", () => {
  test("公開 entry と既存 deep import が消費者側で解決できる", () => {
    const { consumerEntry, cleanup } = createStubConsumer();
    try {
      const require = createRequire(consumerEntry);
      const cases: Array<[string, string]> = [
        // 新設の公開 entry（Phase 0 で昇格させるのは lint-core だけ）
        ["melta-ds-mcp/lint-core", "dist/utils/lint-core.js"],
        ["melta-ds-mcp/package.json", "package.json"],
        // 既存の deep import（exports 新設で壊してはいけない経路）
        ["melta-ds-mcp/dist/utils/lint-core.js", "dist/utils/lint-core.js"],
        ["melta-ds-mcp/dist/utils/loader.js", "dist/utils/loader.js"],
        ["melta-ds-mcp/dist/index.js", "dist/index.js"],
        ["melta-ds-mcp/design/contracts/tokens.json", "design/contracts/tokens.json"],
        ["melta-ds-mcp/design/contracts/rules.json", "design/contracts/rules.json"],
        ["melta-ds-mcp/metadata/components.json", "metadata/components.json"],
      ];
      for (const [specifier, expectedSuffix] of cases) {
        const resolved = require.resolve(specifier).replace(/\\/g, "/");
        expect(resolved, `${specifier} が解決できること`).toContain(expectedSuffix);
      }
    } finally {
      cleanup();
    }
  });

  test("exports に無い path は公開されない（配布境界の維持）", () => {
    const { consumerEntry, cleanup } = createStubConsumer();
    try {
      const require = createRequire(consumerEntry);
      expect(() => require.resolve("melta-ds-mcp/src/utils/loader.ts")).toThrow();
    } finally {
      cleanup();
    }
  });

  test("bare import は公開しない（import しただけで stdio サーバーが起動する footgun）", () => {
    const { consumerEntry, cleanup } = createStubConsumer();
    try {
      const require = createRequire(consumerEntry);
      // dist/index.js は起動と同時に startServer() が走る CLI entry。
      // bin 起動に "." は不要なので公開 API にしない（dist/* passthrough では到達可能）
      expect(() => require.resolve("melta-ds-mcp")).toThrow();
    } finally {
      cleanup();
    }
  });

  test("registry 同期検査の semver 比較（stale=fail / 先行=warn の分岐）", () => {
    // registry > repo → リポが stale（pack-smoke は hard fail）
    expect(compareSemver("0.7.0", "0.6.0")).toBe(1);
    expect(compareSemver("0.6.1", "0.6.0")).toBe(1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    // repo > registry → contracts を先に publish（warn 継続）
    expect(compareSemver("0.6.0", "0.7.0")).toBe(-1);
    // 一致
    expect(compareSemver("0.6.0", "0.6.0")).toBe(0);
    // prerelease は同じ core の release より小さい（0.6.0-rc.1 → 0.6.0 の運用）
    expect(compareSemver("0.6.0", "0.6.0-rc.1")).toBe(1);
    expect(compareSemver("0.6.0-rc.1", "0.6.0")).toBe(-1);
    expect(compareSemver("0.6.0-rc.2", "0.6.0-rc.1")).toBe(1);
  });

  test("loader は公開 entry に昇格させない（engine API 設計は Phase 3）", () => {
    const { consumerEntry, cleanup } = createStubConsumer();
    try {
      const require = createRequire(consumerEntry);
      expect(() => require.resolve("melta-ds-mcp/loader")).toThrow();
      // 従来同等の de facto 経路（dist/* passthrough）では引き続き到達できる
      expect(require.resolve("melta-ds-mcp/dist/utils/loader.js")).toContain(
        "dist/utils/loader.js"
      );
    } finally {
      cleanup();
    }
  });
});
