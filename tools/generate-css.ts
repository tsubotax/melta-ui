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

/**
 * Host-Reset Defense（DADS 取り込み B5）。
 * ホストサイトのリセット CSS が melta より先に読まれても見た目が変わらないよう、
 * ブラウザ既定に依存している値を明示宣言するブロック。
 *
 * ⚠️ 2026-08: このブロックは ds-theme.css に手書きで足されていて generator 側に無く、
 * `npm run generate` を回すたびに黙って消えていた（reset-swap VRT の 3 検体が落ちる）。
 * ds-theme.css は生成物なので、規範はここ（generator）に置く。
 * 検証: npm run test:reset-vrt
 */
const hostResetDefense = `/* --- Host-Reset Defense (reset-swap VRT で機械検証) --------------------------
   ホストサイトのリセットCSS（Reboot / Meyer / kiso.css 等）が melta より先に
   読まれても見た目が変わらないよう、ブラウザ既定に依存している値を明示宣言する。
   検証: npm run test:reset-vrt

   1. Reboot 系は body 直指定の font/color で Preflight の html レベル指定を貫通する
      → body で明示宣言して塞ぐ */
body {
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  color: ${tokens.color.semantic.light["text-default"].value}; /* --text-default（:root 定義前のためリテラル。tokens.json color.semantic.light.text-default と同値） */
  /* 3. kiso.css 系の日本語タイポプロパティは継承で全要素に流れ込みテキスト幅が変わる
     → melta の規範値（= ブラウザ既定）を明示して inherit 連鎖を断つ */
  line-break: auto;
  overflow-wrap: normal;
  text-autospace: no-autospace;
  text-spacing-trim: normal;
}
/* 2. Meyer 系は要素セレクタ（div 等）の border:0 が Preflight の *（specificity 0）に
   常に勝ち、border ユーティリティの枠線が消える → 同 specificity (0,0,1) を melta 側
   （後読み）に置いて source order で取り返す。値は Preflight と同一 */
html *, html *::before, html *::after {
  border-width: 0;
  border-style: solid;
  border-color: #e5e7eb;
}
/* Reboot のテーブル既定（caption-side / tr ボーダー）も同様に明示で固定 */
table { caption-side: top; border-color: inherit; }`;

const output = `/* ==========================================================================
   melta UI — Shared Theme (ds-theme.css)
   Base styles, CSS variables, sidebar chrome, keyframes
   ========================================================================== */

/* --- Base Styles --- */
body { line-height: ${bodyLineHeight}; letter-spacing: ${bodyLetterSpacing}; }
h1, h2, h3, h4, h5, h6 { line-height: ${headingLineHeight}; letter-spacing: ${headingLetterSpacing}; }

${hostResetDefense}

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
