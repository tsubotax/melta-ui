/**
 * run.ts — shadow judge の CLI（PR1 / observation only）
 *
 *   tsx design/judge/run.ts --file <html> --provider anthropic|mock \
 *     [--drop-rule <ID>]... [--targets <ID,...>] [--trials N] [--model <id>] \
 *     [--negative-control --expect fail|pass [--expect-map '{"<ID>":"fail"}']]
 *
 * 位置づけ:
 *   - judge の fail 判定は CI を落とさない。exit code が非 0 になるのは実装障害と
 *     invalid（検証器が出力を拒否）だけ
 *   - proposal（不足ルール候補）は非 authoritative。rules.json へは人間が別 PR で反映する
 *   - 各 run は .melta-loop/runs.jsonl に監査レコードを 1 行残す（playbook の Audit Log）
 *
 * --targets は drop と集計の対象を選ぶだけ。LLM への入力（aspect 全件 + human-only の
 * 決定論付加）と検証器の「全 aspect ちょうど 1 回」は常に全件で、母集団を絞る口は置かない。
 *
 * 陰性対照は target ごとに **期待 verdict を宣言させる**。宣言が無いと「with-rule で pass、
 * without-rule で missing-rule」でも両方が成功に数えられ、「X あり → fail@X」を証明できない。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelProvider, RuleEntry, RulesFile } from "../../src/utils/types.js";
import { getGitInfo, type GitInfo } from "../benchmarks/provenance.js";
import {
  DEFAULT_JUDGE_MODEL,
  JUDGE_PROTOCOL_VERSION,
  JUDGE_PROVIDER_IDS,
  JUDGE_TEMPERATURE,
  JUDGE_TOOLS_ENABLED,
  TEMPERATURE_UNSUPPORTED_MODELS,
  createAnthropicJudgeProvider,
  modelRejectsTemperature,
  runJudgeTrial,
  sha256,
  type JudgeProviderId,
  type JudgeRunResult,
} from "./adapter.js";
import { MOCK_FIXTURE_BANNER, createJudgeMockProvider } from "./providers/judge-mock.js";
import type { JudgeAspect, JudgeVerdict } from "./schema.js";
import { loadAspectsFile } from "./validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const resultsDir = resolve(__dirname, "results");
const historyPath = resolve(__dirname, "history.json");
const auditLogPath = resolve(root, ".melta-loop/runs.jsonl");
const rulesPath = resolve(root, "design/contracts/rules.json");

// ---------- 純関数（テストから import するため副作用なし） ----------

export type ExclusionReason = "sibling" | "not-observable-static" | "human-only";

export interface ExcludedAspect {
  aspectId: string;
  reason: ExclusionReason;
}

/**
 * 陰性対照の対象外 aspect と理由。
 * 兄弟ルールを持つ aspect は「X を抜いても兄弟が同じ欠陥を拾う」ので abstain の証拠として弱い。
 */
export function excludedFromNegativeControl(aspects: JudgeAspect[]): ExcludedAspect[] {
  const out: ExcludedAspect[] = [];
  for (const a of aspects) {
    if (a.automationStatus === "human-only") {
      out.push({ aspectId: a.aspectId, reason: "human-only" });
    } else if (a.staticObservability !== "yes") {
      out.push({ aspectId: a.aspectId, reason: "not-observable-static" });
    } else if (a.siblings.length > 0) {
      out.push({ aspectId: a.aspectId, reason: "sibling" });
    }
  }
  return out;
}

export function eligibleNegativeControlAspects(aspects: JudgeAspect[]): string[] {
  const excluded = new Set(excludedFromNegativeControl(aspects).map((e) => e.aspectId));
  return aspects.filter((a) => !excluded.has(a.aspectId)).map((a) => a.aspectId);
}

export type NegativeControlCondition = "with-rule" | "without-rule";

/** with-rule 側で宣言する期待 verdict。without-rule 側は常に missing-rule */
export type ExpectedVerdict = "fail" | "pass";

/** trial 1 件に紐づく期待値。null は「期待を宣言していない」= 集計対象外 */
export type TrialExpectation = ExpectedVerdict | "missing-rule" | null;

// ---------- CLI 引数の解析（純関数） ----------

export interface JudgeCliOptions {
  filePath: string;
  provider: JudgeProviderId;
  model: string;
  trials: number;
  negativeControl: boolean;
  dropRuleIds: string[];
  /** 解決済みの対象。--negative-control で未指定なら representativeAspects */
  targets: string[];
  /** target → with-rule 側の期待 verdict。--negative-control のときだけ非空 */
  expectByTarget: Record<string, ExpectedVerdict>;
  /** provenance に残す生の argv。parseJudgeArgs は埋めず、呼び出し側が足す */
  cli?: string[];
}

export interface JudgeCliContext {
  aspectIds: string[];
  knownRuleIds: string[];
  representativeAspects: string[];
}

export type ParseJudgeArgsResult =
  | { ok: true; options: JudgeCliOptions }
  | { ok: false; error: string };

export const USAGE = `使い方:
  tsx design/judge/run.ts --file <html> --provider anthropic|mock \\
    [--drop-rule <ID>]... [--targets <ID,...>] [--trials N] [--model <id>] \\
    [--negative-control --expect fail|pass [--expect-map '{"<ID>":"fail"}']]`;

function getArg(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function getRepeatedArg(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) out.push(args[i + 1]);
  }
  return out;
}

function isExpectedVerdict(v: unknown): v is ExpectedVerdict {
  return v === "fail" || v === "pass";
}

/** CLI 引数を検証済みオプションに変換する。IO はしないのでテストから直接呼べる */
export function parseJudgeArgs(args: string[], ctx: JudgeCliContext): ParseJudgeArgsResult {
  const fail = (error: string): ParseJudgeArgsResult => ({ ok: false, error });

  const filePath = getArg(args, "--file");
  if (filePath == null) return fail("--file は必須です");

  const provider = getArg(args, "--provider");
  if (provider == null || !JUDGE_PROVIDER_IDS.includes(provider as JudgeProviderId)) {
    return fail(`--provider は ${JUDGE_PROVIDER_IDS.join(" | ")} のいずれかです（受領: ${provider ?? "(なし)"}）`);
  }

  const trialsRaw = getArg(args, "--trials") ?? "1";
  const trials = parseInt(trialsRaw, 10);
  if (!Number.isInteger(trials) || trials < 1) {
    return fail(`--trials は 1 以上の整数です（受領: "${trialsRaw}"）`);
  }

  const model = getArg(args, "--model") ?? DEFAULT_JUDGE_MODEL;
  // judge は temperature: 0 を固定で渡すので、temperature 非対応モデルは起動前に落とす
  if (modelRejectsTemperature(model)) {
    return fail(
      `--model ${model} は temperature を受け付けません（judge は temperature=${JUDGE_TEMPERATURE} を固定で渡します）。` +
        `非対応: ${TEMPERATURE_UNSUPPORTED_MODELS.join(", ")}`
    );
  }

  const dropRuleIds = getRepeatedArg(args, "--drop-rule");
  const unknownDrops = dropRuleIds.filter((id) => !ctx.knownRuleIds.includes(id));
  if (unknownDrops.length > 0) return fail(`未知の --drop-rule: ${unknownDrops.join(", ")}`);

  const negativeControl = args.includes("--negative-control");
  // オプションの「有無」と「値」を区別する。--targets "" を未指定扱いにすると、
  // 空文字が既定の代表 aspect へ黙って展開されて、指定したつもりの母集団とズレる
  const targetsProvided = args.includes("--targets");
  const targetsRaw = getArg(args, "--targets");
  const targets = targetsProvided
    ? (targetsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : negativeControl
      ? [...ctx.representativeAspects]
      : [];
  if (targetsProvided && targets.length === 0) {
    return fail(`--targets に aspect ID がありません（受領: "${targetsRaw ?? ""}"）`);
  }
  if (negativeControl && targets.length === 0) {
    return fail("--negative-control の対象 aspect が 0 件です");
  }
  // 重複は黙って dedupe しない。集計の母数と artifact のファイル名が暗黙に変わるため
  const duplicateTargets = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (duplicateTargets.length > 0) {
    return fail(`--targets に重複があります: ${[...new Set(duplicateTargets)].join(", ")}`);
  }
  const unknownTargets = targets.filter((t) => !ctx.aspectIds.includes(t));
  if (unknownTargets.length > 0) return fail(`未知の --targets: ${unknownTargets.join(", ")}`);

  const expectRaw = getArg(args, "--expect");
  const expectMapRaw = getArg(args, "--expect-map");

  if (!negativeControl) {
    if (expectRaw != null || expectMapRaw != null) {
      return fail("--expect / --expect-map は --negative-control と一緒にだけ指定できます");
    }
    return {
      ok: true,
      options: { filePath, provider: provider as JudgeProviderId, model, trials, negativeControl, dropRuleIds, targets, expectByTarget: {} },
    };
  }

  if (expectRaw == null && expectMapRaw == null) {
    return fail(
      "--negative-control には期待 verdict の宣言が必要です。--expect fail|pass か --expect-map '{\"<ID>\":\"fail\"}' を指定してください"
    );
  }
  if (expectRaw != null && !isExpectedVerdict(expectRaw)) {
    return fail(`--expect は fail か pass です（受領: "${expectRaw}"）`);
  }

  let expectMap: Record<string, unknown> = {};
  if (expectMapRaw != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(expectMapRaw);
    } catch {
      return fail(`--expect-map が JSON として読めません: ${expectMapRaw}`);
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail("--expect-map は { \"<aspectId>\": \"fail\"|\"pass\" } の object です");
    }
    expectMap = parsed as Record<string, unknown>;
    const unknownKeys = Object.keys(expectMap).filter((k) => !targets.includes(k));
    if (unknownKeys.length > 0) {
      return fail(`--expect-map に --targets 外のキーがあります: ${unknownKeys.join(", ")}`);
    }
    const badValues = Object.entries(expectMap).filter(([, v]) => !isExpectedVerdict(v));
    if (badValues.length > 0) {
      return fail(`--expect-map の値は fail か pass です: ${badValues.map(([k]) => k).join(", ")}`);
    }
  }

  const expectByTarget: Record<string, ExpectedVerdict> = {};
  const missingExpectation: string[] = [];
  for (const t of targets) {
    const v = expectMap[t] ?? expectRaw;
    if (!isExpectedVerdict(v)) {
      missingExpectation.push(t);
      continue;
    }
    expectByTarget[t] = v;
  }
  if (missingExpectation.length > 0) {
    return fail(`期待 verdict が宣言されていない target があります: ${missingExpectation.join(", ")}`);
  }

  return {
    ok: true,
    options: { filePath, provider: provider as JudgeProviderId, model, trials, negativeControl, dropRuleIds, targets, expectByTarget },
  };
}

// ---------- 実行計画（純関数） ----------

export interface PlanStep {
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
  dropRuleIds: string[];
  expectedVerdict: TrialExpectation;
}

/**
 * 実行計画。--targets は「どの aspect のルールを抜くか」と「どう集計するか」だけを決める。
 * どのステップでも runJudgeTrial には aspect 全件を渡す（この関数は母集団を持たない）。
 */
export function buildExecutionPlan(options: JudgeCliOptions, aspects: JudgeAspect[]): PlanStep[] {
  const steps: PlanStep[] = [];
  if (options.negativeControl) {
    for (const target of options.targets) {
      const aspect = aspects.find((a) => a.aspectId === target);
      if (aspect == null) continue;
      for (let t = 1; t <= options.trials; t++) {
        steps.push({
          targetAspectId: target,
          condition: "with-rule",
          trial: t,
          dropRuleIds: [...options.dropRuleIds],
          expectedVerdict: options.expectByTarget[target],
        });
      }
      for (let t = 1; t <= options.trials; t++) {
        steps.push({
          targetAspectId: target,
          condition: "without-rule",
          trial: t,
          dropRuleIds: [...options.dropRuleIds, ...aspect.ruleIds],
          expectedVerdict: "missing-rule",
        });
      }
    }
    return steps;
  }

  const target = options.targets[0] ?? aspects[0].aspectId;
  for (let t = 1; t <= options.trials; t++) {
    steps.push({
      targetAspectId: target,
      condition: options.dropRuleIds.length > 0 ? "without-rule" : "with-rule",
      trial: t,
      dropRuleIds: [...options.dropRuleIds],
      expectedVerdict: null, // 陰性対照でない run は期待値を主張しない
    });
  }
  return steps;
}

// ---------- 集計（純関数） ----------

export interface TrialRecord {
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
  droppedRuleIds: string[];
  expectedVerdict: TrialExpectation;
  verdict: JudgeVerdict["verdict"] | null;
  reason: string | null;
  ruleId: string | null;
  valid: boolean;
  invalidCodes: string[];
  /** 幻覚引用（供給集合外 / aspect 外の ruleId）の件数 */
  hallucinatedCitations: number;
  rawSha256: string;
  systemSha256: string;
  promptSha256: string;
  suppliedRuleSetHash: string;
  treatmentHash: string;
}

export interface ConditionSummary {
  condition: NegativeControlCondition;
  trials: number;
  /** 期待 verdict を宣言している trial 数。分母はここ */
  expectationDeclared: number;
  expectedVerdictMatches: number;
  hallucinatedCitations: number;
  invalid: number;
}

const HALLUCINATION_CODES = new Set(["rule-id-not-supplied", "rule-id-not-in-aspect"]);

/**
 * 期待と一致したか。null は「期待を宣言していない」で、集計の分母にも分子にも入れない。
 *
 * with-rule 側は verdict の一致だけでなく **target 自身の ruleId を引用していること**まで見る。
 * 「評価された」を成功にすると、違反 fixture で pass が返っても成功に数えられ、
 * 「X あり → fail@X / X なし → not-evaluable」の遷移表が偽陽性になる。
 */
export function matchesExpectation(record: TrialRecord): boolean | null {
  if (record.expectedVerdict == null) return null;
  if (!record.valid) return false;
  if (record.expectedVerdict === "missing-rule") {
    return record.verdict === "not-evaluable" && record.reason === "missing-rule";
  }
  return record.verdict === record.expectedVerdict && record.ruleId === record.targetAspectId;
}

export function summarizeByCondition(records: TrialRecord[]): ConditionSummary[] {
  const conditions: NegativeControlCondition[] = ["with-rule", "without-rule"];
  return conditions
    .map((condition) => {
      const rows = records.filter((r) => r.condition === condition);
      const judged = rows.map((r) => matchesExpectation(r));
      return {
        condition,
        trials: rows.length,
        expectationDeclared: judged.filter((v) => v !== null).length,
        expectedVerdictMatches: judged.filter((v) => v === true).length,
        hallucinatedCitations: rows.reduce((a, r) => a + r.hallucinatedCitations, 0),
        invalid: rows.filter((r) => !r.valid).length,
      };
    })
    .filter((s) => s.trials > 0);
}

export function toTrialRecord(args: { result: JudgeRunResult; step: PlanStep }): TrialRecord {
  const { result, step } = args;
  const verdict = result.validation.verdicts.find((v) => v.aspectId === step.targetAspectId);
  return {
    targetAspectId: step.targetAspectId,
    condition: step.condition,
    trial: step.trial,
    droppedRuleIds: result.inputs.droppedRuleIds,
    expectedVerdict: step.expectedVerdict,
    verdict: verdict?.verdict ?? null,
    reason: verdict != null && verdict.verdict === "not-evaluable" ? verdict.reason : null,
    ruleId: verdict != null && "ruleId" in verdict ? verdict.ruleId : null,
    valid: result.validation.valid,
    invalidCodes: result.validation.reasons.map((r) => r.code),
    // 1 件の幻覚引用が rule-id-not-supplied と rule-id-not-in-aspect の 2 コードを出すので、
    // reason 数ではなく aspect（= verdict）単位で一意に数える。reason 数だと実測が倍に膨らむ
    hallucinatedCitations: new Set(
      result.validation.reasons
        .filter((r) => HALLUCINATION_CODES.has(r.code) && r.aspectId != null)
        .map((r) => r.aspectId as string)
    ).size,
    rawSha256: result.rawHash,
    systemSha256: result.systemHash,
    promptSha256: result.promptHash,
    suppliedRuleSetHash: result.suppliedRuleSetHash,
    treatmentHash: result.treatmentHash,
  };
}

export interface JudgeHistoryRecord {
  date: string;
  judgeProtocolVersion: number;
  workflow: "shadow-judge";
  level: "observation";
  provider: string;
  model: string | null;
  temperature: number;
  toolsEnabled: false;
  git: GitInfo;
  fixture: { path: string; sha256: string };
  aspectsHash: string;
  rulesFileHash: string;
  targets: string[];
  trials: number;
  negativeControl: boolean;
  /** target → with-rule 側の期待 verdict。何を証明しようとした run かを history 側に残す */
  expectByTarget: Record<string, ExpectedVerdict>;
  excludedAspects: ExcludedAspect[];
  summary: ConditionSummary[];
  trialRecords: TrialRecord[];
  cli: string[];
  /** 途中で落ちた run の中断情報。正常完了は null */
  interrupted: InterruptedInfo | null;
}

export interface InterruptedInfo {
  /** 0 起点の計画ステップ番号。ここで落ちた */
  atStep: number;
  totalSteps: number;
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
  error: string;
}

export function buildReport(args: { record: JudgeHistoryRecord; isMock: boolean }): string {
  const { record } = args;
  let md = `# shadow judge run — ${record.date}\n\n`;
  md += `> **observation only**: judge の fail 判定は CI を落とさない。proposal は非 authoritative（rules.json へは人間が別 PR で反映する）。\n\n`;
  if (args.isMock) md += `> ${MOCK_FIXTURE_BANNER}\n\n`;

  md += `## 計測条件\n\n`;
  md += `| 項目 | 値 |\n|---|---|\n`;
  md += `| provider | ${record.provider} |\n`;
  md += `| model | ${record.model ?? "(mock)"} |\n`;
  md += `| temperature | ${record.temperature} |\n`;
  md += `| toolsEnabled | ${record.toolsEnabled} |\n`;
  md += `| commit | ${record.git.commit ?? "(不明)"}${record.git.dirty ? " (dirty)" : ""} |\n`;
  md += `| fixture | ${record.fixture.path} (sha256 ${record.fixture.sha256.slice(0, 12)}) |\n`;
  md += `| aspects.json | sha256 ${record.aspectsHash.slice(0, 12)} |\n`;
  md += `| rules.json | sha256 ${record.rulesFileHash.slice(0, 12)} |\n`;
  md += `| trials/条件 | ${record.trials} |\n\n`;

  if (record.interrupted != null) {
    const i = record.interrupted;
    md += `> ⚠️ **中断**: 計画 ${i.totalSteps} ステップ中 ${i.atStep + 1} 番目（${i.targetAspectId} / ${i.condition} / trial ${i.trial}）で失敗した。以降の trial は実行されていない。\n>\n> \`${i.error}\`\n\n`;
  }

  md += `## 宣言した期待 verdict\n\n`;
  if (Object.keys(record.expectByTarget).length === 0) {
    md += `期待 verdict は宣言されていない（陰性対照ではない run）。集計の「期待一致」は分母 0 になる。\n\n`;
  } else {
    md += `| target | with-rule の期待 | without-rule の期待 |\n|---|---|---|\n`;
    for (const [target, expected] of Object.entries(record.expectByTarget)) {
      md += `| ${target} | ${expected}@${target} | not-evaluable/missing-rule |\n`;
    }
    md += `\n> with-rule 側は verdict の一致に加えて、target 自身の ruleId を引用していることまで成功条件にする。\n\n`;
  }

  md += `## 条件別の集計\n\n`;
  md += `| 条件 | trials | 期待宣言 | 期待一致 | 幻覚引用 | invalid |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const s of record.summary) {
    md += `| ${s.condition} | ${s.trials} | ${s.expectationDeclared} | ${s.expectedVerdictMatches} | ${s.hallucinatedCitations} | ${s.invalid} |\n`;
  }
  md += `\n`;

  md += `## trial 単位\n\n`;
  md += `| target | 条件 | trial | drop | 期待 | verdict | reason | ruleId | 一致 | valid | raw sha256 |\n|---|---|---:|---|---|---|---|---|---|---|---|\n`;
  for (const t of record.trialRecords) {
    const hit = matchesExpectation(t);
    md += `| ${t.targetAspectId} | ${t.condition} | ${t.trial} | ${t.droppedRuleIds.join(",") || "-"} | ${t.expectedVerdict ?? "-"} | ${t.verdict ?? "-"} | ${t.reason ?? "-"} | ${t.ruleId ?? "-"} | ${hit == null ? "-" : hit ? "ok" : "NG"} | ${t.valid ? "ok" : "invalid: " + t.invalidCodes.join(",")} | ${t.rawSha256.slice(0, 12)} |\n`;
  }
  md += `\n`;

  md += `## 陰性対照の対象外 aspect（${record.excludedAspects.length} 件）\n\n`;
  md += `| aspectId | 理由 |\n|---|---|\n`;
  for (const e of record.excludedAspects) md += `| ${e.aspectId} | ${e.reason} |\n`;
  md += `\n> sibling = 同じ欠陥を拾う別ルールが残るので abstain の証拠にならない / not-observable-static = 静的 HTML から観測できない / human-only = LLM に渡さない\n`;
  return md;
}

// ---------- 副作用（IO） ----------

function loadRules(): RuleEntry[] {
  return (JSON.parse(readFileSync(rulesPath, "utf-8")) as RulesFile).rules;
}

function appendHistoryTo(path: string, record: JudgeHistoryRecord): void {
  let history: JudgeHistoryRecord[] = [];
  if (existsSync(path)) {
    history = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(history)) {
      throw new Error(`history.json が配列ではありません: ${path}`);
    }
  }
  history.push(record);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(history, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

function appendAuditLogTo(path: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}

export interface ExecuteJudgeRunDeps {
  provider: ModelProvider;
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
  knownRuleIds: string[];
  options: JudgeCliOptions;
  /** record.fixture.path に入れる表示用パス */
  fixturePath: string;
  runDir: string;
  auditLogPath: string;
  /** null なら history に追記しない（mock はパイプライン検証なので git 正本を汚さない） */
  historyPath: string | null;
  aspectsHash: string;
  rulesFileHash: string;
  isMock: boolean;
  providerLabel: string;
  modelLabel: string | null;
  date?: string;
  gitInfo?: GitInfo;
  log?: (msg: string) => void;
}

export interface ExecuteJudgeRunResult {
  record: JudgeHistoryRecord;
  reportPath: string;
  invalidCount: number;
  exitCode: number;
}

/**
 * 計画を実行して成果物を書く。
 *
 * trial ごとに artifact を**即時**書き出す。まとめ書きにすると、途中の API エラーで
 * 完了済み trial の raw も監査記録も丸ごと消える（実 provider の run は金と時間がかかるので
 * 「落ちたら全部やり直し」は許容できない）。例外は握って中断情報として記録し、
 * provenance / report / 監査ログを書いてから非 0 の exitCode を返す。
 */
export async function executeJudgeRun(deps: ExecuteJudgeRunDeps): Promise<ExecuteJudgeRunResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const isoDate = deps.date ?? new Date().toISOString();
  mkdirSync(deps.runDir, { recursive: true });

  const plan = buildExecutionPlan(deps.options, deps.aspects);
  const records: TrialRecord[] = [];
  let interrupted: InterruptedInfo | null = null;

  for (const [index, step] of plan.entries()) {
    try {
      // 母集団は常に全 aspect。step が持つのは drop 対象と期待値だけ
      const result = await runJudgeTrial({
        provider: deps.provider,
        aspects: deps.aspects,
        rules: deps.rules,
        html: deps.html,
        knownRuleIds: deps.knownRuleIds,
        dropRuleIds: step.dropRuleIds,
      });
      const record = toTrialRecord({ result, step });
      records.push(record);

      const base = `${step.targetAspectId}-${step.condition}-t${step.trial}`;
      // 送信した system / prompt の原文を残す（第三者が drop 後の入力を検算できる粒度）
      writeFileSync(
        resolve(deps.runDir, `${base}.input.json`),
        JSON.stringify(
          {
            systemSha256: result.systemHash,
            promptSha256: result.promptHash,
            suppliedRuleIds: result.inputs.suppliedRuleIds,
            droppedRuleIds: result.inputs.droppedRuleIds,
            llmAspectIds: result.inputs.llmAspects.map((a) => a.aspectId),
            system: result.inputs.system,
            prompt: result.inputs.prompt,
          },
          null,
          2
        ),
        "utf-8"
      );
      writeFileSync(
        resolve(deps.runDir, `${base}.output.json`),
        JSON.stringify(
          { record, raw: result.raw, reasons: result.validation.reasons, verdicts: result.validation.verdicts },
          null,
          2
        ),
        "utf-8"
      );

      const hit = matchesExpectation(record);
      const status = record.valid
        ? record.verdict + (record.reason ? `/${record.reason}` : "")
        : `INVALID(${record.invalidCodes.join(",")})`;
      log(
        `  [${step.condition}] ${step.targetAspectId} trial ${step.trial}: ${status}` +
          (hit == null ? "" : hit ? "  ✓期待一致" : `  ✗期待(${step.expectedVerdict})と不一致`)
      );
    } catch (err) {
      interrupted = {
        atStep: index,
        totalSteps: plan.length,
        targetAspectId: step.targetAspectId,
        condition: step.condition,
        trial: step.trial,
        error: err instanceof Error ? err.message : String(err),
      };
      log(`  [${step.condition}] ${step.targetAspectId} trial ${step.trial}: 中断 — ${interrupted.error}`);
      break;
    }
  }

  const record: JudgeHistoryRecord = {
    date: isoDate,
    judgeProtocolVersion: JUDGE_PROTOCOL_VERSION,
    workflow: "shadow-judge",
    level: "observation",
    provider: deps.providerLabel,
    model: deps.modelLabel,
    temperature: JUDGE_TEMPERATURE,
    toolsEnabled: JUDGE_TOOLS_ENABLED,
    git: deps.gitInfo ?? getGitInfo(root),
    fixture: { path: deps.fixturePath, sha256: sha256(deps.html) },
    aspectsHash: deps.aspectsHash,
    rulesFileHash: deps.rulesFileHash,
    targets: deps.options.targets.length > 0 ? deps.options.targets : [records[0]?.targetAspectId ?? ""],
    trials: deps.options.trials,
    negativeControl: deps.options.negativeControl,
    expectByTarget: deps.options.expectByTarget,
    excludedAspects: excludedFromNegativeControl(deps.aspects),
    summary: summarizeByCondition(records),
    trialRecords: records,
    cli: deps.options.cli ?? [],
    interrupted,
  };

  writeFileSync(resolve(deps.runDir, "provenance.json"), JSON.stringify(record, null, 2) + "\n", "utf-8");
  const reportPath = resolve(deps.runDir, "report.md");
  writeFileSync(reportPath, buildReport({ record, isMock: deps.isMock }), "utf-8");

  const invalidCount = records.filter((r) => !r.valid).length;
  const failed = interrupted != null || invalidCount > 0;

  appendAuditLogTo(deps.auditLogPath, {
    run_id: `${isoDate}-shadow-judge`,
    workflow: "shadow-judge",
    level: "observation",
    status: failed ? "failed" : "passed",
    trigger: "manual",
    commands: [`tsx design/judge/run.ts ${(deps.options.cli ?? []).join(" ")}`],
    changed_paths: [],
    escalation: interrupted
      ? {
          stuck_reason: `judge run interrupted at step ${interrupted.atStep + 1}/${interrupted.totalSteps}: ${interrupted.error}`,
          severity: "error",
          evidence: [reportPath],
          human_question: "中断は provider 側の一時障害か、入力の作り方の問題か",
        }
      : invalidCount > 0
        ? {
            stuck_reason: "judge output rejected by validator",
            severity: "error",
            evidence: [reportPath],
            human_question: "検証器の拒否は judge の実装不備か、モデル側の逸脱か",
          }
        : null,
  });

  // 中断した run は git 正本に載せない。部分計測が完了 run と混ざると記事の証拠として誤読される。
  // 証跡は results/ の artifact と .melta-loop/runs.jsonl の failed 行に残る。
  if (deps.historyPath != null && interrupted == null) {
    appendHistoryTo(deps.historyPath, record);
    log(`\n  history: ${deps.historyPath} に追記`);
  } else if (interrupted != null) {
    log(`\n  history: 中断した run のため追記をスキップ（完了分の artifact は ${deps.runDir} に残る）`);
  } else {
    log(`\n  history: mock fixture のため追記をスキップ`);
  }

  return { record, reportPath, invalidCount, exitCode: failed ? 1 : 0 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const aspectsFile = loadAspectsFile();
  const aspects = aspectsFile.aspects;
  const rules = loadRules();
  const knownRuleIds = rules.map((r) => r.id);

  const parsed = parseJudgeArgs(args, {
    aspectIds: aspects.map((a) => a.aspectId),
    knownRuleIds,
    representativeAspects: aspectsFile.representativeAspects,
  });
  if (!parsed.ok) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exit(2);
  }
  const options = parsed.options;

  const absFile = resolve(options.filePath);
  if (!existsSync(absFile)) {
    console.error(`--file が見つかりません: ${absFile}`);
    process.exit(2);
  }
  const html = readFileSync(absFile, "utf-8");

  const isMock = options.provider === "mock";
  const provider: ModelProvider = isMock
    ? createJudgeMockProvider()
    : createAnthropicJudgeProvider(options.model);

  console.log("\n=== melta shadow judge（observation only）===\n");
  if (isMock) console.log(`  ⚠️ ${MOCK_FIXTURE_BANNER}`);
  console.log(`  provider: ${options.provider}, model: ${isMock ? "(mock)" : options.model}, temperature: ${JUDGE_TEMPERATURE}, tools: ${JUDGE_TOOLS_ENABLED}`);
  console.log(`  aspects: ${aspects.length} 件（LLM に渡すのは human-only を除く ${aspects.filter((a) => a.automationStatus !== "human-only").length} 件）`);
  console.log(`  file: ${relative(root, absFile)}`);

  const isoDate = new Date().toISOString();
  const runDir = resolve(resultsDir, `${isoDate.slice(0, 10)}-${isoDate.slice(11, 19).replace(/:/g, "")}`);

  const result = await executeJudgeRun({
    provider,
    aspects,
    rules,
    html,
    knownRuleIds,
    options: { ...options, cli: args },
    fixturePath: relative(root, absFile),
    runDir,
    auditLogPath,
    historyPath: isMock ? null : historyPath,
    aspectsHash: sha256(readFileSync(resolve(__dirname, "aspects.json"), "utf-8")),
    rulesFileHash: sha256(readFileSync(rulesPath, "utf-8")),
    isMock,
    providerLabel: isMock ? "mock" : `anthropic:${options.model}`,
    modelLabel: isMock ? null : options.model,
    date: isoDate,
  });

  console.log(`  レポート: ${relative(root, result.reportPath)}`);
  for (const s of result.record.summary) {
    console.log(`  ${s.condition}: 期待一致 ${s.expectedVerdictMatches}/${s.expectationDeclared}、幻覚引用 ${s.hallucinatedCitations}、invalid ${s.invalid}`);
  }
  if (result.record.interrupted != null) {
    console.error(`  中断: ${result.record.interrupted.error}`);
  }

  if (result.exitCode !== 0) process.exit(result.exitCode);
}

const invokedDirectly =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
