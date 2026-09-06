/**
 * build-screen-skill.spec.ts — Workflow Skill `build-screen` が指す先の実在検査
 *
 * build-screen は「仕様を複製しない」設計の手順書で、実体は `AGENTS.md` の表 /
 * `design/contracts/` / MCP ツール / npm script の側にある。手順書が名指ししているだけなので、
 * 参照が生きていることは誰も検証していない。既存のゲート（design:check / drift / validate /
 * build）は Markdown 本文中の参照先を見ないため、次の 5 つが無言で成立してしまう。
 *
 *   1. 参照先のファイル・npm script・MCP ツール・ルール ID が消える / 改名される。SKILL.md は
 *      「これを読め」と言い続け、実行時に初めて空振りする（skill は静かに壊れる）
 *   2. 参照している `AGENTS.md` の見出しが変わる。Step 1 の入口（表の引き当て）が切れるが、
 *      AGENTS.md 側は見出しを変えただけなので、どのゲートも赤くならない
 *   3. frontmatter に Claude Code 拡張キー（context / agent / background / allowed-tools /
 *      arguments）が混ざる。Claude Code では動くが、symlink で配る Cursor / Codex 側には
 *      無い挙動なので配布先で意味が変わる。特に `context: fork` は生成物と検証結果を
 *      メインコンテキストに残さないので、Step 5 の転記が伝聞になる
 *   4. 「やらないこと」節が消える。守るべき境界（fork しない・実行時取得しない・
 *      passed を完成承認と言わない）が手順書から落ちても、手順自体は読めてしまう
 *   5. Step 2 の質問が増える。「往復を 1 回に潰す」という skill の存在理由だけが静かに失われる
 *
 * 参照の抽出は構造で絞る（バッククォート引用のうち、拡張子を持つ / スラッシュで終わる =
 * パス、`npm run X` = script、小文字スネークケース = MCP ツール）。文書全体の総当たりは
 * 過剰ブロックになり、逆に抽出 0 件でも緑になる逃げ道を作るので、各抽出に下限件数を課す。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";

const SKILL_PATH = "skills/build-screen/SKILL.md";
const AGENTS_PATH = "AGENTS.md";
const SERVER_PATH = "src/server.ts";

/** Claude Code 独自の frontmatter 拡張。Agent Skills 標準の name / description に絞る */
const CLAUDE_CODE_ONLY_KEYS = ["context", "agent", "background", "allowed-tools", "arguments"];

/** SKILL.md が Step 1 / Step 2 で名指ししている AGENTS.md の見出し（`## <見出し>`） */
const REFERENCED_AGENTS_HEADINGS = ["タスクベース読み込みガイド", "テーマ・ダークモード"];

/** SKILL.md が手順の中で必ず名指しする MCP ツール。片側だけ消えても落ちるよう両方向で見る */
const REQUIRED_MCP_TOOLS = ["get_component", "search", "check_html"];

/** 抽出の下限。表記を変えて抽出 0 件（= 何も検査しないまま緑）にする逃げ道を塞ぐ */
const MIN_PATH_REFS = 5;
const MIN_SCRIPT_REFS = 1;
const MIN_TOOL_REFS = 2;
const MIN_RULE_ID_REFS = 2;

function read(path: string): string {
  return readFileSync(resolve(path), "utf-8");
}

/** バッククォートの中身（改行を含まないもの）をすべて拾う */
function backticked(content: string): string[] {
  return [...content.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

/** リポ内パスとして扱う引用: 既知の拡張子で終わるか、スラッシュで終わるもの（空白を含まない） */
const FILE_EXT = /\.(md|json|ts|js|mjs|cjs|html|css|txt|ya?ml)$/;
function looksLikeRepoPath(token: string): boolean {
  if (/\s/.test(token)) return false;
  if (token.startsWith("http") || token.includes("://")) return false;
  return token.endsWith("/") || FILE_EXT.test(token);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** パスの実在。`*` を含む引用は「ディレクトリが在り、かつ 1 件以上一致する」で判定する */
function pathExists(token: string): boolean {
  const clean = token.endsWith("/") ? token.slice(0, -1) : token;
  if (!clean.includes("*")) return existsSync(resolve(clean));
  const dir = resolve(dirname(clean));
  if (!existsSync(dir)) return false;
  const rx = new RegExp(`^${basename(clean).split("*").map(escapeRegExp).join(".*")}$`);
  return readdirSync(dir).some((f) => rx.test(f));
}

/** frontmatter を「トップレベルのキー: 値」として読む（値は 1 行想定・既存 skill と同形式） */
function frontmatter(content: string): { keys: string[]; values: Record<string, string> } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match == null) return null;
  const keys: string[] = [];
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (kv == null) continue; // 継続行・空行
    keys.push(kv[1]);
    values[kv[1]] = kv[2].trim();
  }
  return { keys, values };
}

/** `## ` 見出しで始まる節の本文（次の `## ` の手前まで）。見出し行も含めて返す */
function section(content: string, headingPrefix: string): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const endRel = rest.findIndex((l) => l.startsWith("## "));
  return [lines[start], ...(endRel < 0 ? rest : rest.slice(0, endRel))].join("\n");
}

test.describe("build-screen skill の手順書", () => {
  test("frontmatter は name / description のみで、Claude Code 拡張キーを持たない", () => {
    const fm = frontmatter(read(SKILL_PATH));
    expect(fm, `${SKILL_PATH} に frontmatter が無い`).not.toBeNull();

    expect(fm!.values["name"], "frontmatter の name が build-screen でない").toBe("build-screen");

    const description = fm!.values["description"] ?? "";
    // 1536 は Agent Skills の description 上限。空も上限超過も配布先で読み飛ばされる
    expect(description.length, "description が空").toBeGreaterThan(0);
    expect(description.length, "description が 1536 文字を超えている").toBeLessThanOrEqual(1536);

    // Claude Code 拡張キーは symlink 配布先（Cursor / Codex）に存在しない。
    // 特に context: fork は生成物をメインコンテキストに残さないので、この skill では致命的
    const found = fm!.keys.filter((k) => CLAUDE_CODE_ONLY_KEYS.includes(k));
    expect(found, "frontmatter に Claude Code 拡張キーが混ざっている").toEqual([]);
  });

  test("SKILL.md が参照するパス / npm script / MCP ツール / ルール ID がすべて実在する", () => {
    const skill = read(SKILL_PATH);
    const quotes = backticked(skill);

    // 1. リポ内パス
    const paths = quotes.filter(looksLikeRepoPath);
    expect(paths.length, "パス引用の抽出が下限を割った（記法を変えて空振りさせていないか）").toBeGreaterThanOrEqual(
      MIN_PATH_REFS
    );
    const missingPaths = [...new Set(paths)].filter((p) => !pathExists(p));
    expect(missingPaths, "SKILL.md が実在しないパスを参照している").toEqual([]);

    // 2. npm script（`npm run X`）
    const scripts = [...skill.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
    expect(scripts.length, "npm script 参照の抽出が下限を割った").toBeGreaterThanOrEqual(
      MIN_SCRIPT_REFS
    );
    const declared = Object.keys(
      (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts
    );
    const missingScripts = [...new Set(scripts)].filter((s) => !declared.includes(s));
    expect(missingScripts, "SKILL.md が package.json に無い npm script を参照している").toEqual([]);
    // MCP が無い環境のフォールバック経路。ここが切れると Cursor / Codex で Step 4 が回らない
    expect(scripts, "MCP 無し環境のフォールバック（design:lint-generated）への参照が無い").toContain(
      "design:lint-generated"
    );

    // 3. MCP ツール名（小文字スネークケースの引用は MCP ツールの主張として扱う）
    const serverTools = [...read(SERVER_PATH).matchAll(/name: "([a-z][a-z0-9_]*)"/g)].map(
      (m) => m[1]
    );
    expect(serverTools.length, `${SERVER_PATH} から MCP ツール名を抽出できていない`).toBeGreaterThanOrEqual(
      REQUIRED_MCP_TOOLS.length
    );
    const toolLike = quotes.filter((q) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(q));
    expect(toolLike.length, "MCP ツール引用の抽出が下限を割った").toBeGreaterThanOrEqual(
      MIN_TOOL_REFS
    );
    const unknownTools = [...new Set(toolLike)].filter((t) => !serverTools.includes(t));
    expect(unknownTools, `SKILL.md が ${SERVER_PATH} に無い MCP ツールを参照している`).toEqual([]);
    // 両方向で見る。server.ts 側に在るだけでなく、SKILL.md が手順で名指ししていること
    for (const tool of REQUIRED_MCP_TOOLS) {
      expect(serverTools, `${tool} が ${SERVER_PATH} に無い`).toContain(tool);
      expect(quotes, `SKILL.md が ${tool} を名指ししていない`).toContain(tool);
    }

    // 4. ルール ID（`[ID]` 形式の引用）。design-review と同じく、手順書に嘘の ID を書けなくする。
    // 引用の構造（角括弧）で絞る — 説明文中の大文字語まで見ると過剰ブロックになる
    const ruleIds = new Set(
      (
        JSON.parse(read("design/contracts/rules.json")) as { rules: Array<{ id: string }> }
      ).rules.map((r) => r.id)
    );
    const cited = [...skill.matchAll(/\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/g)].map((m) => m[1]);
    expect(cited.length, "ルール ID 引用の抽出が下限を割った").toBeGreaterThanOrEqual(
      MIN_RULE_ID_REFS
    );
    const unknownRules = [...new Set(cited)].filter((id) => !ruleIds.has(id));
    expect(unknownRules, "SKILL.md が rules.json に無いルール ID を引用している").toEqual([]);
  });

  test("SKILL.md が名指しする AGENTS.md の見出しが実在する", () => {
    const skill = read(SKILL_PATH);
    const agentsLines = read(AGENTS_PATH).split("\n");

    for (const heading of REFERENCED_AGENTS_HEADINGS) {
      // 見出しを変えると skill の入口（Step 1 の表の引き当て）が無言で切れる
      const hits = agentsLines.filter((l) => l.trim() === `## ${heading}`);
      expect(hits.length, `${AGENTS_PATH} に「## ${heading}」が 1 つに定まらない`).toBe(1);
      expect(skill.includes(heading), `SKILL.md が「${heading}」を参照していない`).toBe(true);
    }
  });

  test("「やらないこと」節があり、context: fork を禁じている", () => {
    const body = section(read(SKILL_PATH), "## やらないこと");
    expect(body, "SKILL.md に「## やらないこと」節が無い").not.toBeNull();

    const forkLines = body!.split("\n").filter((l) => l.includes("context: fork"));
    expect(forkLines.length, "「やらないこと」節に context: fork の記述が無い").toBeGreaterThan(0);
    // 「fork にしない」であって「fork する」ではないことまで見る
    expect(
      forkLines.some((l) => l.includes("しない")),
      "context: fork の行が禁止として書かれていない"
    ).toBe(true);
  });

  test("Step 2 は質問数の上限 3 を宣言し、質問バンクが 3 問を超えない", () => {
    const body = section(read(SKILL_PATH), "## Step 2");
    expect(body, "SKILL.md に「## Step 2」節が無い").not.toBeNull();

    // 強調記号を外してから照合する（`**最大 3 問**` の書き分けで空振りさせない）
    expect(
      body!.replace(/\*/g, "").includes("最大 3 問"),
      "Step 2 に質問数の上限（最大 3 問）の宣言が無い"
    ).toBe(true);

    const numbers = [...body!.matchAll(/^- Q(\d+)[:：]/gm)].map((m) => Number(m[1]));
    expect(numbers.length, "Step 2 に質問バンク（`- Q1:` 形式）が無い").toBeGreaterThan(0);
    expect(numbers.length, "質問バンクが 3 問を超えている（往復 1 回の前提が崩れる）").toBeLessThanOrEqual(3);
    expect(Math.max(...numbers), "Q4 以降が定義されている").toBeLessThanOrEqual(3);
    expect(new Set(numbers).size, "質問番号が重複している").toBe(numbers.length);
  });
});
