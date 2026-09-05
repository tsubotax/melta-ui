/**
 * validate.ts — fail-closed 検証器（決定論。LLM を信用しない層）
 *
 * この実装の核。judge の出力は「形式の正直さ」だけをここで担保する:
 *   - 全 aspect にちょうど 1 つの verdict がある
 *   - 引用した ruleId が実在し、かつその aspect のものである
 *   - evidence が原文の行に実在する
 *   - 「ルールが無いから評価不可」と言えるのは、本当にルールが供給されていないときだけ
 *
 * 担保**しない**もの: fail が本当に違反かという意味的な判定精度。docs/judge.md 参照。
 *
 * ブリーフ §3 の 1〜13 を実装する。各チェックの冒頭に対応番号を書いてある。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  JudgeAspect,
  JudgeAspectsFile,
  JudgeEvidence,
  JudgeValidationCode,
  JudgeValidationReason,
  JudgeValidationResult,
  JudgeVerdict,
} from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ASPECTS_PATH = resolve(__dirname, "aspects.json");

export function loadAspectsFile(path: string = ASPECTS_PATH): JudgeAspectsFile {
  return JSON.parse(readFileSync(path, "utf-8")) as JudgeAspectsFile;
}

export function loadAspects(path: string = ASPECTS_PATH): JudgeAspect[] {
  return loadAspectsFile(path).aspects;
}

/** 空白の揺れで evidence 照合が落ちないようにする正規化。全角空白も潰す */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s　]+/g, " ").trim();
}

/**
 * human-only aspect の verdict は adapter が決定論で確定する。
 * LLM には渡さないので、LLM が human-only について何か言ったら invalid（検査 8）。
 */
export function buildHumanOnlyVerdicts(aspects: JudgeAspect[]): JudgeVerdict[] {
  return aspects
    .filter((a) => a.automationStatus === "human-only")
    .map((a) => ({
      aspectId: a.aspectId,
      verdict: "not-evaluable" as const,
      reason: "human-only" as const,
    }));
}

export interface JudgeValidateInput {
  /** LLM が返した生の出力（parse 済み JSON。形が違えば schema エラーにする） */
  llmOutput: unknown;
  /** 契約の全 aspect（human-only を含む） */
  aspects: JudgeAspect[];
  /** system prompt にルール本文を載せた ruleId の集合（drop 後・human-only 除外後） */
  suppliedRuleIds: readonly string[];
  /** rules.json の全 ruleId。proposal の越境検査に使う */
  knownRuleIds: readonly string[];
  /** 審査対象 HTML の原文。evidence の行照合に使う */
  html: string;
  /** 省略時は buildHumanOnlyVerdicts(aspects)。テストから差し替えるためだけの口 */
  deterministicVerdicts?: JudgeVerdict[];
}

const VERDICT_KEYS: Record<string, string[]> = {
  pass: ["aspectId", "verdict", "ruleId", "evidence"],
  fail: ["aspectId", "verdict", "ruleId", "evidence"],
  "not-evaluable:missing-rule": ["aspectId", "verdict", "reason", "missing", "proposal"],
  "not-evaluable:human-only": ["aspectId", "verdict", "reason"],
  "not-evaluable:not-applicable": ["aspectId", "verdict", "reason", "ruleId"],
  "not-evaluable:not-observable-static": ["aspectId", "verdict", "reason", "ruleId"],
};

function reason(
  code: JudgeValidationCode,
  aspectId: string | null,
  message: string
): JudgeValidationReason {
  return { code, aspectId, message };
}

function isEvidence(v: unknown): v is JudgeEvidence {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  if (keys.join(",") !== "line,snippet") return false;
  const e = v as Record<string, unknown>;
  return Number.isInteger(e.line) && typeof e.snippet === "string";
}

/**
 * 検査 1: スキーマ適合。union の分岐ごとにキー集合を完全一致で見る。
 * 余分なキーも invalid にする（fail-closed。system prompt でも「余分なキーを付けない」と指示する）。
 */
function checkSchema(raw: unknown, out: JudgeValidationReason[]): JudgeVerdict[] {
  // top-level は「キーが verdicts だけの非配列 object」に限定する（fail-closed）。
  // 配列直返しと余分な top-level キーを受理すると、docs の「定義外キーは invalid」と矛盾する。
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    out.push(reason("schema", null, "出力が { verdicts: [...] } の object ではありません"));
    return [];
  }
  const topKeys = Object.keys(raw as Record<string, unknown>);
  const extraTopKeys = topKeys.filter((k) => k !== "verdicts");
  if (extraTopKeys.length > 0) {
    out.push(reason("schema", null, `top-level に許可されないキー: ${extraTopKeys.join(",")}`));
    return [];
  }
  const list = (raw as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(list)) {
    out.push(reason("schema", null, "verdicts が配列ではありません"));
    return [];
  }

  const accepted: JudgeVerdict[] = [];
  for (const [i, item] of (list as unknown[]).entries()) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      out.push(reason("schema", null, `verdicts[${i}] がオブジェクトではありません`));
      continue;
    }
    const v = item as Record<string, unknown>;
    const aspectId = typeof v.aspectId === "string" ? v.aspectId : null;
    if (aspectId == null || aspectId.length === 0) {
      out.push(reason("schema", null, `verdicts[${i}] の aspectId が文字列ではありません`));
      continue;
    }
    const verdict = v.verdict;
    if (verdict !== "pass" && verdict !== "fail" && verdict !== "not-evaluable") {
      out.push(reason("schema", aspectId, `verdict が pass/fail/not-evaluable ではありません: ${String(verdict)}`));
      continue;
    }

    const branch =
      verdict === "not-evaluable" ? `not-evaluable:${String(v.reason)}` : verdict;
    const allowed = VERDICT_KEYS[branch];
    if (allowed == null) {
      out.push(reason("schema", aspectId, `未知の reason: ${String(v.reason)}`));
      continue;
    }

    const present = Object.keys(v);
    const unknownKeys = present.filter((k) => !allowed.includes(k));
    if (unknownKeys.length > 0) {
      out.push(reason("schema", aspectId, `${branch} に許可されないキー: ${unknownKeys.join(",")}`));
      continue;
    }

    let shapeOk = true;
    const requireRuleId = (): void => {
      if (typeof v.ruleId !== "string" || v.ruleId.length === 0) {
        out.push(reason("schema", aspectId, `${branch} には ruleId が必要です`));
        shapeOk = false;
      }
    };

    if (verdict === "pass") {
      requireRuleId();
      if (v.evidence !== undefined && !isEvidence(v.evidence)) {
        out.push(reason("schema", aspectId, "pass の evidence の形が不正です"));
        shapeOk = false;
      }
    } else if (verdict === "fail") {
      requireRuleId();
      if (!isEvidence(v.evidence)) {
        out.push(reason("schema", aspectId, "fail には evidence { line, snippet } が必要です"));
        shapeOk = false;
      }
    } else if (v.reason === "missing-rule") {
      if (!Array.isArray(v.missing) || v.missing.some((m) => typeof m !== "string")) {
        out.push(reason("schema", aspectId, "missing-rule には string[] の missing が必要です"));
        shapeOk = false;
      }
      const p = v.proposal as Record<string, unknown> | undefined;
      const pKeys = p == null || typeof p !== "object" ? [] : Object.keys(p).sort();
      if (p == null || typeof p !== "object" || pKeys.join(",") !== "ruleId,summary" ||
        typeof p.ruleId !== "string" || p.ruleId.length === 0 ||
        typeof p.summary !== "string") {
        out.push(reason("schema", aspectId, "missing-rule には proposal { ruleId, summary } が必要です"));
        shapeOk = false;
      }
    } else if (v.reason === "not-applicable" || v.reason === "not-observable-static") {
      requireRuleId();
    }

    if (shapeOk) accepted.push(item as JudgeVerdict);
  }
  return accepted;
}

/**
 * judge 出力の fail-closed 検証。1 つでも破れば valid=false。
 * verdicts は valid のときだけ意味を持つ（決定論の human-only をマージ済み）。
 */
export function validateJudgeOutput(input: JudgeValidateInput): JudgeValidationResult {
  const reasons: JudgeValidationReason[] = [];
  const aspectById = new Map(input.aspects.map((a) => [a.aspectId, a]));
  const supplied = new Set(input.suppliedRuleIds);
  const known = new Set(input.knownRuleIds);
  const lines = input.html.split("\n");

  const llmVerdicts = checkSchema(input.llmOutput, reasons);

  // 検査 8: human-only aspect は LLM に渡さない。LLM 出力に混ざっていたら invalid。
  for (const v of llmVerdicts) {
    const aspect = aspectById.get(v.aspectId);
    if (aspect != null && aspect.automationStatus === "human-only") {
      reasons.push(
        reason(
          "human-only-from-llm",
          v.aspectId,
          `human-only aspect の verdict が LLM 出力に含まれています（verdict=${v.verdict}）`
        )
      );
    }
  }

  const deterministic = input.deterministicVerdicts ?? buildHumanOnlyVerdicts(input.aspects);
  const humanOnlyIds = new Set(deterministic.map((v) => v.aspectId));
  const merged: JudgeVerdict[] = [
    ...llmVerdicts.filter((v) => !humanOnlyIds.has(v.aspectId)),
    ...deterministic,
  ];

  // 検査 2 / 7: 全 aspect がちょうど 1 回。欠落・重複・未知 ID をすべて弾く。
  // pass と fail の混在（検査 7）は「ちょうど 1 回」から従うが、重複時の理由を分けて出す。
  const byAspect = new Map<string, JudgeVerdict[]>();
  for (const v of merged) {
    const list = byAspect.get(v.aspectId) ?? [];
    list.push(v);
    byAspect.set(v.aspectId, list);
  }
  for (const [aspectId, list] of byAspect) {
    if (!aspectById.has(aspectId)) {
      reasons.push(reason("aspect-coverage", aspectId, "契約に無い aspectId です"));
      continue;
    }
    if (list.length > 1) {
      const kinds = new Set(list.map((v) => v.verdict));
      if (kinds.has("pass") && kinds.has("fail")) {
        reasons.push(reason("pass-fail-mixed", aspectId, "同一 aspect に pass と fail が混在しています"));
      }
      reasons.push(reason("aspect-coverage", aspectId, `verdict が ${list.length} 個あります（ちょうど 1 個が必要）`));
    }
  }
  for (const aspect of input.aspects) {
    if (!byAspect.has(aspect.aspectId)) {
      reasons.push(reason("aspect-coverage", aspect.aspectId, "verdict がありません"));
    }
  }

  for (const v of merged) {
    const aspect = aspectById.get(v.aspectId);
    if (aspect == null) continue;
    const isHumanOnly = aspect.automationStatus === "human-only";

    // 検査 4: automationStatus ごとの許可 verdict。human-only は not-evaluable/human-only のみ。
    if (isHumanOnly) {
      if (v.verdict !== "not-evaluable" || v.reason !== "human-only") {
        reasons.push(
          reason(
            "verdict-not-allowed-for-status",
            v.aspectId,
            "human-only aspect には not-evaluable/human-only 以外を許可しません"
          )
        );
      }
      continue; // human-only は以降の供給集合・evidence 検査の対象外
    }
    if (v.verdict === "not-evaluable" && v.reason === "human-only") {
      reasons.push(
        reason(
          "verdict-not-allowed-for-status",
          v.aspectId,
          "llm-judge-candidate aspect に human-only の理由は使えません"
        )
      );
      continue;
    }

    const aspectRuleIds = new Set(aspect.ruleIds);
    const unsuppliedForAspect = aspect.ruleIds.filter((id) => !supplied.has(id));
    const anySupplied = aspect.ruleIds.some((id) => supplied.has(id));

    // 検査 3 / 10: ruleId を持つ全分岐（pass / fail / not-applicable / not-observable-static）で
    // 「供給集合に実在 かつ この aspect の ruleIds 内」を検査する。
    if ("ruleId" in v && typeof v.ruleId === "string") {
      if (!supplied.has(v.ruleId)) {
        // 「rules.json に無い（純粋な幻覚）」と「実在するが今回供給していない」を区別して残す
        reasons.push(
          reason(
            "rule-id-not-supplied",
            v.aspectId,
            known.has(v.ruleId)
              ? `供給されていない ruleId を引用しています: ${v.ruleId}`
              : `rules.json に存在しない ruleId を引用しています: ${v.ruleId}`
          )
        );
      }
      if (!aspectRuleIds.has(v.ruleId)) {
        reasons.push(
          reason("rule-id-not-in-aspect", v.aspectId, `この aspect の ruleIds 外を引用しています: ${v.ruleId}`)
        );
      }
    }

    // 検査 11: ルール本文が供給されていない aspect は missing-rule 以外を全て invalid。
    // not-observable-static / not-applicable で missing-rule を回避させない。
    if (!anySupplied) {
      const isMissingRule = v.verdict === "not-evaluable" && v.reason === "missing-rule";
      if (!isMissingRule) {
        reasons.push(
          reason(
            "unsupplied-aspect-non-missing-rule",
            v.aspectId,
            `ルール本文が供給されていない aspect に ${v.verdict}${v.verdict === "not-evaluable" ? "/" + v.reason : ""} を返しています`
          )
        );
      }
    }

    // 検査 5: missing-rule はルールが供給されていない場合だけ許可（過剰 abstain の対照）。
    // 検査 12: missing は未供給集合と完全一致。proposal はこの aspect に紐づく。
    if (v.verdict === "not-evaluable" && v.reason === "missing-rule") {
      if (anySupplied) {
        reasons.push(
          reason(
            "missing-rule-but-rule-supplied",
            v.aspectId,
            `ルール本文は供給されているのに missing-rule と判定しています（供給: ${aspect.ruleIds.filter((id) => supplied.has(id)).join(",")}）`
          )
        );
      }
      const got = [...new Set(v.missing)].sort();
      const want = [...unsuppliedForAspect].sort();
      if (got.join(",") !== want.join(",")) {
        reasons.push(
          reason(
            "missing-set-mismatch",
            v.aspectId,
            `missing が未供給集合と一致しません（受領: [${got.join(",")}] / 期待: [${want.join(",")}]）`
          )
        );
      }
      // proposal.ruleId は当該 aspect の未供給 ruleId に限定する。初版は aspect : rule が 1:1 で、
      // 「この観点を判定するために足りないルール」は未供給集合そのものだから、新規 ID を許すと
      // DELETE_DATABASE のような無関係な提案が素通りする。
      const pid = v.proposal.ruleId;
      if (!unsuppliedForAspect.includes(pid)) {
        reasons.push(
          reason(
            "proposal-unrelated",
            v.aspectId,
            `proposal.ruleId が当該 aspect の未供給 ruleId ではありません: ${pid}（許可: [${unsuppliedForAspect.join(",")}]）`
          )
        );
      }
      if (normalizeWhitespace(v.proposal.summary).length === 0) {
        reasons.push(reason("proposal-unrelated", v.aspectId, "proposal.summary が空です"));
      }
    }

    // 検査 9: not-observable-static は staticObservability が partial / no の aspect だけ。
    if (v.verdict === "not-evaluable" && v.reason === "not-observable-static") {
      if (aspect.staticObservability === "yes") {
        reasons.push(
          reason(
            "not-observable-static-not-allowed",
            v.aspectId,
            "staticObservability=yes の aspect に not-observable-static は使えません"
          )
        );
      }
    }

    // 検査 6 / 13: evidence.line が範囲内、snippet が当該行に空白正規化後で含まれ、かつ非空。
    const evidence = "evidence" in v ? v.evidence : undefined;
    if (evidence != null) {
      if (evidence.line < 1 || evidence.line > lines.length) {
        reasons.push(
          reason(
            "evidence-line-out-of-range",
            v.aspectId,
            `evidence.line が範囲外です: ${evidence.line}（1..${lines.length}）`
          )
        );
      } else {
        const normalizedSnippet = normalizeWhitespace(evidence.snippet);
        if (normalizedSnippet.length === 0) {
          reasons.push(reason("evidence-snippet-empty", v.aspectId, "evidence.snippet が空です"));
        } else if (!normalizeWhitespace(lines[evidence.line - 1]).includes(normalizedSnippet)) {
          reasons.push(
            reason(
              "evidence-snippet-not-found",
              v.aspectId,
              `evidence.snippet が ${evidence.line} 行目に存在しません: ${evidence.snippet}`
            )
          );
        }
      }
      if (normalizeWhitespace(evidence.snippet).length === 0 && (evidence.line < 1 || evidence.line > lines.length)) {
        // 行が範囲外かつ空 snippet のときも「空」を必ず 1 件残す（範囲外で早期 return しない）
        reasons.push(reason("evidence-snippet-empty", v.aspectId, "evidence.snippet が空です"));
      }
    }
  }

  return { valid: reasons.length === 0, reasons, verdicts: merged };
}
