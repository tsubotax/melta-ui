/**
 * build-skill-checklist.ts — design-review skill のルール索引を rules.json から生成
 *
 * `skills/design-review` は長らく手書きの checklist だけを持っていたため、
 * 「書いてあるルール ID が実在するか」「rules.json に足したルールが skill に届くか」を
 * 誰も検証していなかった。生成層（本スクリプトの出力 = rules-index.md）を挟み、
 * 網羅は機械が持ち、curation（references/checklist.md）は人間が持つ 2 層に分ける。
 *
 * 正本は design/contracts/rules.json。出力は決定論（rules.json の内容と順序のみに依存。
 * タイムスタンプ・環境依存の値を入れない）。CI の freshness チェックと
 * tests/skill-rule-refs.spec.ts が「再生成して diff が出ない」ことを保証する。
 *
 * build-llms-txt.ts は直接実行型だが、本スクリプトは spec から in-memory 生成して
 * コミット済みファイルと突き合わせるため、生成関数を export し main guard で書き出す。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

/** 入力（SSOT）と出力のパス。spec / CI から参照する */
export const RULES_JSON_REL = "design/contracts/rules.json";
export const RULES_INDEX_REL = "skills/design-review/references/rules-index.md";

/** 人間確認待ち節に載せる automationStatus */
export const HUMAN_ONLY_STATUS = "human-only";
/** 機械検出済み節に載せる automationStatus（lint / test が既に見ている） */
export const MACHINE_COVERED_STATUSES = ["auto", "covered-by-test"] as const;

export interface Rule {
  id: string;
  category: string;
  severity: string;
  description: string;
  detector: string;
  pattern?: string;
  alternative?: string;
  automationStatus?: string;
}

interface RulesJson {
  rules: Rule[];
  vocabulary?: { ruleCategories?: string[] };
}

export function loadRules(root: string = REPO_ROOT): RulesJson {
  return JSON.parse(readFileSync(resolve(root, RULES_JSON_REL), "utf-8")) as RulesJson;
}

/**
 * Markdown 表のセルとして安全な文字列にする。
 * GFM ではコードスパンの内側でも `|` は表の区切りとして解釈されるため、
 * バッククォートで囲む場合も含めて必ずエスケープする（例: duration-[5-9]00|duration-1000）。
 */
function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function code(text: string): string {
  return `\`${cell(text)}\``;
}

/** カテゴリ順: vocabulary.ruleCategories → そこに無いカテゴリは rules.json 初出順で末尾に追加 */
export function categoryOrder(data: RulesJson): string[] {
  const vocab = data.vocabulary?.ruleCategories ?? [];
  const present = new Set(data.rules.map((r) => r.category));
  const ordered = vocab.filter((c) => present.has(c));
  const seen = new Set(ordered);
  for (const rule of data.rules) {
    if (!seen.has(rule.category)) {
      seen.add(rule.category);
      ordered.push(rule.category);
    }
  }
  return ordered;
}

/** rules-index.md の本文を生成する（ファイル I/O なし = spec から呼べる） */
export function renderRulesIndex(data: RulesJson): string {
  const rules = data.rules;
  const lines: string[] = [];

  lines.push("# 禁止ルール索引（生成物）");
  lines.push("");
  lines.push(
    "> **生成物。手で編集しない。** `npm run design:skill-index` で再生成する。"
  );
  lines.push(`> 正本は \`${RULES_JSON_REL}\`（全 ${rules.length} ルール）。`);
  lines.push(
    "> 観点の索引（人間が curation した検出手順）は `checklist.md`。網羅はこのファイルが持つ。"
  );
  lines.push("");
  lines.push(
    "`automationStatus` 列の `—` は未宣言。未宣言のルールは静的検出機構（pattern / htmlAttrCheck / compositionCheck）を必ず持ち、lint が見る（`tests/coverage-stats.spec.ts` が 0 件を維持）。"
  );
  lines.push("");

  for (const category of categoryOrder(data)) {
    const inCategory = rules.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    lines.push(`## ${category}（${inCategory.length}）`);
    lines.push("");
    lines.push("| ID | severity | detector | pattern → alternative | 説明 | automationStatus |");
    lines.push("|---|---|---|---|---|---|");
    for (const rule of inCategory) {
      const fix = rule.alternative ? code(rule.alternative) : "—";
      const transition = rule.pattern ? `${code(rule.pattern)} → ${fix}` : fix;
      lines.push(
        `| ${cell(rule.id)} | ${cell(rule.severity)} | ${cell(rule.detector)} | ${transition} | ${cell(rule.description)} | ${cell(rule.automationStatus ?? "—")} |`
      );
    }
    lines.push("");
  }

  const humanOnly = rules.filter((r) => r.automationStatus === HUMAN_ONLY_STATUS);
  lines.push(`## 人間確認待ち（human-only・${humanOnly.length}）`);
  lines.push("");
  lines.push(
    "静的な HTML からは判定できない（実行時の挙動・時間経過・入力操作を見ないと分からない）。**skill はこれらを違反件数に入れない。** レポートでは「評価不可（human-only）」として分離する。"
  );
  lines.push("");
  for (const rule of humanOnly) {
    lines.push(`- \`${rule.id}\` — ${cell(rule.description)}`);
  }
  lines.push("");

  const machineCovered = rules.filter(
    (r) => r.automationStatus != null && (MACHINE_COVERED_STATUSES as readonly string[]).includes(r.automationStatus)
  );
  lines.push(`## 機械検出済み（auto / covered-by-test・${machineCovered.length}）`);
  lines.push("");
  lines.push(
    "lint（composition 検出）または Playwright テストが既に見ている。**skill は二重報告しない。** レビュー対象の HTML で明らかな違反を見つけた場合だけ、機械検出済みである旨を添えて報告する。"
  );
  lines.push("");
  for (const rule of machineCovered) {
    lines.push(`- \`${rule.id}\`（${rule.automationStatus}） — ${cell(rule.description)}`);
  }
  lines.push("");

  return lines.join("\n");
}

/** rules.json を読んで rules-index.md の本文を返す */
export function buildRulesIndex(root: string = REPO_ROOT): string {
  return renderRulesIndex(loadRules(root));
}

function main(): void {
  const content = buildRulesIndex();
  const out = resolve(REPO_ROOT, RULES_INDEX_REL);
  writeFileSync(out, content, "utf-8");
  console.log(`  ✅ ${RULES_INDEX_REL} (${content.length} chars) を生成`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
