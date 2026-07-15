/**
 * tokens.json → scripts/ds-theme.css
 * CSS変数とベーススタイルを tokens.json から自動生成する
 * キーフレーム・ユーティリティクラスは静的追記
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

interface SemanticToken {
  value: string;
  cssVar: string;
  tailwind: string;
}

interface Tokens {
  color: {
    semantic: {
      light: Record<string, SemanticToken>;
      dark: Record<string, SemanticToken>;
    };
  };
  typography: {
    letterSpacing: Record<string, { value: string }>;
    lineHeight: Record<string, { value: string }>;
  };
  [key: string]: unknown;
}

const tokens: Tokens = JSON.parse(
  readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
);

// Build CSS variable blocks
function buildVarBlock(
  semanticTokens: Record<string, SemanticToken>
): string {
  return Object.entries(semanticTokens)
    .map(([, token]) => `  ${token.cssVar}: ${token.value};`)
    .join("\n");
}

const lightVars = buildVarBlock(tokens.color.semantic.light);
const darkVars = buildVarBlock(tokens.color.semantic.dark);

// Wireframe vars (always available in :root alongside brand tokens)
const wfTokens = (tokens as Record<string, unknown>).wireframe as
  | Record<string, { cssVar: string; value: string }>
  | undefined;
const wfVars = wfTokens
  ? Object.entries(wfTokens)
      .map(([, t]) => `  ${t.cssVar}: ${t.value};`)
      .join("\n")
  : "";

const bodyLineHeight = tokens.typography.lineHeight.body.value;
const bodyLetterSpacing = tokens.typography.letterSpacing.body.value;
const headingLineHeight = tokens.typography.lineHeight.heading.value;
const headingLetterSpacing = tokens.typography.letterSpacing.heading.value;

// Static keyframes and utility classes appended after generated sections
const staticCSS = `
/* --- Sidebar Chrome --- */
.ds-sidebar { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
.ds-sidebar::-webkit-scrollbar { width: 4px; }
.ds-sidebar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
.ds-sidebar a[data-nav]:hover {
  background: var(--bg-page-alt);
}
.ds-sidebar a.active {
  color: var(--sidebar-active-color) !important;
  font-weight: 600;
  background: var(--sidebar-active-bg) !important;
}
.ds-nav-group-items { display: none; }
.ds-nav-group-items.open { display: block; }

/* --- Keyframes --- */
@keyframes skeletonPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.skeleton-pulse { animation: skeletonPulse 1.5s ease-in-out infinite; }

.inline-spinner {
  width: 1em; aspect-ratio: 1; border-radius: 50%;
  border: 2.5px solid currentColor;
  animation: spinnerClip 0.8s infinite linear alternate, spinnerRotate 1.6s infinite linear;
}
@keyframes spinnerClip {
  0%{clip-path:polygon(50% 50%,0 0,50% 0%,50% 0%,50% 0%,50% 0%,50% 0%)}
  12.5%{clip-path:polygon(50% 50%,0 0,50% 0%,100% 0%,100% 0%,100% 0%,100% 0%)}
  25%{clip-path:polygon(50% 50%,0 0,50% 0%,100% 0%,100% 100%,100% 100%,100% 100%)}
  50%{clip-path:polygon(50% 50%,0 0,50% 0%,100% 0%,100% 100%,50% 100%,0% 100%)}
  62.5%{clip-path:polygon(50% 50%,100% 0,100% 0%,100% 0%,100% 100%,50% 100%,0% 100%)}
  75%{clip-path:polygon(50% 50%,100% 100%,100% 100%,100% 100%,100% 100%,50% 100%,0% 100%)}
  100%{clip-path:polygon(50% 50%,50% 100%,50% 100%,50% 100%,50% 100%,50% 100%,0% 100%)}
}
@keyframes spinnerRotate {
  0%{transform:scaleY(1) rotate(0deg)} 49.99%{transform:scaleY(1) rotate(135deg)}
  50%{transform:scaleY(-1) rotate(0deg)} 100%{transform:scaleY(-1) rotate(-135deg)}
}

.dot-loader { display:flex; align-items:center; gap:5px; height:34px; }
.dot-loader span { width:9px; height:17px; background:#2b70ef; border-radius:3px; animation:dotWave 1.2s infinite ease-in-out; }
.dot-loader span:nth-child(2){animation-delay:0.2s}
.dot-loader span:nth-child(3){animation-delay:0.4s}
@keyframes dotWave { 0%,100%{transform:translateY(0)} 25%{transform:translateY(-50%)} 50%{transform:translateY(50%)} 75%{transform:translateY(0)} }

@keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
@keyframes scaleCheck { 0%{transform:scale(0);opacity:0} 50%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-3px)} 50%{transform:translateX(3px)} 75%{transform:translateX(-2px)} }
@keyframes toastSlideIn { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes toastSlideOut { from{transform:translateX(0);opacity:1} to{transform:translateX(100%);opacity:0} }

/* --- Reduced Motion --- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}`;

const output = `/* ==========================================================================
   melta UI — Shared Theme (ds-theme.css)
   Base styles, CSS variables, sidebar chrome, keyframes
   ========================================================================== */

/* --- Base Styles --- */
body { line-height: ${bodyLineHeight}; letter-spacing: ${bodyLetterSpacing}; }
h1, h2, h3, h4, h5, h6 { line-height: ${headingLineHeight}; letter-spacing: ${headingLetterSpacing}; }

/* --- CSS Variables (Light Theme) --- */
:root {
${lightVars}
  --sidebar-active-color: #2b70ef;
  --sidebar-active-bg: #f0f5ff;
${wfVars ? `\n${wfVars}` : ""}
}

/* --- Dark Theme --- */
html[data-theme="dark"] {
${darkVars}
  --sidebar-active-color: #95b6ff;
  --sidebar-active-bg: #0e266a;
}

/* Bug fix: dark mode body background */
html[data-theme="dark"] body {
  background: var(--bg-page);
}
${staticCSS}
`;

const outPath = resolve(root, "scripts/ds-theme.css");
writeFileSync(outPath, output, "utf-8");
console.log(`Generated: ${outPath}`);
