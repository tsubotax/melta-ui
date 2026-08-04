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
        ["melta-ds-mcp", "dist/index.js"],
        // 新設の短い公開 entry
        ["melta-ds-mcp/lint-core", "dist/utils/lint-core.js"],
        ["melta-ds-mcp/loader", "dist/utils/loader.js"],
        ["melta-ds-mcp/package.json", "package.json"],
        // 既存の deep import（exports 新設で壊してはいけない経路）
        ["melta-ds-mcp/dist/utils/lint-core.js", "dist/utils/lint-core.js"],
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
});
