/**
 * coverage-stats.ts — 検証カバレッジの集計（P1-5）
 *
 * 「99 ルールのうち何件が、どの経路で検証されているか」を単一数字でなく
 * 経路別マトリクスで出す。発信時に「宣言だけ」を排し、改善のたびに数字が動く
 * 素材にする。export した computeCoverage はテスト/他スクリプトから再利用する。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllRules } from "../../src/utils/loader.js";
import { isAutoDetectable } from "../../src/utils/matcher.js";
import { hasRunnableSpec, specFieldFor } from "../../src/utils/detectors.js";
import type { RuleEntry } from "../../src/utils/types.js";

/**
 * 静的検出機構（class/attr/composition のいずれか）を持つルールの判定述語。
 * detector と spec の対応は capability 表（src/utils/detectors.ts）から導出する
 * — ここで detector 名を直書きしない。
 */
export function isStaticallyDetectable(r: RuleEntry): boolean {
  return isAutoDetectable(r) || hasRunnableSpec(r);
}

/**
 * 生成物 lint（`lintSource` + composition = CI / hook / MCP `check_html` / `design:lint-generated`）が
 * **実際に検査する**ルールの判定述語。isStaticallyDetectable との差は `requiresContext`。
 * 文脈依存の class ルール（`py-0.5` はボタンのみ NG 等）は context-free な生成物 lint では
 * 誤検出になるため除外される（src/utils/lint-core.ts）。したがって「検出機構を持つ」ことと
 * 「生成物が検査された」ことは別で、後者を主張するときはこちらを使う。
 * html-attr / composition は spec があれば requiresContext に関わらず走る（実装に合わせる）。
 */
export function isCheckedByGeneratedLint(r: RuleEntry): boolean {
  return (isAutoDetectable(r) && r.requiresContext !== true) || hasRunnableSpec(r);
}

/**
 * 「ドキュメント参照でのみ守られる」ルールの判定述語（2026-07 棚卸しで isManualOnly から改名・拡張）。
 * 静的検出にもテストにも乗らないルール = AI/人間がドキュメントを読むことだけが防御線。
 * impossible-static も静的に検出されない以上ここに含める（旧 isManualOnly は除外していたが、
 * 参照経路が無ければ死蔵する点は同じ）。coverage-stats の集計と drift-check の orphan 検証が
 * この 1 箇所を共有し、集計値と実リストが乖離しないようにする。
 */
export function isDocOnlyGuarded(r: RuleEntry): boolean {
  if (isStaticallyDetectable(r)) return false;
  if (r.automationStatus === "covered-by-test") return false;
  return true;
}

/** 棚卸し未了（非静的なのに automationStatus 未宣言）の判定述語 */
export function isUnclassified(r: RuleEntry): boolean {
  return !isStaticallyDetectable(r) && r.automationStatus == null;
}

/**
 * 「無防備 error ルール」= severity=error なのに自動検証（静的検出 / interaction test）が
 * 一切効いていないルール。llm-judge-candidate は計画であって稼働中の検証ではないため含める。
 */
export function isUnguardedError(r: RuleEntry): boolean {
  return r.severity === "error" && isDocOnlyGuarded(r);
}

export interface Coverage {
  total: number;
  /** class 文字列マッチ（check_rule と同経路） */
  classAuto: number;
  /** html-attr 検査（htmlAttrCheck spec あり） */
  htmlAttr: number;
  /** composition 検査（compositionCheck spec あり。a11y DOM ルール含む） */
  composition: number;
  /** 静的自動検出の合計 = classAuto + htmlAttr + composition */
  staticAuto: number;
  /** 静的検出はしないが interaction test で担保 */
  coveredByTest: number;
  /** 意味依存で静的検出が原理的に不能（自動検証なし） */
  impossibleStatic: number;
  /** 自動検証なし・将来の LLM 審査候補（2026-07 棚卸し） */
  llmJudgeCandidate: number;
  /** 自動検証なし・人間レビューでのみ守る（2026-07 棚卸し） */
  humanOnly: number;
  /** 棚卸し未了（非静的なのに automationStatus 未宣言） */
  unclassified: number;
  /** severity=error なのに自動検証が一切効いていない件数（≠ バケットの一部。横断集計） */
  unguardedError: number;
}

export function computeCoverage(): Coverage {
  const rules = getAllRules();
  const classAuto = rules.filter(isAutoDetectable).length;
  // spec 駆動の内訳も capability 表から導出する（detector 名を直書きしない）
  const htmlAttr = rules.filter(
    (r) => specFieldFor(r.detector) === "htmlAttrCheck" && hasRunnableSpec(r)
  ).length;
  const composition = rules.filter(
    (r) => specFieldFor(r.detector) === "compositionCheck" && hasRunnableSpec(r)
  ).length;
  // detector と spec の対応は ruleset 検証で保証済み（食い違いは load 時に落ちる）ため
  // この 3 集合は互いに素。単純和で二重計上は起きない
  const staticAuto = classAuto + htmlAttr + composition;
  const coveredByTest = rules.filter((r) => r.automationStatus === "covered-by-test").length;
  const impossibleStatic = rules.filter((r) => r.automationStatus === "impossible-static").length;
  return {
    total: rules.length,
    classAuto,
    htmlAttr,
    composition,
    staticAuto,
    coveredByTest,
    impossibleStatic,
    llmJudgeCandidate: rules.filter((r) => r.automationStatus === "llm-judge-candidate").length,
    humanOnly: rules.filter((r) => r.automationStatus === "human-only").length,
    unclassified: rules.filter(isUnclassified).length,
    unguardedError: rules.filter(isUnguardedError).length,
  };
}

/** 無防備 error ルールの ID を automationStatus 別にグループ化（CLI の一覧表示用） */
export function listUnguardedErrors(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const r of getAllRules().filter(isUnguardedError)) {
    const key = r.automationStatus ?? "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r.id);
  }
  return groups;
}

// --- stateSpec カバレッジ（P2-1 Phase1b の backlog 計器） ---
// 「per-state 生成仕様（stateSpecs）がどれだけの contract に行き渡ったか」を測る。
// validate.ts の disabled backlog warn（集約 1 行）に対し、こちらは数値での進捗トラッキング。
export interface StateSpecCoverage {
  totalContracts: number;
  /** stateSpecs を 1 つ以上持つ contract 数 */
  withStateSpecs: number;
  /**
   * stateSpecs.disabled の必須対象数 = states に disabled を持ち、かつ disabled を variant で
   * モデル化していない contract（dual modeling 容認。variant で持つ系は除外）。
   * 判定は disabled を variant key で持つ系（textfield/select 等）のみ除外＝validate (a) の
   * `"disabled" in variants` 分岐と同基準。variantModeledStates 経由の disabled は現状存在しないため
   * ここでは考慮しない（将来 disabled を variantModeledStates に入れる系が出たら validate (a) の
   * ハイブリッド判定（`req in variants || variantModeled.has(req)`）に揃える要あり）。
   */
  disabledRequired: number;
  /** そのうち stateSpecs.disabled を実際に持つ数 */
  disabledCovered: number;
}

export function computeStateSpecCoverage(contractDir: string): StateSpecCoverage {
  const files = readdirSync(contractDir).filter((f) => f.endsWith(".contract.json"));
  let withStateSpecs = 0;
  let disabledRequired = 0;
  let disabledCovered = 0;
  for (const f of files) {
    const c = JSON.parse(readFileSync(resolve(contractDir, f), "utf-8"));
    const states: string[] = c.states ?? [];
    const specKeys: string[] = c.stateSpecs ? Object.keys(c.stateSpecs) : [];
    if (specKeys.length > 0) withStateSpecs++;
    // disabled を variant で持つ contract（textfield/select 等）は dual modeling 容認で対象外
    const disabledAsVariant = c.variants ? "disabled" in c.variants : false;
    if (states.includes("disabled") && !disabledAsVariant) {
      disabledRequired++;
      if (specKeys.includes("disabled")) disabledCovered++;
    }
  }
  return { totalContracts: files.length, withStateSpecs, disabledRequired, disabledCovered };
}

// --- README 自動埋め込み（経路別マトリクスを単一数字でなく表で掲示） ---
// 改善のたびに数字が動く発信素材にする。CLI（design:coverage）が書き、drift-check が鮮度を検証する
// （DTCG エクスポート / DESIGN.md front matter と同じ「生成して CI で守る」パターン）。
export const COVERAGE_BEGIN = "<!-- BEGIN:coverage (npm run design:coverage で再生成) -->";
export const COVERAGE_END = "<!-- END:coverage -->";
export const COVERAGE_EN_BEGIN = "<!-- BEGIN:coverage-en (npm run design:coverage で再生成) -->";
export const COVERAGE_EN_END = "<!-- END:coverage-en -->";

/** バケット別の error 件数（README 表の「うち error N」用） */
function errorCountsByBucket(): { impossibleStatic: number; llmJudgeCandidate: number; humanOnly: number; unclassified: number } {
  const rules = getAllRules().filter((r) => r.severity === "error");
  return {
    impossibleStatic: rules.filter((r) => r.automationStatus === "impossible-static").length,
    llmJudgeCandidate: rules.filter((r) => r.automationStatus === "llm-judge-candidate").length,
    humanOnly: rules.filter((r) => r.automationStatus === "human-only").length,
    unclassified: rules.filter(isUnclassified).length,
  };
}

/** 日本語 README 用の経路別マトリクス（アンカー込み） */
export function renderCoverageBlock(): string {
  const c = computeCoverage();
  const e = errorCountsByBucket();
  const rows = [
    "| 経路 | 件数 | 内容 |",
    "|------|------|------|",
    `| 静的自動検証 | **${c.staticAuto} / ${c.total}** | class マッチ ${c.classAuto}（MCP \`check_rule\` 同経路）+ html-attr ${c.htmlAttr} + composition ${c.composition}（ネスト + a11y DOM） |`,
    `| interaction test | ${c.coveredByTest} | \`tests/modal.spec.ts\` が focus trap / Escape / focus 復帰を実機検証 |`,
    `| 静的検出 不能 | ${c.impossibleStatic}（うち error ${e.impossibleStatic}） | \`impossible-static\`（active/selected/current の特定が意味依存） |`,
    `| LLM 審査候補 | ${c.llmJudgeCandidate}（うち error ${e.llmJudgeCandidate}） | \`llm-judge-candidate\`（shadow judge 導入までは自動検証なし） |`,
    `| human-only | ${c.humanOnly}（うち error ${e.humanOnly}） | 人間レビューでのみ守る。\`get_rules\` で AI に提示 |`,
    `| 未分類 | ${c.unclassified}（うち error ${e.unclassified}） | 棚卸し未了（automationStatus 未宣言） |`,
  ];
  return `${COVERAGE_BEGIN}\n${rows.join("\n")}\n${COVERAGE_END}`;
}

/** 英語 README 用の経路別マトリクス（アンカー込み）。同じ contracts を参照し全入口で数値整合させる */
export function renderCoverageBlockEn(): string {
  const c = computeCoverage();
  const e = errorCountsByBucket();
  const rows = [
    "| Route | Count | What |",
    "|-------|-------|------|",
    `| Static auto-detection | **${c.staticAuto} / ${c.total}** | class-match ${c.classAuto} (same path as MCP \`check_rule\`) + html-attr ${c.htmlAttr} + composition ${c.composition} (nesting + a11y DOM) |`,
    `| Interaction test | ${c.coveredByTest} | \`tests/modal.spec.ts\` verifies focus trap / Escape / focus return in a real browser |`,
    `| Statically undetectable | ${c.impossibleStatic} (${e.impossibleStatic} error) | \`impossible-static\` (active/selected/current are semantically dependent) |`,
    `| LLM-judge candidate | ${c.llmJudgeCandidate} (${e.llmJudgeCandidate} error) | \`llm-judge-candidate\` (no automated verification until the shadow judge ships) |`,
    `| Human-only | ${c.humanOnly} (${e.humanOnly} error) | Guarded by human review only; surfaced to the AI via \`get_rules\` |`,
    `| Unclassified | ${c.unclassified} (${e.unclassified} error) | Inventory pending (no automationStatus declared) |`,
  ];
  return `${COVERAGE_EN_BEGIN}\n${rows.join("\n")}\n${COVERAGE_EN_END}`;
}

/**
 * md ファイルのアンカー間を最新の coverage 表に差し替える。戻り値: "updated" | "unchanged" | "no-anchor"。
 * begin/end と render を差し替えることで README.md（日本語）/ README.en.md（英語）を同一ロジックで埋め込む。
 */
export function embedCoverageBlock(
  filePath: string,
  begin: string,
  end: string,
  render: () => string
): "updated" | "unchanged" | "no-anchor" {
  if (!existsSync(filePath)) return "no-anchor";
  const md = readFileSync(filePath, "utf-8");
  const b = md.indexOf(begin);
  const e = md.indexOf(end);
  if (b < 0 || e < b) return "no-anchor";
  const next = md.slice(0, b) + render() + md.slice(e + end.length);
  if (next === md) return "unchanged";
  writeFileSync(filePath, next, "utf-8");
  return "updated";
}

const isCli = process.argv[1] && process.argv[1].endsWith("coverage-stats.ts");
if (isCli) {
  const c = computeCoverage();
  const pct = (n: number) => `${((n / c.total) * 100).toFixed(0)}%`;
  console.log(`\n=== melta UI 検証カバレッジ（全 ${c.total} ルール）===\n`);
  console.log(`  静的自動検証      ${c.staticAuto} (${pct(c.staticAuto)})`);
  console.log(`    ├ class マッチ   ${c.classAuto}（MCP check_rule と同経路）`);
  console.log(`    ├ html-attr      ${c.htmlAttr}`);
  console.log(`    └ composition    ${c.composition}（ネスト + a11y DOM）`);
  console.log(`  interaction test  ${c.coveredByTest}（covered-by-test）`);
  console.log(`  静的検出 不能      ${c.impossibleStatic}（impossible-static: active/selected/current の意味依存）`);
  console.log(`  LLM 審査候補       ${c.llmJudgeCandidate}（llm-judge-candidate: shadow judge 導入までは自動検証なし）`);
  console.log(`  human-only        ${c.humanOnly}（人間レビューでのみ守る）`);
  console.log(`  未分類            ${c.unclassified}（棚卸し未了）\n`);

  // 無防備 error ルール = error なのに自動検証（静的検出 / interaction test）が効いていないもの。
  // 「error 表記がある = 守られている」という偽の安心を可視化する（2026-05-30 redteam 監査 S5）。
  const unguarded = listUnguardedErrors();
  console.log(`=== 無防備 error ルール（自動検証なし）: ${c.unguardedError} 件 ===\n`);
  for (const [status, ids] of [...unguarded.entries()].sort()) {
    console.log(`  [${status}] ${ids.length} 件`);
    console.log(`    ${ids.join(", ")}`);
  }
  console.log("");

  // stateSpec カバレッジ（P2-1 Phase1b の backlog 計器）
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // engine root（README はエンジン自身の資産）とアセット root（vendor 先では MELTA_ROOT）を分離
  const engineRoot = resolve(__dirname, "../..");
  const root = process.env.MELTA_ROOT
    ? resolve(process.env.MELTA_ROOT)
    : engineRoot;
  const sc = computeStateSpecCoverage(resolve(root, "design/contracts/components"));
  const scPct = sc.disabledRequired > 0 ? `${((sc.disabledCovered / sc.disabledRequired) * 100).toFixed(0)}%` : "—";
  console.log(`=== stateSpec カバレッジ（P2-1）===\n`);
  console.log(`  stateSpecs 保有     ${sc.withStateSpecs} / ${sc.totalContracts} contract`);
  console.log(`  disabled spec       ${sc.disabledCovered} / ${sc.disabledRequired}（${scPct}）= states に disabled を持つ contract のうち spec 済み`);
  console.log(`  Phase1b backlog     ${sc.disabledRequired - sc.disabledCovered} contract（disabled spec 未定義）\n`);

  // README.md（日本語）/ README.en.md（英語）の経路別マトリクスを再生成。
  //
  // ⚠️ 読み root（アセット）と書き root（engine）が違うときは書かない。
  // MELTA_ROOT で別 DS のアセットを読んだ状態で engine の README を上書きすると、
  // **他人の DS の数値で melta のドキュメントを破壊する**（実際に踏んだ）。
  const crossRoot = root !== engineRoot;
  if (crossRoot) {
    console.log(
      `\n  ⏭️  README のカバレッジ表は更新しません（アセット root = ${root} が engine root と異なるため）\n` +
        "     別 DS のデータで engine のドキュメントを書き換えないための安全弁です。"
    );
  }

  const targets: Array<[string, string, string, () => string]> = [
    [resolve(engineRoot, "README.md"), COVERAGE_BEGIN, COVERAGE_END, renderCoverageBlock],
    [resolve(engineRoot, "README.en.md"), COVERAGE_EN_BEGIN, COVERAGE_EN_END, renderCoverageBlockEn],
  ];
  for (const [path, begin, end, render] of crossRoot ? [] : targets) {
    const name = path.endsWith("README.en.md") ? "README.en.md" : "README.md";
    const result = embedCoverageBlock(path, begin, end, render);
    console.log(
      result === "updated"
        ? `  ✅ ${name} の検証カバレッジ表を更新しました`
        : result === "unchanged"
          ? `  ✅ ${name} の検証カバレッジ表は最新です`
          : `  ⚠️  ${name} に coverage アンカーが見つかりません`
    );
  }
}
