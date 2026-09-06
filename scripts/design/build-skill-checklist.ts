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
  /** detector が pattern の代わりに見る前方一致リスト（tailwind-class-prefix 等） */
  prefixPatterns?: string[];
  /** detector が pattern の代わりに見る部分一致リスト（tailwind-class-segment 等） */
  matchPatterns?: string[];
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
 * 表のセル共通の前処理。
 * 改行は CRLF / 単独 CR / LF の 3 形すべてを空白に潰す。
 * GFM ではコードスパンの内側でも `|` は表の区切りとして解釈されるため、
 * バッククォートで囲む場合も含めて必ずエスケープする（例: duration-[5-9]00|duration-1000）。
 * **trim はしない**: pattern は matcher が完全一致で照合する値なので、索引が両端の空白を
 * 落とすと SSOT の誤表現になる。trim が要るのはプレーンセル側だけ。
 */
function normalize(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ").replace(/\|/g, "\\|");
}

/**
 * 表のプレーンセル（説明・ID・severity 等）。
 * GFM は `<legend>` のような山括弧を生 HTML として解釈し、描画時にタグごと消す。
 * `&lt;` にはせずバックスラッシュエスケープを使う（この md の一次読者は raw を読む LLM なので
 * 原文の可読性を保つ）。
 * 既存のバックスラッシュを先に二重化する（`\*` がそのまま出ると描画で `*` に化ける）。
 * 順序が肝: 自前のエスケープを足す前に元の `\` を潰す。
 */
function cell(text: string): string {
  return normalize(text.replace(/\\/g, "\\\\"))
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .trim();
}

/**
 * コードスパンのセル（pattern / alternative）。
 * 内容にバッククォートが含まれると 1 本区切りでは途中で閉じるため、
 * CommonMark に従い「内容中の最長バッククォート連続 + 1 本」を区切りにする。
 * 内容がバッククォートで始まる / 終わるときは内側に空白を 1 つ入れて閉じ位置を確定させる
 * （両側に入れないと CommonMark の空白ストリップが働かない）。
 * 内容が空白で始まり空白で終わるときも同じ理由でパディングが要る。CommonMark は
 * 「両端が空白なら 1 文字ずつ削る」ので、足しておかないと値の空白が消える。
 * コードスパン内ではバックスラッシュエスケープが効かないので `<` `>` は生のまま置く。
 */
function code(text: string): string {
  const content = normalize(text);
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const touchesBacktick = content.startsWith("`") || content.endsWith("`");
  const strippable = content.startsWith(" ") && content.endsWith(" ");
  const pad = touchesBacktick || strippable ? " " : "";
  return `${fence}${pad}${content}${pad}${fence}`;
}

/**
 * 表の「検出条件」列。detector が実際に見るフィールドを出す。
 * pattern が null でも prefixPatterns / matchPatterns だけで検出するルールがある
 * （AI_NO_DECORATIVE_PURPLE）。pattern だけを出すと索引が「条件なし」に見えてしまう。
 */
function detectionCondition(rule: Rule): string {
  if (rule.pattern) return code(rule.pattern);
  const parts: string[] = [];
  if (rule.prefixPatterns?.length) {
    parts.push(`prefix: ${rule.prefixPatterns.map(code).join(", ")}`);
  }
  if (rule.matchPatterns?.length) {
    parts.push(`match: ${rule.matchPatterns.map(code).join(", ")}`);
  }
  return parts.join(" / ");
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
  lines.push(
    "> skill の必読ではない。人間と CI 向けの生成層であり、skill にとっては「checklist に無いカテゴリを横断で探すときの索引」。判定に使う値は SSOT の `design/contracts/rules.json` を見る。"
  );
  lines.push("");
  lines.push(
    "`automationStatus` 列の `—` は未宣言。未宣言のルールは、detector が参照する pattern 系フィールド（`pattern` / `prefixPatterns` / `matchPatterns`）か `htmlAttrCheck` / `compositionCheck` のいずれかを必ず持つ（`tests/coverage-stats.spec.ts` が未分類 0 件を維持する）。これは検出経路の存在であって、各レビュー対象を検査済みという保証ではない。"
  );
  lines.push("");

  for (const category of categoryOrder(data)) {
    const inCategory = rules.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    lines.push(`## ${category}（${inCategory.length}）`);
    lines.push("");
    lines.push("| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |");
    lines.push("|---|---|---|---|---|---|");
    for (const rule of inCategory) {
      const fix = rule.alternative ? code(rule.alternative) : "—";
      const condition = detectionCondition(rule);
      const transition = condition ? `${condition} → ${fix}` : fix;
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
