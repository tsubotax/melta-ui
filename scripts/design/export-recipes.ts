/**
 * export-recipes.ts — 契約から web 具象レシピ（recipes/web/*.recipe.json）を生成する。
 *
 * 「契約 = 規範（anatomy / variants 語彙 / states / tokenRefs）、プラットフォーム具象 = recipes」
 * の2層分離（Codex レビュー 2026-07-02 の規範/導出ハイブリッド案）。
 *  - recipes/web/ は契約の tailwind フィールドから**生成**される導出物（直接編集しない）。
 *    契約内の tailwind は当面 SSOT のまま残す additive 移行（消すのは次 major、消費者監査後）
 *  - recipes/app/ は RN 実装の styleRefs を**手書き**する authoring source（生成しない）
 *
 * validate.ts が recipes/web/ の鮮度（契約から再生成した内容と一致）を監視する。
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : resolve(__dirname, "../..");

export const CONTRACTS_DIR = "design/contracts/components";
export const WEB_RECIPES_DIR = "design/contracts/recipes/web";

interface ContractLike {
  id: string;
  version: string;
  variants?: Record<string, { tailwind?: string }>;
  sizes?: Record<string, { tailwind?: string }>;
  stateSpecs?: Record<string, { tailwind?: string }>;
  iconButton?: Record<string, { tailwind?: string }>;
}

/** tailwind フィールドだけを抽出した web recipe を組み立てる（決定論・キー順は contract 由来） */
export function buildWebRecipe(contract: ContractLike): Record<string, unknown> {
  const pick = (
    group: Record<string, { tailwind?: string }> | undefined
  ): Record<string, { tailwind: string }> | undefined => {
    if (!group) return undefined;
    const out: Record<string, { tailwind: string }> = {};
    for (const [key, value] of Object.entries(group)) {
      if (typeof value?.tailwind === "string") out[key] = { tailwind: value.tailwind };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const recipe: Record<string, unknown> = {
    $schema: "../../../schemas/recipe.schema.json",
    id: contract.id,
    platform: "web",
    contractVersion: contract.version,
    generatedFrom: `components/${contract.id}.contract.json`,
  };
  const variants = pick(contract.variants);
  const sizes = pick(contract.sizes);
  const iconButton = pick(contract.iconButton);
  const stateSpecs = pick(contract.stateSpecs);
  if (variants) recipe.variants = variants;
  if (sizes) recipe.sizes = sizes;
  if (iconButton) recipe.iconButton = iconButton;
  if (stateSpecs) recipe.stateSpecs = stateSpecs;
  return recipe;
}

export function serializeWebRecipe(contract: ContractLike): string {
  return JSON.stringify(buildWebRecipe(contract), null, 2) + "\n";
}

export function listContractFiles(): string[] {
  return readdirSync(resolve(root, CONTRACTS_DIR))
    .filter((f) => f.endsWith(".contract.json"))
    .sort();
}

function main(): void {
  const outDir = resolve(root, WEB_RECIPES_DIR);
  mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const file of listContractFiles()) {
    const contract = JSON.parse(
      readFileSync(resolve(root, CONTRACTS_DIR, file), "utf-8")
    ) as ContractLike;
    writeFileSync(join(outDir, `${contract.id}.recipe.json`), serializeWebRecipe(contract), "utf-8");
    count++;
  }
  console.log(`✅ web recipes を生成: ${WEB_RECIPES_DIR}/ に ${count} 件`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
