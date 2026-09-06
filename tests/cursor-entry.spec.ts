/**
 * cursor-entry.spec.ts — `.cursor/` の入口が「値を持たないポインタ」であり続けることの検査
 *
 * Cursor は `.cursor/rules/*.mdc` を作業指示として、`.cursor/mcp.json` を MCP 設定として読む
 * （Claude Code の `.mcp.json` は読まない）。melta はここに仕様を書かず、`AGENTS.md` /
 * `DESIGN.md` / `design/contracts/` への所在ポインタと MCP 設定だけを置く方針にした。
 *
 * この方針は「書いてはいけないものを書かない」という運用ルールでしかないので、次の 5 つが
 * 無言で成立してしまう。どれも既存のゲート（design:check / drift / validate / build）は
 * `.cursor/` を見ていないため、ここで構造として押さえる。
 *
 *   1. mdc に色・class レシピ・寸法を書き足す。contracts と並ぶ第二の正典になり、drift 検査の
 *      外側で静かにズレる（2026-03〜07 の 3 本が実例。「セマンティックな背景クラスを使え」の
 *      原則と、それを破るレシピが半年並んでいた）
 *   2. mdc を 2 本目・3 本目と増やす。1 と同じ経路で正典が分裂する
 *   3. `alwaysApply: true` を落とす / Cursor が解釈しない frontmatter キーを足す。Cursor は
 *      黙って適用しなくなるだけで、ローカルでは何も落ちない
 *   4. ポインタの参照先（ファイル・MCP ツール名）をリネームする。リンク切れは静かに残る
 *   5. `.mcp.json` だけ直して `.cursor/mcp.json` を放置する。Claude Code では動くので、
 *      Cursor 側だけ古い起動コマンドのまま気づけない
 *
 * 値の混入検査（1）は**正規表現の手書き列挙を持たない**。禁止語彙は実行時に SSOT
 * （`design/contracts/tokens.json` と `design/contracts/components/*.contract.json`）から
 * 導出する。手書きの語彙表を置くと、それ自体が三つ目の正典になって同じ drift を起こすため。
 * SSOT に無い値（`16px` / `rgb(...)` / 未知のパレット）は汎用リテラルの側で止める。
 *
 * 「どの mdc を見るか」の判定は git の index を正とする（ワーキングコピーに置いたローカル
 * 専用の mdc を巻き込まないため）。中身は Cursor が実際に読む作業ツリー側を読む。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

// playwright は testDir の親（リポジトリ直下）を cwd にして走る。既存 spec と同じ流儀
const REPO_ROOT = resolve(".");
const RULES_DIR = ".cursor/rules";
const POINTER_MDC = `${RULES_DIR}/melta-ui.mdc`;
const CURSOR_MCP = ".cursor/mcp.json";
const CLAUDE_MCP = ".mcp.json";
const TOKENS_JSON = "design/contracts/tokens.json";
const CONTRACTS_DIR = "design/contracts/components";
/** MCP ツール列挙の位置を機械に教えるアンカー（README の `<!-- sec: -->` と同じ流儀） */
const TOOLS_MARKER = "<!-- mcp-tools -->";
/** Cursor が解釈する frontmatter キー（cursor.com/docs/context/rules）。他は黙って無視される */
const SUPPORTED_FRONTMATTER_KEYS = new Set(["description", "globs", "alwaysApply"]);
/**
 * パス検査の唯一の例外。`SKILL.md` は「場所」ではなく「各スキルが持つファイルの名前」を
 * 指すので、ルート相対では実在しない。これ以外の語はルート相対パスとして実在を要求する
 */
const BARE_NAME_EXCEPTION = new Set(["SKILL.md"]);

/** git の index に入っているパス一覧 */
function lsFiles(pathspec: string): string[] {
  const stdout = execFileSync("git", ["ls-files", "--", pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return stdout.split("\n").filter((line) => line.trim() !== "");
}

/**
 * 検査前のテキスト正規化。
 * NFKC で全角英数・互換文字を畳み、非 ASCII ハイフン（U+2010〜U+2015 / U+2212）を `-` に潰す。
 * `bg‑primary‑500`（非分割ハイフン）のような見た目だけ同じ文字列での回避を塞ぐ
 */
function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-");
}

interface FrontmatterLine {
  key: string;
  value: string;
}

/** frontmatter（先頭の `---` ブロック）と本文を分ける。frontmatter が無ければ null */
function splitFrontmatter(md: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (match == null) return null;
  return { frontmatter: match[1], body: md.slice(match[0].length) };
}

/**
 * frontmatter を行単位で読む（yaml 依存は足さない）。
 * 引用符つきのキー（`"unknown": true`）も拾う。値は素の文字列のまま返し、
 * `true` / `"true"` / `yes` の区別を呼び出し側に残す
 */
function parseFrontmatterLines(frontmatter: string): FrontmatterLine[] {
  const lines: FrontmatterLine[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const m = /^\s*("?)([A-Za-z_][\w-]*)\1\s*:\s*(.*)$/.exec(line);
    if (m == null) continue;
    lines.push({ key: m[2], value: m[3].trim() });
  }
  return lines;
}

/** バッククォートで囲まれた語をすべて取り出す（`` `AGENTS.md` `` → `AGENTS.md`） */
function backtickTokens(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

function readPointerMdc(): { frontmatter: string; body: string; raw: string } {
  const raw = readFileSync(resolve(REPO_ROOT, POINTER_MDC), "utf8");
  const parts = splitFrontmatter(raw);
  expect(parts, `${POINTER_MDC} に frontmatter（先頭の --- ブロック）が無い`).not.toBeNull();
  return { ...(parts as { frontmatter: string; body: string }), raw };
}

/** 色として書かれた値か（hex / 色関数） */
function isColorValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/.test(value.trim())
  );
}

/**
 * 禁止語彙を SSOT から導出する。返り値は 語 → 由来の経路。
 *
 * tokens.json: 全ノードを再帰走査して `tailwind` / `cssVar` / 色の `value` を拾い、
 *   色ノードのパスから `<スケール名>-<段>`（`primary-500` 等）も組み立てる。
 * contract: `htmlSample`（文字列 or variant ごとのオブジェクト）の `class="..."` を分解する。
 *
 * `-` か `#` を含む語だけを採用する。`body`（color.body の tailwind）のような普通の単語まで
 * 禁止すると日本語の散文が誤検知で落ちるため
 */
function deriveDenylist(): Map<string, string> {
  const denylist = new Map<string, string>();
  const add = (word: unknown, route: string) => {
    if (typeof word !== "string") return;
    const w = word.trim();
    if (w === "" || !(w.includes("-") || w.includes("#"))) return;
    if (!denylist.has(w)) denylist.set(w, route);
  };

  const tokens = JSON.parse(readFileSync(resolve(REPO_ROOT, TOKENS_JSON), "utf8"));
  const walk = (node: unknown, path: string[]): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, String(i)]));
      return;
    }
    const obj = node as Record<string, unknown>;
    add(obj.tailwind, "tokens.json（tailwind）");
    add(obj.cssVar, "tokens.json（cssVar）");
    if (isColorValue(obj.value)) {
      add(obj.value, "tokens.json（色の値）");
      // 色スケールの葉の名前。`color.primary.500` → `primary-500`
      if (path.length >= 2) {
        add(`${path[path.length - 2]}-${path[path.length - 1]}`, "tokens.json（色スケール名）");
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (child != null && typeof child === "object") walk(child, [...path, key]);
    }
  };
  walk(tokens, []);
  const fromTokens = denylist.size;

  for (const file of readdirSync(resolve(REPO_ROOT, CONTRACTS_DIR))) {
    if (!file.endsWith(".contract.json")) continue;
    const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, CONTRACTS_DIR, file), "utf8"));
    const sample = contract.htmlSample;
    const samples: string[] =
      typeof sample === "string"
        ? [sample]
        : sample != null && typeof sample === "object"
          ? Object.values(sample).filter((v): v is string => typeof v === "string")
          : [];
    for (const html of samples) {
      for (const m of html.matchAll(/class="([^"]*)"/g)) {
        for (const cls of m[1].split(/\s+/)) add(cls, "contract htmlSample（class）");
      }
    }
  }

  // SSOT の形が変わって何も導出できなかったのに「混入なし」と言わないための番人。
  // 片側だけ 0 でも検査が空振りするので、両方の由来に件数を要求する
  expect(fromTokens, `${TOKENS_JSON} から禁止語彙を導出できない（構造が変わった?）`).toBeGreaterThan(
    0
  );
  expect(
    denylist.size - fromTokens,
    `${CONTRACTS_DIR} の htmlSample から禁止語彙を導出できない（構造が変わった?）`
  ).toBeGreaterThan(0);

  return denylist;
}

/** 正規表現メタ文字のエスケープ（class 名は `[` `/` `.` `(` を含む） */
function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe(".cursor/ の入口が値を持たないポインタである", () => {
  test("追跡されている mdc は 1 本だけで、Cursor が解釈する frontmatter を持つ", () => {
    const mdcs = lsFiles(`${RULES_DIR}/*.mdc`);
    // 正典の分裂を止める。増やしたい衝動は AGENTS.md / contracts 側へ向ける
    expect(mdcs, `${RULES_DIR}/ に追跡された .mdc はポインタ 1 本だけのはず`).toEqual([
      POINTER_MDC,
    ]);

    const { frontmatter } = readPointerMdc();
    const lines = parseFrontmatterLines(frontmatter);

    // Cursor が解釈するキーは description / globs / alwaysApply の 3 つだけ。
    // それ以外は黙って無視されるので、効いているつもりの設定が生まれる
    const unsupported = lines.map((l) => l.key).filter((k) => !SUPPORTED_FRONTMATTER_KEYS.has(k));
    expect(
      unsupported,
      `${POINTER_MDC} の frontmatter に Cursor が解釈しないキーがある: ${unsupported.join(", ")}`
    ).toEqual([]);

    // 重複キーは後勝ち・前勝ちがパーサ依存になる。どちらが効いているか読めない状態を許さない
    const seen = new Map<string, number>();
    for (const l of lines) seen.set(l.key, (seen.get(l.key) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(
      duplicated,
      `${POINTER_MDC} の frontmatter にキーの重複がある（どちらが効くかパーサ依存）: ${duplicated.join(", ")}`
    ).toEqual([]);

    const description = lines.find((l) => l.key === "description");
    expect(description?.value, `${POINTER_MDC} の frontmatter に description が無い`).toBeTruthy();

    // alwaysApply は真偽値の true でなければならない。`"true"` / `yes` / `True` は
    // YAML では別物（文字列・別表記）で、常時適用になる保証がない
    const alwaysApply = lines.find((l) => l.key === "alwaysApply");
    expect(
      alwaysApply?.value,
      `${POINTER_MDC} の frontmatter が alwaysApply: true でない（常時適用されない）`
    ).toBe("true");
  });

  test("frontmatter と本文に値（SSOT の語彙 / 色 / 寸法）が 1 つも無い", () => {
    // description に値を書いても Cursor は読むので、frontmatter 込みの全文を対象にする
    const text = normalizeText(readPointerMdc().raw);
    const hits: string[] = [];

    // --- SSOT 由来の語彙 ---
    // 語境界は `[\w-]` で見る。`text-body` が `text-body-x` に、`primary-500` が
    // `primary-5000` に誤ヒットしないように、前後にハイフンが続く場合は別語として扱う
    for (const [word, route] of deriveDenylist()) {
      const re = new RegExp(`(?<![\\w-])${escapeRegExp(word)}(?![\\w-])`);
      if (re.test(text)) hits.push(`${word}（${route}）`);
    }

    // --- 汎用リテラル（SSOT に無い値も止める） ---
    const literals: { name: string; re: RegExp }[] = [
      { name: "汎用リテラル（hex カラー）", re: /#[0-9a-fA-F]{3,8}(?![\w])/g },
      {
        name: "汎用リテラル（色関数）",
        // 引数まで拾うのは失敗メッセージのため（`rgb(` だけだと何を書いたか読み取れない）
        re: /\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)\n]*\)?/g,
      },
      {
        name: "汎用リテラル（単位付き寸法）",
        re: /(?<![\w.])\d+(\.\d+)?(px|rem|em|vh|vw|%)(?![a-zA-Z])/g,
      },
      {
        name: "汎用リテラル（Tailwind ユーティリティ）",
        re: /\b(h|w|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rounded|text|leading|tracking|shadow|border)-(\d+(\.\d+)?|xs|sm|md|lg|xl|\dxl|full|none)\b/g,
      },
    ];
    for (const literal of literals) {
      for (const m of text.matchAll(literal.re)) hits.push(`${m[0]}（${literal.name}）`);
    }

    expect(
      hits,
      `${POINTER_MDC} に値が混入している（値の正本は design/contracts/。ここに書くと drift する）: ${hits.join(" / ")}`
    ).toEqual([]);
  });

  test("参照するリポ内パスがすべて実在する", () => {
    const { body } = readPointerMdc();

    // index を正とする（作業ツリーにしか無いファイルを指したポインタは配布先で切れる）
    const tracked = new Set(lsFiles("."));
    const trackedDirs = new Set<string>();
    for (const p of tracked) {
      const segments = p.split("/");
      for (let i = 1; i < segments.length; i++) trackedDirs.add(segments.slice(0, i).join("/"));
    }

    // バッククォート参照に加えて Markdown リンク `](path)` も対象にする
    const linkTargets = [...body.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => !/^(https?:|mailto:|#)/.test(t));
    const candidates = [...backtickTokens(body), ...linkTargets].filter(
      (t) => /^[A-Za-z0-9._/-]+$/.test(t) && (t.includes("/") || /\.[a-z]+$/.test(t))
    );
    expect(candidates.length, `${POINTER_MDC} がリポ内パスを 1 つも参照していない`).toBeGreaterThan(
      0
    );

    for (const raw of candidates) {
      if (BARE_NAME_EXCEPTION.has(raw)) continue;
      const path = raw.replace(/\/+$/, "");
      const exists = tracked.has(path) || trackedDirs.has(path);
      expect(
        exists,
        `${POINTER_MDC} が参照する \`${raw}\` が git 管理下に存在しない（ルート相対パスで書く。リネーム時の追随漏れ）`
      ).toBe(true);
    }
  });

  test("MCP ツールの列挙が src/server.ts と完全一致する", () => {
    const { body } = readPointerMdc();

    const markerIndex = body.indexOf(TOOLS_MARKER);
    expect(
      markerIndex,
      `${POINTER_MDC} に ${TOOLS_MARKER} アンカーが無い（ツール列挙の位置を機械に教える印）`
    ).toBeGreaterThanOrEqual(0);
    const listLine = body
      .slice(markerIndex + TOOLS_MARKER.length)
      .split(/\r?\n/)
      .find((line) => line.trim() !== "");
    // 列挙行だけを見る。散文中の `check_html` や無関係な `source_type` を巻き込まない
    const listed = new Set(backtickTokens(listLine ?? ""));
    expect(listed.size, `${TOOLS_MARKER} の直後にツールの列挙行が無い`).toBeGreaterThan(0);

    const serverSrc = readFileSync(resolve(REPO_ROOT, "src/server.ts"), "utf8");
    const toolNames = [...serverSrc.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((m) => m[1]);
    expect(
      toolNames.length,
      "src/server.ts から MCP ツール名を抽出できない（パターン変更?）"
    ).toBeGreaterThan(0);

    // 集合の完全一致。ツールの追加・改名・削除のどれもポインタ側の更新を強制する
    // （drift-check §6 が README / DESIGN.md / AGENTS.md / CLAUDE.md に課しているのと同じ規律）
    expect(
      [...listed].sort(),
      `${POINTER_MDC} のツール列挙が src/server.ts と食い違う`
    ).toEqual([...new Set(toolNames)].sort());
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
