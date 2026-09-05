/**
 * judge-mock.ts — judge 用の決定論スタブ（テスト専用・NOT EVIDENCE）
 *
 * ⚠️ この provider が返す verdict は fixture がそう作っているだけで、モデルが規律に
 * 従った証拠ではない。CI で確かめられるのは「配線と検証器が動くこと」だけ。
 * モデルの挙動の証拠は実 provider の実測（PR3）でしか得られない。
 *
 * 挙動: system prompt の <<<RULES>>> に本文がある aspect は fixture 由来の verdict、
 * 本文が無い aspect は not-evaluable/missing-rule。判断材料は system と prompt だけで、
 * 呼び出し側から HTML や aspect 一覧を受け取らない（tautology を最小にするため）。
 */

import type {
  GenerateOptions,
  GenerationResult,
  ModelProvider,
} from "../../../src/utils/types.js";
import {
  extractSection,
  parseAspectLines,
  parseSuppliedRuleIds,
  stripLineNumbers,
} from "../adapter.js";
import type { JudgeVerdict } from "../schema.js";
import { normalizeWhitespace } from "../validate.js";

export type MockAspectFixture =
  | { verdict: "pass" }
  /** probe は審査対象 HTML に実在する文字列。mock はそれを含む最初の行を evidence にする */
  | { verdict: "fail"; probe: string }
  | { verdict: "not-applicable" }
  | { verdict: "not-observable-static" };

export interface JudgeMockOptions {
  /** aspectId → 期待 verdict。未指定の aspect は pass */
  fixtures?: Record<string, MockAspectFixture>;
  /** ルール本文が無いときに付ける proposal の要約 */
  proposalSummary?: string;
}

export interface MockJudgeContext {
  aspects: Array<{ aspectId: string; category: string; ruleIds: string[] }>;
  suppliedRuleIds: Set<string>;
  lines: string[];
}

/** system / prompt だけから判定に必要な文脈を復元する */
export function readMockContext(system: string, prompt: string): MockJudgeContext {
  return {
    aspects: parseAspectLines(extractSection(system, "ASPECTS")),
    suppliedRuleIds: new Set(parseSuppliedRuleIds(extractSection(system, "RULES"))),
    lines: stripLineNumbers(extractSection(prompt, "HTML")).split("\n"),
  };
}

function findEvidence(lines: string[], probe: string): { line: number; snippet: string } {
  const normalizedProbe = normalizeWhitespace(probe);
  const index = lines.findIndex((l) => normalizeWhitespace(l).includes(normalizedProbe));
  if (index < 0) {
    throw new Error(`judge-mock: probe が fixture HTML に見つかりません: ${probe}`);
  }
  return { line: index + 1, snippet: probe };
}

/** system / prompt から verdict 配列を組み立てる純関数。broken mock が変異させる元 */
export function buildMockVerdicts(
  system: string,
  prompt: string,
  options: JudgeMockOptions = {}
): JudgeVerdict[] {
  const ctx = readMockContext(system, prompt);
  const fixtures = options.fixtures ?? {};
  const summary = options.proposalSummary ?? "この観点を判定するためのルールを rules.json に追加する候補";

  return ctx.aspects.map((aspect): JudgeVerdict => {
    const unsupplied = aspect.ruleIds.filter((id) => !ctx.suppliedRuleIds.has(id));
    const supplied = aspect.ruleIds.filter((id) => ctx.suppliedRuleIds.has(id));

    if (supplied.length === 0) {
      return {
        aspectId: aspect.aspectId,
        verdict: "not-evaluable",
        reason: "missing-rule",
        missing: unsupplied,
        proposal: { ruleId: aspect.ruleIds[0], summary },
      };
    }

    const fixture = fixtures[aspect.aspectId] ?? { verdict: "pass" as const };
    const ruleId = supplied[0];
    if (fixture.verdict === "fail") {
      return {
        aspectId: aspect.aspectId,
        verdict: "fail",
        ruleId,
        evidence: findEvidence(ctx.lines, fixture.probe),
      };
    }
    if (fixture.verdict === "not-applicable" || fixture.verdict === "not-observable-static") {
      return { aspectId: aspect.aspectId, verdict: "not-evaluable", reason: fixture.verdict, ruleId };
    }
    return { aspectId: aspect.aspectId, verdict: "pass", ruleId };
  });
}

/** レポート・CLI 出力に必ず添える表示。mock の結果を実測と取り違えないため */
export const MOCK_FIXTURE_BANNER =
  "**MOCK FIXTURE — NOT EVIDENCE**: この結果は配線と検証器の確認用に合成されたもので、モデルが「評価不可」の規律に従う証拠ではありません。";

export function createJudgeMockProvider(options: JudgeMockOptions = {}): ModelProvider {
  return {
    id: "mock",
    async generate(
      system: string,
      prompt: string,
      _opts?: GenerateOptions
    ): Promise<GenerationResult> {
      const verdicts = buildMockVerdicts(system, prompt, options);
      return {
        text: JSON.stringify({ verdicts }, null, 2),
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        resourcesAccessed: [],
      };
    },
  };
}
