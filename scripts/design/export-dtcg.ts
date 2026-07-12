/**
 * export-dtcg.ts — design/contracts/tokens.json を W3C DTCG（Design Tokens
 * Community Group）形式 2025.10 stable に変換し design/contracts/tokens.dtcg.json を生成する。
 *
 * 仕様: https://www.designtokens.org/TR/2025.10/
 *  - token は `$value` / `$type` を持つ。group は `$type` を子へ継承させる
 *  - color の `$value` は構造化オブジェクト { colorSpace, components, alpha, hex }
 *  - dimension の unit は "px" | "rem" のみ。em/unitless は number 等で表現し
 *    元の CSS 値は `$extensions."com.melta"` に保持する
 *  - melta 固有の tailwind / cssVar は `$extensions."com.melta"` に格納する
 *
 * melta の SSOT は引き続き design/contracts/tokens.json。tokens.dtcg.json は
 * そこから生成される interop ビュー（直接編集しない）。validate.ts が鮮度を監視する。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : resolve(__dirname, "../..");

const EXT = "com.melta";

// --- 変換ヘルパー ---

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → DTCG color value（srgb, components 0-1, alpha） */
function hexToColor(hex: string): Record<string, unknown> {
  let h = hex.replace("#", "");
  // #rgb / #rgba 短縮形を展開
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    colorSpace: "srgb",
    components: [round(r), round(g), round(b)],
    alpha: round(alpha),
    hex: `#${h.slice(0, 6).toLowerCase()}`,
  };
}

/** "rgba(r,g,b,a)" / "rgb(r,g,b)" → DTCG color value */
function rgbaToColor(str: string): Record<string, unknown> {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return hexToColor("#000000");
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  const [r, g, b, a = 1] = parts;
  const hex =
    "#" +
    [r, g, b]
      .map((n) => Math.round(n).toString(16).padStart(2, "0"))
      .join("");
  return {
    colorSpace: "srgb",
    components: [round(r / 255), round(g / 255), round(b / 255)],
    alpha: round(a),
    hex,
  };
}

/** 任意の color 文字列（hex / rgba）→ DTCG color value */
function toColor(value: string): Record<string, unknown> {
  return value.trim().startsWith("#") ? hexToColor(value) : rgbaToColor(value);
}

/** "1.125rem" / "4px" / "0" / "9999px" → DTCG dimension { value, unit } */
function toDimension(str: string): { value: number; unit: "px" | "rem" } {
  const s = str.trim();
  if (s === "0") return { value: 0, unit: "px" };
  const m = s.match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) throw new Error(`dimension としてパースできません: "${str}"`);
  return { value: parseFloat(m[1]), unit: m[2] as "px" | "rem" };
}

/** "150ms" / "0.3s" → DTCG duration { value, unit } */
function toDuration(str: string): { value: number; unit: "ms" | "s" } {
  const m = str.trim().match(/^([\d.]+)(ms|s)$/);
  if (!m) throw new Error(`duration としてパースできません: "${str}"`);
  return { value: parseFloat(m[1]), unit: m[2] as "ms" | "s" };
}

/** "cubic-bezier(0.4, 0, 0.2, 1)" → [x1,y1,x2,y2] */
function toCubicBezier(str: string): number[] {
  const m = str.match(/cubic-bezier\(([^)]+)\)/);
  if (!m) throw new Error(`cubicBezier としてパースできません: "${str}"`);
  return m[1].split(",").map((s) => parseFloat(s.trim()));
}

/**
 * "0 4px 6px rgba(0,0,0,0.1)" → DTCG shadow value（none は透明ゼロ影）。
 * 対応文法: 末尾に色（rgba()/hex）を1つ持つ単一シャドウ（offsetX offsetY blur? spread? color）。
 * 複数シャドウ（カンマ区切り）や先頭色の CSS には未対応（現 tokens.json は全てこの形）。
 */
function toShadow(str: string): Record<string, unknown> {
  if (str.trim() === "none") {
    return {
      color: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0, hex: "#000000" },
      offsetX: { value: 0, unit: "px" },
      offsetY: { value: 0, unit: "px" },
      blur: { value: 0, unit: "px" },
      spread: { value: 0, unit: "px" },
    };
  }
  // 末尾の rgba(...) / hex を color として切り出し、残りを length トークンに分解
  const colorMatch = str.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})\s*$/);
  const colorStr = colorMatch ? colorMatch[1] : "rgba(0,0,0,0.1)";
  const lengths = str
    .slice(0, colorMatch ? str.length - colorMatch[0].length : str.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [ox = "0", oy = "0", blur = "0", spread = "0"] = lengths;
  return {
    color: toColor(colorStr),
    offsetX: toDimension(ox),
    offsetY: toDimension(oy),
    blur: toDimension(blur),
    spread: toDimension(spread),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** melta 拡張（tailwind / cssVar）を $extensions として組む。空なら undefined */
function meltaExt(
  leaf: Record<string, unknown>,
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const m: Record<string, unknown> = { ...extra };
  if (typeof leaf.tailwind === "string") m.tailwind = leaf.tailwind;
  if (typeof leaf.cssVar === "string") m.cssVar = leaf.cssVar;
  if (Object.keys(m).length === 0) return undefined;
  return { [EXT]: m };
}

/** token ノードを組む（$type は group 継承させる場合は省略） */
function token(
  value: unknown,
  ext?: Record<string, unknown>,
  type?: string
): Record<string, unknown> {
  const t: Record<string, unknown> = {};
  if (type) t.$type = type;
  t.$value = value;
  if (ext) t.$extensions = ext;
  return t;
}

type Leaf = Record<string, unknown>;

export function buildDtcg(): Record<string, unknown> {
  const tokens = JSON.parse(
    readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8")
  );

  const out: Record<string, unknown> = {
    $description:
      "melta UI design tokens in W3C DTCG format (2025.10). Generated from design/contracts/tokens.json by scripts/design/export-dtcg.ts — do not edit by hand. SSOT remains tokens.json. Tailwind class / CSS var live under $extensions.\"com.melta\".",
  };

  // --- color ---
  const colorGroup: Record<string, unknown> = { $type: "color" };
  const c = tokens.color;
  // primary ramp
  const primary: Record<string, unknown> = {};
  for (const [step, leaf] of Object.entries(c.primary) as [string, Leaf][]) {
    primary[step] = token(toColor(leaf.value as string), meltaExt(leaf));
  }
  colorGroup.primary = primary;
  // body
  colorGroup.body = token(toColor(c.body.value), meltaExt(c.body));
  // semantic light / dark
  for (const mode of ["light", "dark"] as const) {
    const group: Record<string, unknown> = {};
    for (const [name, leaf] of Object.entries(c.semantic[mode]) as [string, Leaf][]) {
      group[name] = token(toColor(leaf.value as string), meltaExt(leaf));
    }
    colorGroup[`semantic-${mode}`] = group;
  }
  // status ramps
  const status: Record<string, unknown> = {};
  for (const [name, ramp] of Object.entries(c.status) as [string, Record<string, Leaf>][]) {
    const g: Record<string, unknown> = {};
    for (const [k, leaf] of Object.entries(ramp)) {
      g[k] = token(toColor(leaf.value as string), meltaExt(leaf));
    }
    status[name] = g;
  }
  colorGroup.status = status;
  out.color = colorGroup;

  // --- spacing (dimension) ---
  const spacing: Record<string, unknown> = { $type: "dimension" };
  for (const [k, leaf] of Object.entries(tokens.spacing) as [string, Leaf][]) {
    spacing[k] = token(
      toDimension(leaf.rem as string),
      meltaExt(leaf, { px: leaf.value })
    );
  }
  out.spacing = spacing;

  // --- radius (dimension) ---
  const radius: Record<string, unknown> = { $type: "dimension" };
  for (const [k, leaf] of Object.entries(tokens.radius) as [string, Leaf][]) {
    radius[k] = token(toDimension(leaf.value as string), meltaExt(leaf));
  }
  out.radius = radius;

  // --- fontSize (dimension) ---
  const fontSize: Record<string, unknown> = { $type: "dimension" };
  for (const [k, leaf] of Object.entries(tokens.typography.fontSize) as [string, Leaf][]) {
    fontSize[k] = token(
      toDimension(leaf.size as string),
      meltaExt(leaf, { px: leaf.px, lineHeight: leaf.lineHeight })
    );
  }
  out.fontSize = fontSize;

  // --- fontFamily ---
  const fontFamily: Record<string, unknown> = { $type: "fontFamily" };
  for (const [k, leaf] of Object.entries(tokens.typography.fontFamily) as [string, Leaf][]) {
    fontFamily[k] = token(leaf.value, meltaExt(leaf));
  }
  out.fontFamily = fontFamily;

  // --- fontWeight ---
  const fontWeight: Record<string, unknown> = { $type: "fontWeight" };
  for (const [k, leaf] of Object.entries(tokens.typography.fontWeight) as [string, Leaf][]) {
    fontWeight[k] = token(leaf.value, meltaExt(leaf));
  }
  out.fontWeight = fontWeight;

  // --- lineHeight (number、unitless) ---
  const lineHeight: Record<string, unknown> = { $type: "number" };
  for (const [k, leaf] of Object.entries(tokens.typography.lineHeight) as [string, Leaf][]) {
    lineHeight[k] = token(parseFloat(leaf.value as string));
  }
  out.lineHeight = lineHeight;

  // --- letterSpacing (em は DTCG dimension 非対応 → number + 拡張に css 値) ---
  const letterSpacing: Record<string, unknown> = { $type: "number" };
  for (const [k, leaf] of Object.entries(tokens.typography.letterSpacing) as [string, Leaf][]) {
    const css = leaf.value as string;
    letterSpacing[k] = token(parseFloat(css), { [EXT]: { unit: "em", css } });
  }
  out.letterSpacing = letterSpacing;

  // --- elevation (shadow) ---
  const elevation: Record<string, unknown> = { $type: "shadow" };
  for (const [k, leaf] of Object.entries(tokens.elevation) as [string, Leaf][]) {
    elevation[k] = token(toShadow(leaf.value as string), meltaExt(leaf));
  }
  out.elevation = elevation;

  // --- motion: duration / easing ---
  const duration: Record<string, unknown> = { $type: "duration" };
  for (const [k, leaf] of Object.entries(tokens.motion.duration) as [string, Leaf][]) {
    duration[k] = token(toDuration(leaf.value as string), meltaExt(leaf));
  }
  const easing: Record<string, unknown> = { $type: "cubicBezier" };
  for (const [k, leaf] of Object.entries(tokens.motion.easing) as [string, Leaf][]) {
    easing[k] = token(toCubicBezier(leaf.value as string), meltaExt(leaf));
  }
  out.motion = { duration, easing };

  // --- zIndex (number) ---
  const zIndex: Record<string, unknown> = { $type: "number" };
  for (const [k, leaf] of Object.entries(tokens.zIndex) as [string, Leaf][]) {
    zIndex[k] = token(leaf.value, meltaExt(leaf));
  }
  out.zIndex = zIndex;

  // --- wireframe (color、ワイヤフレームモード用パレット) ---
  const wireframe: Record<string, unknown> = { $type: "color" };
  for (const [k, leaf] of Object.entries(tokens.wireframe) as [string, Leaf][]) {
    wireframe[k] = token(toColor(leaf.value as string), meltaExt(leaf));
  }
  out.wireframe = wireframe;

  return out;
}

/** tokens.dtcg.json として書き出す文字列（2-space + 末尾改行） */
export function serializeDtcg(): string {
  return JSON.stringify(buildDtcg(), null, 2) + "\n";
}

export const DTCG_PATH = "design/contracts/tokens.dtcg.json";

const isCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const outPath = resolve(root, DTCG_PATH);
  const next = serializeDtcg();
  let prev = "";
  try {
    prev = readFileSync(outPath, "utf-8");
  } catch {
    /* 初回生成 */
  }
  if (next !== prev) {
    writeFileSync(outPath, next, "utf-8");
    console.log(`  ✅ ${DTCG_PATH} を生成しました（W3C DTCG 2025.10）`);
  } else {
    console.log(`  ✅ ${DTCG_PATH} は最新です（変更なし）`);
  }
}
