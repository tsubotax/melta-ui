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
import { parse as parseYaml } from "yaml";
import { test, expect } from "@playwright/test";

// playwright は testDir の親（リポジトリ直下）を cwd にして走る。既存 spec と同じ流儀
const REPO_ROOT = resolve(".");
const RULES_DIR = ".cursor/rules";
const POINTER_MDC = `${RULES_DIR}/melta-ui.mdc`;
const CURSOR_MCP = ".cursor/mcp.json";
const CLAUDE_MCP = ".mcp.json";
const TOKENS_JSON = "design/contracts/tokens.json";
const RULES_JSON = "design/contracts/rules.json";
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
/**
 * 色を取りうる Tailwind ユーティリティの接頭辞。色スケール名（`primary-950`）に前置して
 * `bg-primary-950` 等を denylist へ明示展開するために使う
 */
const UTILITY_PREFIXES = [
  "bg-",
  "text-",
  "border-",
  "ring-",
  "fill-",
  "stroke-",
  "divide-",
  "outline-",
  "placeholder-",
  "decoration-",
  "accent-",
  "caret-",
  "from-",
  "to-",
  "via-",
  "shadow-",
];

/** 禁止語 1 語の由来と照合の仕方（prefix = 前方一致、exact = 語として完全一致） */
interface DenyEntry {
  route: string;
  kind: "exact" | "prefix";
}

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

/** frontmatter（先頭の `---` ブロック）と本文を分ける。frontmatter が無ければ null */
function splitFrontmatter(md: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (match == null) return null;
  return { frontmatter: match[1], body: md.slice(match[0].length) };
}

/**
 * frontmatter を YAML として検証する。
 *
 * 行単位の自作パーサでは、`description: melta: UI`（無効な YAML）を通し、
 * `description: melta's entry`（有効な YAML）を弾く、という取りこぼしと過剰ブロックが
 * 同時に起きる。書式の判定は YAML パーサに任せ、ここは**値の意味**だけを検査する。
 *
 * `description: |` の下に字下げした `alwaysApply: true` は、YAML では description の
 * 文字列に飲まれる。書式としては有効なので、トップレベルに alwaysApply が無いこと
 * （= 常時適用されない）を理由に落ちる。キーの重複は yaml が既定でエラーにする
 */
function validateFrontmatter(frontmatter: string): {
  errors: string[];
  data: Record<string, unknown> | null;
} {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter, { uniqueKeys: true });
  } catch (error) {
    // Cursor が読めない frontmatter は、ルールがまるごと無視される
    errors.push(`YAML として読めない: ${(error as Error).message.split("\n")[0]}`);
    return { errors, data: null };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("frontmatter が key: value のオブジェクトではない");
    return { errors, data: null };
  }
  const data = parsed as Record<string, unknown>;

  // Cursor が解釈するキーは description / globs / alwaysApply の 3 つだけ。
  // それ以外は黙って無視されるので、効いているつもりの設定が生まれる
  const unsupported = Object.keys(data).filter((k) => !SUPPORTED_FRONTMATTER_KEYS.has(k));
  if (unsupported.length > 0) {
    errors.push(`Cursor が解釈しないキーがある: ${unsupported.join(", ")}`);
  }

  // 真偽値の true だけを認める。文字列 `"true"` は別物で、常時適用になる保証がない
  if (data.alwaysApply !== true) {
    errors.push(
      `alwaysApply が boolean の true でない（実際: ${JSON.stringify(data.alwaysApply) ?? "未設定"}）。常時適用されない`
    );
  }

  if (typeof data.description !== "string" || data.description.trim() === "") {
    errors.push("description が非空の文字列でない");
  }

  if ("globs" in data) {
    const globs = data.globs;
    const valid =
      typeof globs === "string" ||
      (Array.isArray(globs) && globs.every((g) => typeof g === "string"));
    if (!valid) errors.push("globs は文字列または文字列の配列であること");
  }

  return { errors, data };
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
 * rules.json: `pattern` / `prefixPatterns[]` / `matchPatterns[]`。**禁止側にしか存在しない語**
 *   （`text-black` / `shadow-lg` 等）はトークンにも contract にも出てこないので、ここを見ないと
 *   「DS が禁止している値を書いたポインタ」が素通りする。
 *
 * `-` か `#` を含む語だけを採用する。`body`（color.body の tailwind）のような普通の単語まで
 * 禁止すると日本語の散文が誤検知で落ちるため
 */
function deriveDenylist(): Map<string, DenyEntry> {
  const denylist = new Map<string, DenyEntry>();
  const add = (word: unknown, route: string, kind: DenyEntry["kind"] = "exact") => {
    if (typeof word !== "string") return;
    const w = word.trim();
    if (w === "" || !(w.includes("-") || w.includes("#"))) return;
    if (!denylist.has(w)) denylist.set(w, { route, kind });
  };
  /** 色スケール名・色の tailwind 名。ユーティリティ接頭辞を明示展開する材料 */
  const colorNames = new Set<string>();

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
      if (typeof obj.tailwind === "string") colorNames.add(obj.tailwind.trim());
      // 色スケールの葉の名前。`color.primary.500` → `primary-500`
      if (path.length >= 2) {
        const scaleName = `${path[path.length - 2]}-${path[path.length - 1]}`;
        add(scaleName, "tokens.json（色スケール名）");
        colorNames.add(scaleName);
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (child != null && typeof child === "object") walk(child, [...path, key]);
    }
  };
  walk(tokens, []);

  // 色スケール名 × ユーティリティ接頭辞の明示展開。
  // 語境界を緩めて `bg-primary-950` の中の `primary-950` に当てにいくと、代わりに
  // `source-text-body` の中の `text-body` まで拾ってしまう（過剰ブロック）。
  // 境界は厳格なままにして、捕まえたい形のほうを列挙する
  for (const name of colorNames) {
    // すでに接頭辞つきの名前（`bg-gray-50` / `text-body`）に重ねると `bg-bg-gray-50` になる
    if (UTILITY_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const prefix of UTILITY_PREFIXES) {
      add(`${prefix}${name}`, "tokens.json（色スケール × ユーティリティ接頭辞）");
    }
  }
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

  const fromContracts = denylist.size - fromTokens;

  const rules = JSON.parse(readFileSync(resolve(REPO_ROOT, RULES_JSON), "utf8"));
  for (const rule of rules.rules ?? []) {
    // 前方一致で禁止しているルールは、こちらも前方一致で見る。末尾境界を課すと
    // `font-[` が `font-[350]` に当たらない（`[` の次が `3` で境界が成立しない）
    const isPrefixRule = rule.detector === "tailwind-class-prefix";
    add(rule.pattern, "rules.json（pattern）", isPrefixRule ? "prefix" : "exact");
    if (Array.isArray(rule.prefixPatterns)) {
      for (const p of rule.prefixPatterns) add(p, "rules.json（prefixPatterns）", "prefix");
    }
    if (Array.isArray(rule.matchPatterns)) {
      for (const p of rule.matchPatterns) add(p, "rules.json（matchPatterns）", "exact");
    }
  }
  const fromRules = denylist.size - fromTokens - fromContracts;

  // SSOT の形が変わって何も導出できなかったのに「混入なし」と言わないための番人。
  // 1 つでも 0 なら、その由来ぶんの検査が空振りしている
  expect(fromTokens, `${TOKENS_JSON} から禁止語彙を導出できない（構造が変わった?）`).toBeGreaterThan(
    0
  );
  expect(
    fromContracts,
    `${CONTRACTS_DIR} の htmlSample から禁止語彙を導出できない（構造が変わった?）`
  ).toBeGreaterThan(0);
  expect(fromRules, `${RULES_JSON} の pattern から禁止語彙を導出できない（構造が変わった?）`).toBeGreaterThan(
    0
  );

  return denylist;
}

/**
 * 禁止語 1 語ぶんの照合パターン。
 *
 * 語境界は前後とも `[\w-]` で見る。`source-text-body` の中の `text-body` や
 * `text-black-list` の中の `text-black` を拾わないため（過剰ブロック側の事故を避ける）。
 * `bg-primary-950` のような接頭辞つきの形は、境界を緩めるのではなく denylist 側の
 * 明示展開（UTILITY_PREFIXES）で捕まえる。
 *
 * kind が prefix の語（rules.json が前方一致で禁止しているもの）だけは末尾の境界を課さない。
 * `bg-blue-` の次は `500`、`font-[` の次は `350` が来るのが前提で、境界は成立しない
 */
function denyPattern(word: string, kind: DenyEntry["kind"]): RegExp {
  const tail = kind === "prefix" ? "" : "(?![\\w-])";
  return new RegExp(`(?<![\\w-])${escapeRegExp(word)}${tail}`);
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
    const { errors } = validateFrontmatter(frontmatter);

    // 書式（YAML として有効か・キーの重複）はパーサが、意味（キー集合・型・値）は
    // validateFrontmatter が見る。どちらが欠けても Cursor は黙って適用しなくなる
    expect(
      errors,
      `${POINTER_MDC} の frontmatter が不正: ${errors.join(" / ")}`
    ).toEqual([]);
  });

  test("frontmatter と本文に値（SSOT の語彙 / 色 / 寸法）が 1 つも無い", () => {
    // description に値を書いても Cursor は読むので、frontmatter 込みの全文を対象にする
    const text = normalizeText(readPointerMdc().raw);
    const hits: string[] = [];

    // --- SSOT 由来の語彙 ---
    for (const [word, entry] of deriveDenylist()) {
      if (denyPattern(word, entry.kind).test(text)) hits.push(`${word}（${entry.route}）`);
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
        // SSOT に無いパレット・キーワード色も止める。`from` / `to` は `to-do` のような
        // 普通の語に当たるので入れない（過剰ブロック側の事故になる）。
        // 語境界は denylist と同じ `[\w-]`。`\b` だと `text-black-list` の中の
        // `text-black` に当たってしまう（ハイフンが単語境界として成立するため）
        name: "汎用リテラル（Tailwind 色ユーティリティ）",
        re: /(?<![\w-])(bg|text|border|ring|fill|stroke|divide|outline|placeholder|decoration|accent|caret)-(white|black|transparent|current|inherit|[a-z]+-\d{2,3})(?![\w-])/g,
      },
      {
        // 先頭の `-?` は負のユーティリティ（`-mt-4` / `-translate-y-1/2`）。
        // 契約の htmlSample には出るが、接頭辞に `-` が付くと denylist の語境界から外れる
        name: "汎用リテラル（Tailwind ユーティリティ）",
        re: /(?<![\w-])-?(h|w|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rounded|text|leading|tracking|shadow|border|inset|top|left|right|bottom|z|space-x|space-y|translate-x|translate-y)-(\d+(\.\d+)?|xs|sm|md|lg|xl|\dxl|full|none|px)(?![\w-])/g,
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

    // バッククォート参照は「パスらしい語」に絞る（散文や `check_html` を巻き込まないため）
    const backtickCandidates = backtickTokens(body).filter(
      (t) => /^[A-Za-z0-9._/-]+$/.test(t) && (t.includes("/") || /\.[a-z]+$/.test(t))
    );

    // Markdown リンクはローカル参照をすべて対象にする。文字種で絞ると
    // `[作業指示](MISSING.md#読み込みモード)` のような日本語 fragment 付きの死リンクが
    // 候補から外れて素通りする。fragment（`#` 以降）を落としてからファイル部分を照合する。
    // destination の後ろにタイトル（`](path "説明")`）が付く形も拾う。
    // 参照形式（`[作業指示][guide]` + 別行の `[guide]: path`）は定義行に destination が
    // 書かれるので、そちらも同じ経路へ流す（インラインだけ見ると定義側の死リンクが残る）
    const referenceDefinitions = [...body.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm)].map(
      (m) => m[1]
    );
    const linkCandidates = [
      ...[...body.matchAll(/\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)].map(
        (m) => m[1]
      ),
      ...referenceDefinitions,
    ]
      // CommonMark の山括弧つき destination（`[guide]: <AGENTS.md>`）。囲みを外してから
      // 照合しないと、`<AGENTS.md>` という名前のファイルを探して不存在で落ちる（過剰ブロック）
      .map((t) => (t.startsWith("<") && t.endsWith(">") ? t.slice(1, -1) : t))
      .filter((t) => !/^(https?:|mailto:)/i.test(t))
      .map((t) => t.split("#")[0].replace(/^\.\//, ""))
      .filter((t) => t !== ""); // 同一ファイル内アンカー（`#section`）はファイル参照ではない

    const candidates = [...backtickCandidates, ...linkCandidates];
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

    // アンカーはちょうど 1 個。2 個目を足すと、検査は 1 個目だけを見て 2 個目の列挙
    //（古いツール名・偽のツール名）を素通りさせる
    const markerCount = body.split(TOOLS_MARKER).length - 1;
    expect(
      markerCount,
      `${POINTER_MDC} の ${TOOLS_MARKER} アンカーはちょうど 1 個であること（実際: ${markerCount} 個）`
    ).toBe(1);
    const markerIndex = body.indexOf(TOOLS_MARKER);
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
