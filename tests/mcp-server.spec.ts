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
import { buildMcpInstructions } from "../src/guidance.js";
import { createServer } from "../src/server.js";

function createMeltaRootFixture(designText?: string): string {
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
