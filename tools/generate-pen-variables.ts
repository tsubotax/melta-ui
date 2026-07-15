/**
 * tokens.json → docs/melta-pen-variables.json
 * Pencil MCP の set_variables 互換 JSON を自動生成する
 *
 * - rgba() → 8桁 RGBA hex 変換（subtle-dark 用）
 * - Light/Dark テーマ対応（semantic, status subtle/text）
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const tokens = JSON.parse(
  readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
);

// ── Types ──────────────────────────────────────────────

interface PenVariable {
  name: string;
  type: "color" | "string" | "number";
  value: string | number;
  themes?: Record<string, string | number>;
}

// ── Helpers ────────────────────────────────────────────

/** rgba(r,g,b,a) → #RRGGBBAA hex */
function rgbaToHex8(rgba: string): string {
  const m = rgba.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
  );
  if (!m) return rgba; // fallback: return as-is if not rgba
  const [, r, g, b, a] = m;
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return (
    "#" +
    toHex(Number(r)) +
    toHex(Number(g)) +
    toHex(Number(b)) +
    toHex(Math.round(Number(a) * 255))
  );
}

/** "18px" → 18, "0.5rem" → pass-through as string */
function pxToNumber(val: string): number | null {
  const m = val.match(/^(\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

// ── Build variables ────────────────────────────────────

const variables: PenVariable[] = [];

// 1. color.primary.{50-950}
for (const [shade, tok] of Object.entries(tokens.color.primary)) {
  const t = tok as { value: string };
  variables.push({
    name: `melta-primary-${shade}`,
    type: "color",
    value: t.value,
  });
}

// 2. color.body
variables.push({
  name: "melta-body",
  type: "color",
  value: tokens.color.body.value,
});

// 3. color.semantic — Light/Dark テーマ
const lightSemantic = tokens.color.semantic.light as Record<
  string,
  { value: string }
>;
const darkSemantic = tokens.color.semantic.dark as Record<
  string,
  { value: string }
>;
for (const key of Object.keys(lightSemantic)) {
  variables.push({
    name: `melta-${key}`,
    type: "color",
    value: lightSemantic[key].value,
    themes: {
      Light: lightSemantic[key].value,
      Dark: darkSemantic[key]?.value ?? lightSemantic[key].value,
    },
  });
}

// 4. color.status.{name} — base / subtle(L/D) / text(L/D)
for (const [name, statusRaw] of Object.entries(tokens.color.status)) {
  const status = statusRaw as Record<string, { value: string }>;

  // base
  variables.push({
    name: `melta-${name}`,
    type: "color",
    value: status.base.value,
  });

  // subtle — Light/Dark
  const subtleLightVal = status["subtle-light"].value;
  const subtleDarkRaw = status["subtle-dark"].value;
  const subtleDarkVal = subtleDarkRaw.startsWith("rgba")
    ? rgbaToHex8(subtleDarkRaw)
    : subtleDarkRaw;
  variables.push({
    name: `melta-${name}-subtle`,
    type: "color",
    value: subtleLightVal,
    themes: { Light: subtleLightVal, Dark: subtleDarkVal },
  });

  // text — Light/Dark
  const textLightVal = status["text-light"].value;
  const textDarkVal = status["text-dark"].value;
  variables.push({
    name: `melta-${name}-text`,
    type: "color",
    value: textLightVal,
    themes: { Light: textLightVal, Dark: textDarkVal },
  });
}

// 5. typography.fontFamily
for (const [name, tok] of Object.entries(tokens.typography.fontFamily)) {
  const t = tok as { value: string[] };
  variables.push({
    name: `melta-font-${name}`,
    type: "string",
    value: t.value.join(", "),
  });
}

// 6. typography.fontSize
for (const [name, tok] of Object.entries(tokens.typography.fontSize)) {
  const t = tok as { px: number };
  variables.push({
    name: `melta-font-${name}`,
    type: "number",
    value: t.px,
  });
}

// 7. spacing
for (const [key, tok] of Object.entries(tokens.spacing)) {
  const t = tok as { value: string };
  const px = pxToNumber(t.value);
  if (px !== null) {
    variables.push({
      name: `melta-spacing-${key}`,
      type: "number",
      value: px,
    });
  }
}

// 8. radius
for (const [key, tok] of Object.entries(tokens.radius)) {
  const t = tok as { px: number };
  variables.push({
    name: `melta-radius-${key}`,
    type: "number",
    value: t.px,
  });
}

// ── Output ─────────────────────────────────────────────

const outPath = resolve(root, "docs/melta-pen-variables.json");
writeFileSync(outPath, JSON.stringify(variables, null, 2) + "\n", "utf-8");
console.log(`Generated: ${outPath} (${variables.length} variables)`);
