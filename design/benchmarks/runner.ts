/**
 * runner.ts — melta UI ベンチマーク runner（P1-4: 条件分離 × N トライアル）
 *
 * 「melta を AI に読ませると DS 準拠スコアが何点上がるか」を、各層の限界寄与
 * （lift）に分解して測る。共通 lint core（score.ts = check_html と同一採点）で
 * 採点し、mean ± 95%CI と条件間 lift を出す。
 *
 * 条件（各層を 1 つずつ足して寄与を分離する）:
 *   cold      : DS コンテキスト無し（素の LLM。melta を一切示さない真のベースライン）
 *   designmd  : DESIGN.md のみ（静的・tools 無し）
 *   contracts : DESIGN.md + contracts 要約（静的・tools 無し）
 *   full      : 上記 + MCP tools（生成後 check_html で自己検証）← 実際の melta workflow
 *
 * ⚠️ full だけ多ターンの自己検証が入るため、contracts→full の lift は
 * 「contracts 単体」ではなく「MCP workflow（自己検証含む）」の寄与。report に明記する。
 * スコアは DS 準拠の proxy であり、見た目の美しさそのものではない。
 *
 * 使い方:
 *   tsx design/benchmarks/runner.ts                       # anthropic / 全 prompt / 全条件 / trials=3
 *   tsx design/benchmarks/runner.ts --trials 5
 *   tsx design/benchmarks/runner.ts --prompt 1 --conditions cold,full
 *   tsx design/benchmarks/runner.ts --provider mock        # API 不要のパイプライン検証
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelProvider, GenerationResult } from "../../src/utils/types.js";
import { prompts as benchmarkPrompts, type BenchmarkPrompt } from "./prompts.js";
import { scoreHTML, type Score } from "./score.js";
import { summarize, computeLift, formatSummary, formatLift, type Summary } from "./stats.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenAIProvider } from "./providers/openai.js";
import { createMockProvider } from "./providers/mock.js";
import {
  buildProvenance,
  getGitInfo,
  hashFile,
  digestFiles,
  readGenerationProvenance,
  sha256,
  type Provenance,
} from "./provenance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const resultsDir = resolve(__dirname, "results");
const historyPath = resolve(__dirname, "history.json");

const CONDITION_IDS = ["cold", "designmd", "contracts", "full"] as const;
type ConditionId = (typeof CONDITION_IDS)[number];

// ---------- 純粋な集計・レポート（テストから import するため副作用なし） ----------

export interface Condition {
  id: ConditionId;
  label: string;
  context: string;
  useTools: boolean;
}

export interface Trial {
  score: Score;
  toolCalls: number;
  resources: string[];
  htmlPath: string;
}
export interface Cell {
  promptId: string;
  conditionId: ConditionId;
  attempted: number;
  failed: number;
  trials: Trial[];
  summary: Summary; // trial 分布
}

/** 指定 prompt 群の各 prompt で「条件の trial 平均」を出し、prompt 等重みで集約する */
export function aggregateByCondition(
  cells: Cell[],
  conditionId: ConditionId,
  promptIds: string[]
): Summary {
  const perPromptMeans: number[] = [];
  for (const pid of promptIds) {
    const cell = cells.find((c) => c.promptId === pid && c.conditionId === conditionId);
    if (cell && cell.summary.n > 0) perPromptMeans.push(cell.summary.mean);
  }
  return summarize(perPromptMeans);
}

export interface ReportInput {
  cells: Cell[];
  conditions: Condition[];
  prompts: BenchmarkPrompt[];
  isoDate: string;
  providerId: string;
  modelName: string | null;
  trials: number;
  /** 計測来歴（施策6A）。省略可（旧テスト互換）だが CLI 実行では必ず渡す */
  provenance?: Provenance;
}

export function buildReport(input: ReportInput): {
  report: string;
  groups: Record<string, Record<ConditionId, Summary>>;
} {
  const { cells, conditions, prompts, isoDate, providerId, modelName, trials, provenance } = input;
  const standardIds = prompts.filter((p) => !p.isRedTeam).map((p) => p.id);
  const redTeamIds = prompts.filter((p) => p.isRedTeam).map((p) => p.id);
  const allIds = prompts.map((p) => p.id);

  const groupDefs: Array<{ key: string; label: string; ids: string[] }> = [
    { key: "all", label: `全 ${allIds.length} prompt`, ids: allIds },
  ];
  if (standardIds.length && redTeamIds.length) {
    groupDefs.push(
      { key: "standard", label: `standard ${standardIds.length}`, ids: standardIds },
      { key: "redteam", label: `red-team ${redTeamIds.length}`, ids: redTeamIds }
    );
  }

  const groups: Record<string, Record<ConditionId, Summary>> = {};
  for (const g of groupDefs) {
    groups[g.key] = {} as Record<ConditionId, Summary>;
    for (const cond of conditions) {
      groups[g.key][cond.id] = aggregateByCondition(cells, cond.id, g.ids);
    }
  }

  const totalFailed = cells.reduce((a, c) => a + c.failed, 0);
  const totalAttempted = cells.reduce((a, c) => a + c.attempted, 0);

  let report = `# melta UI Benchmark — 条件別 DS 準拠スコア\n\n`;
  report += `**日時**: ${isoDate}\n`;
  report += `**Provider**: ${providerId}${modelName ? ` (${modelName})` : ""}\n`;
  if (provenance) {
    const g = provenance.git;
    const commitStr = g.commit
      ? `${g.commit.slice(0, 7)}${g.dirty ? ` (dirty: ${g.dirtyFiles.length} files)` : ""}`
      : "(git 情報なし)";
    report += `**Commit**: ${commitStr}\n`;
    if (provenance.mode === "score-dir") {
      report += provenance.generation
        ? `**生成元**: ${provenance.generation.date} / ${provenance.generation.provider.id}${provenance.generation.provider.model ? ` (${provenance.generation.provider.model})` : ""} / commit ${provenance.generation.git.commit?.slice(0, 7) ?? "不明"}\n`
        : `**生成元**: provenance 不明（score-dir に provenance.json が無い。生成時の model / commit は復元不能）\n`;
    }
  }
  report += `**Trials/cell**: ${trials}（試行 ${totalAttempted} / 失敗 ${totalFailed}）\n`;
  report += `**Prompts**: ${allIds.join(", ")}\n`;
  report += `**採点**: 共通 lint core による DS 準拠 proxy（error -10 / warn -3、base 50 + 準拠シグナル +5）。見た目の美しさそのものではない。\n`;
  report += `**集約**: prompt 等重み（各 prompt の trial 平均を取り、prompt 間で平均）。CI/σ は prompt 間ばらつき。\n\n`;

  // 注記（交絡の明示）
  report += `> **条件の読み方**: cold→designmd→contracts は静的コンテキスト量の差。contracts→full は MCP tools + 生成後の \`check_html\` 自己検証を含む（= 実際の melta workflow）。full の上振れには自己修正の寄与が含まれる。\n\n`;

  for (const g of groupDefs) {
    const base = conditions[0];
    const baseMean = groups[g.key][base.id]?.mean ?? 0;
    report += `## ${g.label}\n\n`;
    report += `| 条件 | スコア (mean ±95%CI, range, σ, n=prompt数) | ${base.id} 比 |\n`;
    report += `|------|------|------|\n`;
    for (const cond of conditions) {
      const s = groups[g.key][cond.id];
      const liftStr =
        cond.id === base.id ? "—（基準）" : formatLift(computeLift(baseMean, s.mean));
      report += `| **${cond.id}** (${cond.label}) | ${formatSummary(s)} | ${liftStr} |\n`;
    }
    report += `\n`;
    if (conditions.length >= 2) {
      report += `限界寄与: `;
      const parts: string[] = [];
      for (let i = 1; i < conditions.length; i++) {
        const from = conditions[i - 1];
        const to = conditions[i];
        parts.push(
          `${from.id}→${to.id} ${formatLift(computeLift(groups[g.key][from.id].mean, groups[g.key][to.id].mean))}`
        );
      }
      report += parts.join(" / ") + "\n\n";
    }
  }

  // prompt 別内訳（trial 分布）
  report += `## Prompt 別内訳（trial 分布）\n\n`;
  report += `| Prompt | ${conditions.map((c) => c.id).join(" | ")} |\n`;
  report += `|--------|${conditions.map(() => "----").join("|")}|\n`;
  for (const p of prompts) {
    const row = conditions.map((cond) => {
      const cell = cells.find((c) => c.promptId === p.id && c.conditionId === cond.id);
      if (!cell || cell.summary.n === 0) return "—";
      const fail = cell.failed > 0 ? ` ✗${cell.failed}` : "";
      return formatSummary(cell.summary) + fail;
    });
    report += `| ${p.id}: ${p.name}${p.isRedTeam ? " 🔴" : ""} | ${row.join(" | ")} |\n`;
  }
  report += `\n`;

  // full の tool 活用（score-dir モードは生成時の tool 呼び出しを記録しないので集計が
  // 全て 0 になる。誤解を招くため、tool データがある時のみ出す）
  const fullCells = cells.filter((c) => c.conditionId === "full");
  const allFullTrials = fullCells.flatMap((c) => c.trials);
  const totalToolCalls = allFullTrials.reduce((a, t) => a + t.toolCalls, 0);
  if (fullCells.length > 0 && totalToolCalls > 0) {
    report += `## full 条件の MCP tool 活用\n\n`;
    report += `- 平均 tool 呼び出し/生成: ${(totalToolCalls / allFullTrials.length).toFixed(1)}\n`;
    const resources = new Set(allFullTrials.flatMap((t) => t.resources));
    report += `- 参照リソース: ${resources.size > 0 ? [...resources].join(", ") : "(なし)"}\n\n`;
  } else if (fullCells.length > 0 && providerId === "score-dir") {
    report += `> （tool 使用統計は生成時に記録され、score-dir 採点モードには持ち込まれない）\n\n`;
  }

  return { report, groups };
}

// ---------- CLI（副作用あり。import 時には実行しない） ----------

function getArg(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

function getDesignMd(): string {
  return readFileSync(resolve(root, "DESIGN.md"), "utf-8");
}

function getContractSummary(): string {
  return ["button", "card", "table"]
    .map((id) => {
      const path = resolve(root, `design/contracts/components/${id}.contract.json`);
      if (!existsSync(path)) return "";
      const c = JSON.parse(readFileSync(path, "utf-8"));
      return `### ${c.name} Contract (要約)\nVariants: ${Object.keys(c.variants).join(
        ", "
      )}\nRules: ${c.rules.map((r: { id: string }) => r.id).join(", ")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildConditions(filter: string[]): Condition[] {
  const designMd = getDesignMd();
  const withContracts = `${designMd}\n\n---\n\n## Component Contracts（参考）\n\n${getContractSummary()}`;
  const all: Condition[] = [
    { id: "cold", label: "No DS context", context: "", useTools: false },
    { id: "designmd", label: "DESIGN.md only", context: designMd, useTools: false },
    { id: "contracts", label: "DESIGN.md + contracts", context: withContracts, useTools: false },
    { id: "full", label: "+ MCP tools (self-verify)", context: withContracts, useTools: true },
  ];
  if (filter.length === 0) return all;
  return all.filter((c) => filter.includes(c.id));
}

function buildSystem(condition: Condition): string {
  if (condition.id === "cold") {
    return "あなたは UI を生成するエキスパートです。指示に従い、単一の HTML ファイル（Tailwind CDN 使用）として完結する UI を生成してください。";
  }
  const toolNote = condition.useTools
    ? "不明な点は提供されたツール（get_token / get_component / check_rule / check_html / get_rules / search）で確認し、生成後は check_html で自己検証してから提示してください。\n\n"
    : "";
  return `あなたは melta UI デザインシステムに準拠した UI を生成するエキスパートです。
以下のデザインシステム仕様を必ず遵守してください。
${toolNote}${condition.context}`;
}

async function runCell(
  prompt: BenchmarkPrompt,
  condition: Condition,
  provider: ModelProvider,
  runDir: string,
  trials: number,
  temperature: number | undefined
): Promise<Cell> {
  const scores: number[] = [];
  const trialResults: Trial[] = [];
  let failed = 0;

  for (let t = 0; t < trials; t++) {
    const suffix = trials > 1 ? `-t${t}` : "";
    const htmlPath = resolve(runDir, `${prompt.id}-${condition.id}${suffix}.html`);
    let result: GenerationResult;
    try {
      result = await provider.generate(buildSystem(condition), prompt.prompt, {
        useTools: condition.useTools,
        temperature,
      });
    } catch (err) {
      console.error(`    ✗ ${prompt.id}/${condition.id} t${t} 失敗: ${(err as Error).message}`);
      failed++;
      continue;
    }
    writeFileSync(htmlPath, result.text, "utf-8");
    const score = scoreHTML(result.text);
    scores.push(score.totalScore);
    trialResults.push({
      score,
      toolCalls: (result.toolCalls ?? []).length,
      resources: result.resourcesAccessed ?? [],
      htmlPath,
    });
  }

  return {
    promptId: prompt.id,
    conditionId: condition.id,
    attempted: trials,
    failed,
    trials: trialResults,
    summary: summarize(scores),
  };
}

/**
 * 生成済み HTML を採点するだけのセル（--score-dir モード）。
 * サブエージェント等で先に生成した `<dir>/<promptId>-<conditionId>-t<k>.html` を
 * 共通 lint core で採点する。ファイル欠落は失敗 trial として扱う。
 */
function scoreCell(
  prompt: BenchmarkPrompt,
  condition: Condition,
  scoreDir: string,
  trials: number
): Cell {
  const scores: number[] = [];
  const trialResults: Trial[] = [];
  let failed = 0;

  for (let t = 0; t < trials; t++) {
    const suffix = trials > 1 ? `-t${t}` : "";
    const htmlPath = resolve(scoreDir, `${prompt.id}-${condition.id}${suffix}.html`);
    if (!existsSync(htmlPath)) {
      failed++;
      continue;
    }
    let html: string;
    try {
      html = readFileSync(htmlPath, "utf-8");
    } catch {
      failed++;
      continue;
    }
    if (html.trim().length === 0) {
      failed++;
      continue;
    }
    const score = scoreHTML(html);
    scores.push(score.totalScore);
    trialResults.push({ score, toolCalls: 0, resources: [], htmlPath });
  }

  return {
    promptId: prompt.id,
    conditionId: condition.id,
    attempted: trials,
    failed,
    trials: trialResults,
    summary: summarize(scores),
  };
}

interface HistoryRecord {
  date: string;
  provider: string;
  model: string | null;
  trials: number;
  temperature: number | null;
  prompts: string[];
  failed: number;
  baselineCondition: ConditionId;
  byCondition: Record<string, { mean: number; ci95: number | null; min: number; max: number; n: number }>;
  liftVsBaseline: Record<string, number>;
  // --- 計測来歴（施策6A, 2026-07 追加。旧エントリは欠落のまま = 任意フィールド） ---
  // results/ は gitignore のため、git に残る来歴の正本はこの要約。
  git?: Provenance["git"];
  inputHashes?: Provenance["inputHashes"];
  cli?: string[];
  /** score-dir 実行時の生成元来歴（provenance.json から引き継ぎ。無ければ null を明示記録） */
  generation?: Provenance["generation"];
}

function appendHistory(record: HistoryRecord): void {
  let history: HistoryRecord[] = [];
  if (existsSync(historyPath)) {
    // parse 失敗を空配列で握りつぶすと既存 history を消すため fail-fast にする
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
    if (!Array.isArray(history)) {
      throw new Error(`history.json が配列ではありません: ${historyPath}`);
    }
  }
  history.push(record);
  // temp file + rename で atomic に（途中クラッシュで履歴を破損させない）
  const tmp = `${historyPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(history, null, 2) + "\n", "utf-8");
  renameSync(tmp, historyPath);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providerId = (getArg(args, "--provider") ?? "anthropic") as "anthropic" | "openai" | "mock";
  const modelName = getArg(args, "--model") ?? "claude-sonnet-4-20250514";
  const promptFilter = getArg(args, "--prompt") ?? null;
  const conditionFilter = (getArg(args, "--conditions") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const temperature = getArg(args, "--temperature") ? parseFloat(getArg(args, "--temperature")!) : undefined;
  const writeHistory = !args.includes("--no-history");
  // 生成済み HTML を採点するだけのモード（サブエージェント生成 → オフライン採点）。
  // メーター API を使わずに実数値を得る経路。
  const scoreDir = getArg(args, "--score-dir") ?? null;

  // --trials の検証（NaN / <1 を素通りさせない）
  const trialsRaw = getArg(args, "--trials") ?? "3";
  const trials = parseInt(trialsRaw, 10);
  if (!Number.isInteger(trials) || trials < 1) {
    console.error(`--trials は 1 以上の整数を指定してください（受領: "${trialsRaw}"）`);
    process.exit(2);
  }

  // --conditions の検証（未知 id を silent 無視しない）
  const unknown = conditionFilter.filter((c) => !CONDITION_IDS.includes(c as ConditionId));
  if (unknown.length > 0) {
    console.error(`未知の条件: ${unknown.join(", ")}（有効: ${CONDITION_IDS.join(", ")}）`);
    process.exit(2);
  }

  const effectiveProvider = scoreDir ? "score-dir" : providerId;
  console.log("\n=== melta UI Benchmark（条件別 DS 準拠スコア）===\n");
  console.log(`  provider: ${effectiveProvider}, trials/cell: ${trials}, temperature: ${temperature ?? "(provider 既定)"}`);

  const isoDate = new Date().toISOString();
  // runDir は日時分秒まで含める（同日再実行・mock 検証実行が過去 run を上書きしないように。施策6A）
  const runDir = resolve(
    resultsDir,
    `${isoDate.slice(0, 10)}-${isoDate.slice(11, 19).replace(/:/g, "")}`
  );
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });

  const targetPrompts = promptFilter
    ? benchmarkPrompts.filter((p) => p.id === promptFilter)
    : benchmarkPrompts;
  if (targetPrompts.length === 0) {
    console.error(`Prompt "${promptFilter}" が見つかりません`);
    process.exit(1);
  }

  const conditions = buildConditions(conditionFilter);
  for (const c of conditions) {
    console.log(`  条件 ${c.id}: ${(c.context.length / 1024).toFixed(1)}KB, tools=${c.useTools}`);
  }

  const cells: Cell[] = [];

  if (scoreDir) {
    // 生成済み HTML を採点するだけ（メーター API 不使用）
    const absScoreDir = resolve(scoreDir);
    if (!existsSync(absScoreDir)) {
      console.error(`--score-dir が見つかりません: ${absScoreDir}`);
      process.exit(1);
    }
    console.log(`  score-dir: ${absScoreDir}`);
    for (const prompt of targetPrompts) {
      for (const cond of conditions) {
        const cell = scoreCell(prompt, cond, absScoreDir, trials);
        cells.push(cell);
      }
    }
  } else {
    const provider =
      providerId === "mock"
        ? createMockProvider()
        : providerId === "openai"
          ? createOpenAIProvider({ model: modelName })
          : createAnthropicProvider({ model: modelName });

    for (const prompt of targetPrompts) {
      console.log(`\n--- Prompt ${prompt.id}: ${prompt.name} ---`);
      for (const cond of conditions) {
        process.stdout.write(`  [${cond.id}] ${trials} trials... `);
        const cell = await runCell(prompt, cond, provider, runDir, trials, temperature);
        console.log(formatSummary(cell.summary) + (cell.failed > 0 ? ` (✗${cell.failed})` : ""));
        cells.push(cell);
      }
    }
  }

  // 実効 model の記録: score-dir は生成しない（generation 側に残る）、mock は無意味なので null。
  // それ以外（anthropic / 将来の openai 実装）は CLI 指定の model を記録する
  const recordedModel = scoreDir || providerId === "mock" ? null : modelName;

  // --- 計測来歴の組み立て（施策6A）---
  const scoredPaths = cells.flatMap((c) => c.trials.map((t) => t.htmlPath));
  const provenance = buildProvenance({
    date: isoDate,
    mode: scoreDir ? "score-dir" : "generate",
    git: getGitInfo(root),
    // 実際に送る組み立て済み context を hash（DESIGN.md・埋め込み contracts の変化を自動で拾う）
    contextHashes: Object.fromEntries(conditions.map((c) => [c.id, sha256(c.context)])),
    fileHashes: Object.fromEntries(
      [
        "design/benchmarks/prompts.ts",
        "design/contracts/rules.json", // scorer（共通 lint core）の入力
      ].map((p) => [p, hashFile(resolve(root, p)) ?? "(missing)"])
    ),
    scoredFilesDigest: scoreDir ? digestFiles(scoredPaths) : null,
    provider: {
      id: effectiveProvider,
      model: recordedModel,
      temperature: temperature ?? null,
      temperatureSource: temperature != null ? "cli" : "provider-default",
      trials,
    },
    prompts: targetPrompts.map((p) => p.id),
    conditions: conditions.map((c) => c.id),
    cli: args,
    generation: scoreDir ? readGenerationProvenance(resolve(scoreDir)) : null,
  });
  const provenancePath = resolve(runDir, "provenance.json");
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n", "utf-8");

  const { report, groups } = buildReport({
    cells,
    conditions,
    prompts: targetPrompts,
    isoDate,
    providerId: effectiveProvider,
    modelName: recordedModel,
    trials,
    provenance,
  });
  const reportPath = resolve(runDir, "report.md");
  writeFileSync(reportPath, report, "utf-8");

  // コンソール要約（all group）
  console.log("\n=== 条件別スコア（全 prompt 等重み）===\n");
  const base = conditions[0];
  const baseMean = groups.all[base.id]?.mean ?? 0;
  for (const cond of conditions) {
    const s = groups.all[cond.id];
    const lift = cond.id === base.id ? "（基準）" : formatLift(computeLift(baseMean, s.mean));
    console.log(`  ${cond.id.padEnd(10)} ${formatSummary(s)}  ${lift}`);
  }

  // mock はパイプライン検証なので history を汚さない。score-dir / anthropic は実データ
  if (writeHistory && effectiveProvider !== "mock") {
    const liftVsBaseline: Record<string, number> = {};
    for (const cond of conditions) {
      liftVsBaseline[cond.id] = +(groups.all[cond.id].mean - baseMean).toFixed(1);
    }
    appendHistory({
      date: isoDate,
      provider: effectiveProvider,
      model: recordedModel,
      trials,
      temperature: temperature ?? null,
      prompts: targetPrompts.map((p) => p.id),
      failed: cells.reduce((a, c) => a + c.failed, 0),
      baselineCondition: base.id,
      byCondition: Object.fromEntries(
        conditions.map((c) => [
          c.id,
          {
            mean: +groups.all[c.id].mean.toFixed(1),
            ci95: groups.all[c.id].ci95 == null ? null : +groups.all[c.id].ci95!.toFixed(1),
            min: +groups.all[c.id].min.toFixed(1),
            max: +groups.all[c.id].max.toFixed(1),
            n: groups.all[c.id].n,
          },
        ])
      ),
      liftVsBaseline,
      git: provenance.git,
      inputHashes: provenance.inputHashes,
      cli: provenance.cli,
      generation: provenance.generation,
    });
    console.log(`\n  history: ${historyPath.replace(root + "/", "")} に追記`);
  }
  console.log(`  provenance: ${provenancePath.replace(root + "/", "")}`);
  console.log(`  レポート: ${reportPath.replace(root + "/", "")}`);
}

// CLI として実行されたときだけ main() を走らせる（test から import しても副作用なし）
const invokedDirectly =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
