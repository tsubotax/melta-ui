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
