/**
 * judge-mock-broken.ts — 壊れ方を選べる mock（検証器のテスト専用・NOT EVIDENCE）
 *
 * 正常 mock の出力に 1 種類だけ変異を入れる。検証器が本当に何かを見ているかを
 * 確かめるための陰性対照側の道具で、実行結果は history にも results にも残さない。
 *
 * ブリーフ §5 の 4 つ（幻覚 ID / aspect 欠落 / human-only に pass / 架空の行番号）に加えて、
 * §7 テスト 3 が要求する false-missing-rule（ルールがあるのに missing-rule）を持つ。
 */

import type {
  GenerateOptions,
  GenerationResult,
  ModelProvider,
} from "../../../src/utils/types.js";
import type { JudgeVerdict } from "../schema.js";
import { buildMockVerdicts, readMockContext, type JudgeMockOptions } from "./judge-mock.js";

export type BrokenMockMode =
  /** 供給されていない ID を引用する */
  | "hallucinated-rule-id"
  /** aspect を 1 つ落とす */
  | "drop-aspect"
  /** human-only aspect に pass を返す */
  | "human-only-pass"
  /** 原文に無い行番号を evidence にする */
  | "fake-line"
  /** ルール本文があるのに missing-rule と言う（過剰 abstain） */
  | "false-missing-rule"
  /** top-level を配列で返す（{ verdicts: [...] } でない） */
  | "top-level-array"
  /** top-level に定義外キーを足す */
  | "top-level-extra-key";

export interface BrokenMockOptions extends JudgeMockOptions {
  mode: BrokenMockMode;
  /** human-only-pass モードで pass を捏造する aspectId。省略時は変異なし */
  humanOnlyAspectId?: string;
  /** 幻覚 ID として使う値 */
  hallucinatedRuleId?: string;
}

export function mutateVerdicts(
  verdicts: JudgeVerdict[],
  options: BrokenMockOptions
): JudgeVerdict[] {
  const next = verdicts.map((v) => ({ ...v }) as JudgeVerdict);

  switch (options.mode) {
    case "hallucinated-rule-id": {
      const target = next.find((v) => v.verdict === "pass" || v.verdict === "fail");
      if (target != null && "ruleId" in target) {
        target.ruleId = options.hallucinatedRuleId ?? "MELTA_NO_HALLUCINATED_RULE";
      }
      return next;
    }
    case "drop-aspect":
      return next.slice(1);
    case "human-only-pass": {
      if (options.humanOnlyAspectId == null) return next;
      next.push({
        aspectId: options.humanOnlyAspectId,
        verdict: "pass",
        ruleId: options.humanOnlyAspectId,
      });
      return next;
    }
    case "fake-line": {
      const target = next.find((v) => v.verdict === "fail");
      if (target != null && target.verdict === "fail") {
        target.evidence = { line: 99999, snippet: target.evidence.snippet };
      }
      return next;
    }
    case "top-level-array":
    case "top-level-extra-key":
      // verdicts 自体は正常。壊すのは JSON の top-level 形なので generate 側で処理する
      return next;
    case "false-missing-rule": {
      const index = next.findIndex((v) => v.verdict === "pass" || v.verdict === "fail");
      if (index < 0) return next;
      const target = next[index];
      const ruleId = "ruleId" in target ? target.ruleId : target.aspectId;
      next[index] = {
        aspectId: target.aspectId,
        verdict: "not-evaluable",
        reason: "missing-rule",
        missing: [ruleId],
        proposal: { ruleId, summary: "壊れ mock による過剰 abstain" },
      };
      return next;
    }
  }
}

export function createBrokenJudgeMockProvider(options: BrokenMockOptions): ModelProvider {
  return {
    id: "mock-broken",
    async generate(
      system: string,
      prompt: string,
      _opts?: GenerateOptions
    ): Promise<GenerationResult> {
      // human-only-pass は「LLM が渡されていない aspect について喋る」変異なので、
      // system prompt に載っていない aspectId を呼び出し側から受け取る必要がある。
      void readMockContext(system, prompt);
      const verdicts = mutateVerdicts(buildMockVerdicts(system, prompt, options), options);
      const payload: unknown =
        options.mode === "top-level-array"
          ? verdicts
          : options.mode === "top-level-extra-key"
            ? { verdicts, unexpected: true }
            : { verdicts };
      return {
        text: JSON.stringify(payload, null, 2),
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        resourcesAccessed: [],
      };
    },
  };
}
