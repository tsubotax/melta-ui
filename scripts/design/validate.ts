/**
 * validate.ts — melta UI static harness
 *
 * 検証項目:
 * 1. rules.json のスキーマ整合性
 * 2. component contract のスキーマ整合性
 * 3. ルール ID の一意性
 * 4. contract 内のルール参照が rules.json に存在するか
 * 5. contract 内の tokenRef が tokens.json に存在するか
 * 6. MCP check_rule のハードコード件数 vs rules.json の自動検出可能ルール件数
 */

import { readFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize, matches, isAutoDetectable } from "../../src/utils/matcher.js";
import { isStaticallyDetectable, isUnclassified, isUnguardedError } from "./coverage-stats.js";
import type { RuleEntry, RulesFile } from "../../src/utils/types.js";
import { serializeDtcg, DTCG_PATH } from "./export-dtcg.js";
import { serializeWebRecipe, WEB_RECIPES_DIR } from "./export-recipes.js";
import { tokenNodeAt, isTokenLeaf } from "./contract-compat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// engine root — schema / loader 等、エンジン自身の資産。vendor 先でもスクリプト位置から解決する
const engineRoot = resolve(__dirname, "../..");
// アセット root。vendor 先では MELTA_ROOT で上書き（src/utils/loader.ts と同じ規約）
const root = process.env.MELTA_ROOT
  ? resolve(process.env.MELTA_ROOT)
  : engineRoot;

// 検査の capability 単位無効化（MELTA_VALIDATE_SKIP=dtcg,recipes-app）。
// vendor 先のアセットが melta のトークン構造を持たない場合に該当検査だけ外す:
//  - dtcg: DTCG serializer は color.primary 等 melta の token 構造を前提とする
//  - recipes-app: app recipe の styleRefs token 参照はブランド固有の token パスを指す
const VALID_SKIP_CAPABILITIES = new Set(["dtcg", "recipes-app"]);
const skipCapabilities = new Set(
  (process.env.MELTA_VALIDATE_SKIP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function isSkipped(cap: string): boolean {
  return skipCapabilities.has(cap);
}

let errors = 0;
let warnings = 0;

function error(msg: string): void {
  console.error(`  ❌ ERROR: ${msg}`);
  errors++;
}

function warn(msg: string): void {
  console.warn(`  ⚠️  WARN: ${msg}`);
  warnings++;
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

function noteSkipped(cap: string, what: string): void {
  console.log(`  ⏭️  SKIP: ${what}（MELTA_VALIDATE_SKIP=${cap}）`);
}

// 未知の capability 名は error（typo で検査が黙って残る/消える事故を塞ぐ）
for (const cap of skipCapabilities) {
  if (!VALID_SKIP_CAPABILITIES.has(cap)) {
    error(
      `MELTA_VALIDATE_SKIP に未知の capability "${cap}"（有効: ${[...VALID_SKIP_CAPABILITIES].join(", ")}）`
    );
  }
}

// --- 簡易 JSON Schema バリデーション（外部ライブラリ不要） ---

interface SimpleSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string | string[]; enum?: string[]; pattern?: string; items?: SimpleSchema }>;
  items?: SimpleSchema;
  additionalProperties?: SimpleSchema | boolean;
}

function validateAgainstSchema(
  data: unknown,
  schema: SimpleSchema,
  path: string,
  label: string
): string[] {
  const issues: string[] = [];

  if (schema.type === "object" && typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;

    // required フィールドチェック
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          issues.push(`${label}: "${path}.${field}" は必須`);
        }
      }
    }

    // properties のチェック
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in obj)) continue;
        const val = obj[key];

        // enum チェック
        if (propSchema.enum && typeof val === "string" && !propSchema.enum.includes(val)) {
          issues.push(`${label}: "${path}.${key}" の値 "${val}" は enum ${JSON.stringify(propSchema.enum)} に含まれない`);
        }

        // pattern チェック
        if (propSchema.pattern && typeof val === "string") {
          const re = new RegExp(propSchema.pattern);
          if (!re.test(val)) {
            issues.push(`${label}: "${path}.${key}" の値 "${val}" がパターン /${propSchema.pattern}/ に不一致`);
          }
        }

        // type チェック（基本型のみ）
        if (propSchema.type) {
          const types = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
          const actualType = val === null ? "null" : Array.isArray(val) ? "array" : typeof val;
          if (!types.includes(actualType)) {
            issues.push(`${label}: "${path}.${key}" の型が ${types.join("|")} ではなく ${actualType}`);
          }
        }

        // 配列の items チェック
        if (propSchema.items && Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            issues.push(...validateAgainstSchema(val[i], propSchema.items, `${path}.${key}[${i}]`, label));
          }
        }
      }
    }

    // additionalProperties: 動的キー配下の検証（variants, sizes 等）
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const apSchema = schema.additionalProperties as SimpleSchema;
      for (const [key, val] of Object.entries(obj)) {
        // properties に定義されているキーはスキップ（上で既にチェック済み）
        if (schema.properties && key in schema.properties) continue;
        if (key === "$schema") continue;
        issues.push(...validateAgainstSchema(val, apSchema, `${path}.${key}`, label));
      }
    }

    // properties 内の各プロパティが additionalProperties を持つ場合、再帰
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in obj)) continue;
        const val = obj[key];
        const fullPropSchema = propSchema as SimpleSchema;
        if (fullPropSchema.type === "object" && fullPropSchema.additionalProperties && typeof val === "object" && val !== null) {
          const apSchema = fullPropSchema.additionalProperties as SimpleSchema;
          if (typeof apSchema === "object") {
            for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
              issues.push(...validateAgainstSchema(subVal, apSchema, `${path}.${key}.${subKey}`, label));
            }
          }
        }
      }
    }
  } else if (schema.type === "array" && Array.isArray(data)) {
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        issues.push(...validateAgainstSchema(data[i], schema.items, `${path}[${i}]`, label));
      }
    }
  }

  return issues;
}

// --- ファイル読み込み ---

function loadJSON(path: string, base: string = root): unknown {
  const fullPath = resolve(base, path);
  if (!existsSync(fullPath)) {
    error(`ファイルが見つかりません: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  } catch (e) {
    error(`JSON パースエラー: ${path} — ${(e as Error).message}`);
    return null;
  }
}

// --- 1. rules.json の検証 ---

section("1. rules.json の検証");

const rulesData = loadJSON("design/contracts/rules.json") as RulesFile | null;

// 自動検出可否の判定は matcher.isAutoDetectable に一本化（segment 含む）。
// contract lint の enforce/warn 抽出は matches() 経由なので boolean で十分。

// JSON Schema を読み込み（schema はエンジン自身の資産なので engine root から。アセット root と分離）
const ruleSchema = loadJSON("design/schemas/rule.schema.json", engineRoot) as SimpleSchema | null;
const contractSchema = loadJSON("design/schemas/component-contract.schema.json", engineRoot) as SimpleSchema | null;

if (rulesData && ruleSchema) {
  // Schema バリデーション
  const schemaIssues = validateAgainstSchema(rulesData, ruleSchema, "rules", "rules.json");
  if (schemaIssues.length > 0) {
    for (const issue of schemaIssues) error(issue);
  } else {
    ok("rules.json スキーマ検証 OK");
  }

  // rules 配列内の各ルールを items スキーマでチェック
  if (ruleSchema.properties?.rules?.items) {
    const itemSchema = ruleSchema.properties.rules.items;
    let ruleSchemaErrors = 0;
    for (const rule of rulesData.rules) {
      const issues = validateAgainstSchema(rule, itemSchema, `rules[${rule.id}]`, "rules.json");
      for (const issue of issues) {
        error(issue);
        ruleSchemaErrors++;
      }
    }
    if (ruleSchemaErrors === 0) {
      ok(`全 ${rulesData.rules.length} ルールのスキーマ検証 OK`);
    }
  }
}

if (rulesData) {
  // version チェック
  if (!rulesData.version) {
    error("rules.json に version がありません");
  } else {
    ok(`version: ${rulesData.version}`);
  }

  // rules 配列チェック
  if (!Array.isArray(rulesData.rules)) {
    error("rules.json の rules が配列ではありません");
  } else {
    ok(`ルール件数: ${rulesData.rules.length}`);

    // 必須フィールドチェック
    const requiredFields = ["id", "category", "severity", "description", "detector", "alternative"];
    for (const rule of rulesData.rules) {
      for (const field of requiredFields) {
        if (!(field in rule)) {
          error(`ルール ${rule.id || "unknown"} に必須フィールド "${field}" がありません`);
        }
      }

      // severity の値チェック
      if (rule.severity && !["error", "warn"].includes(rule.severity)) {
        error(`ルール ${rule.id}: severity "${rule.severity}" は "error" または "warn" のみ`);
      }

      // detector の値チェック
      const validDetectors = ["tailwind-class", "tailwind-class-prefix", "tailwind-class-segment", "html-attr", "composition", "manual"];
      if (rule.detector && !validDetectors.includes(rule.detector)) {
        error(`ルール ${rule.id}: detector "${rule.detector}" は不正`);
      }

      // tailwind-class / tailwind-class-prefix は pattern 必須
      if (["tailwind-class", "tailwind-class-prefix"].includes(rule.detector) && !rule.pattern) {
        error(`ルール ${rule.id}: detector "${rule.detector}" には pattern が必須`);
      }

      // tailwind-class-segment は matchPatterns 必須
      if (rule.detector === "tailwind-class-segment" && (!rule.matchPatterns || rule.matchPatterns.length === 0)) {
        error(`ルール ${rule.id}: detector "tailwind-class-segment" には matchPatterns が必須`);
      }
    }

    // --- 2. ルール ID の一意性 ---

    section("2. ルール ID の一意性");

    const ids = rulesData.rules.map((r) => r.id);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    if (duplicates.size > 0) {
      error(`重複ルール ID: ${[...duplicates].join(", ")}`);
    } else {
      ok(`全 ${ids.length} 件のルール ID が一意`);
    }

    // カテゴリ別集計
    const categories = new Map<string, number>();
    for (const rule of rulesData.rules) {
      categories.set(rule.category, (categories.get(rule.category) || 0) + 1);
    }
    for (const [cat, count] of [...categories.entries()].sort()) {
      ok(`  ${cat}: ${count} 件`);
    }

    // 自動検出可能 vs manual の集計
    const autoDetectable = rulesData.rules.filter(isAutoDetectable);
    const manualOnly = rulesData.rules.filter((r) => !isAutoDetectable(r));
    ok(`自動検出可能: ${autoDetectable.length} 件 / manual: ${manualOnly.length} 件`);

    // --- automationStatus 整合（2026-07 棚卸し）---
    // 「宣言と検出機構の矛盾」を機械で塞ぐ。severity 問わず全ルール対象（warn ルールの誤分類も許さない）。
    let statusConflicts = 0;
    for (const rule of rulesData.rules) {
      const detectable = isStaticallyDetectable(rule);
      const declaresNoAutomation = ["impossible-static", "llm-judge-candidate", "human-only"].includes(
        rule.automationStatus ?? ""
      );
      if (detectable && declaresNoAutomation) {
        error(
          `ルール ${rule.id}: 静的検出機構を持つのに automationStatus "${rule.automationStatus}" を宣言（矛盾。検出可能性は detector/spec から導出する）`
        );
        statusConflicts++;
      }
      if (!detectable && rule.automationStatus === "auto") {
        error(`ルール ${rule.id}: automationStatus "auto" だが静的検出機構が無い（宣言だけの auto は禁止）`);
        statusConflicts++;
      }
    }
    if (statusConflicts === 0) ok("automationStatus と検出機構の矛盾なし");

    // 集約 warn（stateSpecs backlog と同パターン: design:check 出力を汚さない。詳細は design:coverage）
    const unclassified = rulesData.rules.filter(isUnclassified);
    if (unclassified.length > 0) {
      warn(
        `棚卸し backlog: ${unclassified.length} 件が automationStatus 未宣言（npm run design:coverage で一覧。2026-07 棚卸しで解消）`
      );
    }
    const unguardedErrors = rulesData.rules.filter(isUnguardedError);
    if (unguardedErrors.length > 0) {
      warn(
        `無防備 error: ${unguardedErrors.length} 件が severity=error なのに自動検証（静的検出 / interaction test）なし（npm run design:coverage で ID 一覧）`
      );
    }
  }
}

// --- 3. component contract の検証 ---

section("3. component contract の検証");

interface ContractRule {
  id: string;
  severity: string;
}

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

interface StateSpec {
  description: string;
  tailwind: string;
  ariaChanges?: string;
  htmlNote?: string;
}

interface ComponentContract {
  id: string;
  version: string;
  name: string;
  category: string;
  intent: string;
  anatomy?: unknown;
  variants: Record<string, ContractVariant>;
  sizes: Record<string, ContractSize>;
  states: string[];
  variantModeledStates?: string[];
  stateSpecs?: Record<string, StateSpec>;
  a11y: {
    role: string;
    required: string[];
    keyboard: string[];
  };
  rules: ContractRule[];
}

const contractDir = resolve(root, "design/contracts/components");
const contractFiles: string[] = [];

if (existsSync(contractDir)) {
  const files = readdirSync(contractDir).filter((f) => f.endsWith(".contract.json"));
  ok(`contract ファイル数: ${files.length}`);

  for (const file of files) {
    const contract = loadJSON(`design/contracts/components/${file}`) as ComponentContract | null;
    if (!contract) continue;
    contractFiles.push(file);

    // 必須フィールド
    const required = ["id", "version", "name", "category", "intent", "variants", "sizes", "states", "a11y", "rules"];
    for (const field of required) {
      if (!(field in contract)) {
        error(`${file}: 必須フィールド "${field}" がありません`);
      }
    }

    // Schema バリデーション
    if (contractSchema) {
      const issues = validateAgainstSchema(contract, contractSchema, file, file);
      if (issues.length > 0) {
        for (const issue of issues) error(issue);
      } else {
        ok(`${file}: スキーマ検証 OK`);
      }
    }

    ok(`${file}: id=${contract.id}, version=${contract.version}, variants=${Object.keys(contract.variants || {}).length}`);

    // --- 4. contract 内のルール参照が rules.json に存在するか ---
    if (rulesData && contract.rules) {
      const ruleIds = new Set(rulesData.rules.map((r) => r.id));
      for (const ref of contract.rules) {
        if (!ruleIds.has(ref.id)) {
          error(`${file}: ルール参照 "${ref.id}" が rules.json に存在しません`);
        }
      }
      ok(`${file}: ルール参照 ${contract.rules.length} 件すべて rules.json に存在`);
    }

    // --- 5. tokenRef が tokens.json に存在するか ---
    const tokens = loadJSON("design/contracts/tokens.json");
    if (tokens && contract.variants) {
      let tokenRefCount = 0;
      let missingCount = 0;

      for (const [variantName, variant] of Object.entries(contract.variants)) {
        if (!variant.tokenRefs) continue;
        for (const [prop, ref] of Object.entries(variant.tokenRefs)) {
          tokenRefCount++;
          // dot-path で tokens.json を辿る
          const parts = ref.split(".");
          let current: unknown = tokens;
          let found = true;
          for (const part of parts) {
            if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
              current = (current as Record<string, unknown>)[part];
            } else {
              // セマンティック参照（text-on-accent 等）は tokens.json に直接ない場合がある
              // warn にとどめる
              warn(`${file}: variant "${variantName}" の tokenRef "${prop}: ${ref}" が tokens.json に見つかりません`);
              missingCount++;
              found = false;
              break;
            }
          }
        }
      }

      if (missingCount === 0) {
        ok(`${file}: tokenRef ${tokenRefCount} 件チェック完了`);
      }
    }
  }
} else {
  warn("design/contracts/components/ ディレクトリが存在しません");
}

// --- 6. MCP check_rule の rules.json 駆動確認 ---

section("4. MCP check_rule の rules.json 駆動確認");

if (rulesData) {
  // loader.ts はエンジン自身の資産なので engine root から読む
  const loaderPath = resolve(engineRoot, "src/utils/loader.ts");
  if (existsSync(loaderPath)) {
    const loaderContent = readFileSync(loaderPath, "utf-8");

    // loader.ts が rules.json を参照しているか
    if (loaderContent.includes("design/contracts/rules.json")) {
      ok("loader.ts は rules.json を SSOT として参照");
    } else {
      warn("loader.ts が rules.json を参照していません。ハードコードが残っている可能性");
    }

    // ハードコードパターンが残っていないか
    const hardcodedPatterns = loaderContent.match(/pattern:\s*"/g);
    if (hardcodedPatterns && hardcodedPatterns.length > 0) {
      warn(`loader.ts にハードコードパターンが ${hardcodedPatterns.length} 件残っています`);
    } else {
      ok("loader.ts にハードコードパターンなし");
    }

    // rules.json の自動検出可能ルール数
    const autoDetectable = rulesData.rules.filter(isAutoDetectable);
    let expandedCount = 0;
    for (const rule of autoDetectable) {
      expandedCount += rule.matchPatterns ? rule.matchPatterns.length : 1;
    }
    ok(`MCP check_rule 自動検出パターン: ${expandedCount} 件（${autoDetectable.length} ルールから展開）`);
  } else {
    warn("src/utils/loader.ts が見つかりません");
  }
}

// --- tokens.json の存在チェック ---

section("5. tokens.json の存在チェック");

const tokensData = loadJSON("design/contracts/tokens.json");
if (tokensData) {
  ok("tokens.json 読み込み成功: design/contracts/tokens.json");
}

// deprecated path 不在 invariant。
// 旧 SSOT tokens/tokens.json は design/contracts/ 移行時に互換 symlink として残っていたが、
// 旧パス依存が再び生まれる（将来 symlink が実ファイルに分岐しうる）入口なので撤去した。
// engineRoot 固定 — これは melta-ui 自身の移行不変条件であり、vendor 先のアセットには適用しない。
// lstatSync はリンクを追従しないので、実ファイル・生きた symlink・壊れた symlink をすべて検出する。
const LEGACY_TOKENS_PATH = "tokens/tokens.json";
try {
  const legacyEntry = lstatSync(resolve(engineRoot, LEGACY_TOKENS_PATH), {
    throwIfNoEntry: false,
  });
  if (legacyEntry) {
    const kind = legacyEntry.isSymbolicLink()
      ? "symlink"
      : legacyEntry.isFile()
        ? "ファイル"
        : "エントリ";
    error(
      `deprecated tokens path ${LEGACY_TOKENS_PATH} が ${kind} として復活しています（SSOT は design/contracts/tokens.json のみ）`
    );
  } else {
    ok(`deprecated tokens path 不在: ${LEGACY_TOKENS_PATH}`);
  }
} catch (e) {
  error(`${LEGACY_TOKENS_PATH} の不在を確認できません: ${(e as Error).message}`);
}

// --- tokens.dtcg.json の鮮度（W3C DTCG エクスポートの再生成漏れ検知） ---
// tokens.dtcg.json は tokens.json から生成される interop ビュー（npm 配布物）。
// tokens.json を変更したのに再生成し忘れると drift するため、ここで一致を担保する。
section("tokens.dtcg.json 鮮度（W3C DTCG エクスポート）");

if (isSkipped("dtcg")) {
  noteSkipped("dtcg", "tokens.dtcg.json 鮮度検査（DTCG serializer は melta のトークン構造前提）");
} else {
  const dtcgPath = resolve(root, DTCG_PATH);
  if (!existsSync(dtcgPath)) {
    error(`${DTCG_PATH} が存在しません（npm run design:dtcg で生成）`);
  } else {
    const onDisk = readFileSync(dtcgPath, "utf-8");
    if (onDisk !== serializeDtcg()) {
      error(`${DTCG_PATH} が tokens.json と不一致（npm run design:dtcg で再生成）`);
    } else {
      ok(`${DTCG_PATH} は tokens.json から再生成した内容と一致（W3C DTCG 2025.10）`);
    }
  }
}

// --- 6. contract Tailwind class lint（P1b）---

section("6. contract Tailwind class lint");

if (rulesData && existsSync(contractDir)) {
  // contractLint は schema 上 required なので undefined はあり得ない（schema 検証で弾かれる）
  const enforceRules = rulesData.rules
    .filter((r) => r.contractLint === "enforce")
    .filter(isAutoDetectable);
  const warnRules = rulesData.rules
    .filter((r) => r.contractLint === "warn")
    .filter(isAutoDetectable);

  ok(`enforce 対象ルール: ${enforceRules.length} 件 / warn: ${warnRules.length} 件`);

  /**
   * contract から Tailwind class 文字列を抽出する。
   * 対象キー:
   * - "tailwind"（variants/sizes/iconButton/iconTextPadding 等）
   * - "focusRing"（a11y）
   * - "htmlSample" 配下の任意の string（object でも全 string が HTML として扱われる）
   *
   * insideHtmlSample フラグで「htmlSample 配下にいるか」を再帰経由で伝播させる。
   * これにより object 形式の htmlSample（variant 別に分岐するパターン）も走査できる。
   */
  function extractClassStrings(
    node: unknown,
    parentKey: string | undefined,
    out: Array<{ classes: string; path: string }>,
    path: string,
    insideHtmlSample: boolean
  ): void {
    if (typeof node === "string") {
      if (parentKey === "tailwind" || parentKey === "focusRing") {
        out.push({ classes: node, path });
      } else if (insideHtmlSample) {
        // HTML から class="..." を抽出
        const matches = node.matchAll(/class=["']([^"']+)["']/g);
        let i = 0;
        for (const m of matches) {
          out.push({ classes: m[1], path: `${path}[class#${i++}]` });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) =>
        extractClassStrings(item, parentKey, out, `${path}[${i}]`, insideHtmlSample)
      );
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        const childInsideHtml = insideHtmlSample || key === "htmlSample";
        extractClassStrings(value, key, out, `${path}.${key}`, childInsideHtml);
      }
    }
  }

  let totalContractsChecked = 0;
  let totalLintErrors = 0;
  let totalLintWarnings = 0;
  let totalClassStrings = 0;

  for (const file of contractFiles) {
    const contract = loadJSON(`design/contracts/components/${file}`);
    if (!contract) continue;
    totalContractsChecked++;

    const found: Array<{ classes: string; path: string }> = [];
    extractClassStrings(contract, undefined, found, file, false);
    totalClassStrings += found.length;

    for (const { classes, path } of found) {
      const ctxs = tokenize(classes);
      for (const ctx of ctxs) {
        for (const rule of enforceRules) {
          if (matches(rule, ctx)) {
            error(
              `${path}: "${ctx.raw}" は ${rule.id}(${rule.severity}) に違反 — ${rule.description}（→ ${rule.alternative}）`
            );
            totalLintErrors++;
          }
        }
        for (const rule of warnRules) {
          if (matches(rule, ctx)) {
            warn(
              `${path}: "${ctx.raw}" は ${rule.id}(warn) — ${rule.description}（→ ${rule.alternative}）`
            );
            totalLintWarnings++;
          }
        }
      }
    }
  }

  ok(
    `${totalContractsChecked} contract / ${totalClassStrings} class 文字列を走査、違反 ${totalLintErrors} / warn ${totalLintWarnings}`
  );
}

// --- 7. htmlSample 自己整合（variant.tailwind ⊆ htmlSample のクラス） ---
// htmlSample は MCP get_component で AI に直接配信される「コピペ元」。variant.tailwind が
// 宣言する focus/hover 等のクラスが htmlSample から欠けていると、AI はそれを欠いた UI を
// 生成する（focus ring 欠落 = a11y 後退）。値レベルの drift をここで検出する。
section("7. htmlSample 自己整合（variant ↔ htmlSample）");

if (existsSync(contractDir)) {
  let pairsChecked = 0;
  let driftPairs = 0;

  for (const file of contractFiles) {
    const contract = loadJSON(`design/contracts/components/${file}`) as
      | (ComponentContract & { htmlSample?: unknown })
      | null;
    if (!contract) continue;
    const htmlSample = contract.htmlSample;
    if (!htmlSample || typeof htmlSample !== "object" || Array.isArray(htmlSample)) continue;
    const samples = htmlSample as Record<string, unknown>;

    for (const [vkey, variant] of Object.entries(contract.variants || {})) {
      const sample = samples[vkey];
      if (typeof sample !== "string" || typeof variant.tailwind !== "string") continue;
      pairsChecked++;

      // htmlSample 内の全 class="..." トークンを集める
      const sampleClasses = new Set<string>();
      for (const m of sample.matchAll(/class=["']([^"']+)["']/g)) {
        for (const c of m[1].split(/\s+/)) if (c) sampleClasses.add(c);
      }
      const missing = variant.tailwind
        .split(/\s+/)
        .filter((c) => c && !sampleClasses.has(c));
      if (missing.length > 0) {
        driftPairs++;
        warn(
          `${file}: variant "${vkey}" の tailwind クラスが htmlSample.${vkey} に欠落: ${missing.join(" ")}（AI はこの例をコピーするため focus/hover 欠落は生成品質に直結）`
        );
      }
    }
  }

  if (driftPairs === 0) {
    ok(`htmlSample 自己整合 OK（${pairsChecked} variant/htmlSample ペア）`);
  }
}

// --- 8. stateSpecs ↔ states 同期 + 差分規約（P2-1） ---
// stateSpecs は state ごとの生成仕様（opt-in）。検査:
//  (a) backlog: states に disabled（overlay 状態の floor）があるのに spec が無い contract を集約 warn
//      （stateSpecs ゼロの未着手 contract も対象＝「opt-in 前は warn が出ない」穴を塞ぐ。Phase1b 駆動）
//  (b) subset: spec キーが states[] に無ければ error（タイプミス/未宣言 state）
//  (c) coverage backlog: states にあって spec 無し = warn（hover/focus は variants[] が正本で不要なケース含む）
//  (d) 差分規約: stateSpec.tailwind が variant tailwind を verbatim 再掲したら warn（差分は空文字にすべき。
//      structural 状態で variant が基底を表すなら open 等の差分は "" にする。modal が参照実装）
//  (e) disabled レシピ sanity: disabled spec があるのに cursor-not-allowed を欠く = warn
// equality でなく subset を採るのは、全 state に空 spec を強制すると Phase1b の漸進導入を阻むため。
const BACKLOG_REQUIRED_STATES = ["disabled"]; // 「あれば stateSpecs 必須」とする overlay 状態の floor
// spec を持たなくてよい state（default=variant 基底 / hover・focus=variants[] が正本）。
// coverage backlog (c) から除外し、warn を「実際に spec を入れるべき state」だけにする。
const NO_SPEC_NEEDED_STATES = new Set(["default", "hover", "focus"]);
section("8. stateSpecs ↔ states 同期 + 差分規約（P2-1）");

if (existsSync(contractDir)) {
  let specBearingContracts = 0;
  let subsetViolations = 0;
  const backlog: string[] = [];

  for (const file of contractFiles) {
    const contract = loadJSON(`design/contracts/components/${file}`) as ComponentContract | null;
    if (!contract) continue;

    const states = contract.states ?? [];
    const specKeys = contract.stateSpecs ? Object.keys(contract.stateSpecs) : [];
    const variantModeled = new Set(contract.variantModeledStates ?? []);

    // variantModeledStates ⊆ states[] を担保（タイプミス/未宣言 state を error で弾く）。
    // stateSpecs を持たない contract でも検査するため continue の前に置く。
    const stateSetAll = new Set(states);
    // 宣言が実在 variant で裏づけられているか（variant key と exact match、または
    // ハイフン segment 一致＝toggle off/on は exact / tabs active は underline-active の segment）。
    // 裏づけが無いと「coverage backlog (c) を黙らせるだけの escape hatch」になるため warn で塞ぐ。
    const variantKeys = Object.keys(contract.variants ?? {});
    for (const vm of variantModeled) {
      if (!stateSetAll.has(vm)) {
        error(
          `${file}: variantModeledStates "${vm}" が states[] に存在しません（subset 違反 — states に追加するか宣言を修正）`
        );
        continue;
      }
      const backedByVariant = variantKeys.some(
        (k) => k === vm || k.split("-").includes(vm)
      );
      if (!backedByVariant) {
        warn(
          `${file}: variantModeledStates "${vm}" を裏づける variant が見つかりません（variant key と exact 一致もハイフン segment 一致もしない — coverage backlog の escape hatch になっている疑い。stateSpecs で表現するか宣言を見直す）`
        );
      }
    }

    // (a) backlog（stateSpecs ゼロの contract も対象）。ただし disabled を variant で
    //     モデル化している contract（textfield/select 等「状態を variant で持つ」系）は
    //     既に disabled を表現済みなので除外する（dual modeling を容認。統一は P3）。
    for (const req of BACKLOG_REQUIRED_STATES) {
      const modeledAsVariant =
        (contract.variants ? req in contract.variants : false) || variantModeled.has(req);
      if (states.includes(req) && !specKeys.includes(req) && !modeledAsVariant) {
        backlog.push(`${contract.id}(${req})`);
      }
    }

    if (specKeys.length === 0) continue;
    specBearingContracts++;
    const stateSet = new Set(states);

    // (b) subset 違反 = error
    for (const key of specKeys) {
      if (!stateSet.has(key)) {
        error(
          `${file}: stateSpecs."${key}" が states[] に存在しません（subset 違反 — states に追加するか spec キーを修正）`
        );
        subsetViolations++;
      }
    }

    // (c) coverage backlog（spec を入れるべきなのに未定義の state）= warn。
    //     default/hover/focus は variants[] が正本で spec 不要なので除外。
    //     variantModeledStates（toggle off/on, tabs active/inactive 等）も variant 軸が正本なので除外し、
    //     warn を「stateSpecs overlay/structural 差分を実際に書くべき state」だけに絞る。
    const missingSpecs = states.filter(
      (s) => !specKeys.includes(s) && !NO_SPEC_NEEDED_STATES.has(s) && !variantModeled.has(s)
    );
    if (missingSpecs.length > 0) {
      warn(
        `${file}: states ${JSON.stringify(missingSpecs)} に stateSpecs が未定義（coverage backlog。Phase1b で structural/その他状態を順次追加）`
      );
    }

    // (f) 二重モデリングの矛盾検出: 同一 state を stateSpecs と variantModeledStates の両方で
    //     宣言したらどちらが正本か曖昧になる = warn（どちらか一方に寄せる）。
    for (const key of specKeys) {
      if (variantModeled.has(key)) {
        warn(
          `${file}: state "${key}" が stateSpecs と variantModeledStates の両方で宣言されています（モデリングが二重 — どちらか一方に寄せる）`
        );
      }
    }

    // (d) 差分規約: stateSpec.tailwind が variant tailwind を verbatim 再掲したら warn
    const variantTw = new Set(
      Object.values(contract.variants ?? {}).map((v) => v.tailwind).filter(Boolean)
    );
    for (const [stateName, spec] of Object.entries(contract.stateSpecs ?? {})) {
      if (spec.tailwind && variantTw.has(spec.tailwind)) {
        warn(
          `${file}: stateSpecs."${stateName}".tailwind が variant tailwind と完全一致（差分のみの規約に反する。variant が基底状態なら tailwind は "" にする）`
        );
      }
    }

    // (e) disabled レシピ sanity
    const disabled = contract.stateSpecs?.disabled;
    if (disabled && !disabled.tailwind.includes("cursor-not-allowed")) {
      warn(
        `${file}: stateSpecs.disabled.tailwind に cursor-not-allowed が無い（disabled の標準レシピを確認）`
      );
    }
  }

  // backlog は 1 行に集約（design:check 出力を汚さない。詳細は design:coverage）
  if (backlog.length > 0) {
    warn(
      `backlog: ${backlog.length} contract に disabled state があるが stateSpecs.disabled 未定義 — ${backlog.join(", ")}（npm run design:coverage で進捗確認。Phase1b で解消）`
    );
  }

  if (subsetViolations === 0) {
    ok(`stateSpecs subset 検証 OK（${specBearingContracts} contract が stateSpecs 保有 / disabled backlog ${backlog.length}）`);
  }
}

// --- 9. recipes（規範/導出 2層分離、P3）---
// 契約 = 規範（variants 語彙 / states / tokenRefs）、recipes = プラットフォーム具象。
// web recipe は契約の tailwind から生成される導出物（鮮度を担保）、
// app recipe は RN 実装の styleRefs を手書きする authoring source（契約 subset + token 実在を担保）。

section("9. recipes（web 鮮度 + app styleRefs 検証）");

{
  const componentsDir = resolve(root, "design/contracts/components");
  const webDir = resolve(root, WEB_RECIPES_DIR);
  const appDir = resolve(root, "design/contracts/recipes/app");
  const allContractFiles = readdirSync(componentsDir).filter((f) => f.endsWith(".contract.json"));
  const contractIds = new Set<string>();

  // 9a. web recipes 鮮度（契約から再生成した内容と byte 一致するか）
  let webIssues = 0;
  for (const file of allContractFiles) {
    const contract = loadJSON(`design/contracts/components/${file}`) as ComponentContract | null;
    if (!contract) continue;
    contractIds.add(contract.id);
    const recipePath = resolve(webDir, `${contract.id}.recipe.json`);
    if (!existsSync(recipePath)) {
      error(`recipes/web/${contract.id}.recipe.json が存在しません（npm run design:recipes で生成）`);
      webIssues++;
      continue;
    }
    if (readFileSync(recipePath, "utf-8") !== serializeWebRecipe(contract)) {
      error(`recipes/web/${contract.id}.recipe.json が契約と不一致（npm run design:recipes で再生成）`);
      webIssues++;
    }
  }
  if (existsSync(webDir)) {
    for (const file of readdirSync(webDir).filter((f) => f.endsWith(".recipe.json"))) {
      const id = file.replace(/\.recipe\.json$/, "");
      if (!contractIds.has(id)) {
        error(`recipes/web/${file} に対応する契約がありません（orphan。契約を消したなら recipe も消す）`);
        webIssues++;
      }
    }
  }
  if (webIssues === 0) {
    ok(`web recipes ${allContractFiles.length} 件が契約から再生成した内容と一致（orphan 0）`);
  }

  // 9b. app recipes（styleRefs の token 実在 + 契約 subset + version 同期）
  // token 参照は「トークン leaf のパス」（例: color.primary.500 = {value, tailwind}）。
  // group ノード（color.primary 等）への参照は不正（Codex レビュー #2 で塞いだ穴）
  function tokenPathExists(path: string): boolean {
    return isTokenLeaf(tokenNodeAt(tokensData, path));
  }

  /** recipe 内を再帰し {"token": "path"} 参照を全部集める */
  function collectTokenRefs(node: unknown, refs: string[]): void {
    if (Array.isArray(node)) {
      for (const item of node) collectTokenRefs(item, refs);
      return;
    }
    if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.token === "string") refs.push(obj.token);
      for (const value of Object.values(obj)) collectTokenRefs(value, refs);
    }
  }

  // 9c. appStatus（プラットフォーム差分の SSOT 宣言、公開 P0）
  // 全契約に appStatus 必須（新契約が宣言漏れで増える経路を塞ぐ）。
  // 不変条件: appStatus=implemented ⇔ recipes/app/<id>.recipe.json が存在（宣言と実物の一致）
  {
    let appStatusIssues = 0;
    const validStatuses = new Set(["implemented", "planned", "not-planned"]);
    const validMappings = new Set(["native", "adapted"]);
    for (const file of allContractFiles) {
      const contract = loadJSON(`design/contracts/components/${file}`) as
        | (ComponentContract & { appStatus?: string; appMapping?: string; appNote?: string })
        | null;
      if (!contract) continue;
      if (!contract.appStatus) {
        error(`${file}: appStatus がありません（implemented / planned / not-planned を宣言）`);
        appStatusIssues++;
        continue;
      }
      if (!validStatuses.has(contract.appStatus)) {
        error(`${file}: appStatus が不正: ${contract.appStatus}`);
        appStatusIssues++;
        continue;
      }
      if (contract.appMapping !== undefined && !validMappings.has(contract.appMapping)) {
        error(`${file}: appMapping が不正: ${contract.appMapping}（native / adapted）`);
        appStatusIssues++;
      }
      if (contract.appMapping === "adapted" && !contract.appNote) {
        error(`${file}: appMapping=adapted には appNote（変換先）が必須`);
        appStatusIssues++;
      }
      if (contract.appStatus === "not-planned" && contract.appMapping === "adapted") {
        error(`${file}: not-planned と appMapping=adapted は両立しない（実装しないなら写像形態は無意味）`);
        appStatusIssues++;
      }
      if (contract.appStatus === "not-planned" && !contract.appNote) {
        warn(`${file}: appStatus=not-planned に appNote（理由）を推奨`);
      }
      const hasAppRecipe = existsSync(resolve(appDir, `${contract.id}.recipe.json`));
      if (contract.appStatus === "implemented" && !hasAppRecipe) {
        error(`${file}: appStatus=implemented なのに recipes/app/${contract.id}.recipe.json がありません`);
        appStatusIssues++;
      }
      if (contract.appStatus !== "implemented" && hasAppRecipe) {
        error(
          `${file}: recipes/app/${contract.id}.recipe.json があるのに appStatus=${contract.appStatus}（implemented に更新するか recipe を消す）`
        );
        appStatusIssues++;
      }
    }
    if (appStatusIssues === 0) {
      ok(`appStatus 宣言 ${allContractFiles.length} 契約: enum / appNote / recipes-app 一致 OK`);
    }
  }

  if (isSkipped("recipes-app")) {
    noteSkipped("recipes-app", "app recipes 検査（styleRefs の token 参照はブランド固有）");
  } else if (!existsSync(appDir)) {
    warn("recipes/app/ が未作成（app recipe は RN 実装の styleRefs authoring source）");
  } else {
    let appIssues = 0;
    const appFiles = readdirSync(appDir).filter((f) => f.endsWith(".recipe.json"));
    for (const file of appFiles) {
      const recipe = loadJSON(`design/contracts/recipes/app/${file}`) as {
        id: string;
        platform: string;
        contractVersion: string;
        variants?: Record<string, unknown>;
        sizes?: Record<string, unknown>;
        states?: Record<string, unknown>;
      } | null;
      if (!recipe) {
        error(`recipes/app/${file} を JSON として読めません`);
        appIssues++;
        continue;
      }
      if (recipe.platform !== "app") {
        error(`recipes/app/${file}: platform が "app" ではありません（${recipe.platform}）`);
        appIssues++;
      }
      const contract = loadJSON(
        `design/contracts/components/${recipe.id}.contract.json`
      ) as ComponentContract | null;
      if (!contract) {
        error(`recipes/app/${file}: 対応する契約 ${recipe.id}.contract.json がありません`);
        appIssues++;
        continue;
      }
      if (recipe.contractVersion !== contract.version) {
        warn(
          `recipes/app/${file}: contractVersion ${recipe.contractVersion} が契約 version ${contract.version} と不一致（契約変更にレシピが追従しているか確認）`
        );
      }
      // subset: recipe のキーは契約の語彙の部分集合（プラットフォームが語彙を発明しない）
      const axes: Array<[string, string[], string[]]> = [
        ["variants", Object.keys(recipe.variants ?? {}), Object.keys(contract.variants ?? {})],
        ["sizes", Object.keys(recipe.sizes ?? {}), Object.keys(contract.sizes ?? {})],
        ["states", Object.keys(recipe.states ?? {}), contract.states ?? []],
      ];
      for (const [axis, recipeKeys, contractKeys] of axes) {
        const allowed = new Set(contractKeys);
        const invented = recipeKeys.filter((k) => !allowed.has(k));
        if (invented.length > 0) {
          error(`recipes/app/${file}: 契約に無い ${axis} キー: ${invented.join(", ")}（語彙の発明は契約違反）`);
          appIssues++;
        }
      }
      // token 参照の実在
      const refs: string[] = [];
      collectTokenRefs(recipe, refs);
      const missingRefs = refs.filter((r) => !tokenPathExists(r));
      if (missingRefs.length > 0) {
        error(`recipes/app/${file}: tokens.json に存在しない（または group を指す）token 参照: ${[...new Set(missingRefs)].join(", ")}`);
        appIssues++;
      }
    }
    if (appIssues === 0) {
      ok(`app recipes ${appFiles.length} 件: 契約 subset + token 実在 OK`);
    }
  }
}

// --- サマリー ---

section("Summary");

console.log(`  Contracts: ${contractFiles.length} ファイル`);
console.log(`  Rules: ${rulesData ? rulesData.rules.length : 0} 件`);
console.log(`  Errors: ${errors}`);
console.log(`  Warnings: ${warnings}`);
console.log(`\n  ${errors === 0 ? "✅ PASSED" : "❌ FAILED"}\n`);

process.exit(errors > 0 ? 1 : 0);
