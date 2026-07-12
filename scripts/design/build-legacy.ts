/**
 * build-legacy.ts — contract → 既存 JSON 互換生成
 *
 * contracts を SSOT として、既存形式の JSON を生成する:
 * 1. design/contracts/components/*.contract.json → metadata/components.json に合流
 * 2. design/contracts/rules.json → loader.ts 互換の ProhibitionRule[] を検証
 *
 * 使い方: tsx scripts/design/build-legacy.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : resolve(__dirname, "../..");

// --- 型定義（既存 metadata/components.json 互換） ---

interface LegacyVariant {
  name: string;
  tailwind: string;
}

interface LegacySize {
  name: string;
  tailwind: string;
  height?: string;
}

interface LegacyAccessibility {
  role: string;
  required: string[];
  focusRing: string;
}

/** state ごとの生成仕様（P2-1）。tailwind は base/variant からの差分クラスのみ */
interface StateSpec {
  description: string;
  tailwind: string;
  ariaChanges?: string;
  htmlNote?: string;
}

/** anatomy part（object 形式時の各パーツ。Phase1 移行形） */
interface AnatomyPart {
  description: string;
  element?: string;
  roles?: string;
  tailwind?: string;
}

type Anatomy = string[] | Record<string, AnatomyPart>;

interface LegacyComponent {
  id: string;
  name: string;
  category: string;
  description: string;
  docPath: string;
  anatomy?: Anatomy;
  variants: LegacyVariant[];
  sizes: LegacySize[];
  iconButton?: Array<{ name: string; tailwind: string; icon: string }>;
  iconTextPadding?: Array<{ name: string; tailwind: string }>;
  states?: string[];
  stateSpecs?: Record<string, StateSpec>;
  platformSemantics?: Record<string, string>;
  appStatus?: string;
  appMapping?: string;
  appNote?: string;
  recipes?: { app?: Record<string, unknown> };
  accessibility: LegacyAccessibility;
  prohibited: string[];
  htmlSample: string | Record<string, string>;
}

interface LegacyComponentsData {
  version: string;
  components: LegacyComponent[];
}

// --- contract 型 ---

interface ContractVariant {
  description: string;
  tailwind: string;
  tokenRefs?: Record<string, string>;
}

interface ContractSize {
  height: number;
  tailwind: string;
  icon?: number;
}

interface ContractRule {
  id: string;
  severity: string;
}

interface ComponentContract {
  id: string;
  version: string;
  name: string;
  category: string;
  intent: string;
  docPath?: string;
  anatomy?: Anatomy;
  variants: Record<string, ContractVariant>;
  sizes: Record<string, ContractSize>;
  iconButton?: Record<string, { tailwind: string; icon: string }>;
  iconTextPadding?: Record<string, { tailwind: string }>;
  states: string[];
  stateSpecs?: Record<string, StateSpec>;
  platformSemantics?: Record<string, string>;
  appStatus?: string;
  appMapping?: string;
  appNote?: string;
  a11y: {
    role: string;
    required: string[];
    keyboard: string[];
    focusRing?: string;
  };
  rules: ContractRule[];
  htmlSample: string | Record<string, string>;
}

// --- rules 型 ---

interface Rule {
  id: string;
  category: string;
  severity: string;
  description: string;
  detector: string;
  pattern: string | null;
  matchPatterns?: string[];
  alternative: string;
}

interface RulesData {
  version: string;
  rules: Rule[];
}

interface LegacyProhibitionRule {
  pattern: string;
  reason: string;
  alternative: string;
}

// --- contract → legacy 変換 ---

/** recipes/app/<id>.recipe.json（RN styleRefs、手書き authoring source）があれば読む */
function loadAppRecipe(id: string): Record<string, unknown> | null {
  const path = resolve(root, "design/contracts/recipes/app", `${id}.recipe.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function contractToLegacy(contract: ComponentContract, rulesData: RulesData): LegacyComponent {
  // variants 変換（object → array）
  const variants: LegacyVariant[] = Object.entries(contract.variants).map(([name, v]) => ({
    name,
    tailwind: v.tailwind,
  }));

  // sizes 変換（object → array）
  const sizes: LegacySize[] = Object.entries(contract.sizes).map(([name, s]) => ({
    name,
    tailwind: s.tailwind,
    height: `${s.height}px`,
  }));

  // iconButton 変換
  let iconButton: Array<{ name: string; tailwind: string; icon: string }> | undefined;
  if (contract.iconButton) {
    iconButton = Object.entries(contract.iconButton).map(([name, ib]) => ({
      name,
      tailwind: ib.tailwind,
      icon: ib.icon,
    }));
  }

  // iconTextPadding 変換
  let iconTextPadding: Array<{ name: string; tailwind: string }> | undefined;
  if (contract.iconTextPadding) {
    iconTextPadding = Object.entries(contract.iconTextPadding).map(([name, itp]) => ({
      name,
      tailwind: itp.tailwind,
    }));
  }

  // prohibited: rules の description を引く
  const ruleMap = new Map(rulesData.rules.map((r) => [r.id, r]));
  const prohibited: string[] = contract.rules.map((ref) => {
    const rule = ruleMap.get(ref.id);
    return rule ? rule.description : ref.id;
  });

  // accessibility
  const accessibility: LegacyAccessibility = {
    role: contract.a11y.role,
    required: contract.a11y.required,
    focusRing: contract.a11y.focusRing || "focus:ring-2 focus:ring-primary-500/50",
  };

  // htmlSample: contract の値をそのまま渡す（string でも object でも LegacyComponent 型は両方受け入れる）
  const htmlSample: string | Record<string, string> = contract.htmlSample ?? "";
  const appRecipe = loadAppRecipe(contract.id);

  return {
    id: contract.id,
    name: contract.name,
    category: contract.category,
    description: contract.intent,
    docPath: contract.docPath || `components/${contract.id}.md`,
    // P2-1: anatomy / states / stateSpecs を additive で運ぶ（条件スプレッドで未定義時は出さない）
    ...(contract.anatomy ? { anatomy: contract.anatomy } : {}),
    variants,
    sizes,
    ...(iconButton ? { iconButton } : {}),
    ...(iconTextPadding ? { iconTextPadding } : {}),
    ...(contract.states ? { states: contract.states } : {}),
    ...(contract.stateSpecs ? { stateSpecs: contract.stateSpecs } : {}),
    // P3: 規範（platformSemantics）と app 具象レシピ（recipes/app/、手書き authoring source）を
    // additive で運ぶ。web 具象は variants[].tailwind に既存なので recipes.web は載せない
    ...(contract.platformSemantics ? { platformSemantics: contract.platformSemantics } : {}),
    ...(contract.appStatus ? { appStatus: contract.appStatus } : {}),
    ...(contract.appMapping ? { appMapping: contract.appMapping } : {}),
    ...(contract.appNote ? { appNote: contract.appNote } : {}),
    ...(appRecipe ? { recipes: { app: appRecipe } } : {}),
    accessibility,
    prohibited,
    htmlSample,
  };
}

// --- rules.json → ProhibitionRule[] 変換 ---

function rulesToLegacyProhibitions(rulesData: RulesData): LegacyProhibitionRule[] {
  const result: LegacyProhibitionRule[] = [];

  for (const rule of rulesData.rules) {
    // 自動検出可能なルールのみ変換
    if (rule.detector === "manual" || !rule.pattern) continue;

    if (rule.matchPatterns && rule.matchPatterns.length > 0) {
      // 展開
      for (const mp of rule.matchPatterns) {
        result.push({
          pattern: mp,
          reason: rule.description,
          alternative: rule.alternative,
        });
      }
    } else {
      result.push({
        pattern: rule.pattern,
        reason: rule.description,
        alternative: rule.alternative,
      });
    }
  }

  return result;
}

// --- メイン処理 ---

console.log("\n=== build-legacy: contract → 既存 JSON 互換生成 ===\n");

// 1. rules.json を読み込み
const rulesPath = resolve(root, "design/contracts/rules.json");
if (!existsSync(rulesPath)) {
  console.error("ERROR: design/contracts/rules.json が見つかりません");
  process.exit(1);
}
const rulesData: RulesData = JSON.parse(readFileSync(rulesPath, "utf-8"));
console.log(`  rules.json: ${rulesData.rules.length} ルール読み込み`);

// 2. 既存 components.json を読み込み
const existingPath = resolve(root, "metadata/components.json");
const existingData: LegacyComponentsData = existsSync(existingPath)
  ? JSON.parse(readFileSync(existingPath, "utf-8"))
  : { version: "1.0.0", components: [] };
console.log(`  既存 components.json: ${existingData.components.length} コンポーネント`);

// 3. contract ファイルを読み込み
const contractDir = resolve(root, "design/contracts/components");
const contractFiles = existsSync(contractDir)
  ? readdirSync(contractDir).filter((f) => f.endsWith(".contract.json"))
  : [];
console.log(`  contract ファイル: ${contractFiles.length} 件`);

// 4. contract → legacy 変換して既存データにマージ
const contractIds = new Set<string>();
const convertedComponents: LegacyComponent[] = [];

for (const file of contractFiles) {
  const contract: ComponentContract = JSON.parse(
    readFileSync(resolve(contractDir, file), "utf-8")
  );
  contractIds.add(contract.id);
  convertedComponents.push(contractToLegacy(contract, rulesData));
  console.log(`  ✓ ${file} → ${contract.id} (contract)`);
}

// 既存データから contract 未移行のコンポーネントを保持
const keptComponents = existingData.components.filter((c) => !contractIds.has(c.id));
console.log(`  既存データから保持: ${keptComponents.length} コンポーネント`);

// マージ: contract 変換分 + 既存保持分
const mergedComponents = [...convertedComponents, ...keptComponents];

// id 順でソート
mergedComponents.sort((a, b) => a.id.localeCompare(b.id));

// 5. metadata/components.json を書き出し
const output: LegacyComponentsData = {
  version: rulesData.version || existingData.version,
  components: mergedComponents,
};

writeFileSync(existingPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
console.log(`\n  ✅ metadata/components.json を更新: ${mergedComponents.length} コンポーネント`);

// 6. rules → ProhibitionRule[] の互換性レポート
const legacyRules = rulesToLegacyProhibitions(rulesData);
console.log(`\n  rules.json → ProhibitionRule[] 互換: ${legacyRules.length} パターン`);

// loader.ts のハードコードとの差分表示
const loaderPath = resolve(root, "src/utils/loader.ts");
if (existsSync(loaderPath)) {
  const loaderContent = readFileSync(loaderPath, "utf-8");
  const patternMatches = loaderContent.match(/pattern:\s*"([^"]+)"/g);
  const hardcodedPatterns = patternMatches
    ? patternMatches.map((m) => m.replace(/pattern:\s*"/, "").replace(/"$/, ""))
    : [];

  const legacyPatterns = new Set(legacyRules.map((r) => r.pattern));
  const missing = legacyRules.filter((r) => !hardcodedPatterns.some((h) => r.pattern.includes(h) || h.includes(r.pattern)));
  const extra = hardcodedPatterns.filter((h) => !legacyRules.some((r) => r.pattern.includes(h) || h.includes(r.pattern)));

  if (missing.length > 0) {
    console.log(`\n  ⚠️  rules.json にあって loader.ts にないパターン (${missing.length} 件):`);
    for (const m of missing.slice(0, 10)) {
      console.log(`      + ${m.pattern}`);
    }
    if (missing.length > 10) console.log(`      ... 他 ${missing.length - 10} 件`);
  }

  if (extra.length > 0) {
    console.log(`\n  ℹ️  loader.ts にあって rules.json にないパターン (${extra.length} 件):`);
    for (const e of extra) {
      console.log(`      - ${e}`);
    }
  }
}

console.log("\n=== build-legacy 完了 ===\n");
