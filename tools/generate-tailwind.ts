/**
 * tokens.json → scripts/ds-config.js
 * Tailwind config を tokens.json から自動生成する
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

interface TokenValue {
  value: string | number | string[];
  tailwind?: string;
  [key: string]: unknown;
}

interface Tokens {
  color: {
    primary: Record<string, TokenValue>;
    body: TokenValue;
  };
  typography: {
    fontFamily: Record<string, TokenValue>;
    fontSize: Record<string, { size: string; lineHeight: string; tailwind: string }>;
  };
  [key: string]: unknown;
}

const tokens: Tokens = JSON.parse(
  readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
);

// Build primary colors
const primaryColors: Record<string, string> = {};
for (const [shade, token] of Object.entries(tokens.color.primary)) {
  primaryColors[shade] = token.value as string;
}

// Build font families
const fontFamilies: Record<string, string[]> = {};
for (const [name, token] of Object.entries(tokens.typography.fontFamily)) {
  fontFamilies[name] = token.value as string[];
}

// Build font sizes
const fontSizes: Record<string, [string, { lineHeight: string }]> = {};
for (const [name, token] of Object.entries(tokens.typography.fontSize)) {
  fontSizes[name] = [token.size, { lineHeight: token.lineHeight }];
}

const config = `tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
${Object.entries(primaryColors)
  .map(([k, v]) => `          ${k}: '${v}',`)
  .join("\n")}
        },
        body: '${tokens.color.body.value}',
        wf: {
          bg: 'var(--wf-bg)',
          surface: 'var(--wf-surface)',
          border: 'var(--wf-border)',
          text: 'var(--wf-text)',
          'text-sub': 'var(--wf-text-sub)',
          accent: 'var(--wf-accent)',
        },
      },
      fontFamily: {
${Object.entries(fontFamilies)
  .map(([k, v]) => `        ${k}: [${v.map((f) => `'${f}'`).join(",")}],`)
  .join("\n")}
      },
      fontSize: {
${Object.entries(fontSizes)
  .map(
    ([k, [size, opts]]) =>
      `        ${k.includes("-") ? `'${k}'` : k}: ['${size}', { lineHeight: '${opts.lineHeight}' }],`
  )
  .join("\n")}
      },
    },
  },
}
`;

const outPath = resolve(root, "scripts/ds-config.js");
writeFileSync(outPath, config, "utf-8");
console.log(`Generated: ${outPath}`);
