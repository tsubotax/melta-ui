/**
 * provenance.ts — ベンチマーク計測来歴（施策6A, 2026-07）
 *
 * 「このスコアは何を・どの状態で測った数字か」を run ごとに自己記述させ、
 * ベンチを使い捨て実験から再現可能な計測器にする。
 *
 * 保存の2層構造:
 *   - results/<runDir>/provenance.json … per-run の詳細（results/ は gitignore、作業記録）
 *   - history.json への要約転記        … git に残る正本（時系列比較はこちら）
 *
 * score-dir モード（生成と採点が別 run）では、生成側 runDir の provenance.json を
 * 読んで generation フィールドに要約を引き継ぐ。見つからなければ null（推測で埋めない）。
 * 組み立て（純関数）と取得・IO（副作用）を分離し、純関数はテストから import する。
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 条件名の意味や処置の組み立てが変わったときに上げる実験プロトコル世代。
 * history の時系列比較は同じ version の run 同士に限定する。
 */
export const BENCHMARK_PROTOCOL_VERSION = 2;

export interface GitInfo {
  /** HEAD の commit SHA。git 取得失敗（CI 外・shallow 等）は null でベンチは止めない */
  commit: string | null;
  dirty: boolean | null;
  /** 未コミット変更のパス一覧（porcelain）。diff 本文は持たない */
  dirtyFiles: string[];
}

export interface ProviderInfo {
  id: string;
  model: string | null;
  temperature: number | null;
  /** temperature=null が「provider 既定値」であることを明示（実効値は現状取得不能） */
  temperatureSource: "cli" | "provider-default";
  trials: number;
}

/** score-dir 実行時に generation へ引き継ぐ生成時来歴の要約（再帰させない固定形） */
export interface GenerationSummary {
  date: string;
  /** 旧 provenance など世代不明の場合は null。異なる世代を暗黙比較しない。 */
  benchmarkProtocolVersion: number | null;
  git: GitInfo;
  provider: ProviderInfo;
  inputHashes: Record<string, unknown>;
}

export interface Provenance {
  schemaVersion: 2;
  benchmarkProtocolVersion: number;
  date: string;
  mode: "generate" | "score-dir";
  git: GitInfo;
  /** 静的 context・実際の処置（system + tools）・主要入力ファイルの hash */
  inputHashes: {
    contextByCondition: Record<string, string>;
    /** system prompt + tools 有無を含む、LLM に与えた実処置の hash */
    treatmentByCondition: Record<string, string>;
    files: Record<string, string>;
  };
  /** score-dir 時のみ: 採点対象 HTML 群の結合 hash（パス順ソートで安定） */
  scoredFilesDigest: string | null;
  provider: ProviderInfo;
  prompts: string[];
  conditions: string[];
  cli: string[];
  /** score-dir 時の生成元来歴。provenance.json が無い/壊れている場合は null（report に明記） */
  generation: GenerationSummary | null;
}

// ---------- 純関数（テストから import） ----------

export function buildProvenance(input: {
  date: string;
  mode: "generate" | "score-dir";
  git: GitInfo;
  contextHashes: Record<string, string>;
  treatmentHashes: Record<string, string>;
  fileHashes: Record<string, string>;
  scoredFilesDigest: string | null;
  provider: ProviderInfo;
  prompts: string[];
  conditions: string[];
  cli: string[];
  generation: GenerationSummary | null;
}): Provenance {
  return {
    schemaVersion: 2,
    benchmarkProtocolVersion: BENCHMARK_PROTOCOL_VERSION,
    date: input.date,
    mode: input.mode,
    git: input.git,
    inputHashes: {
      contextByCondition: input.contextHashes,
      treatmentByCondition: input.treatmentHashes,
      files: input.fileHashes,
    },
    scoredFilesDigest: input.scoredFilesDigest,
    provider: input.provider,
    prompts: input.prompts,
    conditions: input.conditions,
    cli: input.cli,
    generation: input.generation,
  };
}

/**
 * score-dir 入力側の provenance.json（parse 済み）から generation 要約を抽出する。
 * - mode=generate の provenance → その git / provider / inputHashes / date を要約化
 * - mode=score-dir の provenance → その generation をそのまま引き継ぐ（generation の
 *   generation は作らない = score-dir を再帰的に重ねても肥大しない）
 * - 形が不正なら null（推測で埋めない）
 */
export function extractGenerationSummary(parsed: unknown): GenerationSummary | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const p = parsed as Partial<Provenance>;
  if (p.mode === "score-dir") {
    return extractGenerationSummary(p.generation === undefined ? null : { mode: "generate", ...p.generation });
  }
  if (typeof p.date !== "string" || p.git == null || p.provider == null) return null;
  return {
    date: p.date,
    benchmarkProtocolVersion:
      typeof p.benchmarkProtocolVersion === "number"
        ? p.benchmarkProtocolVersion
        : null,
    git: p.git as GitInfo,
    provider: p.provider as ProviderInfo,
    inputHashes: (p.inputHashes ?? {}) as Record<string, unknown>,
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * condition.context だけでなく、実際に送る system prompt と tools の有無を固定する。
 * instructions 文や tool routing 条件の変更を provenance 上で区別するための hash。
 */
export function hashBenchmarkTreatment(system: string, useTools: boolean): string {
  return sha256(JSON.stringify({ system, useTools }));
}

// ---------- 副作用（git / ファイル IO） ----------

export function getGitInfo(cwd: string): GitInfo {
  try {
    const commit = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
    const porcelain = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
    const dirtyFiles = porcelain
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3));
    return { commit, dirty: dirtyFiles.length > 0, dirtyFiles };
  } catch {
    return { commit: null, dirty: null, dirtyFiles: [] };
  }
}

export function hashFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return sha256(readFileSync(path, "utf-8"));
}

/** 採点対象 HTML 群の結合 hash。パス順ソートで安定させる（ファイル名 + 内容を連結） */
export function digestFiles(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const h = createHash("sha256");
  for (const p of [...paths].sort()) {
    h.update(p);
    h.update("\0");
    try {
      h.update(readFileSync(p, "utf-8"));
    } catch {
      h.update("(unreadable)");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

/** score-dir 入力ディレクトリの provenance.json を読む。無い・壊れている場合は null */
export function readGenerationProvenance(scoreDir: string): GenerationSummary | null {
  const path = resolve(scoreDir, "provenance.json");
  if (!existsSync(path)) return null;
  try {
    return extractGenerationSummary(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}
