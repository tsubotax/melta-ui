/**
 * score.ts — 生成 HTML の自動スコアリング（runner から分離）
 *
 * P4 で provider を切り替えても同じ scoring を使えるよう純粋関数化。
 * runner.ts は GenerationResult.text をここに渡すだけにする。
 *
 * P1-4 Slice 1: 採点コアを共通 lint core（lintSource + lintComposition）に差し替え。
 * CI / MCP check_html / PostToolUse hook と同一判定になり、旧ナイーブ includes の
 * 誤検出（top-0 → p-0 等）と、Q3/Q5/S2 で増えた検知（prefixPatterns / html-attr /
 * composition）の未反映を同時に解消する。
 * 2026-10-10: 自前の連結をやめ、単一 lint API `lint()`（src/utils/lint.ts）を呼ぶ。
 * benchmark の採点だけ経路が別だと、check_html / CI / hook / npm と合否が食い違いうる。
 */

import { extractClassStrings, type LintViolation } from "../../src/utils/lint-core.js";
import { lint } from "../../src/utils/lint.js";

export interface Score {
  /** error 違反数（lint core 判定） */
  ruleViolations: number;
  violationDetails: string[];
  /** warn 違反数（lint core 判定） */
  prohibitedPatterns: number;
  patternDetails: string[];
  totalScore: number;
}

function formatViolation(v: LintViolation): string {
  return `[${v.severity}] ${v.ruleId}: "${v.token}" → ${v.alternative}`;
}

// 採点の重み（DS 準拠の proxy であり、見た目の美しさそのものではない）。
// 50 を「DS を知らない素の出力」相当のベースラインとし、違反で減点・準拠シグナルで加点する
// ヒューリスティック。重みは恣意性を避けるため定数化して可視化し、感度分析の対象にする。
const BASE = 50;
const ERROR_PENALTY = 10;
const WARN_PENALTY = 3;
const SIGNAL_BONUS = 5;

// 準拠シグナル: 実際の class 属性 / 属性に出現したものだけを数える（コメントや本文への
// 文字列埋め込みで稼げないよう、生の html.includes はやめて class トークン / 属性で判定）。
const SIGNAL_CLASSES = [
  "primary-500",
  "rounded-xl",
  "shadow-sm",
  "border-slate-200",
  "text-slate-900",
  "text-body",
  "cursor-pointer",
  "font-medium",
];

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function countPositiveSignals(html: string): number {
  // class 属性に実在するトークンのみ集計（extractClassStrings はコメント除去済み）
  const classTokens = new Set(
    extractClassStrings(html)
      .flatMap((cls) => cls.split(/\s+/))
      .filter(Boolean)
  );
  let signals = SIGNAL_CLASSES.filter((c) => classTokens.has(c)).length;
  // 属性ベースのシグナル（コメント除去後の本体に実属性として出現するか）
  const body = stripComments(html);
  if (/\bscope\s*=\s*["']col["']/.test(body)) signals++;
  if (/\baria-label\s*=\s*["'][^"']+["']/.test(body)) signals++;
  return signals;
}

/**
 * HTML をスコアリング（DS 準拠の proxy）。
 * - 共通 lint core による違反検出（error -10 / warn -3）— CI / check_html と同一判定
 * - DS 準拠シグナル（class 属性 / a11y 属性に実在するもののみ +5/個）
 * - 総合スコア（0-100、BASE 50 ± 加減点）
 */
export function scoreHTML(html: string): Score {
  // 生成物は HTML なので composition まで検査する（check_html の既定と同じ）
  const violations = lint(html, { sourceType: "html" }).violations;
  const errors = violations.filter((v) => v.severity === "error");
  const warns = violations.filter((v) => v.severity === "warn");

  const positiveSignals = countPositiveSignals(html);
  const violationPenalty = errors.length * ERROR_PENALTY + warns.length * WARN_PENALTY;
  const positiveBonus = positiveSignals * SIGNAL_BONUS;
  const totalScore = Math.max(0, Math.min(100, BASE + positiveBonus - violationPenalty));

  return {
    ruleViolations: errors.length,
    violationDetails: errors.map(formatViolation),
    prohibitedPatterns: warns.length,
    patternDetails: warns.map(formatViolation),
    totalScore,
  };
}
