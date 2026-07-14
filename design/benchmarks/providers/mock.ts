/**
 * mock provider — API 不要のオフライン検証用。
 *
 * 目的は「runner の複数条件 × N トライアル → 集計 → レポート」という
 * パイプライン機構そのものの回帰テスト（実測 history への追記はしない）。生成内容は実 LLM ではなく、与えられた
 * 条件（system に DS コンテキストが含まれるか / useTools か）に応じて DS 準拠度の
 * 異なる HTML を合成する。trial 間は呼び出しカウンタで決定論的に微変動させる。
 *
 * ⚠️ これは「ハーネスが正しく動くこと」を確かめるためのスタブで、DS の効果を
 * 主張する数値は anthropic provider の実測でのみ得られる。
 */

import type {
  ModelProvider,
  GenerationResult,
  GenerateOptions,
} from "../../../src/utils/types.js";
import { MCP_INSTRUCTIONS } from "../../../src/guidance.js";

type Quality = "cold" | "designmd" | "contracts" | "mcp-raw" | "full";

/** system プロンプトと useTools から条件の質を推定する */
function inferQuality(system: string, useTools: boolean): Quality {
  const hasDs = system.includes("melta UI デザインシステム") || system.includes("Design Constitution");
  const hasContracts = system.includes("Component Contracts");
  const hasInstructions = system.includes(MCP_INSTRUCTIONS);
  if (hasDs && useTools && hasInstructions) return "full";
  if (hasDs && useTools) return "mcp-raw";
  if (hasDs && hasContracts) return "contracts";
  if (hasDs) return "designmd";
  return "cold";
}

function coldHtml(jitter: boolean): string {
  // DS 無知のベースライン: 禁止パターン多数（text-black / shadow-2xl / bg-blue / color bar）
  const extra = jitter ? ' tracking-tight' : "";
  return `<!DOCTYPE html><html><body class="bg-white">
<div class="border-t-4 border-blue-500 shadow-2xl p-4${extra}">
  <h2 class="text-black font-light">Title</h2>
  <button class="bg-blue-500 text-white py-0.5">Save</button>
</div></body></html>`;
}

function designmdHtml(jitter: boolean): string {
  // DESIGN.md 準拠: semantic color / rounded-xl / shadow-sm。trial で軽微 warn を増減
  const maybeWarn = jitter ? ' shadow-[0_4px_8px_#0001]' : "";
  return `<!DOCTYPE html><html><body class="bg-gray-50">
<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm${maybeWarn}">
  <h2 class="text-slate-900 font-bold">Title</h2>
  <button class="bg-primary-500 text-white h-10 px-4 rounded-lg cursor-pointer font-medium">Save</button>
</div></body></html>`;
}

function contractsHtml(jitter: boolean): string {
  // designmd より準拠シグナルを 1 つ多く（text-body を追加）、warn 無し → designmd 以上
  const _ = jitter;
  return `<!DOCTYPE html><html><body class="bg-gray-50">
<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
  <h2 class="text-slate-900 font-bold">Title</h2>
  <p class="text-body">Description</p>
  <button class="bg-primary-500 text-white h-10 px-4 rounded-lg cursor-pointer font-medium">Save</button>
</div></body></html>`;
}

function fullHtml(_jitter: boolean): string {
  // DESIGN.md + contracts + MCP（自己検証込み）: 完全準拠 + a11y。
  // 準拠シグナル（primary-500 / text-body / rounded-xl / shadow-sm / border-slate-200 /
  // text-slate-900 / scope=col / aria-label / cursor-pointer / font-medium）を全て満たし
  // 違反ゼロにすることで designmd 以上のスコアになるよう構成（CI 不変条件 full≥designmd）。
  return `<!DOCTYPE html><html><body class="bg-gray-50">
<table class="bg-white rounded-xl border border-slate-200 shadow-sm">
  <thead><tr><th scope="col" class="text-slate-900">Name</th></tr></thead>
  <tbody><tr class="hover:bg-gray-50"><td class="text-body">Acme</td></tr></tbody>
</table>
<button class="bg-primary-500 text-white h-10 px-4 rounded-lg cursor-pointer font-medium">Save</button>
<button aria-label="Edit" class="w-10 h-10 inline-flex items-center justify-center cursor-pointer">
  <svg class="w-5 h-5"></svg>
</button></body></html>`;
}

export interface MockProviderOptions {
  /** trial ごとの決定論的変動に使う基準カウンタ（runner が trial index を渡す想定） */
  seed?: number;
}

export function createMockProvider(options: MockProviderOptions = {}): ModelProvider {
  let callCounter = options.seed ?? 0;

  return {
    id: "mock",
    async generate(
      system: string,
      _prompt: string,
      opts?: GenerateOptions
    ): Promise<GenerationResult> {
      const quality = inferQuality(system, opts?.useTools ?? false);
      const jitter = callCounter % 2 === 1;
      callCounter++;

      const text =
        quality === "cold"
          ? coldHtml(jitter)
          : quality === "designmd"
            ? designmdHtml(jitter)
            : quality === "contracts" || quality === "mcp-raw"
              ? contractsHtml(jitter)
              : fullHtml(jitter);

      return {
        text,
        toolCalls:
          quality === "full"
            ? [{ name: "check_html", arguments: {}, result: { passed: true } }]
            : quality === "mcp-raw"
              ? [{ name: "get_component", arguments: { id: "card" }, result: {} }]
            : [],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        resourcesAccessed:
          quality === "full"
            ? ["melta://rules/auto-detectable"]
            : quality === "mcp-raw"
              ? ["melta://components/card"]
              : [],
      };
    },
  };
}
