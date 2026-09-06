/**
 * skill-rule-refs.spec.ts — design-review skill が引くルール ID の実在と生成層の鮮度
 *
 * skill は「ルール ID つきで違反を報告する」設計に変えた。ID が実在しなければ
 * レポートは検証できない主張になるので、次の 4 点を機械で縛る:
 *
 * 1. skill が書いている ID がすべて rules.json に実在する（嘘の ID を書けない）
 * 2. rules-index.md が生成器の出力と完全一致する（生成物が stale にならない）
 * 3. rules.json の全ルールが rules-index.md に載る（ルール追加が skill に届く）
 * 4. checklist.md の各観点が ID か「評価不可候補」を持つ（対応不明のまま増やせない）
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { buildRulesIndex, RULES_INDEX_REL } from "../scripts/design/build-skill-checklist.js";

const SKILL_DIR = "skills/design-review";
const CHECKLIST_PATH = `${SKILL_DIR}/references/checklist.md`;

/**
 * ルール ID らしきトークン。アンダースコアを 1 つ以上含む大文字語に絞り、
 * HTML / SSOT / CSS のような ID でない大文字語を拾わない。
 */
const RULE_ID_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/**
 * ID ではないがこの正規表現に当たる語の allowlist。
 * 追加するときは「なぜルール ID ではないか」を必ず書く（無言で緩めない）。
 * 現状は空 = skill の文面に出てくる大文字_大文字トークンはすべて実在ルール ID。
 */
const NON_RULE_ID_ALLOWLIST = new Set<string>([]);

function readRules(): Array<{ id: string; automationStatus?: string }> {
  const json = JSON.parse(readFileSync(resolve("design/contracts/rules.json"), "utf-8")) as {
    rules: Array<{ id: string; automationStatus?: string }>;
  };
  return json.rules;
}

function readRuleIds(): Set<string> {
  return new Set(readRules().map((r) => r.id));
}

/** SKILL.md + references/*.md の全 md ファイル（相対パス） */
function skillMarkdownFiles(): string[] {
  const refs = readdirSync(resolve(SKILL_DIR, "references"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `${SKILL_DIR}/references/${f}`);
  return [`${SKILL_DIR}/SKILL.md`, ...refs];
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
  test("skill が書くルール ID はすべて rules.json に実在する", () => {
    const ids = readRuleIds();
    const unknown: string[] = [];
    for (const file of skillMarkdownFiles()) {
      const content = readFileSync(resolve(file), "utf-8");
      for (const token of content.match(RULE_ID_TOKEN) ?? []) {
        if (ids.has(token) || NON_RULE_ID_ALLOWLIST.has(token)) continue;
        unknown.push(`${file}: ${token}`);
      }
    }
    expect(
      [...new Set(unknown)],
      "rules.json に無い ID を skill が書いている（実在するものに直すか、ID でない語なら allowlist に理由つきで追加する）"
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
});
