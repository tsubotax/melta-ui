/**
 * coverage-stats.spec.ts — 検証カバレッジ集計の構造不変条件（P1-5）
 *
 * 公表する「静的自動検証 N/99」が嘘をつかないよう、集計の内訳と分類の整合を守る。
 * マジックナンバーに固定せず、ルール追加で自然に数字が動く前提で「構造」を検証する。
 */

import { test, expect } from "@playwright/test";
import { computeCoverage, isStaticallyDetectable } from "../scripts/design/coverage-stats.js";
import { getAllRules } from "../src/utils/loader.js";

test.describe("coverage-stats: 集計の構造整合", () => {
  test("内訳の合計が total に一致する（取りこぼし無し）", () => {
    const c = computeCoverage();
    expect(c.staticAuto).toBe(c.classAuto + c.htmlAttr + c.composition);
    expect(
      c.staticAuto + c.coveredByTest + c.impossibleStatic + c.llmJudgeCandidate + c.humanOnly + c.unclassified
    ).toBe(c.total);
  });

  test("auto 状態のルールは実際に検出機構を持つ", () => {
    for (const r of getAllRules()) {
      if (r.automationStatus !== "auto") continue;
      const detectable =
        r.pattern != null ||
        (r.matchPatterns?.length ?? 0) > 0 ||
        (r.prefixPatterns?.length ?? 0) > 0 ||
        r.htmlAttrCheck != null ||
        r.compositionCheck != null;
      expect(detectable, `${r.id} は auto だが検出機構が無い`).toBe(true);
    }
  });

  test("impossible-static は detector が manual/html-attr/composition（class 検出可能でない）", () => {
    for (const r of getAllRules()) {
      if (r.automationStatus !== "impossible-static") continue;
      expect(["manual", "html-attr", "composition"]).toContain(r.detector);
      // impossible-static は静的 spec を持たない（持つなら auto にすべき）
      expect(r.htmlAttrCheck == null && r.compositionCheck == null, `${r.id}`).toBe(true);
    }
  });

  test("静的自動検証は 41 件以上（P1-5 で 38→41 に到達した floor を割らない）", () => {
    // 退行ガード: 蘇生した composition a11y ルールが dead に戻ると割れる
    expect(computeCoverage().staticAuto).toBeGreaterThanOrEqual(41);
  });

  test("llm-judge-candidate / human-only は静的検出機構を持たない（宣言と機構の排他）", () => {
    // 静的検出できるなら分類は不要（detector/spec から導出）。宣言してしまうと coverage が二重計上になる
    for (const r of getAllRules()) {
      if (r.automationStatus !== "llm-judge-candidate" && r.automationStatus !== "human-only") continue;
      expect(isStaticallyDetectable(r), `${r.id} は ${r.automationStatus} だが静的検出機構を持つ`).toBe(false);
    }
  });

  test("無防備 error ルールは 43 件以下（2026-07 棚卸し完了時点の ceiling を超えて増やさない）", () => {
    // 増加検知: 新規 error ルールを自動検証なしで足すと割れる（分類 or 検証機構の追加を強制）
    expect(computeCoverage().unguardedError).toBeLessThanOrEqual(43);
  });

  test("未分類 0（ratchet: 新規ルールは静的検出機構か automationStatus 宣言のどちらかを必ず持つ）", () => {
    // 2026-07 棚卸しで全 99 件の検証経路を宣言済み。100 個目以降も棚卸し済み状態を維持する
    expect(computeCoverage().unclassified).toBe(0);
  });
});
