/**
 * build-llms-txt.ts — llms.txt / llms-full.txt を contracts から生成
 *
 * llms.txt 標準（https://llmstxt.org/）に従い、AI エージェント向けの入口を
 * リポジトリルートに生成する。
 *
 * リンク先は GitHub raw（main ブランチ固定）。melta.tsubotax.com は showcase 専用で、
 * ドキュメント・契約の正本は GitHub リポジトリ（2026-08-17 確定）。
 * 経緯: 2026-07-06 の allowlist 化で publish が site-public に変わり、llms.txt が列挙する
 * 自サイト URL が 42 日間すべて 404 だった。自サイト配信を復旧する案もあったが、
 * llms.txt を主要 LLM プロバイダがほぼ読んでいない実測（Google は不採用宣言）を踏まえ、
 * 配信面を増やさず GitHub を正とする。
 *
 * main 固定の性質: 常に最新版を指す living docs であって、過去タグ時点の llms.txt から
 * 辿っても当時の内容は再現できない。リリース時点の内容が要るなら npm の melta-contracts を使う。
 * raw.githubusercontent.com は Content-Type: text/plain で返す（md も json も）。
 * 取得して parse する用途では問題ない。匿名アクセスは rate limit の対象（429）。
 *
 * - llms.txt      : インデックス（H1 + 要約 + 注釈付きリンク）
 * - llms-full.txt : 主要ドキュメントの連結（DESIGN.md / authority / theme /
 *                   tokens.json / rules.json / contract サマリ）
 *
 * 出力は決定論（ファイル内容とソート順のみに依存。タイムスタンプなし）。
 * CI の freshness チェックで「再生成して diff が出ない」ことを保証する。
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getContractStats } from "../../src/utils/contract-stats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const BASE = "https://raw.githubusercontent.com/tsubotax/melta-ui/main";

// 全文連結の上限（コンテキスト破壊防止。超過時は contract サマリから削る）
const FULL_MAX_CHARS = 400_000;

// --- データ収集 ---
const stats = getContractStats(resolve(root, "design/contracts/components"));
const rulesJson = JSON.parse(
  readFileSync(resolve(root, "design/contracts/rules.json"), "utf-8")
);
const ruleCount: number = rulesJson.rules.length;

const tokensJson = JSON.parse(
  readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
);
// トークン数カウント（update-showcase.ts / drift-check.ts と同一ロジック）
function countTokens(obj: unknown): number {
  if (typeof obj !== "object" || obj === null) return 0;
  const record = obj as Record<string, unknown>;
  if ("value" in record) return 1;
  let count = 0;
  for (const val of Object.values(record)) count += countTokens(val);
  return count;
}
const tokenCount = countTokens(tokensJson);

const contractDir = resolve(root, "design/contracts/components");
const contractFiles = readdirSync(contractDir)
  .filter((f) => f.endsWith(".contract.json"))
  .sort();

interface StateSpecSummary {
  description: string;
  tailwind: string;
  ariaChanges?: string;
  htmlNote?: string;
}
interface ContractSummary {
  id: string;
  description: string;
  webStatus?: string;
  variants: string[];
  states: string[];
  /** state ごとの生成仕様（P2-1）。disabled/loading 等を静的 llms に乗せ cold/designmd ベンチに届かせる */
  stateSpecs?: Record<string, StateSpecSummary>;
  /** anatomy パーツ名（object 形式は keys、string[] はそのまま）。構造の存在を静的に示す */
  anatomy?: string[];
  rules: string[];
}
const contractSummaries: ContractSummary[] = contractFiles.map((f) => {
  const c = JSON.parse(readFileSync(resolve(contractDir, f), "utf-8"));
  return {
    id: c.id,
    description: (c.intent ?? c.description ?? "").slice(0, 120),
    ...(c.webStatus === "pending" ? { webStatus: "pending" } : {}),
    variants: Object.keys(c.variants ?? {}),
    states: c.states ?? [],
    ...(c.stateSpecs ? { stateSpecs: c.stateSpecs } : {}),
    ...(c.anatomy
      ? { anatomy: Array.isArray(c.anatomy) ? c.anatomy : Object.keys(c.anatomy) }
      : {}),
    rules: (c.rules ?? []).map((r: { id: string }) => r.id),
  };
});

// --- llms.txt（インデックス） ---
const contractLinks = contractSummaries
  .map(
    (c) =>
      `- [${c.id}](${BASE}/design/contracts/components/${c.id}.contract.json): ${c.description}${c.webStatus === "pending" ? "（web 実装は準備中）" : ""}`
  )
  .join("\n");

const llmsTxt = `# melta UI

> 人間にも AI にも読めるデザインシステム（AI-Ready 2.0）。Tailwind CSS ベースで、${stats.web} コンポーネント（contract は全 ${stats.all} contract = web ${stats.web} + app 先行 ${stats.pending}）、${tokenCount} デザイントークン、${ruleCount} 禁止ルール、検証ハーネス（CI / lint / hook）、MCP サーバーを同梱する。

UI を生成する前に DESIGN.md を読むこと。exact value は design/contracts/ の JSON が SSOT（値競合時は contracts > DESIGN.md Quick Reference > 各 md の順で優先）。

## Docs

- [DESIGN.md](${BASE}/DESIGN.md): デザイン憲法 + Quick Reference。これだけで基本 UI を生成可能
- [AGENTS.md](${BASE}/AGENTS.md): AI エージェント向け作業ガイド（読み込みモード・作業ルール・タスク別ガイド）
- [authority.md](${BASE}/design/authority.md): SSOT 宣言と値競合時の優先順位
- [tokens.json](${BASE}/design/contracts/tokens.json): ${tokenCount} デザイントークン（exact value + tailwind class）
- [rules.json](${BASE}/design/contracts/rules.json): ${ruleCount} 禁止ルール（ID + severity + detector + alternative）
- [theme.md](${BASE}/foundations/theme.md): テーマ・CSS 変数・カラーパレット

## Components

- [components.json](${BASE}/metadata/components.json): ${stats.web} コンポーネント仕様の集約ビュー（contracts から生成）
${contractLinks}

## Optional

- [README.md](${BASE}/README.md): プロジェクト全体像（アーキテクチャ・Quick Start・Enforcement）
- [design_philosophy.md](${BASE}/foundations/design_philosophy.md): デザイン哲学の詳細
- [layout.md](${BASE}/patterns/layout.md): レイアウトパターン（コンテンツ幅・グリッド）
- [form.md](${BASE}/patterns/form.md): フォームパターン
- [llms-full.txt](${BASE}/llms-full.txt): 主要ドキュメントの全文連結（1 ファイルで読みたいエージェント向け）
`;

// --- llms-full.txt（全文連結） ---
function sectionOf(label: string, body: string): string {
  return `\n\n===== ${label} =====\n\n${body.trim()}\n`;
}

const fullParts: string[] = [
  `# melta UI — llms-full.txt\n\n> 主要ドキュメントの全文連結（scripts/design/build-llms-txt.ts で生成。直接編集しない）。\n> インデックス版: ${BASE}/llms.txt`,
  sectionOf("DESIGN.md", readFileSync(resolve(root, "DESIGN.md"), "utf-8")),
  sectionOf("design/authority.md", readFileSync(resolve(root, "design/authority.md"), "utf-8")),
  sectionOf("foundations/theme.md", readFileSync(resolve(root, "foundations/theme.md"), "utf-8")),
  sectionOf("design/contracts/tokens.json", JSON.stringify(tokensJson)),
  sectionOf("design/contracts/rules.json", JSON.stringify(rulesJson)),
];

const summarySection = sectionOf(
  `contract summaries（全 ${stats.all} contract。全文は design/contracts/components/{id}.contract.json）`,
  contractSummaries.map((c) => JSON.stringify(c)).join("\n")
);

let llmsFull = fullParts.join("") + summarySection;
if (llmsFull.length > FULL_MAX_CHARS) {
  console.warn(
    `  ⚠️ llms-full.txt が上限 ${FULL_MAX_CHARS} chars を超過（${llmsFull.length}）。contract サマリを除外します`
  );
  llmsFull = fullParts.join("");
  if (llmsFull.length > FULL_MAX_CHARS) {
    console.error(`  ❌ contract サマリ除外後も上限超過（${llmsFull.length}）。構成を見直してください`);
    process.exit(1);
  }
}

writeFileSync(resolve(root, "llms.txt"), llmsTxt, "utf-8");
writeFileSync(resolve(root, "llms-full.txt"), llmsFull, "utf-8");
console.log(
  `  ✅ llms.txt (${llmsTxt.length} chars) / llms-full.txt (${llmsFull.length} chars) を生成`
);
