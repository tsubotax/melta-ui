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
import { isAutoDetectable } from "../../src/utils/matcher.js";
import { emitClassValue, readClassValue, requireClassValue } from "../../src/utils/class-value.js";
import type { RuleEntry } from "../../src/utils/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// engine root — loader.ts 等、エンジン自身の資産。vendor 先でもスクリプト位置から解決する
const engineRoot = resolve(__dirname, "../..");
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : engineRoot;

// --- 型定義（既存 metadata/components.json 互換） ---

interface LegacyVariant {
  name: string;
  /** 正のキー（W3）。tailwind は deprecated alias として同値で併記する */
  class: string;
  tailwind: string;
}

interface LegacySize {
  name: string;
  class: string;
  tailwind: string;
  height?: string;
}

interface LegacyAccessibility {
  role: string;
  required: string[];
  /** 契約が宣言した場合のみ。engine 側で既定値を補わない（下記 contractToLegacy 参照） */
  focusRing?: string;
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
  iconButton?: Array<{ name: string; class: string; tailwind: string; icon: string }>;
  iconTextPadding?: Array<{ name: string; class: string; tailwind: string }>;
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
  prefixPatterns?: string[];
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
  // クラス文字列は class 正 / tailwind alias の共通 reader で読む（W3）。
  // 生成物には両キーを同値で併記する（metadata は MCP の配布面。片方だけにすると
  // 既存消費者を壊すか、公開面に技術強制が残るかのどちらかになる）
  const variants: LegacyVariant[] = Object.entries(contract.variants).map(([name, v]) => ({
    name,
    ...emitClassValue(requireClassValue(v, `${contract.id}.variants.${name}`)),
  }));

  // sizes 変換（object → array）
  const sizes: LegacySize[] = Object.entries(contract.sizes).map(([name, s]) => ({
    name,
    ...emitClassValue(requireClassValue(s, `${contract.id}.sizes.${name}`)),
    height: `${s.height}px`,
  }));

  // iconButton 変換
  let iconButton: Array<{ name: string; tailwind: string; icon: string }> | undefined;
  if (contract.iconButton) {
    iconButton = Object.entries(contract.iconButton).map(([name, ib]) => ({
      name,
      ...emitClassValue(requireClassValue(ib, `${contract.id}.iconButton.${name}`)),
      icon: ib.icon,
    }));
  }

  // iconTextPadding 変換
  let iconTextPadding: Array<{ name: string; tailwind: string }> | undefined;
  if (contract.iconTextPadding) {
    iconTextPadding = Object.entries(contract.iconTextPadding).map(([name, itp]) => ({
      name,
      ...emitClassValue(requireClassValue(itp, `${contract.id}.iconTextPadding.${name}`)),
    }));
  }

  // prohibited: rules の description を引く
  const ruleMap = new Map(rulesData.rules.map((r) => [r.id, r]));
  const prohibited: string[] = contract.rules.map((ref) => {
    const rule = ruleMap.get(ref.id);
    return rule ? rule.description : ref.id;
  });

  // accessibility
  // focusRing は契約が宣言したものだけを載せる。
  // 以前は melta の "focus:ring-2 focus:ring-primary-500/50" を既定値として補っていたが、
  // それは第三者 DS の metadata / MCP 応答に **その DS に存在しない melta のクラス**を
  // 混入させる経路だった（AI がそれを読んで未定義クラスを出力する）。
  // melta の 40 契約はすべて focusRing を宣言済みなので、削除しても出力は変わらない。
  const accessibility: LegacyAccessibility = {
    role: contract.a11y.role,
    required: contract.a11y.required,
    ...(contract.a11y.focusRing ? { focusRing: contract.a11y.focusRing } : {}),
  };

  // stateSpecs / anatomy(object 形式) も class carrier。pass-through だと
  // class-only contract で alias が生成されず「metadata は両キー同値」が崩れる
  const normalizeCarrier = <T extends Record<string, unknown>>(
    entries: Record<string, T> | undefined,
    kind: string
  ): Record<string, T> | undefined => {
    if (!entries) return undefined;
    return Object.fromEntries(
      Object.entries(entries).map(([key, value]) => {
        const cls = readClassValue(value, `${contract.id}.${kind}.${key}`);
        return [key, (cls != null ? { ...value, ...emitClassValue(cls) } : value) as T];
      })
    );
  };
  const normalizedStateSpecs = normalizeCarrier(
    contract.stateSpecs as Record<string, Record<string, unknown>> | undefined,
    "stateSpecs"
  );
  const normalizedAnatomy = Array.isArray(contract.anatomy)
    ? contract.anatomy
    : normalizeCarrier(
        contract.anatomy as Record<string, Record<string, unknown>> | undefined,
        "anatomy"
      );

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
    ...(normalizedAnatomy ? { anatomy: normalizedAnatomy as Anatomy } : {}),
    variants,
    sizes,
    ...(iconButton ? { iconButton } : {}),
    ...(iconTextPadding ? { iconTextPadding } : {}),
    ...(contract.states ? { states: contract.states } : {}),
    ...(normalizedStateSpecs ? { stateSpecs: normalizedStateSpecs as Record<string, StateSpec> } : {}),
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
    // 自動検出可能なルールのみ変換。判定は matcher.isAutoDetectable が単一の真理。
    // 旧実装は `!rule.pattern` で弾いていたため、matchPatterns だけを持つ
    // tailwind-class-segment（AI_NO_DECORATIVE_PURPLE）が legacy 出力から
    // 黙って脱落していた。detector ごとに読むフィールドが違う以上、
    // pattern の有無で判定してはいけない。
    if (!isAutoDetectable(rule as unknown as RuleEntry)) continue;

    // 展開順は loader.getProhibitionRules と同じ（matchPatterns → pattern、加えて prefixPatterns）
    if (rule.matchPatterns && rule.matchPatterns.length > 0) {
      for (const mp of rule.matchPatterns) {
        result.push({
          pattern: mp,
          reason: rule.description,
          alternative: rule.alternative,
        });
      }
    } else if (rule.pattern) {
      result.push({
        pattern: rule.pattern,
        reason: rule.description,
        alternative: rule.alternative,
      });
    }
    for (const pp of rule.prefixPatterns ?? []) {
      result.push({
        pattern: pp,
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

// 旧 loader.ts はパターンをハードコードしていたため、ここで文字列リテラルを
// 拾って差分を出していた。現在の loader.ts は rules.json を読む動的実装で
// リテラルを持たないため、この比較は全パターンを「loader.ts にない」と誤報するだけだった。
// 実装同士の一致は tests/ と design:check が担保しているので、件数の報告に留める。

console.log("\n=== build-legacy 完了 ===\n");
