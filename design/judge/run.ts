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
import {
  buildManifest,
  buildPreparedTrials,
  checkManifestConsistency,
  checkManifestPlan,
  checkPreparedInputs,
  checkPreparedTasks,
  createFileTrialRunner,
  loadManifest,
  nextStepsMessage,
  resolveRunDir,
  trialBaseName,
  writePreparePhase,
  type FileOutputRecord,
  type JudgePhase,
} from "./file-provider.js";
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
  /** file provider の相。anthropic / mock では null */
  phase: JudgePhase | null;
  /** file provider の作業ディレクトリ。anthropic / mock では null */
  runDir: string | null;
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
  # API を叩く（anthropic は有料 / mock は NOT EVIDENCE）
  tsx design/judge/run.ts --file <html> --provider anthropic|mock \\
    [--drop-rule <ID>]... [--targets <ID,...>] [--trials N] [--model <id>] \\
    [--negative-control --expect fail|pass [--expect-map '{"<ID>":"fail"}']]

  # API キー無しで実測する（二相。生成は外部の実行者がやる）
  tsx design/judge/run.ts --provider file --phase prepare --run-dir <dir> \\
    --file <html> [--negative-control --expect fail|pass] [--targets <ID,...>] [--trials N]
  tsx design/judge/run.ts --provider file --phase collect --run-dir <dir> --runtime "<実行者>"`;

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

  // --provider file は二相 CLI。ここで扱うのは prepare だけで、collect は
  // parseJudgeCli が MANIFEST 経由の別経路へ振り分ける（collect は --file を取らない）
  const isFileProvider = provider === "file";
  const phaseRaw = getArg(args, "--phase");
  const phaseGiven = args.includes("--phase");
  const runDirRaw = getArg(args, "--run-dir");
  const runDirGiven = args.includes("--run-dir");
  const runtimeGiven = args.includes("--runtime");
  const modelGiven = args.includes("--model");

  if (!isFileProvider) {
    if (phaseGiven) return fail("--phase は --provider file のときだけ指定できます");
    if (runDirGiven) return fail("--run-dir は --provider file のときだけ指定できます");
    if (runtimeGiven) return fail("--runtime は --provider file --phase collect のときだけ指定できます");
  } else {
    if (!phaseGiven) return fail("--provider file には --phase prepare か --phase collect が必要です");
    if (phaseRaw !== "prepare") {
      return fail(`--phase は prepare か collect です（受領: "${phaseRaw ?? ""}"）`);
    }
    if (runDirRaw == null || runDirRaw.trim() === "") {
      return fail("--phase prepare には --run-dir <dir> が必要です");
    }
    if (runtimeGiven) {
      return fail("--runtime は --phase collect で指定します（prepare の時点では誰が実行するか決まっていません）");
    }
    if (modelGiven) {
      return fail("--provider file では --model を指定できません。実行したモデルは --phase collect の --runtime に書きます");
    }
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
      options: {
        filePath,
        provider: provider as JudgeProviderId,
        model,
        trials,
        negativeControl,
        dropRuleIds,
        targets,
        expectByTarget: {},
        phase: isFileProvider ? "prepare" : null,
        runDir: isFileProvider ? (runDirRaw as string) : null,
      },
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
    options: {
      filePath,
      provider: provider as JudgeProviderId,
      model,
      trials,
      negativeControl,
      dropRuleIds,
      targets,
      expectByTarget,
      phase: isFileProvider ? "prepare" : null,
      runDir: isFileProvider ? (runDirRaw as string) : null,
    },
  };
}

// ---------- 二相 CLI の入口（純関数） ----------

/** --phase collect のオプション。実行計画は CLI ではなく MANIFEST.json が正本 */
export interface JudgeCollectOptions {
  runDir: string;
  /** 誰がどのモデル・どの枠で書いたか（自由文。例 claude-code-subagent:haiku-4.5） */
  runtime: string;
}

export type JudgeCliPlan =
  | { ok: true; mode: "run"; options: JudgeCliOptions }
  | { ok: true; mode: "collect"; options: JudgeCollectOptions }
  | { ok: false; error: string };

/**
 * CLI の front door。--provider file --phase collect だけ別経路に振り分け、
 * 残りは従来どおり parseJudgeArgs に渡す。
 *
 * collect が --file / --targets / --trials 等を受け取らないのは、prepare と collect で
 * 実行計画がズレると「実行者が答えた trial」と「集計した trial」が別物になるため。
 * 計画の正本は MANIFEST.json だけにする。
 */
export function parseJudgeCli(args: string[], ctx: JudgeCliContext): JudgeCliPlan {
  const provider = getArg(args, "--provider");
  const phase = getArg(args, "--phase");
  if (provider === "file" && args.includes("--phase") && phase === "collect") {
    const runDir = getArg(args, "--run-dir");
    if (runDir == null || runDir.trim() === "") {
      return { ok: false, error: "--phase collect には --run-dir <dir> が必要です" };
    }
    const runtime = getArg(args, "--runtime");
    if (runtime == null || runtime.trim() === "") {
      return {
        ok: false,
        error:
          '--phase collect には --runtime "<実行者>" が必要です（例: "claude-code-subagent:haiku-4.5"）。' +
          "provenance の provider は file としか書けず、どのモデルがどの枠で答えたかは runtime にしか残らない",
      };
    }
    const forbidden = [
      "--file",
      "--targets",
      "--drop-rule",
      "--trials",
      "--model",
      "--expect",
      "--expect-map",
      "--negative-control",
    ].filter((f) => args.includes(f));
    if (forbidden.length > 0) {
      return {
        ok: false,
        error: `--phase collect は ${forbidden.join(", ")} を受け取りません（実行計画の正本は ${runDir}/MANIFEST.json）`,
      };
    }
    return { ok: true, mode: "collect", options: { runDir, runtime } };
  }

  const parsed = parseJudgeArgs(args, ctx);
  return parsed.ok ? { ok: true, mode: "run", options: parsed.options } : { ok: false, error: parsed.error };
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
  /**
   * file provider のとき「誰がどのモデル・どの枠で書いたか」の自由文。
   * provider は "file" としか書けないので、実測の主語はここにしか残らない。API 経路は null
   */
  runtime: string | null;
  /** file provider では null（実行者側の設定で、melta 側は制御していない） */
  temperature: number | null;
  /** file provider では null（実行者の tools 制限は構造でなく agent 定義に依存する） */
  toolsEnabled: boolean | null;
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
  /** file provider が読んだ output ファイルの一覧（欠落も present:false で残す）。API 経路は null */
  outputs: FileOutputRecord[] | null;
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
  if (record.outputs != null) {
    md += `> **file provider**: 応答は melta の外（\`${record.runtime ?? "(runtime 不明)"}\`）で生成され、このプロセスは入力の用意と出力の検証だけをした。temperature と tools は melta 側で制御していない。供給していない ruleId の引用（下表の invalid \`rule-id-not-supplied\`）は、実行者がルールを再取得したか幻覚したかのどちらかで、**構造では止められない**。\n\n`;
  }

  md += `## 計測条件\n\n`;
  md += `| 項目 | 値 |\n|---|---|\n`;
  md += `| provider | ${record.provider} |\n`;
  md += `| model | ${record.model ?? (record.runtime != null ? "(runtime を参照)" : "(mock)")} |\n`;
  if (record.runtime != null) md += `| runtime | ${record.runtime} |\n`;
  md += `| temperature | ${record.temperature ?? "null（実行者側の設定。melta は制御していない）"} |\n`;
  md += `| toolsEnabled | ${record.toolsEnabled ?? "null（実行者の tools 制限は agent 定義に依存し、構造では保証できない）"} |\n`;
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

  if (record.outputs != null) {
    const missing = record.outputs.filter((o) => !o.present);
    md += `## 実行者の出力（${record.outputs.length} 件中 欠落 ${missing.length} 件）\n\n`;
    md += `| output | 有無 | sha256 |\n|---|---|---|\n`;
    for (const o of record.outputs) {
      md += `| ${o.name} | ${o.present ? "あり" : "**欠落**"} | ${o.sha256?.slice(0, 12) ?? "-"} |\n`;
    }
    md += `\n> 欠落した trial は \`missing-output\` で invalid に数える。未実施として集計から外すと、答えられなかった trial が消えて成功率が上振れする。\n\n`;
  }

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

/**
 * 1 trial を実行して JudgeRunResult にする関数。既定は adapter の runJudgeTrial（provider を叩く）。
 * file provider はここを差し替えて「provider を叩かず outputs/*.output.txt を読む」に変える。
 * 差し替えても検証器・集計・成果物の書き出しは共通のままにする（経路ごとに契約を分けない）。
 */
export type TrialRunner = (args: {
  provider: ModelProvider;
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
  knownRuleIds: readonly string[];
  dropRuleIds: string[];
  step: PlanStep;
}) => Promise<JudgeRunResult>;

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
  /** file provider の実行者。API 経路は省略（null になる） */
  runtimeLabel?: string | null;
  /** 省略時は JUDGE_TEMPERATURE。file provider は null を渡す */
  temperature?: number | null;
  /** 省略時は JUDGE_TOOLS_ENABLED。file provider は null を渡す */
  toolsEnabled?: boolean | null;
  /** 省略時は runJudgeTrial（provider を叩く） */
  runTrial?: TrialRunner;
  /** file provider が読んだ output の一覧を返す。record 組み立て時に 1 回だけ呼ぶ */
  fileOutputs?: () => FileOutputRecord[];
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
  const runTrial: TrialRunner = deps.runTrial ?? ((a) => runJudgeTrial(a));

  for (const [index, step] of plan.entries()) {
    try {
      // 母集団は常に全 aspect。step が持つのは drop 対象と期待値だけ
      const result = await runTrial({
        provider: deps.provider,
        aspects: deps.aspects,
        rules: deps.rules,
        html: deps.html,
        knownRuleIds: deps.knownRuleIds,
        dropRuleIds: step.dropRuleIds,
        step,
      });
      const record = toTrialRecord({ result, step });
      records.push(record);

      const base = trialBaseName(step);
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
    runtime: deps.runtimeLabel ?? null,
    temperature: deps.temperature === undefined ? JUDGE_TEMPERATURE : deps.temperature,
    toolsEnabled: deps.toolsEnabled === undefined ? JUDGE_TOOLS_ENABLED : deps.toolsEnabled,
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
    outputs: deps.fileOutputs?.() ?? null,
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

/** collect が executeJudgeRun に渡す stub。file 経路はモデルを一度も呼ばない */
const NEVER_CALLED_PROVIDER: ModelProvider = {
  id: "file",
  async generate() {
    throw new Error("file provider はモデルを呼ばない（collect は outputs/*.output.txt を読むだけ）");
  },
};

interface MainContext {
  args: string[];
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  knownRuleIds: string[];
  aspectsHash: string;
  rulesFileHash: string;
}

/** --phase prepare: 入力と TASK.md と MANIFEST を書くだけ。LLM は呼ばない */
function runPreparePhase(ctx: MainContext, options: JudgeCliOptions, absFile: string, html: string): void {
  const runDir = resolveRunDir(options.runDir as string);
  if (existsSync(resolve(runDir, "MANIFEST.json"))) {
    console.error(
      `${runDir} は既に prepare 済みです。別の --run-dir を使ってください（上書きすると、既に書かれた outputs が別の計画の孤児になる）`
    );
    process.exit(2);
  }

  const plan = buildExecutionPlan(options, ctx.aspects);
  const prepared = buildPreparedTrials({ plan, aspects: ctx.aspects, rules: ctx.rules, html });
  const manifest = buildManifest({
    options: { ...options, cli: ctx.args },
    prepared,
    fixture: { path: relative(root, absFile), sha256: sha256(html) },
    aspectsHash: ctx.aspectsHash,
    rulesFileHash: ctx.rulesFileHash,
    git: getGitInfo(root),
    cli: ctx.args,
    createdAt: new Date().toISOString(),
    llmAspectCount: ctx.aspects.filter((a) => a.automationStatus !== "human-only").length,
  });
  writePreparePhase({ runDir, manifest, prepared });

  console.log(nextStepsMessage({ runDir, manifest, root }));
}

/** --phase collect: outputs を読んで検証器・集計・成果物へ通す */
async function runCollectPhase(ctx: MainContext, collect: JudgeCollectOptions): Promise<void> {
  const runDir = resolve(collect.runDir);
  let manifest;
  try {
    manifest = loadManifest(runDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const absFile = resolve(root, manifest.fixture.path);
  if (!existsSync(absFile)) {
    console.error(`MANIFEST の fixture が見つかりません: ${absFile}`);
    process.exit(2);
  }
  const html = readFileSync(absFile, "utf-8");
  // 集計の前に 3 つ確かめる: (1) 材料が prepare 時と同じか (2) MANIFEST の options と
  // trials[] が同じ計画か (3) 実行者が読んだ input.json が改変されていないか。
  // どれも「別の質問への答え」を実測として集計しないための門
  const fail = (problems: string[]): never => {
    console.error(`prepare 時の計画・入力と一致しないので集計しません:\n  - ${problems.join("\n  - ")}`);
    process.exit(2);
  };
  // 材料と計画を先に見る。構造が壊れた MANIFEST のまま入力照合へ進むと、
  // 「何が壊れているか」でなく TypeError で落ちて原因が読めなくなる
  const structural = [
    ...checkManifestConsistency({
      manifest,
      fixtureSha256: sha256(html),
      aspectsHash: ctx.aspectsHash,
      rulesFileHash: ctx.rulesFileHash,
    }),
    ...checkManifestPlan({ manifest, plan: buildExecutionPlan(manifest.options, ctx.aspects) }),
  ];
  if (structural.length > 0) fail(structural);

  // 実行者が読んだもの（入力と指示）の両方を byte で照合する。
  // 入力だけ見ていると、TASK.md に答えを 1 行足した run が通常の測定として通る
  const executorProblems = [
    ...checkPreparedInputs({
      runDir,
      manifest,
      aspects: ctx.aspects,
      rules: ctx.rules,
      html,
    }),
    ...checkPreparedTasks({ runDir, manifest }),
  ];
  if (executorProblems.length > 0) fail(executorProblems);

  const { runTrial, outputs } = createFileTrialRunner({ runDir, manifest });
  const isoDate = new Date().toISOString();

  console.log("\n=== melta shadow judge（observation only / file provider collect）===\n");
  console.log(`  provider: file, runtime: ${collect.runtime}, temperature: null, tools: null`);
  console.log(`  run-dir: ${relative(root, runDir) || runDir}（trial ${manifest.trials.length} 件）`);
  console.log(`  file: ${manifest.fixture.path}`);

  const result = await executeJudgeRun({
    provider: NEVER_CALLED_PROVIDER,
    aspects: ctx.aspects,
    rules: ctx.rules,
    html,
    knownRuleIds: ctx.knownRuleIds,
    options: { ...manifest.options, cli: ctx.args },
    fixturePath: manifest.fixture.path,
    runDir,
    auditLogPath,
    // mock ではないので history に書く。実測の正本はここにしか残らない
    historyPath,
    aspectsHash: ctx.aspectsHash,
    rulesFileHash: ctx.rulesFileHash,
    isMock: false,
    providerLabel: "file",
    modelLabel: null,
    runtimeLabel: collect.runtime,
    temperature: null,
    toolsEnabled: null,
    runTrial,
    fileOutputs: outputs,
    date: isoDate,
  });

  console.log(`  レポート: ${relative(root, result.reportPath)}`);
  for (const s of result.record.summary) {
    console.log(
      `  ${s.condition}: 期待一致 ${s.expectedVerdictMatches}/${s.expectationDeclared}、幻覚引用 ${s.hallucinatedCitations}、invalid ${s.invalid}`
    );
  }
  const missing = (result.record.outputs ?? []).filter((o) => !o.present);
  if (missing.length > 0) {
    console.error(`  出力が欠けた trial: ${missing.map((o) => o.name).join(", ")}（missing-output で invalid に数えた）`);
  }
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const aspectsFile = loadAspectsFile();
  const aspects = aspectsFile.aspects;
  const rules = loadRules();
  const knownRuleIds = rules.map((r) => r.id);
  const ctx: MainContext = {
    args,
    aspects,
    rules,
    knownRuleIds,
    aspectsHash: sha256(readFileSync(resolve(__dirname, "aspects.json"), "utf-8")),
    rulesFileHash: sha256(readFileSync(rulesPath, "utf-8")),
  };

  const cliPlan = parseJudgeCli(args, {
    aspectIds: aspects.map((a) => a.aspectId),
    knownRuleIds,
    representativeAspects: aspectsFile.representativeAspects,
  });
  if (!cliPlan.ok) {
    console.error(`${cliPlan.error}\n${USAGE}`);
    process.exit(2);
  }

  if (cliPlan.mode === "collect") {
    await runCollectPhase(ctx, cliPlan.options);
    return;
  }

  const options = cliPlan.options;

  const absFile = resolve(options.filePath);
  if (!existsSync(absFile)) {
    console.error(`--file が見つかりません: ${absFile}`);
    process.exit(2);
  }
  const html = readFileSync(absFile, "utf-8");

  if (options.provider === "file") {
    console.log("\n=== melta shadow judge（observation only / file provider prepare）===\n");
    console.log(`  LLM は呼ばない。入力・TASK.md・MANIFEST.json を書くだけ`);
    console.log(`  file: ${relative(root, absFile)}`);
    runPreparePhase(ctx, options, absFile, html);
    return;
  }

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
    aspectsHash: ctx.aspectsHash,
    rulesFileHash: ctx.rulesFileHash,
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
