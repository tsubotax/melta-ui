/**
 * stats.ts — ベンチ集計の純関数（runner から分離してテスト可能にする）
 *
 * P1-4 Slice 2: 複数条件 × N トライアルの分布を
 * mean±range で集計し、条件間の限界寄与（lift）を出す。
 * Atlassian「context engine で +52%」式の「DS を足すと準拠スコアが何点上がるか」を
 * 自前の一次データとして提示するための土台。
 */

export interface Summary {
  n: number;
  mean: number;
  min: number;
  max: number;
  /** 標本標準偏差（不偏、n-1 で割る） */
  stdev: number;
  /** 95% 信頼区間の半幅（mean ± ci95）。n<2 は null（区間を主張できない） */
  ci95: number | null;
}

// t 分布の両側 95% 臨界値（df=1..30）。小標本の CI を Normal 近似より正直に出すため。
// df>30 は 2.04→1.96 に漸近するので 2.0 を使う。
const T_95: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
  15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056,
  27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

export function summarize(scores: number[]): Summary {
  if (scores.length === 0) {
    return { n: 0, mean: 0, min: 0, max: 0, stdev: 0, ci95: null };
  }
  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  // 不偏分散（n-1）。n=1 は分散・CI を定義できない
  const stdev =
    n < 2 ? 0 : Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const ci95 = n < 2 ? null : (T_95[n - 1] ?? 2.0) * (stdev / Math.sqrt(n));
  return { n, mean, min, max, stdev, ci95 };
}

export interface Lift {
  /** 絶対差（point） */
  abs: number;
  /** 相対上昇率（%）。base が 0 のときは null */
  pct: number | null;
}

// 相対 % を出してよい最小ベースライン。base がこれ未満だと「6点→80点 = +1168%」のように
// % が誇張・無意味になるため、絶対ポイント差のみを主指標にする（pct=null）。
const MIN_BASE_FOR_PCT = 10;

/** base 条件に対する target 条件の限界寄与。低ベースラインでは pct を出さない */
export function computeLift(baseMean: number, targetMean: number): Lift {
  const abs = targetMean - baseMean;
  const pct = Math.abs(baseMean) < MIN_BASE_FOR_PCT ? null : (abs / baseMean) * 100;
  return { abs, pct };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** mean ± 95%CI を主、range/σ/n を補助で整形 */
export function formatSummary(s: Summary): string {
  const ci = s.ci95 == null ? "" : ` ±${s.ci95.toFixed(1)}`;
  return `${s.mean.toFixed(1)}${ci} (${round1(s.min)}–${round1(s.max)}, σ${s.stdev.toFixed(1)}, n=${s.n})`;
}

export function formatLift(l: Lift): string {
  const sign = l.abs > 0 ? "+" : "";
  const pctStr = l.pct == null ? "" : ` (${l.pct > 0 ? "+" : ""}${l.pct.toFixed(0)}%)`;
  return `${sign}${l.abs.toFixed(1)}${pctStr}`;
}
