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

test.describe("check_html の入力検証（MCP 境界の fail-open 閉塞）", () => {
  // 以前は handler が型キャストだけで、schema の enum は runtime で照合されなかった。
  // sourceType: "htlm" が composition 検査を無言で外し passed: true を返す
  // （2026-08-17 Codex 監査で実測）。ここでは MCP 経由で isError: true になることを固定する。
  const NESTED = '<div role="dialog"><div role="dialog">x</div></div>';

  async function withInMemory<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "melta-check-html-args", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      return await fn(client);
    } finally {
      await client.close();
      await server.close();
    }
  }

  test("未知の sourceType は isError: true で返す（throw ではなくツールエラー）", async () => {
    await withInMemory(async (client) => {
      const result = (await client.callTool({
        name: "check_html",
        arguments: { source: NESTED, sourceType: "htlm" },
      })) as { isError?: boolean; content: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? "").toMatch(/sourceType/);
    });
  });

  test("sourceType: null は省略扱いにせず拒否する", async () => {
    await withInMemory(async (client) => {
      const result = (await client.callTool({
        name: "check_html",
        arguments: { source: NESTED, sourceType: null },
      })) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });
  });

  test("arguments 自体を省略した呼び出しも TypeError にならず isError: true", async () => {
    await withInMemory(async (client) => {
      const result = (await client.callTool({ name: "check_html" })) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });
  });

  test("source が文字列でない場合も isError: true", async () => {
    await withInMemory(async (client) => {
      const result = (await client.callTool({
        name: "check_html",
        arguments: { source: 123 },
      })) as { isError?: boolean };
      expect(result.isError).toBe(true);
    });
  });

  test("省略時は html として composition が走る（正規経路の回帰）", async () => {
    await withInMemory(async (client) => {
      const result = (await client.callTool({
        name: "check_html",
        arguments: { source: NESTED },
      })) as { isError?: boolean; content: Array<{ text?: string }> };
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0]?.text ?? "{}");
      expect(body.passed).toBe(false);
      expect(body.violations.map((v: { ruleId: string }) => v.ruleId)).toContain("MODAL_NO_NESTED");
    });
  });

  test("tool schema の sourceType enum は runtime の許容値と同一（二重 SSOT を持たない）", async () => {
    await withInMemory(async (client) => {
      const listed = (await client.listTools()) as {
        tools: Array<{ name: string; inputSchema: { properties: { sourceType: { enum: string[] } } } }>;
      };
      const tool = listed.tools.find((t) => t.name === "check_html");
      expect(tool).toBeDefined();
      const { SOURCE_TYPES } = await import("../src/tools/check-html.js");
      expect(tool!.inputSchema.properties.sourceType.enum).toEqual([...SOURCE_TYPES]);
    });
  });
});

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

  test("doc を持たない bundle では design-constitution resource を列挙しない（S2 W6）", async () => {
    // 以前は DESIGN.md の有無に関わらず無条件に列挙していたため、
    // doc を同梱しない bundle では「list には出るが read すると必ず ENOENT」という
    // 壊れた resource が残り、クライアントは接続直後に 1 件必ず失敗していた。
    const fixtureRoot = createMeltaRootFixture(undefined); // DESIGN.md を置かない
    const client = new Client({ name: "melta-doc-capability", version: "1.0.0" });
    try {
      await client.connect(createCliTransport([`--melta-root=${fixtureRoot}`]));
      const listed = (await client.listResources()) as { resources: Array<{ uri: string }> };
      const uris = listed.resources.map((r) => r.uri);
      expect(uris, `design-constitution が列挙されている: ${uris.join(", ")}`).not.toContain(
        "melta://design-constitution"
      );
      // 他の resource は従来どおり出ること（列挙ごと消していないことの確認）
      expect(uris).toContain("melta://tokens");
      expect(uris).toContain("melta://rules");
    } finally {
      await client.close();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("doc を持つ bundle では design-constitution resource が列挙される", async () => {
    const fixtureRoot = createMeltaRootFixture("# Vendor Design\n");
    const client = new Client({ name: "melta-doc-capability-on", version: "1.0.0" });
    try {
      await client.connect(createCliTransport([`--melta-root=${fixtureRoot}`]));
      const listed = (await client.listResources()) as { resources: Array<{ uri: string }> };
      expect(listed.resources.map((r) => r.uri)).toContain("melta://design-constitution");
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
