/**
 * adapter.ts — judge の provider adapter（tools-off 固定）
 *
 * 既存の ModelProvider を包み、必ず `{ useTools: false, temperature: 0 }` で呼ぶ。
 * tools を許すと `get_rules` で「抜いたはずのルール」を再取得できてしまい、陰性対照が
 * 成立しない（providers/anthropic.ts の既定は useTools ?? true）。ここが陰性対照の
 * 成立条件そのものなので、オプションにせず固定する。
 *
 * human-only aspect は LLM に渡さない。verdict は validate.ts の
 * buildHumanOnlyVerdicts が決定論で付ける。ルール本文も system prompt に載せない。
 */

import { createHash } from "node:crypto";
import type {
  GenerationResult,
  ModelProvider,
  RuleEntry,
} from "../../src/utils/types.js";
import { createAnthropicProvider } from "../benchmarks/providers/anthropic.js";
import type { JudgeAspect, JudgeValidationResult } from "./schema.js";
import { validateJudgeOutput } from "./validate.js";

/**
 * judge 出力契約・system prompt の規律・検証器の意味論が変わったら上げる。
 * history.json の時系列比較は同じ version の run 同士に限定する。
 */
export const JUDGE_PROTOCOL_VERSION = 1;

/**
 * temperature を受け付けないと分かっているモデル。指定されたら起動前に usage error にする。
 * judge は temperature: 0 を固定で渡し、providers/anthropic.ts はそれをそのまま API へ転送する
 * ので、この表のモデルを既定にすると実 provider の既定経路が 400 になる。
 * 出典: claude-api スキルの Thinking & Effort 表（Sampling 列が "Removed - 400" の行）。
 */
export const TEMPERATURE_UNSUPPORTED_MODELS: readonly string[] = [
  "claude-fable-5-1",
  "claude-mythos-5-1",
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
];

/** 指定モデルが temperature を受け付けないと分かっているか */
export function modelRejectsTemperature(model: string): boolean {
  return TEMPERATURE_UNSUPPORTED_MODELS.includes(model);
}

/**
 * 既定モデル。design/benchmarks/runner.ts の claude-sonnet-4-20250514 は古い ID なので
 * コピーしない。judge は temperature: 0 を固定で渡すため、**temperature を受け付ける現行
 * モデルの中で最も能力の高いもの**を選ぶ（claude-api スキルの表で Sampling が "Allowed" なのは
 * Opus 4.6 / Sonnet 4.6 / Haiku 4.5）。
 */
export const DEFAULT_JUDGE_MODEL = "claude-opus-4-6";

/** 判定のばらつきを抑えるため 0 固定。provenance に必ず記録する */
export const JUDGE_TEMPERATURE = 0;

/** tools を渡さないことは provenance の必須フィールドにする */
export const JUDGE_TOOLS_ENABLED = false;

/**
 * provider に応答本文の加工をさせない。true でないと anthropic provider が ```html
 * フェンスの中身だけを text にするので、「説明文 + フェンス内の正常 JSON」が
 * parseJudgeOutput を通ってしまい、fail-closed の契約が provider 層で骨抜きになる。
 */
export const JUDGE_RAW_TEXT = true;

/**
 * provider の種類。
 *   anthropic … 実 API（有料）
 *   mock      … 決定論スタブ（NOT EVIDENCE。history には書かない）
 *   file      … 二相 CLI。モデルの応答は外部の実行者がファイルとして先に作り、
 *               melta 側は入力を用意して出力を読むだけ（benchmarks の --score-dir と同じ形）
 */
export type JudgeProviderId = "anthropic" | "mock" | "file";

const SECTION_DELIMITERS = {
  RULES: ["<<<RULES>>>", "<<<END RULES>>>"],
  ASPECTS: ["<<<ASPECTS>>>", "<<<END ASPECTS>>>"],
  HTML: ["<<<HTML>>>", "<<<END HTML>>>"],
} as const;

export type JudgeSection = keyof typeof SECTION_DELIMITERS;

/** system / user prompt から 1 区画を切り出す。テストと mock provider が使う */
export function extractSection(text: string, section: JudgeSection): string {
  const [open, close] = SECTION_DELIMITERS[section];
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < 0 || end < start) return "";
  return text.slice(start + open.length, end).trim();
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

const SYSTEM_DISCIPLINE = `あなたは melta UI デザインシステムの shadow judge です。
供給されたルール本文だけで判定してください。次の規律を必ず守ります。

1. 判定に使ってよい根拠は <<<RULES>>> 区画のルール本文だけです。一般的な UX 知識・
   他のデザインシステムの常識・記憶しているガイドラインで補完してはいけません。
2. <<<ASPECTS>>> 区画の aspect に対応するルール本文が <<<RULES>>> に無い場合は、
   verdict "not-evaluable" / reason "missing-rule" を返します。missing には
   「無かった ruleId」を、proposal にはそのギャップを埋める候補ルール（ID と 1 行の要約）を書きます。
3. すべての aspect にちょうど 1 つの verdict を返します。飛ばしても増やしてもいけません。
4. ruleId は供給されたルール本文の ID をそのまま写します。推測した ID・記憶している ID を書いてはいけません。
5. evidence は審査対象の原文から写します。line は行番号、snippet は行番号の "|" より右の
   原文そのままです。要約・整形・創作をしてはいけません。
6. 対象要素が HTML に無いときは reason "not-applicable"、ルールはあるが静的 HTML からは
   観測できない（キーボード操作・時間経過・レンダリング結果に依存する）ときは
   reason "not-observable-static" を返します。ルールが無いことを "not-applicable" や
   "not-observable-static" で言い換えてはいけません。

出力は JSON だけです。コードフェンス・前置き・後置きの説明文を一切付けず、
1 文字目が { で最後の文字が } になるようにしてください。
top-level は verdicts だけを持つオブジェクトで、定義外のキーを足してはいけません。

{"verdicts":[
  {"aspectId":"...","verdict":"pass","ruleId":"...","evidence":{"line":1,"snippet":"..."}},
  {"aspectId":"...","verdict":"fail","ruleId":"...","evidence":{"line":1,"snippet":"..."}},
  {"aspectId":"...","verdict":"not-evaluable","reason":"missing-rule","missing":["..."],"proposal":{"ruleId":"...","summary":"..."}},
  {"aspectId":"...","verdict":"not-evaluable","reason":"not-applicable","ruleId":"..."},
  {"aspectId":"...","verdict":"not-evaluable","reason":"not-observable-static","ruleId":"..."}
]}

pass の evidence は省略できます。fail の evidence は必須です。`;

export function formatRule(rule: RuleEntry): string {
  return [
    `### ${rule.id}`,
    `- category: ${rule.category}`,
    `- severity: ${rule.severity}`,
    `- 禁止する理由: ${rule.description}`,
    `- 代替: ${rule.alternative}`,
  ].join("\n");
}

/**
 * aspect 1 行。ruleIds を必ず併記する（ルール本文が抜かれていても「何が無いか」を
 * missing に書けるようにするため。本文が無いのに ID を引用したら検証器 3 が弾く）。
 */
export function formatAspect(aspect: JudgeAspect): string {
  return `- ${aspect.aspectId} | ${aspect.category} | rules: ${aspect.ruleIds.join(",")} | ${aspect.question}`;
}

/** formatAspect の逆変換。judge-mock が system prompt から aspect を復元するために使う */
export function parseAspectLines(
  aspectsSection: string
): Array<{ aspectId: string; category: string; ruleIds: string[] }> {
  return aspectsSection
    .split("\n")
    .map((line) => line.match(/^- (\S+) \| ([^|]+) \| rules: ([^|]*) \| /))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => ({
      aspectId: m[1],
      category: m[2].trim(),
      ruleIds: m[3].split(",").map((s) => s.trim()).filter(Boolean),
    }));
}

/** RULES 区画から供給済み ruleId を復元する */
export function parseSuppliedRuleIds(rulesSection: string): string[] {
  return rulesSection
    .split("\n")
    .map((line) => line.match(/^### (\S+)$/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => m[1]);
}

/** 行番号つきの原文。evidence.line と snippet の対応を一意にする */
export function numberLines(html: string): string {
  return html
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4, " ")}| ${line}`)
    .join("\n");
}

/** numberLines の逆変換。judge-mock が原文を復元するために使う */
export function stripLineNumbers(numbered: string): string {
  return numbered
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\|\s?/, ""))
    .join("\n");
}

export interface JudgeInputs {
  /** 契約の全 aspect（human-only を含む）。検証器の「全件ちょうど 1 回」の母集団 */
  aspects: JudgeAspect[];
  /** LLM に渡す aspect。human-only だけを除く（--targets では絞らない） */
  llmAspects: JudgeAspect[];
  /** system prompt に本文を載せたルール */
  suppliedRules: RuleEntry[];
  suppliedRuleIds: string[];
  /** --drop-rule で本文ごと抜いた ID（実際に抜けたものだけ） */
  droppedRuleIds: string[];
  system: string;
  prompt: string;
}

export function buildJudgeInputs(args: {
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
  dropRuleIds?: readonly string[];
}): JudgeInputs {
  const drop = new Set(args.dropRuleIds ?? []);
  const llmAspects = args.aspects.filter((a) => a.automationStatus !== "human-only");

  // human-only のルール本文は LLM に渡さない（テスト 11）。
  const llmRuleIds = new Set(llmAspects.flatMap((a) => a.ruleIds));
  const ruleById = new Map(args.rules.map((r) => [r.id, r]));

  const suppliedRules: RuleEntry[] = [];
  const droppedRuleIds: string[] = [];
  for (const id of llmRuleIds) {
    const rule = ruleById.get(id);
    if (rule == null) continue;
    if (drop.has(id)) {
      droppedRuleIds.push(id);
      continue;
    }
    suppliedRules.push(rule);
  }
  suppliedRules.sort((a, b) => a.id.localeCompare(b.id));
  droppedRuleIds.sort();

  const [rulesOpen, rulesClose] = SECTION_DELIMITERS.RULES;
  const [aspectsOpen, aspectsClose] = SECTION_DELIMITERS.ASPECTS;
  const system = [
    SYSTEM_DISCIPLINE,
    "",
    rulesOpen,
    suppliedRules.length > 0 ? suppliedRules.map(formatRule).join("\n\n") : "(ルール本文はありません)",
    rulesClose,
    "",
    aspectsOpen,
    llmAspects.map(formatAspect).join("\n"),
    aspectsClose,
  ].join("\n");

  const [htmlOpen, htmlClose] = SECTION_DELIMITERS.HTML;
  const prompt = [
    "次の HTML を、上の aspect すべてについて審査してください。JSON だけを返します。",
    "",
    htmlOpen,
    numberLines(args.html),
    htmlClose,
  ].join("\n");

  return {
    aspects: args.aspects,
    llmAspects,
    suppliedRules,
    suppliedRuleIds: suppliedRules.map((r) => r.id),
    droppedRuleIds,
    system,
    prompt,
  };
}

/**
 * 出力全体を JSON として parse する。**切り出しはしない**。
 *
 * コードフェンスを剥がしたり最初の `{` から最後の `}` を抜き出したりすると、
 * 「説明文 + JSON + 追記」を valid に変換してしまう。それは「JSON だけを返す」という
 * 契約を検証器の手前で骨抜きにする行為で、fail-closed ではない。
 * 前後に 1 文字でも余計なものが付いていたら parse 失敗 → 検証器が schema invalid にする。
 */
export function parseJudgeOutput(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

/**
 * 1 trial の「処置」。provenance の treatmentHash に入る。
 * file provider では temperature / tools が実行者側にあり melta 側で制御できないので、
 * 0 や false と書かずに null にする（制御していないことを嘘にしないため）。
 */
export interface JudgeTreatment {
  useTools: boolean | null;
  temperature: number | null;
  rawText: boolean | null;
}

/** API 経路（anthropic / mock）の処置。tools-off・temperature 0・原文取得を固定する */
export const JUDGE_API_TREATMENT: JudgeTreatment = {
  useTools: JUDGE_TOOLS_ENABLED,
  temperature: JUDGE_TEMPERATURE,
  rawText: JUDGE_RAW_TEXT,
};

/** file 経路の処置。melta 側は生成に関与しないので 3 つとも null */
export const JUDGE_FILE_TREATMENT: JudgeTreatment = {
  useTools: null,
  temperature: null,
  rawText: null,
};

export interface JudgeRunResult {
  inputs: JudgeInputs;
  raw: string;
  parsed: unknown;
  validation: JudgeValidationResult;
  generation: GenerationResult;
  /** provenance に載せる処置の hash（system + prompt + tools 有無 + temperature） */
  treatmentHash: string;
  /** 送信した system prompt の原文 hash。原文そのものは results/ の入力成果物に残す */
  systemHash: string;
  /** 送信した user prompt の原文 hash */
  promptHash: string;
  suppliedRuleSetHash: string;
  rawHash: string;
}

/**
 * 1 trial を実行する。provider は必ず tools-off / temperature=0 で呼ぶ。
 * fail 判定でも throw しない（observation only）。invalid かどうかは validation で返す。
 */
export async function runJudgeTrial(args: {
  provider: ModelProvider;
  aspects: JudgeAspect[];
  rules: RuleEntry[];
  html: string;
  knownRuleIds: readonly string[];
  dropRuleIds?: readonly string[];
}): Promise<JudgeRunResult> {
  const inputs = buildJudgeInputs({
    aspects: args.aspects,
    rules: args.rules,
    html: args.html,
    dropRuleIds: args.dropRuleIds,
  });

  const generation = await args.provider.generate(inputs.system, inputs.prompt, {
    useTools: JUDGE_TOOLS_ENABLED,
    temperature: JUDGE_TEMPERATURE,
    rawText: JUDGE_RAW_TEXT,
  });

  return evaluateJudgeOutputText({
    inputs,
    text: generation.text,
    aspects: args.aspects,
    knownRuleIds: args.knownRuleIds,
    html: args.html,
    generation,
    treatment: JUDGE_API_TREATMENT,
  });
}

/**
 * 応答本文（原文）を検証器に通して JudgeRunResult に整える。
 *
 * provider を呼ぶ経路（runJudgeTrial）と、応答をファイルから読む経路（file provider）で
 * **同じ検証と同じ hash 計算**を通すために切り出してある。ここで契約を分岐させると
 * 「file 経路だけ通る出力」が生まれ、二相 CLI の実測が API 経路と比較できなくなる。
 */
export function evaluateJudgeOutputText(args: {
  inputs: JudgeInputs;
  text: string;
  aspects: JudgeAspect[];
  knownRuleIds: readonly string[];
  html: string;
  generation: GenerationResult;
  treatment: JudgeTreatment;
}): JudgeRunResult {
  const { inputs } = args;
  const parsed = parseJudgeOutput(args.text);
  const validation = validateJudgeOutput({
    llmOutput: parsed,
    aspects: args.aspects,
    suppliedRuleIds: inputs.suppliedRuleIds,
    knownRuleIds: args.knownRuleIds,
    html: args.html,
  });

  return {
    inputs,
    raw: args.text,
    parsed,
    validation,
    generation: args.generation,
    treatmentHash: sha256(
      JSON.stringify({
        system: inputs.system,
        prompt: inputs.prompt,
        useTools: args.treatment.useTools,
        temperature: args.treatment.temperature,
        rawText: args.treatment.rawText,
      })
    ),
    systemHash: sha256(inputs.system),
    promptHash: sha256(inputs.prompt),
    suppliedRuleSetHash: sha256(inputs.suppliedRules.map(formatRule).join("\n\n")),
    rawHash: sha256(args.text),
  };
}

/**
 * anthropic provider を tools-off 前提で生成する。
 * provider は anthropic | mock | file のみ（openai は placeholder で常に throw するので CLI が
 * 受け付けない）。mock 側の生成は providers/judge-mock.ts が、file 側は file-provider.ts が
 * 持つ（循環 import を避ける）。
 */
export function createAnthropicJudgeProvider(model: string): ModelProvider {
  return createAnthropicProvider({ model });
}

export const JUDGE_PROVIDER_IDS: readonly JudgeProviderId[] = ["anthropic", "mock", "file"];
