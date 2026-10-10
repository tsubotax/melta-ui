/**
 * Claude Code plugin（plugin/ と .claude-plugin/marketplace.json）の構造検査。
 *
 * plugin は install 時に丸ごとコピーされ、build は走らない。ここで見るのは
 *   - 4 つの JSON が読めて、必須キーがある
 *   - plugin が参照する実行ファイルのパスが、npm tarball（= このリポジトリの dist/）に実在する形か
 *   - plugin 名が marketplace の entry 名と一致する（違うと install できない）
 *   - 版が root の package.json と一致する（lock の解決版は design:drift が見る。CI では
 *     npm publish 前の PR で lock が無いことがあるので、ここでは pin と plugin.json だけ）
 * 実際の install / MCP 接続 / hook 発火は Claude Code の外から再現できないので、公開後に手で確認する。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

const root = resolve(".");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf-8"));

const rootPkg = read("package.json") as { version: string };
const manifest = read("plugin/.claude-plugin/plugin.json") as { name: string; version: string };
const pluginPkg = read("plugin/package.json") as { private?: boolean; dependencies?: Record<string, string> };
const mcp = read("plugin/.mcp.json") as { mcpServers: Record<string, { command: string; args: string[] }> };
const hooks = read("plugin/hooks/hooks.json") as {
  hooks: { PostToolUse?: Array<{ matcher: string; hooks: Array<{ type: string; command: string; args?: string[] }> }> };
};
const marketplace = read(".claude-plugin/marketplace.json") as {
  name: string;
  owner: { name: string };
  plugins: Array<{ name: string; source: string }>;
};

/** `${CLAUDE_PLUGIN_ROOT}/node_modules/melta-ds-mcp/<rel>` の <rel> を取り出す */
function pathInPackage(arg: string): string {
  const prefix = "${CLAUDE_PLUGIN_ROOT}/node_modules/melta-ds-mcp/";
  expect(arg.startsWith(prefix), `${arg} は plugin root 配下の melta-ds-mcp を指す`).toBe(true);
  return arg.slice(prefix.length);
}

test.describe("Claude Code plugin のマニフェスト", () => {
  test("plugin.json: name は kebab-case、version は root の package.json と一致", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.version).toBe(rootPkg.version);
  });

  test("plugin/package.json: private で、melta-ds-mcp を root と同じ版に exact pin", () => {
    expect(pluginPkg.private).toBe(true);
    expect(pluginPkg.dependencies?.["melta-ds-mcp"]).toBe(rootPkg.version);
    // ^ や ~ が付くと install ごとに違う版を引きうる
    expect(pluginPkg.dependencies?.["melta-ds-mcp"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test(".mcp.json: node で npm 同梱の dist/index.js を叩く", () => {
    const server = mcp.mcpServers["melta-ui"];
    expect(server.command).toBe("node");
    expect(server.args).toHaveLength(1);
    const rel = pathInPackage(server.args[0]);
    expect(rel).toBe("dist/index.js");
    // このリポジトリの build 生成物と同じパス（tarball の files に dist が含まれる）
    expect(existsSync(resolve(root, rel)) || !existsSync(resolve(root, "dist")), `${rel} が dist に出る`).toBe(true);
  });

  test("hooks.json: PostToolUse Write|Edit で npm 同梱の lint CLI を --hook（stdin）で叩く", () => {
    const entries = hooks.hooks.PostToolUse ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe("Write|Edit");
    const hook = entries[0].hooks[0];
    expect(hook.type).toBe("command");
    expect(hook.command).toBe("node");
    expect(hook.args).toHaveLength(2);
    expect(pathInPackage(hook.args![0])).toBe("dist/cli/lint-generated.js");
    // 引数なしの --hook = stdin の PostToolUse JSON を読む（bash の wrapper を介さない）
    expect(hook.args![1]).toBe("--hook");
  });

  test("marketplace.json: entry 名が plugin.json の name と一致し、source が plugin/ を指す", () => {
    expect(marketplace.owner.name).toBeTruthy();
    const entry = marketplace.plugins.find((p) => p.name === manifest.name);
    expect(entry, `plugin "${manifest.name}" の entry`).toBeDefined();
    expect(resolve(root, entry!.source)).toBe(resolve(root, "plugin"));
    expect(existsSync(resolve(root, entry!.source, ".claude-plugin/plugin.json"))).toBe(true);
  });

  test("plugin は skills を持たない（利用者のプロジェクトで成立しない手順を配らない）", () => {
    expect(existsSync(resolve(root, "plugin/skills"))).toBe(false);
  });
});
