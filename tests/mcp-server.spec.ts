import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CliArgError, parseMeltaRootArg } from "../src/cli-args.js";
import { buildMcpInstructions } from "../src/guidance.js";
import { createServer } from "../src/server.js";

/**
 * fixture 側のトークンだと一目で分かる sentinel 値。
 * リポ本体の tokens.json には存在しないので、root 差し替えが効いた証明になる。
 */
function fixtureTokens(sentinelValue: string): string {
  return JSON.stringify({
    version: "0.0.0-fixture",
    color: {
      sentinel: { value: sentinelValue, tailwind: "text-sentinel" },
    },
  });
}

function createMeltaRootFixture(designText?: string, sentinelValue = "#abcdef"): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "melta-mcp-root-"));
  mkdirSync(resolve(fixtureRoot, "metadata"), { recursive: true });
  mkdirSync(resolve(fixtureRoot, "design/contracts"), { recursive: true });
  copyFileSync(resolve("package.json"), resolve(fixtureRoot, "package.json"));
  copyFileSync(
    resolve("metadata/components.json"),
    resolve(fixtureRoot, "metadata/components.json")
  );
  copyFileSync(
    resolve("design/contracts/rules.json"),
    resolve(fixtureRoot, "design/contracts/rules.json")
  );
  writeFileSync(
    resolve(fixtureRoot, "design/contracts/tokens.json"),
    fixtureTokens(sentinelValue),
    "utf-8"
  );
  if (designText !== undefined) {
    writeFileSync(resolve(fixtureRoot, "DESIGN.md"), designText, "utf-8");
  }
  return fixtureRoot;
}

function runTsxWithMeltaRoot(fixtureRoot: string, source: string): string {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    {
      cwd: resolve("."),
      env: { ...process.env, MELTA_ROOT: fixtureRoot },
      encoding: "utf-8",
    }
  );
}

/** `node src/index.ts --melta-root=<path>` を stdio MCP サーバーとして起動する transport */
function createCliTransport(args: string[]): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("src/index.ts"), ...args],
    cwd: resolve("."),
  });
}

test.describe("MCP onboarding", () => {
  test("initialize instructions が利用順と検証境界を常駐提示する", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "melta-test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const instructions = client.getInstructions();
      expect(instructions).toContain("melta://design-constitution");
      expect(instructions).toContain("contracts > DESIGN.md Quick Reference > prose docs");
      expect(instructions).toContain("check_html");
      expect(instructions).toContain("lint-clean draft / brand未承認");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("vendor 名と URI scheme を同じ instructions に反映する", () => {
    const instructions = buildMcpInstructions("acme-ds", "acme");
    expect(instructions).toContain("acme-ds は完成済み CSS コンポーネント集ではなく");
    expect(instructions).toContain("acme://design-constitution");
    expect(instructions).not.toContain("melta://design-constitution");
  });

  test("design-constitution resource が package 同梱の DESIGN.md を返す", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "melta-test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listResources();
      expect(listed.resources.map((resource) => resource.uri)).toEqual([
        "melta://design-constitution",
        "melta://tokens",
        "melta://components",
        "melta://rules",
        "melta://rules/auto-detectable",
      ]);
      expect(listed.resources).toContainEqual(
        expect.objectContaining({
          uri: "melta://design-constitution",
          mimeType: "text/markdown",
        })
      );

      const resource = await client.readResource({ uri: "melta://design-constitution" });
      const expected = readFileSync(resolve("DESIGN.md"), "utf-8");
      expect(resource.contents).toHaveLength(1);
      expect(resource.contents[0]).toEqual(
        expect.objectContaining({
          uri: "melta://design-constitution",
          mimeType: "text/markdown",
          text: expected,
        })
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("MELTA_ROOT を process 起動前に指定すると、その DESIGN.md resource を返す", () => {
    const sentinel = "# Vendor Design Constitution\n\nMELTA_ROOT sentinel\n";
    const fixtureRoot = createMeltaRootFixture(sentinel);
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { Client } from "@modelcontextprotocol/sdk/client/index.js";
          import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
          import { createServer } from "./src/server.ts";

          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const server = createServer();
          const client = new Client({ name: "melta-root-test", version: "1.0.0" });
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          const resource = await client.readResource({ uri: "melta://design-constitution" });
          process.stdout.write(String(resource.contents[0]?.text ?? ""));
          await client.close();
          await server.close();
        `
      );
      expect(output).toBe(sentinel);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("DESIGN.md が無い MELTA_ROOT は対象 path を含む診断を返す", () => {
    const fixtureRoot = createMeltaRootFixture();
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { loadDesignConstitution } from "./src/utils/loader.ts";
          try {
            loadDesignConstitution();
          } catch (error) {
            process.stdout.write(error instanceof Error ? error.message : String(error));
          }
        `
      );
      expect(output).toContain("[melta-ui] DESIGN.md の読み込みに失敗しました");
      expect(output).toContain(resolve(fixtureRoot, "DESIGN.md"));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

test.describe("アセット root の差し替え（vendor 経路）", () => {
  test("MELTA_ROOT 差し替えで get_token が fixture のトークンを返す", () => {
    const fixtureRoot = createMeltaRootFixture(undefined, "#abcdef");
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { Client } from "@modelcontextprotocol/sdk/client/index.js";
          import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
          import { createServer } from "./src/server.ts";

          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const server = createServer();
          const client = new Client({ name: "melta-root-test", version: "1.0.0" });
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          const result = await client.callTool({
            name: "get_token",
            arguments: { path: "color.sentinel" },
          });
          process.stdout.write(String(result.content[0]?.text ?? ""));
          await client.close();
          await server.close();
        `
      );
      expect(JSON.parse(output)).toEqual({ value: "#abcdef", tailwind: "text-sentinel" });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("MELTA_ROOT 差し替えで search が fixture のトークンを引く", () => {
    const fixtureRoot = createMeltaRootFixture(undefined, "#abcdef");
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { Client } from "@modelcontextprotocol/sdk/client/index.js";
          import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
          import { createServer } from "./src/server.ts";

          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const server = createServer();
          const client = new Client({ name: "melta-root-test", version: "1.0.0" });
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          const result = await client.callTool({
            name: "search",
            arguments: { query: "sentinel" },
          });
          process.stdout.write(String(result.content[0]?.text ?? ""));
          await client.close();
          await server.close();
        `
      );
      const response = JSON.parse(output);
      expect(response.results).toContainEqual(
        expect.objectContaining({
          type: "token",
          path: "color.sentinel",
          data: { value: "#abcdef", tailwind: "text-sentinel" },
        })
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("setMeltaRoot は MELTA_ROOT より優先され、読み込み済みキャッシュも破棄する", () => {
    const explicitRoot = createMeltaRootFixture(undefined, "#111111");
    const envRoot = createMeltaRootFixture(undefined, "#222222");
    try {
      const output = runTsxWithMeltaRoot(
        envRoot,
        `
          import { setMeltaRoot, loadTokens } from "./src/utils/loader.ts";
          // 先に env 経路で読ませてキャッシュを作ってから差し替える
          const before = loadTokens().color.sentinel.value;
          setMeltaRoot(${JSON.stringify(explicitRoot)});
          const after = loadTokens().color.sentinel.value;
          process.stdout.write(JSON.stringify({ before, after }));
        `
      );
      expect(JSON.parse(output)).toEqual({ before: "#222222", after: "#111111" });
    } finally {
      rmSync(explicitRoot, { recursive: true, force: true });
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  test("parseMeltaRootArg は = / スペース区切りを受け、値なしは設定エラーで落ちる", () => {
    expect(parseMeltaRootArg(["--melta-root=/tmp/vendor"])).toBe("/tmp/vendor");
    expect(parseMeltaRootArg(["--melta-root", "/tmp/vendor"])).toBe("/tmp/vendor");
    expect(parseMeltaRootArg([])).toBeNull();
    // ホスト側の無関係な引数は拾わない
    expect(parseMeltaRootArg(["--root", "/tmp/other", "--verbose"])).toBeNull();
    // 値なしは黙って env / パッケージ相対に fallback せず失敗する
    expect(() => parseMeltaRootArg(["--melta-root"])).toThrow(CliArgError);
    expect(() => parseMeltaRootArg(["--melta-root", "--verbose"])).toThrow(CliArgError);
    expect(() => parseMeltaRootArg(["--melta-root="])).toThrow(CliArgError);
  });

  test("CLI 起動 `--melta-root=<path>` で MCP サーバーが fixture のアセットを配る", async () => {
    const fixtureRoot = createMeltaRootFixture(undefined, "#333333");
    const client = new Client({ name: "melta-cli-test", version: "1.0.0" });
    try {
      await client.connect(createCliTransport([`--melta-root=${fixtureRoot}`]));
      const result = (await client.callTool({
        name: "get_token",
        arguments: { path: "color.sentinel" },
      })) as { content: Array<{ text?: string }> };
      expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
        value: "#333333",
        tailwind: "text-sentinel",
      });
    } finally {
      await client.close();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("値なしの --melta-root は起動せず設定エラーで落ちる", () => {
    let stderr = "";
    let status: number | null = null;
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", resolve("src/index.ts"), "--melta-root"],
        { cwd: resolve("."), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }
      );
    } catch (e) {
      const err = e as { status: number | null; stderr: string };
      status = err.status;
      stderr = err.stderr;
    }
    expect(status).toBe(1);
    expect(stderr).toContain("--melta-root に値がありません");
  });

  test("tokens.json が無い root は期待パスと root 差し替え方法を含む診断を返す", () => {
    const fixtureRoot = createMeltaRootFixture();
    rmSync(resolve(fixtureRoot, "design/contracts/tokens.json"), { force: true });
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { loadTokens } from "./src/utils/loader.ts";
          try {
            loadTokens();
          } catch (error) {
            process.stdout.write(error instanceof Error ? error.message : String(error));
          }
        `
      );
      expect(output).toContain("[melta-ui] design/contracts/tokens.json の読み込みに失敗しました");
      expect(output).toContain(resolve(fixtureRoot, "design/contracts/tokens.json"));
      expect(output).toContain("--melta-root=<path>");
      expect(output).toContain("MELTA_ROOT=<path>");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("components.json が無い root も同じ流儀の診断を返す", () => {
    const fixtureRoot = createMeltaRootFixture();
    rmSync(resolve(fixtureRoot, "metadata/components.json"), { force: true });
    try {
      const output = runTsxWithMeltaRoot(
        fixtureRoot,
        `
          import { loadComponents } from "./src/utils/loader.ts";
          try {
            loadComponents();
          } catch (error) {
            process.stdout.write(error instanceof Error ? error.message : String(error));
          }
        `
      );
      expect(output).toContain("[melta-ui] metadata/components.json の読み込みに失敗しました");
      expect(output).toContain(resolve(fixtureRoot, "metadata/components.json"));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
