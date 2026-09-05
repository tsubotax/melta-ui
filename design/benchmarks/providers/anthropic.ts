/**
 * Anthropic provider — melta MCP の5 tools を Claude API に渡し、
 * tool_use ループで GenerationResult.toolCalls / resourcesAccessed を記録する。
 *
 * P4 研究目的の核（line 574）: 「AI が参照したルール / リソース」を実測する。
 * MCP server を経由せず、src/tools/* を直接呼ぶ（同じ実装なので結果は同じ）。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Tool,
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import type {
  ModelProvider,
  GenerationResult,
  GenerateOptions,
} from "../../../src/utils/types.js";
import { getToken } from "../../../src/tools/get-token.js";
import { getComponent } from "../../../src/tools/get-component.js";
import { checkRule } from "../../../src/tools/check-rule.js";
import { checkHtml } from "../../../src/tools/check-html.js";
import { search } from "../../../src/tools/search.js";
import { getAllRules } from "../../../src/utils/loader.js";
import type { RuleFilter } from "../../../src/utils/types.js";

const MELTA_TOOLS: Tool[] = [
  {
    name: "get_token",
    description:
      "Get a melta UI design token by dot-path. Returns the token object with value and tailwind class.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Dot-separated path (e.g. "color.primary.600", "spacing.4", "radius.lg")',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_component",
    description:
      "Get melta UI component metadata: variants, sizes, accessibility requirements, HTML sample, per-state specs (stateSpecs: disabled/loading/open/empty — delta Tailwind + aria changes), and anatomy parts (overlay/th etc.). Prefer the structured fields over inferring states from the HTML sample.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: 'Component ID (e.g. "button", "card", "table", "sidebar")',
        },
      },
      required: ["id"],
    },
  },
  {
    name: "check_rule",
    description:
      "Check Tailwind classes against melta UI prohibition rules. Returns violations with reasons and alternatives.",
    input_schema: {
      type: "object",
      properties: {
        classes: {
          type: "string",
          description:
            'Space-separated Tailwind classes (e.g. "text-black shadow-2xl bg-blue-500")',
        },
      },
      required: ["classes"],
    },
  },
  {
    name: "get_rules",
    description: `Get melta UI prohibition rules from rules.json (${getAllRules().length} total). Use to retrieve manual/contextual rules that check_rule cannot auto-detect. Filter by category, severity, or detector.`,
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        severity: {
          type: "string",
          enum: ["error", "warn"],
          description: "Filter by severity",
        },
        detector: {
          type: "string",
          enum: ["tailwind-class", "tailwind-class-prefix", "tailwind-class-segment", "html-attr", "composition", "manual"],
          description: "Filter by detector type",
        },
      },
    },
  },
  {
    name: "search",
    description:
      "Search across melta UI tokens and components by keyword. Matches against names, values, tailwind classes, and descriptions.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search keyword (e.g. "card", "primary", "shadow")',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_html",
    description:
      "Lint a full HTML/JSX source against melta UI rules (same checks as CI: class + html-attr + composition). Use AFTER generating UI code to self-verify before presenting it.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Full source code to lint (HTML / JSX)",
        },
        sourceType: {
          type: "string",
          enum: ["html", "jsx"],
          description: 'Source type (default "html")',
        },
      },
      required: ["source"],
    },
  },
];

function dispatchTool(name: string, args: unknown): unknown {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_token":
      return getToken(String(a.path ?? ""));
    case "get_component":
      return getComponent(String(a.id ?? ""));
    case "check_rule":
      return checkRule(String(a.classes ?? ""));
    case "check_html":
      return checkHtml(
        String(a.source ?? ""),
        a.sourceType === "jsx" ? "jsx" : "html"
      );
    case "search":
      return search(String(a.query ?? ""));
    case "get_rules":
      return getAllRules(a as RuleFilter);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** tool 呼び出しから resource アクセス相当を派生 */
function deriveResourceUri(name: string, args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_token":
      return "melta://tokens";
    case "get_component":
      return a.id ? `melta://components/${String(a.id)}` : "melta://components";
    case "check_rule":
      return "melta://rules/auto-detectable";
    case "check_html":
      return "melta://rules/auto-detectable";
    case "get_rules":
      return "melta://rules";
    case "search":
      return null;
    default:
      return null;
  }
}

/**
 * 応答本文から返却テキストを決める。
 *
 * 既定（rawText 未指定 / false）は ```html ブロックを抽出する。ベンチマークは HTML を
 * 採点するので、説明文を混ぜたまま渡すとスコアが崩れるため。
 *
 * rawText: true は抽出をしない。judge のように「出力全体が契約どおりか」を後段の検証器で
 * 見る用途では、ここでフェンスを剥がすと「説明文 + フェンス内の正常 JSON」が valid に化け、
 * 保存する raw と hash からも説明文とフェンスが消えて検算できなくなる。
 */
export function extractGenerationText(fullText: string, opts?: GenerateOptions): string {
  if (opts?.rawText === true) return fullText;
  const htmlMatch = fullText.match(/```html\n([\s\S]*?)```/);
  return htmlMatch ? htmlMatch[1] : fullText;
}

export interface AnthropicProviderOptions {
  /** Anthropic model id (e.g. "claude-sonnet-4-20250514") */
  model: string;
  /** ループ上限。tool 呼び出しの暴走を防ぐ */
  maxIterations?: number;
  /** max_tokens per turn */
  maxTokensPerTurn?: number;
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions
): ModelProvider {
  const maxIterations = options.maxIterations ?? 10;
  const maxTokens = options.maxTokensPerTurn ?? 8192;

  return {
    id: `anthropic:${options.model}`,
    async generate(
      system: string,
      prompt: string,
      opts?: GenerateOptions
    ): Promise<GenerationResult> {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY 環境変数を設定してください");
      }
      const client = new Anthropic();
      // cold / designmd 条件では tools を渡さない（静的コンテキストの効果を切り分ける）
      const useTools = opts?.useTools ?? true;

      const messages: MessageParam[] = [{ role: "user", content: prompt }];
      const recordedToolCalls: NonNullable<GenerationResult["toolCalls"]> = [];
      const resourcesAccessed = new Set<string>();
      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      const start = Date.now();
      let finalContent: ContentBlock[] = [];

      for (let i = 0; i < maxIterations; i++) {
        const response = await client.messages.create({
          model: options.model,
          max_tokens: maxTokens,
          system,
          ...(useTools ? { tools: MELTA_TOOLS } : {}),
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
          messages,
        });

        usage.inputTokens += response.usage.input_tokens;
        usage.outputTokens += response.usage.output_tokens;
        // cache tokens は SDK によって型が違うことがあるので存在チェック
        const u = response.usage as unknown as Record<string, number | undefined>;
        if (typeof u.cache_read_input_tokens === "number") {
          usage.cacheReadTokens += u.cache_read_input_tokens;
        }
        if (typeof u.cache_creation_input_tokens === "number") {
          usage.cacheCreationTokens += u.cache_creation_input_tokens;
        }

        finalContent = response.content;

        if (response.stop_reason !== "tool_use") {
          break;
        }

        // assistant turn を履歴に積む
        messages.push({ role: "assistant", content: response.content });

        // tool_use を dispatch して tool_result を作る
        const toolResults: ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            let result: unknown;
            let isError = false;
            try {
              result = dispatchTool(block.name, block.input);
            } catch (err) {
              result = { error: (err as Error).message };
              isError = true;
            }
            recordedToolCalls.push({
              name: block.name,
              arguments: block.input,
              result,
            });
            const uri = deriveResourceUri(block.name, block.input);
            if (uri) resourcesAccessed.add(uri);

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
              is_error: isError,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
      }

      const latencyMs = Date.now() - start;

      // 最終 assistant turn から text を抽出
      const fullText = finalContent
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const text = extractGenerationText(fullText, opts);

      const usagePayload: GenerationResult["usage"] = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
      if (usage.cacheReadTokens > 0) {
        usagePayload.cacheReadTokens = usage.cacheReadTokens;
      }
      if (usage.cacheCreationTokens > 0) {
        usagePayload.cacheCreationTokens = usage.cacheCreationTokens;
      }

      return {
        text,
        toolCalls: recordedToolCalls,
        usage: usagePayload,
        latencyMs,
        resourcesAccessed: Array.from(resourcesAccessed),
      };
    },
  };
}
