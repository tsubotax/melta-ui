/**
 * drift-check.ts — ドキュメントと contracts/実装の整合性チェック
 *
 * 検出項目:
 * 1. DESIGN.md のルール件数 vs rules.json の実件数
 * 2. showcase (docs/index.html) のコンポーネント数 vs contracts
 * 3. package.json の version vs showcase の MELTA_VERSION / server.json（version 2 箇所 + ルール件数）
 *    / showcase の version 表示が ds-version-label で置換対象になっているか
 * 4. 全 contract に対応する components/*.md が存在するか
 * 5. rules.json の全ルール ID が一意（validate.ts と重複するが独立チェック）
 * 6. README.md ↔ README.en.md の構造 parity（check-readme-parity.ts に委譲）
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getContractStats } from "../../src/utils/contract-stats.js";
import { isAutoDetectable } from "../../src/utils/matcher.js";
import { getAllRules } from "../../src/utils/loader.js";
import { buildFrontMatter } from "./export-designmd.js";
import { checkReadmeParity } from "./check-readme-parity.js";
import { checkDeployDocs } from "./check-deploy-docs.js";
import {
  isDocOnlyGuarded,
  renderCoverageBlock,
  renderCoverageBlockEn,
  COVERAGE_BEGIN,
  COVERAGE_END,
  COVERAGE_EN_BEGIN,
  COVERAGE_EN_END,
} from "./coverage-stats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

let drifts = 0;
let driftWarnings = 0;

function drift(msg: string): void {
  console.error(`  ⚠️  DRIFT: ${msg}`);
  drifts++;
}

function driftWarn(msg: string): void {
  console.warn(`  ⚠️  WARN: ${msg}`);
  driftWarnings++;
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

// --- 1. DESIGN.md のルール件数 ---
section("1. DESIGN.md ルール件数");

const designMd = readFileSync(resolve(root, "DESIGN.md"), "utf-8");
const rulesJson = JSON.parse(readFileSync(resolve(root, "design/contracts/rules.json"), "utf-8"));
const actualRuleCount = rulesJson.rules.length;

// トークン数カウント
const tokensJson = JSON.parse(readFileSync(resolve(root, "design/contracts/tokens.json"), "utf-8"));
function countTokens(obj: unknown): number {
  if (typeof obj !== "object" || obj === null) return 0;
  const record = obj as Record<string, unknown>;
  if ("value" in record) return 1;
  let count = 0;
  for (const val of Object.values(record)) count += countTokens(val);
  return count;
}
const tokenCount = countTokens(tokensJson);

const ruleCountMatch = designMd.match(/全ルール（(\d+)\s*件）/);
if (ruleCountMatch) {
  const stated = parseInt(ruleCountMatch[1]);
  if (stated !== actualRuleCount) {
    drift(`DESIGN.md: ${stated} 件 vs rules.json: ${actualRuleCount} 件`);
  } else {
    ok(`ルール件数一致: ${actualRuleCount} 件`);
  }
} else {
  drift("DESIGN.md にルール件数の記載が見つかりません");
}

// --- 1b. DESIGN.md Quick Ref の fontSize スケール ---
// Quick Ref の CDN config から fontSize が欠落していた事故（Whisper タイポ 18px/lh2.0 が
// 「DESIGN.md 単体で生成可能」の宣言通りに再現されない）の再発防止。
section("1b. DESIGN.md Quick Ref fontSize");

const fontSizeTokens = (tokensJson.typography?.fontSize ?? {}) as Record<
  string,
  { size: string; lineHeight: string }
>;
if (!/fontSize:\s*\{/.test(designMd)) {
  drift("DESIGN.md Quick Ref に fontSize スケールがありません（CDN config に必須）");
} else {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const missingSizes: string[] = [];
  for (const [key, def] of Object.entries(fontSizeTokens)) {
    const pair = new RegExp(
      `'${esc(def.size)}'\\s*,\\s*\\{\\s*lineHeight:\\s*'${esc(def.lineHeight)}'`
    );
    if (!pair.test(designMd)) missingSizes.push(`${key}(${def.size}/lh${def.lineHeight})`);
  }
  if (missingSizes.length > 0) {
    drift(`DESIGN.md Quick Ref の fontSize が tokens.json と不一致: ${missingSizes.join(", ")}`);
  } else {
    ok(`Quick Ref fontSize ${Object.keys(fontSizeTokens).length} 段が tokens.json と一致`);
  }
}

// --- 1c. DESIGN.md の Google spec 互換 front matter ---
// tokens.json 変更後に export-designmd の再生成を忘れると interop ビューが drift する
section("1c. DESIGN.md front matter（Google spec 互換）");

const fmMatch = designMd.match(/^---\n[\s\S]*?\n---\n/);
if (!fmMatch) {
  drift("DESIGN.md に YAML front matter がありません（npx tsx scripts/design/export-designmd.ts で生成）");
} else if (fmMatch[0] !== buildFrontMatter()) {
  drift("DESIGN.md の front matter が tokens.json と不一致（npx tsx scripts/design/export-designmd.ts で再生成）");
} else {
  ok("front matter が tokens.json から再生成した内容と一致");
}

// --- 2. showcase のコンポーネント数 ---
section("2. showcase コンポーネント数");

const docsPath = resolve(root, "docs/index.html");
if (existsSync(docsPath)) {
  const docsHtml = readFileSync(docsPath, "utf-8");

  // "28 コンポーネント" パターンを探す（全 match 走査）
  const contractDir = resolve(root, "design/contracts/components");
  const stats = getContractStats(contractDir);
  const webContractCount = stats.web;

  const compCountMatches = [...docsHtml.matchAll(/(\d+)\s*コンポーネント/g)];
  const compMismatch = compCountMatches.filter(m => parseInt(m[1]) !== webContractCount);
  if (compCountMatches.length > 0) {
    if (compMismatch.length > 0) {
      drift(`docs/index.html: ${compMismatch.map(m => m[1]).join(",")} コンポーネント vs contracts(web): ${webContractCount} 件`);
    } else {
      ok(`コンポーネント数一致: ${webContractCount} 件（web 実装済み、${compCountMatches.length} 箇所）`);
    }
  }

  // ヒーロー統計の Tokens
  const heroTokenMatch = docsHtml.match(/font-bold text-white">(\d+)\+?<\/span>\s*<span[^>]*>Tokens/);
  if (heroTokenMatch) {
    const stated = parseInt(heroTokenMatch[1]);
    if (stated !== tokenCount) {
      drift(`ヒーロー Tokens: ${stated} vs 実際: ${tokenCount}`);
    } else {
      ok(`ヒーロー Tokens 一致: ${tokenCount}`);
    }
  }

  // 禁止ルール件数
  const ruleRefMatch = docsHtml.match(/(\d+)ルールの禁止パターン/);
  if (ruleRefMatch) {
    const stated = parseInt(ruleRefMatch[1]);
    if (stated !== actualRuleCount) {
      drift(`docs/index.html: ${stated} ルール vs rules.json: ${actualRuleCount} 件`);
    } else {
      ok(`禁止ルール件数一致: ${actualRuleCount} 件`);
    }
  }
} else {
  ok("docs/index.html が存在しない（スキップ）");
}

// --- 3. version ---
section("3. version 整合性");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const pkgVersion = pkg.version;

if (existsSync(docsPath)) {
  const docsHtml = readFileSync(docsPath, "utf-8");
  const versionMatch = docsHtml.match(/MELTA_VERSION\s*=\s*'([^']+)'/);
  if (versionMatch) {
    if (versionMatch[1] !== pkgVersion) {
      drift(`showcase MELTA_VERSION: ${versionMatch[1]} vs package.json: ${pkgVersion}`);
    } else {
      ok(`version 一致: ${pkgVersion}`);
    }
  }
}

// server.json（MCP Registry 公開マニフェスト）の version 2 箇所
// publish 後に bump し忘れると registry に古い版が居座る（1.4.0 stale 事故の再発防止）
const serverJson = JSON.parse(readFileSync(resolve(root, "server.json"), "utf-8"));
const serverVersions = [serverJson.version, serverJson.packages?.[0]?.version];
const serverVersionMismatch = serverVersions.filter((v) => v !== pkgVersion);
if (serverVersionMismatch.length > 0) {
  drift(`server.json: version ${serverVersionMismatch.join(",")} vs package.json: ${pkgVersion}`);
} else {
  ok(`server.json version 一致: ${pkgVersion}（2 箇所）`);
}

// server.json description のルール件数
const serverRuleMatch = String(serverJson.description ?? "").match(/(\d+)\s*rules/);
if (!serverRuleMatch) {
  drift("server.json の description にルール件数の記載が見つかりません");
} else if (parseInt(serverRuleMatch[1]) !== actualRuleCount) {
  drift(`server.json description: ${serverRuleMatch[1]} rules vs rules.json: ${actualRuleCount} 件`);
} else {
  ok(`server.json description のルール件数一致: ${actualRuleCount} 件`);
}

// showcase の version 表示は ds-showcase.js が .ds-version-label だけを置換する。
// クラスを付け忘れた "v1.2" 表記は置換対象外＝永久 stale になるので、全 v 表記を検査する。
if (existsSync(docsPath)) {
  const docsHtml = readFileSync(docsPath, "utf-8");
  const unlabeled = [...docsHtml.matchAll(/<(span|p)\b([^>]*)>([^<]*\bv\d+\.\d+[^<]*)<\/\1>/g)]
    .filter((m) => !m[2].includes("ds-version-label"))
    .map((m) => m[3].trim());
  if (unlabeled.length > 0) {
    drift(
      `docs/index.html: ds-version-label が付いていない version 表示（置換対象外＝永久 stale）: ${unlabeled.join(" / ")}`
    );
  } else {
    ok("docs/index.html の version 表示はすべて ds-version-label 付き");
  }
}

// CLAUDE.md のルール件数
const claudeMd = readFileSync(resolve(root, "CLAUDE.md"), "utf-8");
const claudeRuleMatch = claudeMd.match(/(\d+)\s*ルール/);
if (claudeRuleMatch) {
  const stated = parseInt(claudeRuleMatch[1]);
  if (stated !== actualRuleCount) {
    drift(`CLAUDE.md: ${stated} ルール vs rules.json: ${actualRuleCount} 件`);
  } else {
    ok(`CLAUDE.md ルール件数一致: ${actualRuleCount} 件`);
  }
}

// --- 4. contract ↔ components/*.md ---
section("4. contract ↔ components/*.md 対応");

const contractDir2 = resolve(root, "design/contracts/components");
const contracts = readdirSync(contractDir2).filter(f => f.endsWith(".contract.json"));

let missingDocs = 0;
let skippedPending = 0;
for (const file of contracts) {
  const contract = JSON.parse(readFileSync(resolve(contractDir2, file), "utf-8"));
  // webStatus:"pending"（app 先行）は web ドキュメント未整備が正常なので docPath 突合を skip。
  if (contract.webStatus === "pending") {
    skippedPending++;
    continue;
  }
  const docPath = resolve(root, contract.docPath || `components/${contract.id}.md`);
  if (!existsSync(docPath)) {
    drift(`${contract.id}: docPath "${contract.docPath}" が存在しません`);
    missingDocs++;
  }
}
if (missingDocs === 0) {
  ok(`全 ${contracts.length - skippedPending} contract の docPath が存在（pending ${skippedPending} 件は skip）`);
}

// --- 5. README / AGENTS.md / llms.txt の数値整合 ---
// 「drift 検知を売りにする DS の README 自身が drift」を防ぐ。表記規約:
//   N ルール = rules.json 全件 / N contract = 全 contract（pending 含む）/
//   N コンポーネント = web 実装済み / （Nパターン自動検出）= isAutoDetectable 件数
section("5. README / AGENTS.md / llms.txt 数値整合");

const contractStatsForDocs = getContractStats(resolve(root, "design/contracts/components"));
const autoDetectableCount = getAllRules().filter(isAutoDetectable).length;

function checkDocNumbers(label: string, content: string): void {
  const checks: Array<{ name: string; re: RegExp; expected: number }> = [
    { name: "ルール件数", re: /(\d+)\s*(?:禁止)?ルール/g, expected: actualRuleCount },
    { name: "contract 件数", re: /(\d+)\s+contract/gi, expected: contractStatsForDocs.all },
    { name: "コンポーネント数", re: /(\d+)\s*コンポーネント/g, expected: contractStatsForDocs.web },
    { name: "自動検出パターン数", re: /（(\d+)パターン自動検出）/g, expected: autoDetectableCount },
  ];
  let bad = 0;
  for (const c of checks) {
    const mismatch = [...content.matchAll(c.re)].filter((m) => parseInt(m[1]) !== c.expected);
    if (mismatch.length > 0) {
      drift(`${label}: ${c.name} ${mismatch.map((m) => m[1]).join(",")} vs 実数 ${c.expected}`);
      bad++;
    }
  }
  if (bad === 0) ok(`${label}: 数値整合 OK`);
}

// 英語入口（README.en.md / maturity model）の prose カウントも実数と整合させる。
// 「全入口の数値整合を CI で保証」を英語ドキュメントにも効かせる（数値表記は英語固有）。
function checkEnDocNumbers(label: string, relPath: string): void {
  const full = resolve(root, relPath);
  if (!existsSync(full)) return; // 任意ファイル
  const content = readFileSync(full, "utf-8");
  const checks: Array<{ name: string; re: RegExp; expected: number }> = [
    { name: "rules", re: /(\d+)\s+(?:prohibition\s+)?rules\b/gi, expected: actualRuleCount },
    { name: "tokens", re: /(\d+)\s+(?:design\s+)?tokens\b/gi, expected: tokenCount },
    { name: "contracts", re: /(\d+)\s+contracts\b/gi, expected: contractStatsForDocs.all },
    { name: "web", re: /(\d+)\s+web\b/gi, expected: contractStatsForDocs.web },
    { name: "MCP tools", re: /(\d+)\s+(?:MCP\s+)?tools\b/gi, expected: toolNames.length },
  ];
  let bad = 0;
  for (const c of checks) {
    const mismatch = [...content.matchAll(c.re)].filter((m) => parseInt(m[1]) !== c.expected);
    if (mismatch.length > 0) {
      drift(`${label}: ${c.name} ${mismatch.map((m) => m[1]).join(",")} vs 実数 ${c.expected}`);
      bad++;
    }
  }
  if (bad === 0) ok(`${label}: 英語数値整合 OK`);
}

checkDocNumbers("README.md", readFileSync(resolve(root, "README.md"), "utf-8"));

const agentsPath = resolve(root, "AGENTS.md");
if (existsSync(agentsPath)) {
  checkDocNumbers("AGENTS.md", readFileSync(agentsPath, "utf-8"));
} else {
  drift("AGENTS.md が存在しません（エージェント中立の入口）");
}

const llmsPath = resolve(root, "llms.txt");
if (existsSync(llmsPath)) {
  checkDocNumbers("llms.txt", readFileSync(llmsPath, "utf-8"));
} else {
  drift("llms.txt が存在しません（npm run design:build で生成）");
}

// --- 6. MCP ツール名がドキュメントに揃っているか ---
// ツール追加時に README / DESIGN.md / AGENTS.md / CLAUDE.md の表が置き去りになる drift を防ぐ
section("6. MCP ツール表");

const serverSrc = readFileSync(resolve(root, "src/server.ts"), "utf-8");
const toolNames = [...serverSrc.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((m) => m[1]);
if (toolNames.length === 0) {
  drift("src/server.ts から MCP ツール名を抽出できません（パターン変更?）");
} else {
  for (const docFile of ["README.md", "DESIGN.md", "AGENTS.md", "CLAUDE.md"]) {
    const content = readFileSync(resolve(root, docFile), "utf-8");
    const missingTools = toolNames.filter((t) => !content.includes(t));
    if (missingTools.length > 0) {
      drift(`${docFile}: MCP ツール ${missingTools.join(", ")} の記載がありません`);
    } else {
      ok(`${docFile}: 全 ${toolNames.length} ツール記載あり`);
    }
  }
}

// --- 6b. 英語入口の数値整合（toolNames 確定後に実行） ---
// 対象は README.en.md のみ。maturity model は Lv2→3「rules.json に 5 件」等の
// 例示数値を含む汎用教材なので count チェックしない（誤爆する）。
section("6b. 英語入口の数値整合");
checkEnDocNumbers("README.en.md", "README.en.md");

// --- 7. foundations/*.md の件数 vs AGENTS.md の「Foundations (N)」 ---
section("7. Foundations 件数整合");

const foundationsDir = resolve(root, "foundations");
const foundationCount = existsSync(foundationsDir)
  ? readdirSync(foundationsDir).filter((f) => f.endsWith(".md")).length
  : 0;
const agentsMd = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8") : "";
const foundationsLabel = agentsMd.match(/\*\*Foundations \((\d+)\)\*\*/);
if (!foundationsLabel) {
  drift("AGENTS.md に「Foundations (N)」の記載が見つかりません");
} else if (parseInt(foundationsLabel[1]) !== foundationCount) {
  drift(
    `AGENTS.md: Foundations (${foundationsLabel[1]}) vs foundations/*.md 実数: ${foundationCount} 件`
  );
} else {
  ok(`Foundations 件数一致: ${foundationCount} 件`);
}

// --- 8. doc-only ルールの orphan 0 検証 ---
// 「ドキュメント参照でのみ守られるルール」（human-only / llm-judge-candidate / impossible-static /
// 未分類）は静的検出にもテストにも乗らないため、どこかの doc/contract が AI に提示しないと
// 到達不能になる。全対象が contract.rules[] か foundations/patterns の md（prohibited.md の
// <!-- ID --> コメント等）でカバーされることを担保する。
// 100 個目のルール追加時に「rules.json に足したが参照経路が無い」死蔵を構造的に防ぐ。
section("8. doc-only ルール orphan 0（参照経路の到達性）");

const allRules = getAllRules();
const manualRules = allRules.filter(isDocOnlyGuarded);

// カバレッジコーパス: contract.rules[] の ID + foundations/patterns の md 本文
const contractRefIds = new Set<string>();
const contractDir3 = resolve(root, "design/contracts/components");
if (existsSync(contractDir3)) {
  for (const file of readdirSync(contractDir3).filter((f) => f.endsWith(".contract.json"))) {
    try {
      const c = JSON.parse(readFileSync(resolve(contractDir3, file), "utf-8"));
      for (const ref of c.rules || []) contractRefIds.add(ref.id);
    } catch {
      /* JSON エラーは validate.ts 側で検出 */
    }
  }
}

let docCorpus = "";
for (const subdir of ["foundations", "patterns"]) {
  const dir = resolve(root, subdir);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    docCorpus += readFileSync(resolve(dir, file), "utf-8") + "\n";
  }
}

// ID は境界アンカーで照合する（部分文字列一致だと FOO が FOOBAR に誤ヒットして
// 本来 orphan のルールを「カバー済み」と誤判定する false-negative を避ける）。
const orphans = manualRules.filter((r) => {
  if (contractRefIds.has(r.id)) return false;
  const idRe = new RegExp(`(?<![A-Z0-9_])${r.id}(?![A-Z0-9_])`);
  return !idRe.test(docCorpus);
});
if (orphans.length > 0) {
  drift(
    `doc-only ルール ${orphans.length} 件が contract.rules[] にも foundations/patterns md にも未参照（orphan）: ${orphans
      .map((r) => r.id)
      .join(", ")}`
  );
} else {
  ok(`doc-only ${manualRules.length} 件すべてが参照経路を持つ（orphan 0）`);
}

// --- 9. README の検証カバレッジ表が computeCoverage と一致するか ---
// 経路別マトリクスは coverage-stats.ts が生成し README のアンカー間に埋め込む。
// rules.json / automationStatus を変えたのに再生成し忘れると「宣言だけ」に逆戻りするため、
// ここで鮮度を担保する（npm run design:coverage で再生成）。
section("9. README 検証カバレッジ表の鮮度");

// 全入口（README.md 日本語 / README.en.md 英語）が同じ contracts 由来の数値で整合することを担保する。
function checkCoverageBlock(file: string, begin: string, end: string, expected: string): void {
  const path = resolve(root, file);
  if (!existsSync(path)) return; // README.en.md は任意（無ければ skip）
  const content = readFileSync(path, "utf-8");
  const b = content.indexOf(begin);
  const e = content.indexOf(end);
  if (b < 0 || e < b) {
    drift(`${file} に検証カバレッジのアンカーが見つかりません`);
  } else if (content.slice(b, e + end.length) !== expected) {
    drift(`${file} の検証カバレッジ表が coverage-stats と不一致（npm run design:coverage で再生成）`);
  } else {
    ok(`${file} 検証カバレッジ表は computeCoverage と一致`);
  }
}
checkCoverageBlock("README.md", COVERAGE_BEGIN, COVERAGE_END, renderCoverageBlock());
checkCoverageBlock("README.en.md", COVERAGE_EN_BEGIN, COVERAGE_EN_END, renderCoverageBlockEn());

// --- 10. Loop playbook self-drift ---
// Playbook は「実行に近い設計書」として扱う。存在しない npm script や CI gate の
// 記載漏れは loop/pipeline の実行不能に直結するため error。分類表現などの naming drift は
// まだ運用上の混乱に留まるため warn にする。
section("10. Loop playbook self-drift");

const loopPlaybookPath = resolve(root, "docs/melta-loop-playbook.md");
if (!existsSync(loopPlaybookPath)) {
  drift("docs/melta-loop-playbook.md が存在しません（loop / pipeline 統治原則の入口）");
} else {
  const playbook = readFileSync(loopPlaybookPath, "utf-8");
  const packageScripts = new Set(Object.keys(pkg.scripts ?? {}));

  const scriptRefs = [...playbook.matchAll(/`npm run ([a-z0-9:_-]+)(?:\s+[^`]*)?`/gi)].map(
    (m) => m[1]
  );
  const missingScripts = [...new Set(scriptRefs)].filter((name) => !packageScripts.has(name));
  if (missingScripts.length > 0) {
    drift(`Loop playbook: package.json に存在しない npm script 参照: ${missingScripts.join(", ")}`);
  } else {
    ok(`Loop playbook: npm script 参照 ${new Set(scriptRefs).size} 件が package.json と一致`);
  }

  const requiredMarkers = [
    "<!-- loop:ssot-write-protection -->",
    "<!-- loop:designmd-two-layered -->",
    "<!-- loop:hook-boundary -->",
    "<!-- loop:brand-gate -->",
    "<!-- loop:brand-draft-label -->",
    "<!-- loop:red-team-isolation -->",
    "<!-- loop:audit-log -->",
    "<!-- loop:memory-quarantine -->",
    "<!-- loop:escalation-contract -->",
    "<!-- loop:ci-failure-triage -->",
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !playbook.includes(marker));
  if (missingMarkers.length > 0) {
    drift(`Loop playbook: 必須統治原則の記載漏れ: ${missingMarkers.join(", ")}`);
  } else {
    ok("Loop playbook: 必須統治原則の記載あり");
  }

  const workflowPath = resolve(root, ".github/workflows/design-check.yml");
  if (existsSync(workflowPath)) {
    const workflow = readFileSync(workflowPath, "utf-8");
    const requiredCiCommands = [
      "npm run design:check",
      "npm run design:lint-generated",
      "npm run design:drift",
      "npm run design:compat",
      "npm run design:llms",
      "npm run validate",
      "npm run build",
      "npm run check:pack",
      "npm test",
    ];
    const missingFromWorkflow = requiredCiCommands.filter((cmd) => !workflow.includes(cmd));
    const missingFromPlaybook = requiredCiCommands.filter((cmd) => !playbook.includes(cmd));
    if (missingFromWorkflow.length > 0) {
      drift(`design-check.yml: Release Readiness 必須コマンドが workflow にありません: ${missingFromWorkflow.join(", ")}`);
    }
    if (missingFromPlaybook.length > 0) {
      drift(`Loop playbook: Release Readiness 必須コマンドの記載漏れ: ${missingFromPlaybook.join(", ")}`);
    }
    if (missingFromWorkflow.length === 0 && missingFromPlaybook.length === 0) {
      ok(`Loop playbook: Release Readiness の CI コマンド ${requiredCiCommands.length} 件が workflow と一致`);
    }
  }

  const gitignorePath = resolve(root, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.split(/\r?\n/).includes(".melta-loop/")) {
      drift("Loop playbook: Audit Log の .melta-loop/ が .gitignore にありません");
    } else {
      ok("Loop playbook: .melta-loop/ は .gitignore で除外済み");
    }
  }

  const requiredClassifications = [
    "Level 1 deterministic pipeline",
    "Level 2 model loop",
    "Level 3 observation cron",
  ];
  const missingClassifications = requiredClassifications.filter((marker) => !playbook.includes(marker));
  if (missingClassifications.length > 0) {
    driftWarn(`Loop playbook: 分類表現の不足（warn）: ${missingClassifications.join(", ")}`);
  } else {
    ok("Loop playbook: 3-Level 分類表現あり");
  }
}

// --- 11. README 日英 parity ---
// 手書き 2 枚の入口（README.md / README.en.md）は片方だけ更新されると静かに乖離する。
// 「同一アウトラインで運用する」は運用ルールであって SSOT ではないので機械照合する。
section("11. README 日英 parity");

const parity = checkReadmeParity(root);
for (const o of parity.oks) ok(o);
for (const d of parity.drifts) drift(d);

// --- 12. AGENTS.md デプロイ手順 ↔ netlify.toml ---
// 2026-07-06 の allowlist 化で publish が site-public に変わったのに AGENTS.md が
// publish = "." のまま 42 日間残り、手順どおりだと stale な site-public が出る状態だった。
// netlify.toml は本検査の対象外だったので拾えなかった（実装は check-deploy-docs.ts）。
section("12. AGENTS.md デプロイ手順 ↔ netlify.toml");

const deployDocs = checkDeployDocs(root);
for (const o of deployDocs.oks) ok(o);
for (const d of deployDocs.drifts) drift(d);

// --- Summary ---
section("Summary");

console.log(`  Drifts: ${drifts}`);
console.log(`  Warnings: ${driftWarnings}`);
console.log(`\n  ${drifts === 0 ? "✅ NO DRIFT" : `⚠️  ${drifts} DRIFT(S) DETECTED`}\n`);

process.exit(drifts > 0 ? 1 : 0);
