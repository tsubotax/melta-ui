/**
 * skill-rule-refs.spec.ts — design-review skill が引くルール ID の実在と生成層の鮮度
 *
 * skill は「ルール ID つきで違反を報告する」設計に変えた。ID が実在しなければ
 * レポートは検証できない主張になるので、次の 5 点を機械で縛る:
 *
 * 1. skill が引用している ID がすべて rules.json に実在する（嘘の ID を書けない）
 * 2. rules-index.md が生成器の出力と完全一致する（生成物が stale にならない）
 * 3. rules.json の全ルールが rules-index.md に載る（ルール追加が skill に届く）
 * 4. checklist.md の各観点が ID か「評価不可候補」を持つ（対応不明のまま増やせない）
 * 5. 生成器が Markdown の特殊文字を壊さない（説明文の <legend> がタグとして消えない）
 *
 * 1 は「文書中の大文字_大文字トークン全部」を見ない。rules.json の説明文には
 * A11Y_MIN_TAP_TARGET_44 のような ID 参照も、将来 CSS_VARIABLE のような非 ID 語も入りうるので、
 * 全文走査は過剰ブロックになる。引用の構造（手書き = 角括弧 / 生成物 = 表の第 1 列）で絞る。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import {
  buildRulesIndex,
  renderRulesIndex,
  RULES_INDEX_REL,
} from "../scripts/design/build-skill-checklist.js";

const SKILL_DIR = "skills/design-review";
const CHECKLIST_PATH = `${SKILL_DIR}/references/checklist.md`;

/** 手書き文書（生成物を除く）。ここでの ID 引用は必ず `[ID]` 形式で書く約束 */
const HANDWRITTEN_FILES = [
  `${SKILL_DIR}/SKILL.md`,
  `${SKILL_DIR}/references/checklist.md`,
  `${SKILL_DIR}/references/report-template.md`,
  `${SKILL_DIR}/references/severity-rules.md`,
];

/** 手書き文書の ID 引用: 角括弧で囲まれたトークンだけを見る */
const BRACKETED_RULE_ID = /\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/g;

/** ID をバッククォートで引用した書き方。`[ID]` に統一しないと下限件数を空振りさせられる */
const BACKTICKED_RULE_ID = /`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g;

/**
 * 文書ごとの `[ID]` 引用の下限。表記を変えるだけで検査が空振りする（抽出 0 件でも緑）のを防ぐ。
 * 実測値は checklist 36 / report-template 2 / SKILL 0 / severity-rules 0（2026-09-06）。
 * 現状 0 件の文書を一律 1 以上にはしない（ID を書く場所ではないため）。
 */
const MIN_BRACKETED_REFS: Record<string, number> = {
  // 手順書。ID の引用は checklist / rules-index に集約するので下限を課さない
  [`${SKILL_DIR}/SKILL.md`]: 0,
  // 7 カテゴリ 33 観点。1 観点が「ルール無し」なので 36 件から余裕を見て 20 を床に置く
  [`${SKILL_DIR}/references/checklist.md`]: 20,
  // テンプレの記載例が架空 ID に退行しないよう、実在 ID の例を最低 1 つ保つ
  [`${SKILL_DIR}/references/report-template.md`]: 1,
  // 重大度の基準はクラス名で書かれており ID 引用を前提にしない
  [`${SKILL_DIR}/references/severity-rules.md`]: 0,
};

/** checklist.md の観点行として許可する唯一の記法（インデント無しの `- `） */
const CANONICAL_BULLET = /^- /;
/** 箇条書きらしい行すべて（`*` `+` やインデント付きも拾って、許可外を拒否する） */
const ANY_BULLET = /^\s*[-*+]\s/;

function readRules(): Array<{ id: string; automationStatus?: string }> {
  const json = JSON.parse(readFileSync(resolve("design/contracts/rules.json"), "utf-8")) as {
    rules: Array<{ id: string; automationStatus?: string }>;
  };
  return json.rules;
}

function readRuleIds(): Set<string> {
  return new Set(readRules().map((r) => r.id));
}

/**
 * 表の行をセルに割る。書式も契約なので **trim しない**（`| ID |` を `|ID|` に変えたら
 * ヘッダーが見つからず fail する）。`\|` はセル内のエスケープ済みパイプなので分割しない。
 */
function splitTableRow(line: string): string[] {
  if (!line.startsWith("|") || !line.endsWith("|")) return [];
  return line.slice(1, -1).split(/(?<!\\)\|/);
}

const ID_CELL = /^ ([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+) $/;

/** rules-index.md の全カテゴリ表から ID 列を抜き出す（列位置はヘッダー行から決める） */
function extractIndexTableIds(index: string): {
  ids: string[];
  headerRows: number;
  malformed: string[];
} {
  const ids: string[] = [];
  const malformed: string[] = [];
  let headerRows = 0;
  let idColumn = -1;

  for (const line of index.split("\n")) {
    const cells = splitTableRow(line);
    if (cells.length === 0) {
      idColumn = -1; // 表の外に出た
      continue;
    }
    const headerAt = cells.indexOf(" ID ");
    if (headerAt >= 0) {
      headerRows++;
      idColumn = headerAt;
      continue;
    }
    if (idColumn < 0) continue;
    if (cells.every((c) => /^-{3,}$/.test(c))) continue; // 区切り行
    const cell = cells[idColumn] ?? "";
    const match = ID_CELL.exec(cell);
    if (match) ids.push(match[1]);
    else malformed.push(line.slice(0, 60));
  }
  return { ids, headerRows, malformed };
}

/**
 * 分離節の見出し。前方一致だと `## 人間確認待ちの説明` のようなデコイ節に乗っ取られ、
 * 本物の節が空でも緑になる（実測）。見出しは完全一致で、宣言件数まで含めて縛る。
 */
const HUMAN_ONLY_HEADING = /^## 人間確認待ち（human-only・(\d+)）$/;
const MACHINE_COVERED_HEADING = /^## 機械検出済み（auto \/ covered-by-test・(\d+)）$/;
/** 分離節の列挙行（`- \`ID\` — 説明`） */
const SECTION_BULLET_ID = /^- `([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/;

/** 見出しを完全一致で 1 つだけ探し、その節の宣言件数と列挙 ID を返す */
function strictSection(
  index: string,
  heading: RegExp
): { headings: number; declared: number; ids: string[] } {
  const lines = index.split("\n");
  const hits = lines.filter((l) => heading.test(l));
  if (hits.length !== 1) return { headings: hits.length, declared: -1, ids: [] };

  const start = lines.findIndex((l) => heading.test(l));
  const ids: string[] = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## "); i++) {
    const match = SECTION_BULLET_ID.exec(lines[i]);
    if (match) ids.push(match[1]);
  }
  return { headings: 1, declared: Number(heading.exec(hits[0])![1]), ids };
}

test.describe("design-review skill のルール参照", () => {
  test("skill が引用するルール ID はすべて rules.json に実在する", () => {
    const ids = readRuleIds();
    const unknown: string[] = [];

    const belowFloor: string[] = [];
    const wrongNotation: string[] = [];
    /** ID の族（最初の `_` より前）。綴り違いの ID を非 ID 語と区別するために使う */
    const families = new Set([...ids].map((id) => id.split("_")[0]));

    // 手書き文書: `[ID]` の形で引用しているものだけを実在照合する
    for (const file of HANDWRITTEN_FILES) {
      const content = readFileSync(resolve(file), "utf-8");
      const bracketed = [...content.matchAll(BRACKETED_RULE_ID)];
      for (const match of bracketed) {
        if (!ids.has(match[1])) unknown.push(`${file}: [${match[1]}]`);
      }
      // 抽出件数の下限。表記を変えて抽出を 0 件にする逃げ道を塞ぐ
      const floor = MIN_BRACKETED_REFS[file] ?? 0;
      if (bracketed.length < floor) {
        belowFloor.push(`${file}: ${bracketed.length} 件（下限 ${floor}）`);
      }
      // `[ID]` へ統一する（バッククォート引用は実在照合も下限件数もすり抜ける）。
      // ID でない大文字_大文字語（CSS_VARIABLE 等）まで拒否すると過剰ブロックになるので、
      // 実在 ID か、実在 ID と同じ族の接頭辞を持つ語（= 綴り違いの ID）だけを対象にする
      for (const match of content.matchAll(BACKTICKED_RULE_ID)) {
        const token = match[1];
        if (ids.has(token)) wrongNotation.push(`${file}: \`${token}\``);
        else if (families.has(token.split("_")[0])) unknown.push(`${file}: \`${token}\``);
      }
    }

    expect(
      belowFloor,
      "ID 引用が下限を割った（記法を変えて検査を空振りさせていないか）"
    ).toEqual([]);
    expect(
      wrongNotation,
      "ルール ID をバッククォートで引用している（`[ID]` 表記に直す）"
    ).toEqual([]);

    // 生成物: ヘッダー行から ID 列を決め、その列だけを実在照合する
    const index = readFileSync(resolve(RULES_INDEX_REL), "utf-8");
    const table = extractIndexTableIds(index);
    for (const id of table.ids) {
      if (!ids.has(id)) unknown.push(`${RULES_INDEX_REL}: ${id}`);
    }

    expect(
      [...new Set(unknown)],
      "rules.json に無い ID を skill が引用している（実在する ID に直す）"
    ).toEqual([]);

    // 抽出そのものが空振りしていないことを、件数と集合で確かめる
    expect(
      table.headerRows,
      "rules-index.md に表ヘッダー行（`| ID | severity | …`）が無い"
    ).toBeGreaterThan(0);
    expect(table.malformed, "ID 列の書式が契約から外れた行").toEqual([]);
    const rules = readRules();
    expect(table.ids.length, "表に載る ID の件数が rules.json と違う").toBe(rules.length);
    expect(new Set(table.ids).size, "表の ID が重複している").toBe(table.ids.length);
    expect([...new Set(table.ids)].sort(), "表の ID 集合が rules.json と一致しない").toEqual(
      [...ids].sort()
    );
  });

  test("rules-index.md は生成器の出力と一致する（生成物が stale でない）", () => {
    const committed = readFileSync(resolve(RULES_INDEX_REL), "utf-8");
    expect(
      committed === buildRulesIndex(),
      `${RULES_INDEX_REL} が rules.json と乖離している（npm run design:skill-index で再生成する）`
    ).toBe(true);
  });

  test("rules.json の全ルールが rules-index.md に載る（分離節は集合が完全一致）", () => {
    const index = readFileSync(resolve(RULES_INDEX_REL), "utf-8");
    const rules = readRules();

    const missing = rules.filter((r) => !index.includes(r.id)).map((r) => r.id);
    expect(missing, "rules-index.md に現れないルール").toEqual([]);

    const sections: Array<[string, RegExp, string[]]> = [
      [
        "人間確認待ち",
        HUMAN_ONLY_HEADING,
        rules.filter((r) => r.automationStatus === "human-only").map((r) => r.id),
      ],
      [
        "機械検出済み",
        MACHINE_COVERED_HEADING,
        rules
          .filter((r) => r.automationStatus === "auto" || r.automationStatus === "covered-by-test")
          .map((r) => r.id),
      ],
    ];

    for (const [label, heading, expected] of sections) {
      const section = strictSection(index, heading);
      expect(section.headings, `「${label}」節の見出しが 1 つに定まらない`).toBe(1);
      expect(section.declared, `「${label}」節の見出しが宣言する件数が実際と違う`).toBe(
        expected.length
      );
      expect(new Set(section.ids).size, `「${label}」節の列挙に重複がある`).toBe(
        section.ids.length
      );
      // 不足も過剰も許さない（列挙が空でも、余計な ID が混じっても落ちる）
      expect([...section.ids].sort(), `「${label}」節の ID 集合が rules.json と一致しない`).toEqual(
        [...expected].sort()
      );
    }
  });

  test("checklist.md の各観点は `- ` 記法でルール ID か「評価不可候補」を持つ", () => {
    const lines = readFileSync(resolve(CHECKLIST_PATH), "utf-8").split("\n");
    const orphans: string[] = [];
    const badNotation: string[] = [];
    lines.forEach((line, i) => {
      if (!ANY_BULLET.test(line)) return;
      // 許可外の記法（`* ` `+ ` やインデント付き）を無言で捨てない。捨てると
      // 記法を変えるだけで ID 併記の検査を回避できてしまう
      if (!CANONICAL_BULLET.test(line)) {
        badNotation.push(`L${i + 1}: ${line.slice(0, 60)}`);
        return;
      }
      const hasId = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/.test(line);
      const hasUnevaluable = line.includes("[評価不可候補");
      if (!hasId && !hasUnevaluable) orphans.push(`L${i + 1}: ${line.slice(0, 60)}`);
    });
    expect(
      badNotation,
      "許可されていない箇条書き記法（観点行はインデント無しの `- ` に統一する）"
    ).toEqual([]);
    expect(orphans, "ID も「評価不可候補」も持たない観点行").toEqual([]);
  });

  test("renderRulesIndex() は入力値を壊さない（特殊文字 / 空白 / 検出条件）", () => {
    // rules.json 実物には <legend> を含む説明が 6 件ある。生の < > は GFM が HTML タグとして
    // 解釈して描画時に消すので、プレーンセルではバックスラッシュエスケープが要る。
    // バッククォート・両端空白・既存バックスラッシュを含むルールは現状 0 件だが、
    // matcher は pattern の完全一致で照合するので、索引が値を変形したら SSOT の誤表現になる。
    const output = renderRulesIndex({
      rules: [
        {
          id: "COLOR_NO_TEXT_BLACK",
          category: "color",
          severity: "error",
          description: "<legend> は a|b のように表と干渉する",
          detector: "manual",
          pattern: "`tick` と ``double`` を含む",
          alternative: "普通の代替",
        },
        {
          id: "COLOR_NO_GREEN",
          category: "color",
          severity: "error",
          description: "prefix / match でしか検出しないルール",
          detector: "tailwind-class-prefix",
          prefixPatterns: ["bg-green-", "text-green-"],
          alternative: "bg-emerald-*",
        },
        {
          id: "AI_NO_DECORATIVE_PURPLE",
          category: "ai-pattern",
          severity: "error",
          description: "バックスラッシュ \\* を保存する",
          detector: "tailwind-class-segment",
          matchPatterns: ["purple", "violet"],
          alternative: "bg-primary-*",
        },
        {
          id: "COLOR_NO_PRIMARY_400",
          category: "color",
          severity: "warn",
          description: "両端の空白を保存する",
          detector: "tailwind-class",
          pattern: " text-black ",
          alternative: "bg-primary-500",
        },
      ],
    });

    expect(output, "説明セルの山括弧がエスケープされていない").toContain("\\<legend\\>");
    expect(output, "説明セルのパイプがエスケープされていない").toContain("a\\|b");
    // 最長連続 2 本 → 区切りは 3 本。内容がバッククォートで始まるので内側に空白 1 つ
    expect(output, "コードスパンの区切りが内容より長くない").toContain(
      "``` `tick` と ``double`` を含む ```"
    );
    // 既存のバックスラッシュを二重化しないと、描画時に `\*` が `*` に化ける
    expect(output, "既存のバックスラッシュが保存されていない").toContain("バックスラッシュ \\\\*");
    // pattern が null のルールは、detector が実際に見るフィールドを検出条件として出す
    expect(output, "prefixPatterns が検出条件に出ていない").toContain(
      "prefix: `bg-green-`, `text-green-` → `bg-emerald-*`"
    );
    expect(output, "matchPatterns が検出条件に出ていない").toContain(
      "match: `purple`, `violet` → `bg-primary-*`"
    );
    // 両端の空白を trim しない（CommonMark の 1 文字ストリップに食われないよう両側に 1 つ足す）
    expect(output, "pattern の両端の空白が trim されている").toContain("`  text-black  `");
  });
});
