/**
 * validate-tokens.ts
 * tokens.json の値と既存 ds-config.js / ds-theme.css の整合性を検証する
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

let errors = 0;

function error(msg: string): void {
  console.error(`  ERROR: ${msg}`);
  errors++;
}

function info(msg: string): void {
  console.log(`  ${msg}`);
}

// --- Load tokens ---
const tokens = JSON.parse(
  readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
);

// --- Validate against ds-config.js ---
console.log("\n=== Validating tokens.json vs ds-config.js ===\n");

const configContent = readFileSync(
  resolve(root, "scripts/ds-config.js"),
  "utf-8"
);

// Check primary colors
for (const [shade, token] of Object.entries(
  tokens.color.primary as Record<string, { value: string }>
)) {
  const expected = token.value;
  if (!configContent.includes(expected)) {
    error(`primary.${shade}: '${expected}' not found in ds-config.js`);
  } else {
    info(`primary.${shade}: '${expected}' OK`);
  }
}

// Check body color
const bodyColor = tokens.color.body.value;
if (!configContent.includes(bodyColor)) {
  error(`body color: '${bodyColor}' not found in ds-config.js`);
} else {
  info(`body color: '${bodyColor}' OK`);
}

// Check font families
for (const [name, token] of Object.entries(
  tokens.typography.fontFamily as Record<string, { value: string[] }>
)) {
  const firstFont = token.value[0];
  if (!configContent.includes(firstFont)) {
    error(`fontFamily.${name}: '${firstFont}' not found in ds-config.js`);
  } else {
    info(`fontFamily.${name}: OK`);
  }
}

// Check font sizes
for (const [name, token] of Object.entries(
  tokens.typography.fontSize as Record<
    string,
    { size: string; lineHeight: string }
  >
)) {
  if (!configContent.includes(token.size)) {
    error(`fontSize.${name}: '${token.size}' not found in ds-config.js`);
  } else {
    info(`fontSize.${name}: '${token.size}' OK`);
  }
}

// --- Validate against ds-theme.css ---
console.log("\n=== Validating tokens.json vs ds-theme.css ===\n");

const cssContent = readFileSync(
  resolve(root, "scripts/ds-theme.css"),
  "utf-8"
);

// Check semantic light CSS variables
for (const [name, token] of Object.entries(
  tokens.color.semantic.light as Record<
    string,
    { value: string; cssVar: string }
  >
)) {
  const { value, cssVar } = token;
  const pattern = `${cssVar}: ${value}`;
  if (!cssContent.includes(pattern)) {
    error(`light.${name}: '${pattern}' not found in ds-theme.css`);
  } else {
    info(`light.${name}: OK`);
  }
}

// Check semantic dark CSS variables
for (const [name, token] of Object.entries(
  tokens.color.semantic.dark as Record<
    string,
    { value: string; cssVar: string }
  >
)) {
  const { value, cssVar } = token;
  const pattern = `${cssVar}: ${value}`;
  if (!cssContent.includes(pattern)) {
    error(`dark.${name}: '${pattern}' not found in ds-theme.css`);
  } else {
    info(`dark.${name}: OK`);
  }
}

// --- 背景セマンティックトークンの同値衝突検査 ---
// 背景 4 種は「面が重なる」関係にある（page の上に surface、surface の上に page-alt の
// チップ / disabled 入力）。同一 mode 内で 2 つが同値になると、その組で塗り分けている
// コンポーネントがコントラスト比 1.00:1 で完全に消える（2026-08: dark の bg-page-alt が
// bg-surface と同値になり、Tag basic / removable と TextField disabled がカード上で
// 不可視だった実害バグ）。値が同じでよい組は ALLOWED_SAME に理由付きで明示する
// —— 「気づかず同値になる」経路だけを塞ぎ、意図した同値は宣言に残す。
console.log("\n=== Validating background semantic token collisions ===\n");

/** 検査対象。面の重なりを表す背景トークンのみ（input-bg 等は別の意味論なので含めない） */
const BG_TOKENS = ["bg-page", "bg-page-alt", "bg-surface", "bg-surface-alt"] as const;

/** 意図的に同値な組（キーは BG_TOKENS 2 つを "|" で結んだもの。BG_TOKENS の順序に従う） */
const ALLOWED_SAME: Record<string, string> = {
  // surface-alt は「surface の中の一段沈んだ帯」で、地色（page）と同じ面に落とすのが設計。
  // light も dark も page と一致するのは意図した重ね順（color.md の background/surface 2 系統）
  "bg-page|bg-surface-alt": "surface-alt は page と同じ面に沈める設計（light/dark 共通）",
};

for (const mode of ["light", "dark"] as const) {
  const semantic = tokens.color.semantic[mode] as Record<
    string,
    { value: string } | undefined
  >;
  for (let i = 0; i < BG_TOKENS.length; i++) {
    for (let j = i + 1; j < BG_TOKENS.length; j++) {
      const [a, b] = [BG_TOKENS[i], BG_TOKENS[j]];
      const va = semantic[a]?.value;
      const vb = semantic[b]?.value;
      if (va === undefined || vb === undefined) {
        error(`semantic.${mode}: 背景トークン ${va === undefined ? a : b} がありません`);
        continue;
      }
      const key = `${a}|${b}`;
      const allowed = ALLOWED_SAME[key];
      if (va.toLowerCase() === vb.toLowerCase()) {
        if (allowed) {
          info(`${mode}: ${a} == ${b}（${va}）— 意図的な同値: ${allowed}`);
        } else {
          error(
            `${mode}: ${a} と ${b} が同値 '${va}'（コントラスト比 1.00:1 = 一方の面に置いた要素が消える）。` +
              `値を分けるか、意図的なら ALLOWED_SAME に理由付きで登録する`
          );
        }
      } else if (allowed) {
        info(`${mode}: ${a} != ${b}（ALLOWED_SAME 登録済みだが現在は別値。登録は残してよい）`);
      } else {
        info(`${mode}: ${a} != ${b} OK`);
      }
    }
  }
}

// Check base styles
const bodyLH = tokens.typography.lineHeight.body.value;
const bodyLS = tokens.typography.letterSpacing.body.value;
if (!cssContent.includes(`line-height: ${bodyLH}`)) {
  error(`body line-height: '${bodyLH}' not found in ds-theme.css`);
} else {
  info(`body line-height: OK`);
}
if (!cssContent.includes(`letter-spacing: ${bodyLS}`)) {
  error(`body letter-spacing: '${bodyLS}' not found in ds-theme.css`);
} else {
  info(`body letter-spacing: OK`);
}

// --- Summary ---
console.log(
  `\n=== Validation ${errors === 0 ? "PASSED" : "FAILED"} (${errors} error${errors !== 1 ? "s" : ""}) ===\n`
);

process.exit(errors > 0 ? 1 : 0);
