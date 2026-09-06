/**
 * cursor-entry.spec.ts — `.cursor/` の入口が「値を持たないポインタ」であり続けることの検査
 *
 * Cursor は `.cursor/rules/*.mdc` を作業指示として、`.cursor/mcp.json` を MCP 設定として読む
 * （Claude Code の `.mcp.json` は読まない）。melta はここに仕様を書かず、`AGENTS.md` /
 * `DESIGN.md` / `design/contracts/` への所在ポインタと MCP 登録だけを置く方針にした。
 *
 * この方針は「書いてはいけないものを書かない」という運用ルールでしかないので、次の 5 つが
 * 無言で成立してしまう。どれも既存のゲート（design:check / drift / validate / build）は
 * `.cursor/` を見ていないため、ここで構造として押さえる。
 *
 *   1. mdc に色コード・Tailwind class レシピ・サイズを書き足す。contracts と並ぶ第二の正典に
 *      なり、drift 検査の外側で静かにズレる（2026-03〜07 の 3 本が実例。「セマンティック
 *      クラスを使え」の原則と、それを破るレシピが半年並んでいた）
 *   2. mdc を 2 本目・3 本目と増やす。1 と同じ経路で正典が分裂する
 *   3. `alwaysApply: true` を落とす / Cursor が解釈しない frontmatter キーを足す。Cursor は
 *      黙って適用しなくなるだけで、ローカルでは何も落ちない
 *   4. ポインタの参照先（ファイル・MCP ツール名）をリネームする。リンク切れは静かに残る
 *   5. `.mcp.json` だけ直して `.cursor/mcp.json` を放置する。Claude Code では動くので、
 *      Cursor 側だけ古い起動コマンドのまま気づけない
 *
 * 「どの mdc を見るか」の判定は git の index を正とする（ワーキングコピーに置いたローカル
 * 専用の mdc を巻き込まないため）。中身は Cursor が実際に読む作業ツリー側を読む。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { test, expect } from "@playwright/test";

// playwright は testDir の親（リポジトリ直下）を cwd にして走る。既存 spec と同じ流儀
const REPO_ROOT = resolve(".");
const RULES_DIR = ".cursor/rules";
const POINTER_MDC = `${RULES_DIR}/melta-ui.mdc`;
const CURSOR_MCP = ".cursor/mcp.json";
const CLAUDE_MCP = ".mcp.json";

/** git の index に入っているパス一覧 */
function lsFiles(pathspec: string): string[] {
  const stdout = execFileSync("git", ["ls-files", "--", pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return stdout.split("\n").filter((line) => line.trim() !== "");
}

/** frontmatter（先頭の `---` ブロック）と本文を分ける。frontmatter が無ければ null */
function splitFrontmatter(md: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (match == null) return null;
  return { frontmatter: match[1], body: md.slice(match[0].length) };
}

/** frontmatter のトップレベルキー（`key: value` 行の key） */
function frontmatterKeys(frontmatter: string): string[] {
  return frontmatter
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => m[1]);
}

/** frontmatter の値。`alwaysApply: true` の true / false を素の文字列で返す */
function frontmatterValue(frontmatter: string, key: string): string | null {
  const line = frontmatter.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  if (line == null) return null;
  return line.slice(key.length + 1).trim();
}

/** バッククォートで囲まれた語をすべて取り出す（`` `AGENTS.md` `` → `AGENTS.md`） */
function backtickTokens(body: string): string[] {
  return [...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

function readPointerMdc(): { frontmatter: string; body: string } {
  const raw = readFileSync(resolve(REPO_ROOT, POINTER_MDC), "utf8");
  const parts = splitFrontmatter(raw);
  expect(parts, `${POINTER_MDC} に frontmatter（先頭の --- ブロック）が無い`).not.toBeNull();
  return parts as { frontmatter: string; body: string };
}

test.describe(".cursor/ の入口が値を持たないポインタである", () => {
  test("追跡されている mdc は melta-ui.mdc の 1 本だけで、Cursor が解釈する frontmatter を持つ", () => {
    const mdcs = lsFiles(`${RULES_DIR}/*.mdc`);
    // 正典の分裂を止める。増やしたい衝動は AGENTS.md / contracts 側へ向ける
    expect(mdcs, `${RULES_DIR}/ に追跡された .mdc はポインタ 1 本だけのはず`).toEqual([
      POINTER_MDC,
    ]);

    const { frontmatter } = readPointerMdc();

    // alwaysApply: true でないと「description に合致したときだけ」の適用になり、
    // 入口として機能しているかどうかが Cursor の判断次第になる
    expect(
      frontmatterValue(frontmatter, "alwaysApply"),
      `${POINTER_MDC} の frontmatter に alwaysApply: true が無い（常時適用されない）`
    ).toBe("true");
    expect(
      frontmatterValue(frontmatter, "description"),
      `${POINTER_MDC} の frontmatter に description が無い`
    ).toBeTruthy();

    // Cursor が解釈するキーは description / globs / alwaysApply の 3 つだけ。
    // それ以外は黙って無視されるので、効いているつもりの設定が生まれる
    const supported = new Set(["description", "globs", "alwaysApply"]);
    const unsupported = frontmatterKeys(frontmatter).filter((k) => !supported.has(k));
    expect(
      unsupported,
      `${POINTER_MDC} の frontmatter に Cursor が解釈しないキーがある: ${unsupported.join(", ")}`
    ).toEqual([]);
  });

  test("本文に値（色コード / Tailwind class レシピ / サイズ）が 1 つも無い", () => {
    const { body } = readPointerMdc();

    const leaks: { name: string; re: RegExp }[] = [
      // 色コードの直書き。tokens.json の値を複製した瞬間に第二の正典になる
      { name: "hex カラー", re: /#[0-9a-fA-F]{3,8}\b/g },
      // Tailwind の色クラス。パレット名 + 階調は contracts と recipes が持つ値
      {
        name: "Tailwind 色クラス",
        re: /\b(bg|text|border|ring|from|to)-(primary|slate|gray|emerald|amber|red|blue|indigo|green|yellow|rose|purple|violet)-\d{2,3}\b/g,
      },
      // 寸法レシピ（h-10 / px-4 / gap-6 / rounded-xl 等）。component contract の tailwind が正
      { name: "サイズレシピ", re: /\b(h|w|p|px|py|gap|rounded)-\d/g },
    ];

    for (const leak of leaks) {
      const hits = [...body.matchAll(leak.re)].map((m) => m[0]);
      expect(
        hits,
        `${POINTER_MDC} の本文に ${leak.name} が混入している（値は design/contracts/ が正本。ここに書くと drift する）: ${hits.join(", ")}`
      ).toEqual([]);
    }
  });

  test("本文が参照するリポ内パスと MCP ツール名がすべて実在する", () => {
    const { body } = readPointerMdc();
    const tokens = backtickTokens(body);

    // --- リポ内パス ---
    // index を正とする（作業ツリーにしか無いファイルを指したポインタは配布先で切れる）
    const tracked = new Set(lsFiles("."));
    const trackedDirs = new Set<string>();
    for (const p of tracked) {
      const segments = p.split("/");
      for (let i = 1; i < segments.length; i++) trackedDirs.add(segments.slice(0, i).join("/"));
    }
    const trackedBasenames = new Set([...tracked].map((p) => basename(p)));

    // パスらしい語だけを対象にする: 使える文字だけで構成され、`/` を含むか拡張子を持つもの
    const pathLike = tokens.filter(
      (t) => /^[A-Za-z0-9._/-]+$/.test(t) && (t.includes("/") || /\.[a-z]+$/.test(t))
    );
    expect(pathLike.length, `${POINTER_MDC} がリポ内パスを 1 つも参照していない`).toBeGreaterThan(0);

    for (const raw of pathLike) {
      const path = raw.replace(/\/+$/, "");
      const isFile = tracked.has(path);
      const isDir = trackedDirs.has(path);
      // `/` を含まない語（`SKILL.md` 等）は「場所」ではなく「ファイルの種類」を指すので、
      // 同名の追跡ファイルがどこかにあれば足りるとする。綴り間違いはこれでも落ちる
      const isKnownName = !raw.includes("/") && trackedBasenames.has(path);
      expect(
        isFile || isDir || isKnownName,
        `${POINTER_MDC} が参照する \`${raw}\` が git 管理下に存在しない（リネーム時の追随漏れ）`
      ).toBe(true);
    }

    // --- MCP ツール名 ---
    const serverSrc = readFileSync(resolve(REPO_ROOT, "src/server.ts"), "utf8");
    const toolNames = [...serverSrc.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((m) => m[1]);
    expect(toolNames.length, "src/server.ts から MCP ツール名を抽出できない（パターン変更?）").toBeGreaterThan(0);

    // ツール名の綴り間違い・廃止されたツールの残留を止める。
    // 対象はスネークケースの語（`passed` のような普通の英単語を巻き込まないため）
    const mentioned = tokens.filter((t) => /^[a-z]+(_[a-z]+)+$/.test(t));
    for (const name of mentioned) {
      expect(
        toolNames,
        `${POINTER_MDC} が参照する MCP ツール \`${name}\` が src/server.ts に無い`
      ).toContain(name);
    }
    // ツールを増やしたのにポインタが古いまま、を止める（drift-check §6 の .cursor 版）
    const missing = toolNames.filter((t) => !body.includes(t));
    expect(
      missing,
      `${POINTER_MDC} に MCP ツール ${missing.join(", ")} の記載が無い（src/server.ts が先行）`
    ).toEqual([]);
  });

  test(".cursor/mcp.json の mcpServers が .mcp.json と一致する", () => {
    for (const path of [CURSOR_MCP, CLAUDE_MCP]) {
      expect(existsSync(resolve(REPO_ROOT, path)), `${path} が存在しない`).toBe(true);
      expect(lsFiles(path), `${path} が git 管理下に無い（clone した先に届かない）`).toEqual([path]);
    }

    const cursor = JSON.parse(readFileSync(resolve(REPO_ROOT, CURSOR_MCP), "utf8"));
    const claude = JSON.parse(readFileSync(resolve(REPO_ROOT, CLAUDE_MCP), "utf8"));

    expect(cursor.mcpServers, `${CURSOR_MCP} に mcpServers が無い（Cursor の形式）`).toBeTruthy();
    // 片方だけ起動コマンドを直すと、Cursor だけ古い entry を叩き続ける
    expect(
      cursor.mcpServers,
      `${CURSOR_MCP} と ${CLAUDE_MCP} の mcpServers が食い違う（起動コマンドは 1 つに揃える）`
    ).toEqual(claude.mcpServers);
  });
});
