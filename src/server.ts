import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  loadTokens,
  loadComponents,
  loadRules,
  loadPackage,
  loadDesignConstitution,
  getProhibitionRules,
  getAllRules,
} from "./utils/loader.js";
import { getToken } from "./tools/get-token.js";
import { getComponent } from "./tools/get-component.js";
import { checkRule } from "./tools/check-rule.js";
import { checkHtml, type SourceType } from "./tools/check-html.js";
import { search } from "./tools/search.js";
import type { RuleFilter } from "./utils/types.js";
import { buildMcpInstructions } from "./guidance.js";

/**
 * server name / URI スキームの設定。既定は melta-ui / melta://（後方互換）。
 * vendor 先では MELTA_SERVER_NAME / MELTA_URI_SCHEME で差し替える
 * （例: acme-ds / acme:// → リソース URI が acme://tokens になる）。
 */
const SERVER_NAME = process.env.MELTA_SERVER_NAME ?? "melta-ui";
const URI_SCHEME = process.env.MELTA_URI_SCHEME ?? "melta";

export function createServer(): Server {
  const pkg = loadPackage();
  const components = loadComponents();
  const rules = loadRules();

  const uriOf = (path: string) => `${URI_SCHEME}://${path}`;

  const server = new Server(
    { name: SERVER_NAME, version: pkg.version },
    {
      capabilities: { resources: {}, tools: {} },
      instructions: buildMcpInstructions(SERVER_NAME, URI_SCHEME),
    }
  );

  // --- Resources ---

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: uriOf("design-constitution"),
        name: "Design Constitution (DESIGN.md)",
        description:
          "Start here before UI work: brand identity, non-negotiable principles, Quick Reference, prohibited Top 10, and source-of-truth order",
        mimeType: "text/markdown",
      },
      {
        uri: uriOf("tokens"),
        name: "Design Tokens",
        description: "Design tokens (colors, typography, spacing, etc.)",
        mimeType: "application/json",
      },
      {
        uri: uriOf("components"),
        name: "Components",
        description: `All ${components.components.length} component metadata with Tailwind classes`,
        mimeType: "application/json",
      },
      {
        uri: uriOf("rules"),
        name: "Prohibition Rules (all)",
        description: `All ${rules.rules.length} prohibition rules including manual ones (full SSOT for AI reference)`,
        mimeType: "application/json",
      },
      {
        uri: uriOf("rules/auto-detectable"),
        name: "Prohibition Rules (auto-detectable subset)",
        description: "Subset of rules that check_rule can auto-detect from Tailwind class strings",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Handle {scheme}://components/{id}（scheme は正規表現に埋め込まず prefix 判定）
    const componentsPrefix = `${URI_SCHEME}://components/`;
    const componentMatch = uri.startsWith(componentsPrefix)
      ? [uri, uri.slice(componentsPrefix.length)]
      : null;
    if (componentMatch) {
      const id = componentMatch[1];
      const comp = getComponent(id);
      if (!comp) {
        throw new Error(`Component not found: ${id}`);
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(comp, null, 2),
          },
        ],
      };
    }

    switch (uri) {
      case uriOf("design-constitution"):
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: loadDesignConstitution(),
            },
          ],
        };

      case uriOf("tokens"):
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(loadTokens(), null, 2),
            },
          ],
        };

      case uriOf("components"):
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(loadComponents(), null, 2),
            },
          ],
        };

      case uriOf("rules"):
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(loadRules(), null, 2),
            },
          ],
        };

      case uriOf("rules/auto-detectable"):
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(getProhibitionRules(), null, 2),
            },
          ],
        };

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  // --- Tools ---

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_token",
        description:
          "Get a design token by dot-path. Returns the token object with value and tailwind class.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description:
                'Dot-separated path to the token (e.g. "color.primary.600", "spacing.4", "radius.lg", "typography.fontSize.base")',
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_component",
        description:
          "Get component metadata including variants, sizes, accessibility requirements, HTML sample, per-state specs (stateSpecs: disabled/loading/open/empty etc. — each with delta Tailwind classes + aria changes), and anatomy parts (overlay/container/th etc. with element/roles/tailwind). Prefer these structured fields over inferring states from the HTML sample.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description:
                'Component ID (e.g. "button", "card", "table", "sidebar")',
            },
          },
          required: ["id"],
        },
      },
      {
        name: "check_rule",
        description:
          "Check Tailwind classes against melta UI prohibition rules. Returns violations with reasons and alternatives.",
        inputSchema: {
          type: "object" as const,
          properties: {
            classes: {
              type: "string",
              description:
                'Space-separated Tailwind classes to check (e.g. "text-black shadow-2xl bg-green-500")',
            },
          },
          required: ["classes"],
        },
      },
      {
        name: "check_html",
        description:
          "Lint a full HTML/JSX source against melta UI rules — the same checks as CI and the PostToolUse hook (class rules + html-attr rules + composition rules for HTML). Use this AFTER generating UI code to self-verify before presenting it. Response always includes coverage info (manual rules cannot be auto-checked).",
        inputSchema: {
          type: "object" as const,
          properties: {
            source: {
              type: "string",
              description: "Full source code to lint (HTML / JSX / Vue template)",
            },
            sourceType: {
              type: "string",
              enum: ["html", "jsx"],
              description:
                'Source type. "html" (default) also runs composition lint (nested modal etc.); "jsx" runs class + attr lint only',
            },
          },
          required: ["source"],
        },
      },
      {
        name: "search",
        description:
          "Search across tokens and components by keyword. Matches against names, values, tailwind classes, and descriptions. Returns up to 20 results (truncated flag when more matched).",
        inputSchema: {
          type: "object" as const,
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
        name: "get_rules",
        description:
          `Get melta UI prohibition rules from rules.json (${rules.rules.length} total). Use this to retrieve manual/contextual rules that check_rule cannot auto-detect. Supports filtering by category, severity, or detector.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            category: {
              type: "string",
              description:
                'Filter by category (e.g. "color", "spacing", "accessibility", "button", "modal")',
            },
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "get_token": {
        const path = (args as { path: string }).path;
        const result = getToken(path);
        if (result === null) {
          return {
            content: [
              { type: "text", text: `Token not found: ${path}` },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_component": {
        const id = (args as { id: string }).id;
        const comp = getComponent(id);
        if (!comp) {
          return {
            content: [
              { type: "text", text: `Component not found: ${id}` },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(comp, null, 2),
            },
          ],
        };
      }

      case "check_rule": {
        const classes = (args as { classes: string }).classes;
        const violations = checkRule(classes);
        if (violations.length === 0) {
          return {
            content: [
              { type: "text", text: "No violations found." },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(violations, null, 2),
            },
          ],
        };
      }

      case "check_html": {
        const { source, sourceType } = args as { source: string; sourceType?: SourceType };
        const result = checkHtml(source, sourceType ?? "html");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "search": {
        const query = (args as { query: string }).query;
        const results = search(query);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "get_rules": {
        const filter = (args as RuleFilter | undefined) ?? {};
        const results = getAllRules(filter);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
