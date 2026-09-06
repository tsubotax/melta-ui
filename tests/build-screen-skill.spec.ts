/**
 * build-screen-skill.spec.ts — Workflow Skill `build-screen` が指す先の実在検査
 *
 * build-screen は「仕様を複製しない」設計の手順書で、実体は `AGENTS.md` の表 /
 * `design/contracts/` / MCP ツール / npm script の側にある。手順書が名指ししているだけなので、
 * 参照が生きていることは誰も検証していない。既存のゲート（design:check / drift / validate /
 * build）は Markdown 本文中の参照先を見ないため、次の 5 つが無言で成立してしまう。
 *
 *   1. 参照先のファイル・npm script・MCP ツール・ルール ID が消える / 改名される。SKILL.md は
 *      「これを読め」と言い続け、実行時に初めて空振りする（skill は静かに壊れる）。
 *      ルール ID は実在するだけでは足りない。Step 3 は「Step 4 が拾う例」と「Step 4 では
 *      絶対に捕まらない例（detector manual）」を対にして挙げており、例が逆側のルールに
 *      差し替わると、手順書は読めるのに指示が嘘になる
 *   2. 参照している `AGENTS.md` の見出しが変わる、または見出しだけ残って表が消える。
 *      Step 1 の入口（表の引き当て）が切れるが、AGENTS.md 側はどのゲートも赤くならない
 *   3. frontmatter に Claude Code 拡張キー（context / agent / background / allowed-tools /
 *      arguments）が混ざる。Claude Code では動くが、symlink で配る Cursor / Codex 側には
 *      無い挙動なので配布先で意味が変わる。特に `context: fork` は生成物と検証結果を
 *      メインコンテキストに残さないので、Step 5 の転記が伝聞になる
 *   4. 「やらないこと」節の項目が 1 つ落ちる。節の見出しは残るので、存在検査だけでは通る
 *   5. Step 2 の質問が増える。「往復を 1 回に潰す」という skill の存在理由だけが静かに失われる
 *   6. Step 5 の分岐（coverage 未取得 / lint 未通過 / 検査未完了）や「ブランド未承認」が消え、
 *      報告から留保だけが落ちる。生成物は残るので、読み手には完成品として届く
 *
 * 参照の抽出は構造で絞る（バッククォート引用のうち、拡張子を持つ / スラッシュで終わる =
 * パス、`npm run X` = script、小文字スネークケース = MCP ツール、大文字スネーク = ルール ID）。
 * 文書全体の総当たりは過剰ブロックになり、逆に抽出 0 件でも緑になる逃げ道を作るので、
 * 各抽出に下限件数を課す。記法（角括弧 / バッククォート / 箇条書き記号）を変えるだけで
 * 抽出が空になる書き方も塞ぐ。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { isCheckedByGeneratedLint } from "../scripts/design/coverage-stats.js";
import { getAllRules } from "../src/utils/loader.js";
import type { RuleEntry } from "../src/utils/types.js";

const SKILL_PATH = "skills/build-screen/SKILL.md";
const AGENTS_PATH = "AGENTS.md";
const SERVER_PATH = "src/server.ts";
const RULES_PATH = "design/contracts/rules.json";

/** Claude Code 独自の frontmatter 拡張。Agent Skills 標準の name / description に絞る */
const CLAUDE_CODE_ONLY_KEYS = ["context", "agent", "background", "allowed-tools", "arguments"];

/** SKILL.md が Step 1 / Step 2 で名指ししている AGENTS.md の見出し（`## <見出し>`） */
const REFERENCED_AGENTS_HEADINGS = ["タスクベース読み込みガイド", "テーマ・ダークモード"];
/** Step 1 が引き当てに使う表。見出しだけ残して表が消えると入口が切れる */
const TASK_GUIDE_HEADING = "タスクベース読み込みガイド";
const TASK_GUIDE_HEADER_CELL = "| タスク |";

/** SKILL.md が手順の中で必ず名指しする MCP ツール。片側だけ消えても落ちるよう両方向で見る */
const REQUIRED_MCP_TOOLS = ["get_component", "search", "check_html"];

/**
 * Step 3 の 2 つの例の意味を縛る。手順書は「Step 4 が拾う / 拾わない」を対で主張しており、
 * 例が逆側に差し替わると指示そのものが嘘になる（初版は auto の例に impossible-static の
 * ルールを挙げていた）。行の識別は本文の言い回しをアンカーにする
 */
const STEP3_AUTO_ANCHOR = "Step 4 が拾える";
const STEP3_MANUAL_ANCHOR = "Step 4 で絶対に捕まらない";

/** 「やらないこと」節の 5 項目。1 つ消えても落ちるよう個別に見る */
const FORBIDDEN_ITEMS: Array<[string, RegExp]> = [
  ["context: fork を禁じる", /context: fork/],
  ["実行時のリモート取得を禁じる", /実行時に原文を取りに行かない/],
  ["passed を完成承認と言わない", /完成承認と言わない/],
  ["コンポーネント単体に使わない", /コンポーネント単体の生成に使わない/],
  ["既存 HTML のレビューに使わない", /既存 HTML のレビューに使わない/],
];

/**
 * Step 5 が読み手に約束している文言。skill の価値は「何を検査していないか」を毎回書くことなので、
 * ここが落ちると生成物だけが残って留保が消える（= lint 結果が完成承認に見える）
 */
const REPORT_CONTRACT: Array<[string, string]> = [
  ["CLI 経路の coverage を未取得と書く", "未取得"],
  ["error 残りは lint 未通過と書く", "lint 未通過"],
  ["検査が実行できなかったときは検査未完了と書く", "検査未完了"],
  ["error 0 は lint-clean draft と書く", "lint-clean draft"],
  ["どの分岐でもブランド未承認と書く", "ブランド未承認"],
];

/** coverage を捏造する言い回し。実際には検査していない範囲を「済み」と言わせない */
const FABRICATED_COVERAGE = ["全件自動検査済み", "全ルール検査済み", "全ルールを自動検査", "完全準拠"];

/** 抽出の下限。表記を変えて抽出 0 件（= 何も検査しないまま緑）にする逃げ道を塞ぐ */
const MIN_PATH_REFS = 5;
const MIN_SCRIPT_REFS = 1;
const MIN_TOOL_REFS = 2;
const MIN_RULE_ID_REFS = 2;

interface Rule {
  id: string;
  detector: string;
  severity: string;
  automationStatus?: string;
}

function read(path: string): string {
  return readFileSync(resolve(path), "utf-8");
}

function readRules(): Map<string, Rule> {
  const json = JSON.parse(read(RULES_PATH)) as { rules: Rule[] };
  return new Map(json.rules.map((r) => [r.id, r]));
}

/** loader 経由の RuleEntry。検出可否の述語は typed なフィールドを見るのでこちらを使う */
function loadedRules(): Map<string, RuleEntry> {
  return new Map(getAllRules().map((r) => [r.id, r]));
}

/** バッククォートの中身（改行を含まないもの）をすべて拾う */
function backticked(content: string): string[] {
  return [...content.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

/** 大文字スネークのルール ID。角括弧引用とバッククォート引用の両方を拾う */
const RULE_ID_BODY = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";
function citedRuleIds(content: string): string[] {
  return [...content.matchAll(new RegExp(`\\[(${RULE_ID_BODY})\\]|\`(${RULE_ID_BODY})\``, "g"))].map(
    (m) => m[1] ?? m[2]
  );
}

/** リポ内パスとして扱う引用: 既知の拡張子で終わるか、スラッシュで終わるもの（空白を含まない） */
const FILE_EXT = /\.(md|json|ts|js|mjs|cjs|html|css|txt|ya?ml)$/;
function looksLikeRepoPath(token: string): boolean {
  if (/\s/.test(token)) return false;
  if (token.startsWith("http") || token.includes("://")) return false;
  // 拡張子そのものの引用（Step 2 の `.html` / `.tsx` 等）はパスではない。
  // これを弾かないと「拡張子を揃えろ」と書くだけで存在検査が落ちる
  if (/^\.[A-Za-z0-9]+$/.test(token)) return false;
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

/**
 * frontmatter を「トップレベルのキー: 値」として読む。
 * キーは引用符を剥がして小文字化する（`'context': fork` や `Context: fork` で
 * 拡張キーの検査をすり抜けられないようにする）。値は 1 行分のみ返し、
 * ブロックスカラー（`|` / `>`）は「単一行の値ではない」ものとして印を付ける。
 * このブランチには YAML パーサ依存が無いので、行単位で必要十分な範囲だけ見る
 */
interface Frontmatter {
  keys: string[];
  values: Record<string, string>;
  blockScalarKeys: string[];
}
function frontmatter(content: string): Frontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match == null) return null;
  const keys: string[] = [];
  const values: Record<string, string> = {};
  const blockScalarKeys: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    // 引用符つきキー（'context' / "context"）も同じキーとして正規化する
    const kv = /^(["']?)([A-Za-z][A-Za-z0-9_-]*)\1\s*:\s?(.*)$/.exec(line);
    if (kv == null) continue; // 継続行・空行・インデントされた入れ子
    const key = kv[2].toLowerCase();
    const value = kv[3].trim();
    keys.push(key);
    values[key] = value;
    // `description: |` / `>` は次行以降に本体が続く。1 行目の長さを測っても意味がない
    if (/^[|>][-+]?\d*\s*$/.test(value)) blockScalarKeys.push(key);
  }
  return { keys, values, blockScalarKeys };
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

    // description はブロックスカラーにしない。1 行の値でないと長さ上限を機械で保証できない
    expect(
      fm!.blockScalarKeys,
      "frontmatter にブロックスカラー（`|` / `>`）の値がある（1 行で書く）"
    ).toEqual([]);
    const description = fm!.values["description"] ?? "";
    // 1536 は Agent Skills の description 上限。空も上限超過も配布先で読み飛ばされる
    expect(description.length, "description が空").toBeGreaterThan(0);
    expect(description.length, "description が 1536 文字を超えている").toBeLessThanOrEqual(1536);

    // Claude Code 拡張キーは symlink 配布先（Cursor / Codex）に存在しない。
    // 特に context: fork は生成物をメインコンテキストに残さないので、この skill では致命的。
    // キーは正規化済みなので `'context'` も `Context` も同じものとして拒否される
    const found = fm!.keys.filter((k) => CLAUDE_CODE_ONLY_KEYS.includes(k));
    expect(found, "frontmatter に Claude Code 拡張キーが混ざっている").toEqual([]);
  });

  test("SKILL.md が参照するパス / npm script / MCP ツール / ルール ID がすべて実在する", () => {
    const skill = read(SKILL_PATH);
    const quotes = backticked(skill);

    // 1. リポ内パス
    const paths = quotes.filter(looksLikeRepoPath);
    expect(
      paths.length,
      "パス引用の抽出が下限を割った（記法を変えて空振りさせていないか）"
    ).toBeGreaterThanOrEqual(MIN_PATH_REFS);
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
    expect(
      scripts,
      "MCP 無し環境のフォールバック（design:lint-generated）への参照が無い"
    ).toContain("design:lint-generated");

    // 3. MCP ツール名（小文字スネークケースの引用は MCP ツールの主張として扱う）
    const serverTools = [...read(SERVER_PATH).matchAll(/name: "([a-z][a-z0-9_]*)"/g)].map(
      (m) => m[1]
    );
    expect(
      serverTools.length,
      `${SERVER_PATH} から MCP ツール名を抽出できていない`
    ).toBeGreaterThanOrEqual(REQUIRED_MCP_TOOLS.length);
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

    // 4. ルール ID。design-review と同じく、手順書に嘘の ID を書けなくする。
    // 角括弧引用とバッククォート引用の両方を対象にする（記法を変えて逃げられないように）
    const rules = readRules();
    const cited = citedRuleIds(skill);
    expect(cited.length, "ルール ID 引用の抽出が下限を割った").toBeGreaterThanOrEqual(
      MIN_RULE_ID_REFS
    );
    const unknownRules = [...new Set(cited)].filter((id) => !rules.has(id));
    expect(unknownRules, "SKILL.md が rules.json に無いルール ID を引用している").toEqual([]);
  });

  test("Step 3 の「自動検出される例 / されない例」が rules.json の実態と一致する", () => {
    const step3 = section(read(SKILL_PATH), "## Step 3");
    expect(step3, "SKILL.md に「## Step 3」節が無い").not.toBeNull();
    const rules = readRules();

    const lineFor = (anchor: string): string => {
      const hits = step3!.split("\n").filter((l) => l.includes(anchor));
      expect(hits.length, `Step 3 に「${anchor}」の行が 1 つに定まらない`).toBe(1);
      return hits[0];
    };

    // 「Step 4 が拾える」側: 判定は生成物 lint の実際の条件（isCheckedByGeneratedLint）で行う。
    // detector != manual では足りない — requiresContext のルール（SPACE_NO_P0_CARDS 等）は
    // 検出機構を持つのに context-free な生成物 lint からは除外される（src/utils/lint-core.ts）
    const loaded = loadedRules();
    const autoIds = citedRuleIds(lineFor(STEP3_AUTO_ANCHOR));
    expect(autoIds.length, "自動検出の例にルール ID が無い").toBeGreaterThan(0);
    const notActuallyAuto = autoIds.filter((id) => {
      const rule = loaded.get(id);
      return rule == null || !isCheckedByGeneratedLint(rule);
    });
    expect(
      notActuallyAuto,
      "「Step 4 が拾える」例に、生成物 lint が実際には検査しないルールが挙がっている"
    ).toEqual([]);

    // 「Step 4 で絶対に捕まらない」側: detector manual かつ severity error であることが主張の中身
    const manualIds = citedRuleIds(lineFor(STEP3_MANUAL_ANCHOR));
    expect(manualIds.length, "manual の例にルール ID が無い").toBeGreaterThan(0);
    const notManualError = manualIds.filter((id) => {
      const rule = rules.get(id);
      const loadedRule = loaded.get(id);
      return (
        rule == null ||
        loadedRule == null ||
        rule.detector !== "manual" ||
        rule.severity !== "error" ||
        // 「捕まらない」の実体も述語で確かめる（detector 名だけの主張にしない）
        isCheckedByGeneratedLint(loadedRule)
      );
    });
    expect(
      notManualError,
      "「error なのに Step 4 で捕まらない」例が、manual かつ error かつ生成物 lint 対象外になっていない"
    ).toEqual([]);
  });

  test("SKILL.md が名指しする AGENTS.md の見出しと、引き当て表が実在する", () => {
    const skill = read(SKILL_PATH);
    const agents = read(AGENTS_PATH);
    const agentsLines = agents.split("\n");

    for (const heading of REFERENCED_AGENTS_HEADINGS) {
      // 見出しを変えると skill の入口（Step 1 の表の引き当て）が無言で切れる
      const hits = agentsLines.filter((l) => l.trim() === `## ${heading}`);
      expect(hits.length, `${AGENTS_PATH} に「## ${heading}」が 1 つに定まらない`).toBe(1);
      expect(skill.includes(heading), `SKILL.md が「${heading}」を参照していない`).toBe(true);
    }

    // 見出しだけ残して中身の表が消えても Step 1 は回らない。表の実体まで見る
    const guide = section(agents, `## ${TASK_GUIDE_HEADING}`);
    expect(guide, `${AGENTS_PATH} に「## ${TASK_GUIDE_HEADING}」節が無い`).not.toBeNull();
    const guideLines = guide!.split("\n");
    const headerAt = guideLines.findIndex((l) => l.includes(TASK_GUIDE_HEADER_CELL));
    expect(
      headerAt,
      `「${TASK_GUIDE_HEADING}」節に \`${TASK_GUIDE_HEADER_CELL}\` を含む表ヘッダーが無い`
    ).toBeGreaterThanOrEqual(0);
    const dataRows = guideLines
      .slice(headerAt + 1)
      .filter((l) => l.startsWith("|") && !/^\|[\s:-]+\|/.test(l));
    expect(
      dataRows.length,
      `「${TASK_GUIDE_HEADING}」の表にデータ行が 1 行も無い`
    ).toBeGreaterThan(0);
  });

  test("「やらないこと」節に 5 項目がすべて残っている", () => {
    const body = section(read(SKILL_PATH), "## やらないこと");
    expect(body, "SKILL.md に「## やらないこと」節が無い").not.toBeNull();
    const lines = body!.split("\n");

    const missing = FORBIDDEN_ITEMS.filter(([, pattern]) => !lines.some((l) => pattern.test(l))).map(
      ([label]) => label
    );
    expect(missing, "「やらないこと」節から落ちている項目").toEqual([]);

    // 「fork にしない」であって「fork する」ではないことまで見る
    const forkLines = lines.filter((l) => l.includes("context: fork"));
    expect(
      forkLines.some((l) => l.includes("しない")),
      "context: fork の行が禁止として書かれていない"
    ).toBe(true);
  });

  test("Step 5 が報告の 3 分岐と coverage の留保を約束している", () => {
    const body = section(read(SKILL_PATH), "## Step 5");
    expect(body, "SKILL.md に「## Step 5」節が無い").not.toBeNull();

    // 約束している文言が 1 つでも落ちると、報告から留保が消えて lint 結果が完成承認に見える
    const missing = REPORT_CONTRACT.filter(([, phrase]) => !body!.includes(phrase)).map(
      ([label]) => label
    );
    expect(missing, "Step 5 の報告契約から落ちている文言").toEqual([]);

    // 反対側: 検査していない範囲を「済み」と言わせない（coverage の捏造を手順書側で塞ぐ）
    const fabricated = FABRICATED_COVERAGE.filter((phrase) => body!.includes(phrase));
    expect(fabricated, "Step 5 に coverage を捏造する文言がある").toEqual([]);
  });

  test("Step 2 は質問数の上限 3 を宣言し、質問バンクがちょうど Q1〜Q3 である", () => {
    const body = section(read(SKILL_PATH), "## Step 2");
    expect(body, "SKILL.md に「## Step 2」節が無い").not.toBeNull();

    // 強調記号を外してから照合する（`**最大 3 問**` の書き分けで空振りさせない）
    expect(
      body!.replace(/\*/g, "").includes("最大 3 問"),
      "Step 2 に質問数の上限（最大 3 問）の宣言が無い"
    ).toBe(true);

    // 記法に依らず拾う。`- ` 限定にすると `* Q4:` を足すだけで検査を空振りさせられる
    const numbers = [...body!.matchAll(/^\s*(?:[-*+]|\d+[.)])\s*\**Q(\d+)\**\s*[:：]/gm)].map((m) =>
      Number(m[1])
    );
    expect(numbers.length, "Step 2 に質問バンク（`- Q1:` 形式）が無い").toBeGreaterThan(0);
    expect(new Set(numbers).size, "質問番号が重複している").toBe(numbers.length);
    // 集合で縛る。件数だけだと Q1/Q2/Q4 のような抜けを見逃す
    expect(
      [...numbers].sort((a, b) => a - b),
      "質問バンクが Q1〜Q3 ちょうどでない（往復 1 回の前提が崩れる）"
    ).toEqual([1, 2, 3]);
  });
});
