/**
 * file-provider.ts — API キー無しで実測するための二相 CLI（prepare / collect）
 *
 * 前例は benchmarks の `--score-dir`。モデル出力はサブエージェント等が先にファイルとして作り、
 * 決定論の採点器はそれを読むだけ、という形をそのまま judge に持ち込む。
 *
 *   prepare … trial ごとの入力（system / prompt の原文）と TASK.md と MANIFEST.json を書く。
 *             LLM は呼ばない
 *   collect … outputs/*.output.txt を読み、**API 経路と同じ** parseJudgeOutput → 検証器 →
 *             集計 → report / provenance / history に通す
 *
 * この経路で melta が制御できるのは「入力」と「検証」だけ。temperature も tools も実行者側に
 * あるので provenance では null にする（0 や false と書くと制御している嘘になる）。
 *
 * 実行者向けのファイル名は `t01` のような通し番号にする。`<aspectId>-without-rule-t1` の
 * ような名前をそのまま渡すと、**ファイル名が「このルールは意図的に抜いてある」という手がかりに
 * なる**（陰性対照の測定条件が実行者に漏れる）。target と条件の対応は MANIFEST.json だけが持ち、
 * 実行者には渡さない。
 */

import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { RuleEntry } from "../../src/utils/types.js";
import type { GitInfo } from "../benchmarks/provenance.js";
import {
  JUDGE_FILE_TREATMENT,
  JUDGE_PROTOCOL_VERSION,
  buildJudgeInputs,
  evaluateJudgeOutputText,
  sha256,
  type JudgeInputs,
} from "./adapter.js";
import type { JudgeAspect } from "./schema.js";
import type {
  JudgeCliOptions,
  NegativeControlCondition,
  PlanStep,
  TrialExpectation,
  TrialRunner,
} from "./run.js";

export const JUDGE_PHASES = ["prepare", "collect"] as const;
export type JudgePhase = (typeof JUDGE_PHASES)[number];

export const MANIFEST_FILENAME = "MANIFEST.json";

/**
 * collect が書く成果物のベース名。target と条件が読めるので **melta 側専用**。
 * 実行者に渡すファイル名には使わない（上のヘッダ参照）。
 */
export function trialBaseName(step: {
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
}): string {
  return `${step.targetAspectId}-${step.condition}-t${step.trial}`;
}

/** 実行者に見せる通し番号。計画の並び順だけを表し、条件も target も含まない */
export function trialSlotName(index: number): string {
  return `t${String(index + 1).padStart(2, "0")}`;
}

function stepKey(step: {
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
}): string {
  return `${step.targetAspectId}|${step.condition}|${step.trial}`;
}

/** MANIFEST の trial 1 件。実行者向けの通し番号と、melta 側の条件を突き合わせる表 */
export interface JudgeManifestTrial {
  /** 実行者向けの通し番号（t01 …） */
  name: string;
  /** collect が書く成果物のベース名（target と条件が読める） */
  artifactBase: string;
  /** run-dir からの相対パス。実行者に渡すのは inputPath と taskPath だけ */
  inputPath: string;
  taskPath: string;
  outputPath: string;
  /** 供給集合・drop ID・hash の置き場。**実行者には渡さない** */
  metaPath: string;
  /** inputs/<name>.input.json の全バイトの sha256。1 文字の改変も collect で弾く */
  inputSha256: string;
  targetAspectId: string;
  condition: NegativeControlCondition;
  trial: number;
  dropRuleIds: string[];
  expectedVerdict: TrialExpectation;
  systemSha256: string;
  promptSha256: string;
}

export interface JudgeManifest {
  judgeProtocolVersion: number;
  provider: "file";
  phase: "prepare";
  createdAt: string;
  cli: string[];
  /** collect が実行計画を再現するための正本。CLI から再指定させない */
  options: JudgeCliOptions;
  fixture: { path: string; sha256: string };
  aspectsHash: string;
  rulesFileHash: string;
  git: GitInfo;
  /** LLM に渡す aspect 数（human-only を除いた全件）。TASK.md の「ちょうど N 件」に使う */
  llmAspectCount: number;
  trials: JudgeManifestTrial[];
}

/** collect が読んだ output ファイルの記録。欠落も present:false で残す */
export interface FileOutputRecord {
  name: string;
  /** run-dir からの相対パス */
  path: string;
  present: boolean;
  sha256: string | null;
  bytes: number | null;
}

export interface PreparedTrial {
  step: PlanStep;
  name: string;
  inputs: JudgeInputs;
}

/** 計画の各ステップについて、実際に送る入力を組み立てる（純関数。LLM は呼ばない） */
export function buildPreparedTrials(args: {
  plan: PlanStep[];
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
}): PreparedTrial[] {
  return args.plan.map((step, index) => ({
    step,
    name: trialSlotName(index),
    inputs: buildJudgeInputs({
      aspects: args.aspects,
      rules: args.rules,
      html: args.html,
      dropRuleIds: step.dropRuleIds,
    }),
  }));
}

/**
 * 実行者 1 人に渡す指示。**条件・target・抜いたルールは書かない**。
 * ここに「このルールは抜いてある」と書くと、答えを教えてから答えさせることになる。
 */
export function renderTaskMarkdown(args: {
  name: string;
  inputPath: string;
  outputPath: string;
  llmAspectCount: number;
}): string {
  return `# judge trial ${args.name}

あなたは melta shadow judge の**実行者**です。この 1 件だけを処理します。

## 手順

1. \`${args.inputPath}\` を Read する
2. その JSON の \`system\` を自分への指示、\`prompt\` を審査対象の入力として扱う
3. 応答本文を **JSON だけ**にして \`${args.outputPath}\` に Write する

## 守ること

- **読んでよいファイルは 1 で指定した input.json だけ**。\`design/contracts/rules.json\`・
  \`aspects.json\`・\`DESIGN.md\`・他の trial の input / output は読まない。判定の根拠は
  input.json の \`system\` に載っているルール本文だけに限る
- **使ってよいツールは Read と Write だけ**。検索・実行・ネットワークは使わない
- 出力の 1 文字目は \`{\`、最後の文字は \`}\`。コードフェンス・前置き・後置き・断り書きを
  1 文字も付けない（付いた時点で検証器が invalid にする）
- \`system\` の \`<<<ASPECTS>>>\` 区画に並ぶ **${args.llmAspectCount} 件すべてにちょうど 1 つずつ** verdict を返す。
  飛ばしても増やしてもいけない
- \`<<<RULES>>>\` 区画にルール本文が無い aspect は \`not-evaluable\` / \`missing-rule\` で答える。
  知っている一般的な UX 知識で補完しない
- \`evidence\` は \`prompt\` の行番号つき原文からそのまま写す。要約・整形・創作をしない
`;
}

/**
 * 実行者に渡す input.json の**唯一の**表現。キーは system と prompt だけ。
 *
 * 供給集合・drop ID・aspect 一覧・hash を同居させると、指定ファイルだけを読む実行者にも
 * 「どのルールを抜いたか」が読めてしまう（＝陰性対照の測定条件を教えてから答えさせる）。
 * それらは meta/<name>.meta.json に分離し、実行者には渡さない。
 *
 * collect はこの関数の出力と実ファイルを byte 単位で突き合わせるので、
 * 整形（キー順・インデント・末尾改行）を変えると過去の run-dir が読めなくなる。
 */
export function renderExecutorInput(inputs: JudgeInputs): string {
  return JSON.stringify({ system: inputs.system, prompt: inputs.prompt }, null, 2) + "\n";
}

/** melta 側だけが読む来歴。実行者には渡さない */
export function renderTrialMeta(args: { inputs: JudgeInputs; inputSha256: string }): string {
  return (
    JSON.stringify(
      {
        systemSha256: sha256(args.inputs.system),
        promptSha256: sha256(args.inputs.prompt),
        inputSha256: args.inputSha256,
        suppliedRuleIds: args.inputs.suppliedRuleIds,
        droppedRuleIds: args.inputs.droppedRuleIds,
        llmAspectIds: args.inputs.llmAspects.map((a) => a.aspectId),
      },
      null,
      2
    ) + "\n"
  );
}

export function buildManifest(args: {
  options: JudgeCliOptions;
  prepared: PreparedTrial[];
  fixture: { path: string; sha256: string };
  aspectsHash: string;
  rulesFileHash: string;
  git: GitInfo;
  cli: string[];
  createdAt: string;
  llmAspectCount: number;
}): JudgeManifest {
  return {
    judgeProtocolVersion: JUDGE_PROTOCOL_VERSION,
    provider: "file",
    phase: "prepare",
    createdAt: args.createdAt,
    cli: args.cli,
    options: args.options,
    fixture: args.fixture,
    aspectsHash: args.aspectsHash,
    rulesFileHash: args.rulesFileHash,
    git: args.git,
    llmAspectCount: args.llmAspectCount,
    trials: args.prepared.map((p) => ({
      name: p.name,
      artifactBase: trialBaseName(p.step),
      inputPath: `inputs/${p.name}.input.json`,
      taskPath: `tasks/${p.name}.task.md`,
      outputPath: `outputs/${p.name}.output.txt`,
      metaPath: `meta/${p.name}.meta.json`,
      inputSha256: sha256(renderExecutorInput(p.inputs)),
      targetAspectId: p.step.targetAspectId,
      condition: p.step.condition,
      trial: p.step.trial,
      dropRuleIds: p.step.dropRuleIds,
      expectedVerdict: p.step.expectedVerdict,
      systemSha256: sha256(p.inputs.system),
      promptSha256: sha256(p.inputs.prompt),
    })),
  };
}

/** prepare の書き出し。inputs / tasks / outputs(空) / MANIFEST.json */
export function writePreparePhase(args: {
  runDir: string;
  manifest: JudgeManifest;
  prepared: PreparedTrial[];
}): void {
  mkdirSync(resolve(args.runDir, "inputs"), { recursive: true });
  mkdirSync(resolve(args.runDir, "meta"), { recursive: true });
  mkdirSync(resolve(args.runDir, "tasks"), { recursive: true });
  mkdirSync(resolve(args.runDir, "outputs"), { recursive: true });

  const byName = new Map(args.manifest.trials.map((t) => [t.name, t]));
  for (const p of args.prepared) {
    const entry = byName.get(p.name);
    if (entry == null) throw new Error(`MANIFEST に ${p.name} がありません`);
    // 実行者が読むのはこの 2 キーだけ
    writeFileSync(resolve(args.runDir, entry.inputPath), renderExecutorInput(p.inputs), "utf-8");
    // 来歴は実行者の外に置く
    writeFileSync(
      resolve(args.runDir, entry.metaPath),
      renderTrialMeta({ inputs: p.inputs, inputSha256: entry.inputSha256 }),
      "utf-8"
    );
    writeFileSync(
      resolve(args.runDir, entry.taskPath),
      renderTaskMarkdown({
        name: entry.name,
        inputPath: resolve(args.runDir, entry.inputPath),
        outputPath: resolve(args.runDir, entry.outputPath),
        llmAspectCount: args.manifest.llmAspectCount,
      }),
      "utf-8"
    );
  }

  writeFileSync(
    resolve(args.runDir, MANIFEST_FILENAME),
    JSON.stringify(args.manifest, null, 2) + "\n",
    "utf-8"
  );
}

/** prepare の stdout。次に何をするかだけを出す */
export function nextStepsMessage(args: { runDir: string; manifest: JudgeManifest; root: string }): string {
  const rel = relative(args.root, args.runDir) || args.runDir;
  const first = args.manifest.trials[0];
  return [
    `  ${args.manifest.trials.length} trial 分の入力を書いた: ${rel}/`,
    `    inputs/   … 実行者に渡す system / prompt の原文（この 2 キーだけ）`,
    `    meta/     … 供給集合・drop ID・hash（melta 側だけが読む。実行者に渡さない）`,
    `    tasks/    … 実行者に渡す指示（1 trial 1 ファイル）`,
    `    outputs/  … 実行者がここに <name>.output.txt を書く（今は空）`,
    ``,
    `  次の手順:`,
    `  1. tasks/*.task.md を 1 件ずつ実行者に渡す（Claude Code なら .claude/agents/judge-runner.md）`,
    `     例: ${rel}/${first?.taskPath ?? "tasks/t01.task.md"}`,
    `  2. 全部の outputs/*.output.txt が揃ったら集計する:`,
    `     npx tsx design/judge/run.ts --provider file --phase collect \\`,
    `       --run-dir ${rel} --runtime "claude-code-subagent:<model>"`,
    ``,
    `  LLM はこの相では呼んでいない。temperature と tools は実行者側の設定になる。`,
  ].join("\n");
}

export function loadManifest(runDir: string): JudgeManifest {
  const path = resolve(runDir, MANIFEST_FILENAME);
  if (!existsSync(path)) {
    throw new Error(`${MANIFEST_FILENAME} がありません: ${path}（先に --phase prepare を回す）`);
  }
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as JudgeManifest;
  if (manifest.provider !== "file") {
    throw new Error(`${path} の provider が file ではありません: ${String(manifest.provider)}`);
  }
  if (manifest.judgeProtocolVersion !== JUDGE_PROTOCOL_VERSION) {
    throw new Error(
      `${path} の judgeProtocolVersion が ${String(manifest.judgeProtocolVersion)} で、現在の ${JUDGE_PROTOCOL_VERSION} と違います。出力契約が変わっているので集計しない`
    );
  }
  return manifest;
}

/**
 * collect の trial 実行。provider を叩かず outputs/*.output.txt を読む。
 *
 * 出力が無い trial は `missing-output` で **invalid に数える**。未実施として集計から
 * 外すと「答えられなかった trial」が母数から消えて成功率が上振れする。
 */
export function createFileTrialRunner(args: { runDir: string; manifest: JudgeManifest }): {
  runTrial: TrialRunner;
  outputs: () => FileOutputRecord[];
} {
  const byKey = new Map(args.manifest.trials.map((t) => [stepKey(t), t]));
  const seen: FileOutputRecord[] = [];

  const runTrial: TrialRunner = async (trialArgs) => {
    const entry = byKey.get(stepKey(trialArgs.step));
    if (entry == null) {
      throw new Error(
        `MANIFEST に無い trial: ${trialBaseName(trialArgs.step)}（MANIFEST と実行計画がズレている）`
      );
    }
    const inputs = buildJudgeInputs({
      aspects: trialArgs.aspects,
      rules: trialArgs.rules,
      html: trialArgs.html,
      dropRuleIds: trialArgs.dropRuleIds,
    });
    // prepare 時に実行者へ渡した入力と、いま検証している入力が同じであることを確かめる。
    // ここが一致しない collect は「別の質問への答え」を採点していることになる
    if (sha256(inputs.system) !== entry.systemSha256 || sha256(inputs.prompt) !== entry.promptSha256) {
      throw new Error(
        `${entry.name} の入力が prepare 時と一致しません（aspects.json / rules.json / fixture が prepare 後に変わった）`
      );
    }

    const outputPath = resolve(args.runDir, entry.outputPath);
    const evaluate = (text: string) =>
      evaluateJudgeOutputText({
        inputs,
        text,
        aspects: trialArgs.aspects,
        knownRuleIds: trialArgs.knownRuleIds,
        html: trialArgs.html,
        generation: { text, latencyMs: 0 },
        treatment: JUDGE_FILE_TREATMENT,
      });

    if (!existsSync(outputPath)) {
      seen.push({ name: entry.name, path: entry.outputPath, present: false, sha256: null, bytes: null });
      const evaluated = evaluate("");
      return {
        ...evaluated,
        validation: {
          valid: false,
          reasons: [
            {
              code: "missing-output" as const,
              aspectId: null,
              message: `実行者の出力がありません: ${entry.outputPath}`,
            },
          ],
          verdicts: [],
        },
      };
    }

    const text = readFileSync(outputPath, "utf-8");
    seen.push({
      name: entry.name,
      path: entry.outputPath,
      present: true,
      sha256: sha256(text),
      bytes: Buffer.byteLength(text, "utf-8"),
    });
    return evaluate(text);
  };

  return { runTrial, outputs: () => seen };
}

/** collect 前の突き合わせ。prepare 時と同じ材料で集計しているかを確かめる */
export function checkManifestConsistency(args: {
  manifest: JudgeManifest;
  fixtureSha256: string;
  aspectsHash: string;
  rulesFileHash: string;
}): string[] {
  const problems: string[] = [];
  if (args.manifest.fixture.sha256 !== args.fixtureSha256) {
    problems.push(`fixture が prepare 時から変わっています: ${args.manifest.fixture.path}`);
  }
  if (args.manifest.aspectsHash !== args.aspectsHash) {
    problems.push("aspects.json が prepare 時から変わっています");
  }
  if (args.manifest.rulesFileHash !== args.rulesFileHash) {
    problems.push("rules.json が prepare 時から変わっています");
  }
  return problems;
}

/**
 * M3: MANIFEST の自己整合。**再構成した計画と trials[] の全件一致**まで見る。
 *
 * `options` と `trials[]` は同じ計画を二重に持っている。片方だけ書き換えると
 * 「14 件だけ集計して残り 28 件は missing-output にもならない」run が作れてしまうので、
 * 集計の前に両者が一致していることを確かめる。
 *
 * plan は呼び出し側が buildExecutionPlan(manifest.options, aspects) で作って渡す
 * （run.ts との循環 import を避けるため、この module は計画を作らない）。
 */
export function checkManifestPlan(args: { manifest: JudgeManifest; plan: PlanStep[] }): string[] {
  const { manifest, plan } = args;
  const problems: string[] = [];

  // --- 構造 ---
  if (!Array.isArray(manifest.trials) || manifest.trials.length === 0) {
    return ["MANIFEST の trials が空です"];
  }
  if (manifest.options == null || typeof manifest.options !== "object") {
    return ["MANIFEST の options がありません"];
  }
  if (typeof manifest.llmAspectCount !== "number" || manifest.llmAspectCount < 1) {
    problems.push("MANIFEST の llmAspectCount が不正です");
  }
  if (manifest.fixture == null || typeof manifest.fixture.sha256 !== "string") {
    problems.push("MANIFEST の fixture がありません");
  }
  const names = manifest.trials.map((t) => t.name);
  const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicated.length > 0) {
    problems.push(`MANIFEST の trial name が重複しています: ${[...new Set(duplicated)].join(", ")}`);
  }

  // --- trial の必須フィールド（旧形式の MANIFEST をここで落とす。
  //     欠けたまま先へ進むと hash 比較が undefined に触って TypeError になる） ---
  for (const [i, entry] of manifest.trials.entries()) {
    const missingFields = (
      [
        "name",
        "artifactBase",
        "inputPath",
        "taskPath",
        "outputPath",
        "metaPath",
        "systemSha256",
        "promptSha256",
        "inputSha256",
      ] as const
    ).filter((k) => typeof entry[k] !== "string" || entry[k].length === 0);
    if (!Number.isInteger(entry.trial)) missingFields.push("trial" as never);
    if (!Array.isArray(entry.dropRuleIds)) missingFields.push("dropRuleIds" as never);
    if (missingFields.length > 0) {
      problems.push(
        `trial ${i + 1} 件目に必須フィールドがありません: ${missingFields.join(", ")}（prepare をやり直す）`
      );
    }
  }
  if (problems.length > 0) return problems;

  // --- 計画との全件一致 ---
  if (plan.length !== manifest.trials.length) {
    problems.push(
      `options から再構成した計画 ${plan.length} 件と trials[] ${manifest.trials.length} 件が一致しません`
    );
  }
  const compared = Math.min(plan.length, manifest.trials.length);
  for (let i = 0; i < compared; i++) {
    const step = plan[i];
    const entry = manifest.trials[i];
    const expectedName = trialSlotName(i);
    const mismatches: string[] = [];
    if (entry.name !== expectedName) mismatches.push(`name ${entry.name} ≠ ${expectedName}`);
    if (entry.targetAspectId !== step.targetAspectId) {
      mismatches.push(`target ${entry.targetAspectId} ≠ ${step.targetAspectId}`);
    }
    if (entry.condition !== step.condition) mismatches.push(`condition ${entry.condition} ≠ ${step.condition}`);
    if (entry.trial !== step.trial) mismatches.push(`trial ${entry.trial} ≠ ${step.trial}`);
    if ([...entry.dropRuleIds].sort().join(",") !== [...step.dropRuleIds].sort().join(",")) {
      mismatches.push(`drop [${entry.dropRuleIds.join(",")}] ≠ [${step.dropRuleIds.join(",")}]`);
    }
    if ((entry.expectedVerdict ?? null) !== (step.expectedVerdict ?? null)) {
      mismatches.push(`expectedVerdict ${String(entry.expectedVerdict)} ≠ ${String(step.expectedVerdict)}`);
    }
    if (entry.artifactBase !== trialBaseName(step)) {
      mismatches.push(`artifactBase ${entry.artifactBase} ≠ ${trialBaseName(step)}`);
    }
    for (const [key, expected] of [
      ["inputPath", `inputs/${expectedName}.input.json`],
      ["taskPath", `tasks/${expectedName}.task.md`],
      ["outputPath", `outputs/${expectedName}.output.txt`],
      ["metaPath", `meta/${expectedName}.meta.json`],
    ] as const) {
      if (entry[key] !== expected) mismatches.push(`${key} ${String(entry[key])} ≠ ${expected}`);
    }
    if (mismatches.length > 0) {
      problems.push(`trial ${i + 1} 件目が計画と一致しません: ${mismatches.join(" / ")}`);
    }
  }
  return problems;
}

/**
 * M2: **実行者が実際に読んだ input.json** と、MANIFEST の記録と、いまのソースから
 * 再構成した入力の三者が一致することを確かめる。
 *
 * hash 同士を比べるだけでは、prepare 後に input.json の system を書き換えて実行者に
 * 別の質問をさせた run が素通りする。ファイルの中身を読んで突き合わせるのはここだけ。
 */
export function checkPreparedInputs(args: {
  runDir: string;
  manifest: JudgeManifest;
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
}): string[] {
  const problems: string[] = [];
  for (const entry of args.manifest.trials) {
    const inputPath = resolve(args.runDir, entry.inputPath);
    if (!existsSync(inputPath)) {
      problems.push(`${entry.inputPath} がありません（実行者に渡した入力が復元できない）`);
      continue;
    }
    const actual = readFileSync(inputPath, "utf-8");
    const actualSha = sha256(actual);
    if (actualSha !== entry.inputSha256) {
      problems.push(
        `${entry.inputPath} が prepare 後に書き換えられています（sha256 ${actualSha.slice(0, 12)} ≠ MANIFEST ${String(entry.inputSha256 ?? "").slice(0, 12)}）`
      );
      continue;
    }

    const rebuilt = buildJudgeInputs({
      aspects: args.aspects,
      rules: args.rules,
      html: args.html,
      dropRuleIds: entry.dropRuleIds,
    });
    if (renderExecutorInput(rebuilt) !== actual) {
      problems.push(
        `${entry.inputPath} が現在のソースから再構成した入力と一致しません（aspects.json / rules.json / fixture が prepare 後に変わった）`
      );
      continue;
    }
    if (sha256(rebuilt.system) !== entry.systemSha256 || sha256(rebuilt.prompt) !== entry.promptSha256) {
      problems.push(`${entry.inputPath} の system / prompt hash が MANIFEST の記録と一致しません`);
    }
  }
  return problems;
}

/** run-dir の絶対パス。相対指定は cwd 基準にする */
export function resolveRunDir(runDir: string): string {
  const abs = resolve(runDir);
  mkdirSync(dirname(abs), { recursive: true });
  return abs;
}
