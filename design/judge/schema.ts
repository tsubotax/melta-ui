/**
 * schema.ts — shadow judge の出力契約（PR1 / observation only）
 *
 * `design/schemas/` は playbook の保護パス（SSOT write-protection）なので、judge の
 * 出力契約はここに置く。rules.json / tokens.json の schema とは階層が違う:
 *   - design/schemas/*.schema.json … DS の SSOT が満たす形（human gate）
 *   - design/judge/schema.ts       … judge の「1 run の出力」が満たす形（本ファイル）
 *
 * 判定は discriminated union。`verdict` と `reason` の組でしか表現できない形にして、
 * 「evidence の無い fail」「missing の無い missing-rule」を型と検証器の両方で塞ぐ。
 * 意味的な正しさ（fail が本当に違反か）はこの契約では担保しない — docs/judge.md を参照。
 */

/** 静的 HTML から観測できるか。not-observable-static を許す条件になる */
export type StaticObservability = "yes" | "partial" | "no";

/** rules.json の automationStatus のうち judge が扱う 2 値 */
export type JudgeAutomationStatus = "llm-judge-candidate" | "human-only";

/** aspects.json の 1 エントリ（審査観点 = 判定できる 1 つの問い） */
export interface JudgeAspect {
  aspectId: string;
  question: string;
  /** 初版は必ず 1 本で aspectId === ruleIds[0]。将来 1 aspect 複数 rule を許すため配列 */
  ruleIds: string[];
  category: string;
  automationStatus: JudgeAutomationStatus;
  staticObservability: StaticObservability;
  /** 同じ欠陥を拾う別ルール（陰性対照の既定対象から外す判断に使う）。静的ルールも含む */
  siblings: string[];
}

export interface JudgeAspectsFile {
  version: string;
  judgeProtocolVersion: number;
  note?: string;
  /** --negative-control の既定対象（siblings 無し・staticObservability yes から選ぶ） */
  representativeAspects: string[];
  aspects: JudgeAspect[];
}

/** 原文の行をそのまま指す証拠。line は 1 起点、snippet は当該行に実在する部分文字列 */
export interface JudgeEvidence {
  line: number;
  snippet: string;
}

/** 不足ルール候補。非 authoritative（Memory Quarantine 扱い。rules.json へは人間が別 PR で反映） */
export interface JudgeProposal {
  ruleId: string;
  summary: string;
}

export type JudgeVerdict =
  /** ルール本文が供給され、違反が無い。evidence は任意 */
  | { aspectId: string; verdict: "pass"; ruleId: string; evidence?: JudgeEvidence }
  /** ルール本文が供給され、違反がある。evidence 必須 */
  | { aspectId: string; verdict: "fail"; ruleId: string; evidence: JudgeEvidence }
  /** 該当ルールがハーネスに無い = 「評価不可」の本体。missing と proposal 必須 */
  | {
      aspectId: string;
      verdict: "not-evaluable";
      reason: "missing-rule";
      missing: string[];
      proposal: JudgeProposal;
    }
  /** 人間レビュー専用。LLM は出力しない（adapter が決定論で付加する） */
  | { aspectId: string; verdict: "not-evaluable"; reason: "human-only" }
  /** 対象 HTML にこの aspect の対象要素が無い */
  | { aspectId: string; verdict: "not-evaluable"; reason: "not-applicable"; ruleId: string }
  /** ルールはあるが静的 HTML から観測できない（staticObservability が partial / no のみ） */
  | {
      aspectId: string;
      verdict: "not-evaluable";
      reason: "not-observable-static";
      ruleId: string;
    };

export type JudgeReason = Extract<JudgeVerdict, { verdict: "not-evaluable" }>["reason"];

/** LLM に返させる 1 run 分の出力 */
export interface JudgeOutput {
  verdicts: JudgeVerdict[];
}

/** 検証器が拒否した理由。code で機械集計、message は人間向け */
export interface JudgeValidationReason {
  code: JudgeValidationCode;
  aspectId: string | null;
  message: string;
}

export type JudgeValidationCode =
  | "schema"
  | "aspect-coverage"
  | "rule-id-not-supplied"
  | "rule-id-not-in-aspect"
  | "verdict-not-allowed-for-status"
  | "missing-rule-but-rule-supplied"
  | "evidence-line-out-of-range"
  | "evidence-snippet-not-found"
  | "evidence-snippet-empty"
  | "pass-fail-mixed"
  | "human-only-from-llm"
  | "not-observable-static-not-allowed"
  | "unsupplied-aspect-non-missing-rule"
  | "missing-set-mismatch"
  | "proposal-unrelated"
  /**
   * 実行者が output ファイルを置かなかった trial。
   * **validateJudgeOutput は出さない**（検証器 13 条件は出力があることを前提にしている）。
   * file provider の collect 層だけが付ける code で、「出力が無い = invalid」を
   * 「valid でも invalid でもない未実施」に逃がさないために置いてある。
   */
  | "missing-output";

export interface JudgeValidationResult {
  valid: boolean;
  reasons: JudgeValidationReason[];
  /** valid のときだけ意味を持つ、決定論 verdict をマージ済みの全 aspect 分 */
  verdicts: JudgeVerdict[];
}
