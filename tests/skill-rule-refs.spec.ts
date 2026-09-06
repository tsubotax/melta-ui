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

/** rules-index.md の ID 引用: 表の行の第 1 列だけを見る（説明セルの ID 風トークンは対象外） */
const INDEX_TABLE_ROW_ID = /^\| ([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+) \|/;

function readRules(): Array<{ id: string; automationStatus?: string }> {
  const json = JSON.parse(readFileSync(resolve("design/contracts/rules.json"), "utf-8")) as {
    rules: Array<{ id: string; automationStatus?: string }>;
  };
  return json.rules;
}

function readRuleIds(): Set<string> {
  return new Set(readRules().map((r) => r.id));
}

/** `## <heading>` から次の `## ` までを切り出す */
function sectionOf(markdown: string, headingPrefix: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${headingPrefix}`));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

test.describe("design-review skill のルール参照", () => {
  test("skill が引用するルール ID はすべて rules.json に実在する", () => {
    const ids = readRuleIds();
    const unknown: string[] = [];

    // 手書き文書: `[ID]` の形で引用しているものだけを実在照合する
    for (const file of HANDWRITTEN_FILES) {
      const content = readFileSync(resolve(file), "utf-8");
      for (const match of content.matchAll(BRACKETED_RULE_ID)) {
        if (!ids.has(match[1])) unknown.push(`${file}: [${match[1]}]`);
      }
    }

    // 生成物: 表の第 1 列（= ルールの ID 列）だけを実在照合する
    const indexLines = readFileSync(resolve(RULES_INDEX_REL), "utf-8").split("\n");
    for (const line of indexLines) {
      const match = INDEX_TABLE_ROW_ID.exec(line);
      if (match && !ids.has(match[1])) unknown.push(`${RULES_INDEX_REL}: ${match[1]}`);
    }

    expect(
      [...new Set(unknown)],
      "rules.json に無い ID を skill が引用している（実在する ID に直す）"
    ).toEqual([]);
  });

  test("rules-index.md は生成器の出力と一致する（生成物が stale でない）", () => {
    const committed = readFileSync(resolve(RULES_INDEX_REL), "utf-8");
    expect(
      committed === buildRulesIndex(),
      `${RULES_INDEX_REL} が rules.json と乖離している（npm run design:skill-index で再生成する）`
    ).toBe(true);
  });

  test("rules.json の全ルールが rules-index.md に載る（human-only は専用節にも載る）", () => {
    const index = readFileSync(resolve(RULES_INDEX_REL), "utf-8");
    const rules = readRules();

    const missing = rules.filter((r) => !index.includes(r.id)).map((r) => r.id);
    expect(missing, "rules-index.md に現れないルール").toEqual([]);

    const humanSection = sectionOf(index, "人間確認待ち");
    expect(humanSection.length, "「人間確認待ち」節が見つからない").toBeGreaterThan(0);
    const humanOnly = rules.filter((r) => r.automationStatus === "human-only").map((r) => r.id);
    const missingHumanOnly = humanOnly.filter((id) => !humanSection.includes(id));
    expect(missingHumanOnly, "human-only なのに「人間確認待ち」節に無いルール").toEqual([]);
  });

  test("checklist.md の各観点はルール ID か「評価不可候補」を持つ", () => {
    const lines = readFileSync(resolve(CHECKLIST_PATH), "utf-8").split("\n");
    const orphans: string[] = [];
    lines.forEach((line, i) => {
      if (!line.startsWith("- ")) return;
      const hasId = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/.test(line);
      const hasUnevaluable = line.includes("[評価不可候補");
      if (!hasId && !hasUnevaluable) orphans.push(`L${i + 1}: ${line.slice(0, 60)}`);
    });
    expect(orphans, "ID も「評価不可候補」も持たない観点行").toEqual([]);
  });

  test("renderRulesIndex() は特殊文字を壊さない（山括弧 / パイプ / バッククォート）", () => {
    // rules.json 実物には <legend> を含む説明が 6 件ある。生の < > は GFM が HTML タグとして
    // 解釈して描画時に消すので、プレーンセルではバックスラッシュエスケープが要る。
    // バッククォートを含むルールは現状 0 件だが、生成器の責務として合成入力で塞ぐ。
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
      ],
    });

    expect(output, "説明セルの山括弧がエスケープされていない").toContain("\\<legend\\>");
    expect(output, "説明セルのパイプがエスケープされていない").toContain("a\\|b");
    // 最長連続 2 本 → 区切りは 3 本。内容がバッククォートで始まるので内側に空白 1 つ
    expect(output, "コードスパンの区切りが内容より長くない").toContain(
      "``` `tick` と ``double`` を含む ```"
    );
  });
});
