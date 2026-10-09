#!/usr/bin/env node
/**
 * lint-generated — AI 生成物の禁止パターン検査 CLI（③ CI gate の実体）
 *
 * 使い方:
 *   melta-lint <file...>                                 # npm 消費者（dist/cli/lint-generated.js = bin）
 *   melta-lint "src/**\/*.tsx"                           # glob は呼び出し側 shell で展開
 *   npm run design:lint-generated -- <file...>           # このリポジトリ（scripts/design/lint-generated.ts の shim 経由）
 *
 * design:check（contract の自己整合）と違い、こちらは「実際に生成された
 * .html/.tsx/.jsx/.vue」を単一 lint API（src/utils/lint.ts の lint()）に通す。
 * MCP check_html / PostToolUse hook / npm 公開 entry（melta-ds-mcp/lint）と同じ判定。
 * error 違反が 1 件でもあれば exit 1 → CI gate / Git Hook のブロックに使える。
 *
 * 本体を scripts/design/ から src/cli/ へ移した理由: tsc で dist/cli/ に出して npm に同梱し、
 * tsx も TS ソースも無い環境（npm install した消費者、plugin 配布）でも node だけで動かすため。
 *
 * 旧 hook-check-rule.sh の問題（exit 0 で警告のみ・includes 誤検出・.html 限定）を
 * すべて解消する。
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { lint, sourceTypeForPath, type LintResult } from "../utils/lint.js";
import { isExcludedHookPath, NO_PATH_PHRASE, parseHookInput } from "../utils/hook-input.js";
import { getAllRules } from "../utils/loader.js";

// 検査対象の拡張子。sourceType の振り分け（.html → composition 込み）は
// 対象かどうかは lint.ts の sourceTypeForPath から導く（拡張子の定義を 2 か所に持たない。
// 片方だけ増やすと「対象なのに種別が決まらない」が起きる）
const isTarget = (path: string): boolean => sourceTypeForPath(path) !== null;

/**
 * 引数を「検査対象」と「解決できなかった引数」に分ける。
 *
 * 拡張子違い（.ts 等）は**意図的な絞り込み**なので黙って落としてよい（呼び出し側は
 * glob をそのまま渡す）。一方 **不在パス / ディレクトリ**は typo・未展開 glob・
 * 消えたファイルのいずれかで、黙って落とすと「N 件走査して合格」に見えるのに
 * 実際は意図した検体を 1 つも見ていない、という穴になる。
 * 引数が 0 件のときだけ exit 2 にする従来実装では、
 * `clean.html typo.html` のような**部分的な取りこぼし**が素通りしていた。
 */
function collectFiles(args: string[]): { files: string[]; unresolved: string[] } {
  const files: string[] = [];
  const unresolved: string[] = [];
  for (const a of args) {
    if (!existsSync(a) || !statSync(a).isFile()) {
      // 拡張子が対象外のものは「そもそも検査対象ではない」ので不在でも報告しない
      if (isTarget(a)) unresolved.push(a);
      continue;
    }
    if (!isTarget(a)) continue;
    files.push(a);
  }
  return { files, unresolved };
}

/**
 * ruleset を先に読んで診断を表に出す（Phase 2 / S2 W8）。
 *
 * ruleset の不正（未知 detector / 壊れた spec / JSON 破損）は loadRules が
 * S0 の診断付きで throw するが、その throw を最初に浴びるのは lintFile の
 * try/catch だった。結果、**「HTML の読み込みに失敗」という無関係な報告**に化けて
 * 利用者は HTML を見に行くことになる（外部 DS fixture の E2E で実測）。
 * 検体を 1 つも読む前にここで落として、原因が ruleset であることを明示する。
 */
function loadRulesetOrFail(): Error | null {
  try {
    getAllRules();
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** lintFile の失敗理由。null 返しだと read 失敗と ruleset 不正を区別できない */
interface LintFailure {
  file: string;
  message: string;
}

/**
 * 1 ファイルを lint() に通す。合否（errorCount / warnCount / passed）はここで合成せず
 * lint() の結果をそのまま使う（check_html / npm 公開 entry と同じ判定経路）。
 */
function lintFile(file: string): LintResult | LintFailure {
  const sourceType = sourceTypeForPath(file);
  // isTarget は sourceTypeForPath から導くので通常ここには来ない。来たら黙って既定（"html"）で
  // 検査せず未走査として落とす（composition の有無が化けるため）
  if (sourceType === null) {
    return { file, message: "拡張子から sourceType を決められません" };
  }
  try {
    const source = readFileSync(file, "utf-8");
    return lint(source, { sourceType });
  } catch (e) {
    return { file, message: e instanceof Error ? e.message : String(e) };
  }
}

function isFailure(r: LintResult | LintFailure): r is LintFailure {
  return "message" in r;
}

/**
 * --hook <file>: Claude Code PostToolUse hook 用の JSON を stdout に出して常に exit 0。
 *
 * - error あり → {"decision":"block","reason":...} — Claude に自動フィードバックされ
 *   修正ループが回る（PostToolUse は書き込み後なので「実行前ブロック」ではない）
 * - warn のみ → hookSpecificOutput.additionalContext で助言注入
 * - 違反なし / 対象外 → 出力なし
 * - **ruleset 不正 / 検体の読込失敗 → block**（従来は出力なし = 無言で検査ゼロだった。
 *   hook は exit 0 が契約なので、fail-loud にできる経路は block 出力しかない）
 *
 * 旧 hook の「plain stdout + exit 0」は transcript 表示のみで model に届かないため、
 * この JSON 出力が enforcement の実体。
 */
/** hook で「検査が走らなかった」ことを Claude に伝える（block はしない） */
function notCheckedNotice(detail: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `デザインシステムの禁止パターン検査を実行できませんでした（${detail}）。この書き込みは未検査です。`,
      },
    })
  );
}

function hookMain(fileArg: string | undefined): void {
  // hook の配線ミス（file_path を渡していない）。無言で通すと enforcement が
  // 落ちていることに誰も気づけないので、検査対象かどうかを判断する前に報告する
  if (!fileArg) {
    notCheckedNotice(NO_PATH_PHRASE);
    return;
  }
  // `--hook <file>` の相対パスも stdin 経路と同じく cwd 基準で絶対化する（除外判定の入口を揃える）
  const file = resolve(fileArg);
  // 検査対象外の拡張子は元から対象外なので黙って抜ける
  if (!isTarget(file)) return;
  // テスト / ベンチマーク / 検証用の検体も黙って抜ける（違反を含むのが仕事。hook-input.ts 参照）
  if (isExcludedHookPath(file)) return;

  // 対象拡張子なのに実物が無い / ファイルでない（.html という名前のディレクトリ等）。
  // block にすると「書いて消した」だけで作業が止まるので block はしないが、
  // 「検査が走らなかった」ことは伝える（無言 exit 0 は検査ゼロを合格と同義）
  if (!existsSync(file) || !statSync(file).isFile()) {
    notCheckedNotice(`検体を解決できません: ${file}`);
    return;
  }

  const rulesetError = loadRulesetOrFail();
  if (rulesetError) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "デザインシステムの ruleset を読み込めないため検査できませんでした（検査ゼロを合格として扱わない）:\n" +
          rulesetError.message,
      })
    );
    return;
  }

  const result = lintFile(file);
  if (isFailure(result)) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `デザインシステムの禁止パターン検査を実行できませんでした（${result.file}）:\n${result.message}`,
      })
    );
    return;
  }
  const { violations, errorCount, warnCount } = result;
  if (violations.length === 0) return;

  const MAX_LISTED = 10;
  const lines = violations
    .slice(0, MAX_LISTED)
    .map(
      (v) =>
        `${v.severity === "error" ? "✗" : "⚠"} [${v.severity}] ${v.ruleId}: "${v.token}" → ${v.alternative}（${v.reason}）`
    );
  if (violations.length > MAX_LISTED) {
    lines.push(
      `…他 ${violations.length - MAX_LISTED} 件（melta-lint ${file} で全件表示。このリポジトリでは npm run design:lint-generated -- ${file}）`
    );
  }

  if (errorCount > 0) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `melta UI 禁止パターン検出（error ${errorCount} / warn ${warnCount}）。書き込まれたファイルを修正してください:\n${lines.join("\n")}\nルール仕様: design/contracts/rules.json`,
      })
    );
  } else {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `melta UI 注意（warn ${warnCount}）。可能なら修正を推奨:\n${lines.join("\n")}`,
        },
      })
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--hook") {
    // `--hook <file>` は従来どおり。引数が無ければ stdin の PostToolUse JSON を読む
    // （Claude Code の hook と plugin はこちら。wrapper の grep に頼らない）
    if (args[1] !== undefined) {
      hookMain(args[1]);
      process.exit(0);
    }
    // 端末から手で打つと readFileSync(0) が入力待ちで止まるので、TTY なら読まずに案内する
    if (process.stdin.isTTY) {
      notCheckedNotice(`${NO_PATH_PHRASE}（stdin が端末。PostToolUse の JSON を stdin に渡すか --hook <file> を使う）`);
      process.exit(0);
    }
    // stdin が閉じられている等で読めないときも、例外で落ちて無言になるのでなく未検査を通知する
    let raw: string;
    try {
      raw = readFileSync(0, "utf-8");
    } catch (e) {
      notCheckedNotice(`${NO_PATH_PHRASE}（stdin を読めません: ${e instanceof Error ? e.message : String(e)}）`);
      process.exit(0);
    }
    const parsed = parseHookInput(raw);
    if (!parsed.ok) {
      notCheckedNotice(parsed.reason);
      process.exit(0);
    }
    hookMain(parsed.filePath);
    process.exit(0);
  }
  // --baseline = 比較モード（baseline 不在は exit 2。「不在 = PASS」を防ぐ）
  // --baseline-write = 初期化・更新モード（現状の warn 件数を書き出す。CI では使わない）
  let baselinePath: string | null = null;
  let baselineWrite = false;
  let fileArgs = args;
  if (args[0] === "--baseline" || args[0] === "--baseline-write") {
    baselineWrite = args[0] === "--baseline-write";
    baselinePath = args[1] ?? null;
    fileArgs = args.slice(2);
    if (!baselinePath) {
      console.error("usage: melta-lint --baseline <baseline.json> <file...>");
      process.exit(2);
    }
  }

  if (fileArgs.length === 0) {
    console.error(
      "usage: melta-lint [--hook|--baseline <json>|--baseline-write <json>] <file.html|tsx|jsx|vue ...>"
    );
    process.exit(2);
  }

  const { files, unresolved } = collectFiles(fileArgs);
  // 引数はあるのに対象ファイルが 0 件 = typo path / glob 非展開 / 非対応拡張子。
  // CI gate が「走査対象ゼロ」を PASS と誤認しないよう exit 2 で落とす。
  if (files.length === 0) {
    console.error(
      `対象ファイルが見つかりません（.html/.tsx/.jsx/.vue が必要）: ${fileArgs.join(", ")}`
    );
    process.exit(2);
  }
  // 一部だけ解決できなかったケース（`clean.html typo.html`）も素通りさせない。
  // 走査件数だけ見ていると「1 ファイル走査 / error 0」で合格に見えてしまう
  if (unresolved.length > 0) {
    console.error(
      `❌ 指定されたのに見つからない検体があります（未走査）: ${unresolved.join(", ")}`
    );
    process.exit(2);
  }
  // ruleset の不正は検体の読込失敗と区別して先に落とす（S0 の診断を CLI まで届かせる）
  const rulesetError = loadRulesetOrFail();
  if (rulesetError) {
    console.error(`❌ ruleset を読み込めないため検査していません:\n${rulesetError.message}`);
    process.exit(2);
  }

  let errorCount = 0;
  let warnCount = 0;
  const skipped: LintFailure[] = [];
  const fileViolations = new Map<string, LintResult["violations"]>();

  for (const file of files) {
    const result = lintFile(file);
    // 読み込み失敗を silent skip すると「走査したつもりで素通り」になるため記録して exit 2
    if (isFailure(result)) {
      skipped.push(result);
      continue;
    }
    const { violations } = result;
    fileViolations.set(file, violations);
    // 件数は lint() の判定をそのまま積む（ここで severity を数え直さない）
    errorCount += result.errorCount;
    warnCount += result.warnCount;
    if (violations.length === 0) continue;

    console.log(`\n${file}`);
    for (const v of violations) {
      const mark = v.severity === "error" ? "✗" : "⚠";
      console.log(
        `  ${mark} [${v.severity}] ${v.ruleId}: "${v.token}" → ${v.alternative}（${v.reason}）`
      );
    }
  }

  console.log(
    `\n${files.length} ファイル走査 / error ${errorCount} / warn ${warnCount}`
  );

  if (skipped.length > 0) {
    console.error("❌ 読み込み失敗で未走査のファイルがあります:");
    for (const { file, message } of skipped) {
      console.error(`  - ${file}: ${message}`);
    }
    process.exit(2);
  }

  // --- baseline ラチェット（error は従来通り即 FAIL。warn は per-file × ruleId で増加禁止） ---
  type Baseline = Record<string, Record<string, number>>;
  const currentWarns: Baseline = {};
  for (const [file, violations] of fileViolations) {
    const counts: Record<string, number> = {};
    for (const v of violations) {
      if (v.severity !== "warn") continue;
      counts[v.ruleId] = (counts[v.ruleId] ?? 0) + 1;
    }
    if (Object.keys(counts).length > 0) {
      currentWarns[file] = Object.fromEntries(Object.entries(counts).sort());
    }
  }

  if (baselinePath && baselineWrite) {
    const sorted = Object.fromEntries(Object.entries(currentWarns).sort());
    writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
    console.log(`📝 baseline を書き出しました: ${baselinePath}（${Object.keys(sorted).length} ファイル）`);
  } else if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(
        `❌ baseline が見つかりません: ${baselinePath}（初期化は --baseline-write で明示的に行う）`
      );
      process.exit(2);
    }
    const baseline: Baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
    const increases: string[] = [];
    let decreased = false;
    for (const [file, counts] of Object.entries(currentWarns)) {
      for (const [ruleId, count] of Object.entries(counts)) {
        const allowed = baseline[file]?.[ruleId] ?? 0;
        if (count > allowed) increases.push(`${file} ${ruleId}: ${allowed} → ${count}`);
      }
    }
    for (const [file, counts] of Object.entries(baseline)) {
      if (!fileViolations.has(file)) continue; // 今回の走査対象外は比較しない
      for (const [ruleId, allowed] of Object.entries(counts)) {
        if ((currentWarns[file]?.[ruleId] ?? 0) < allowed) decreased = true;
      }
    }
    if (increases.length > 0) {
      console.error(`\n❌ warn が baseline を超過（ラチェット違反）:\n  ${increases.join("\n  ")}`);
      console.error("  正当な増加なら --baseline-write で更新してコミットに含めること");
      process.exit(1);
    }
    if (decreased) {
      console.log("💡 warn が baseline より減少。--baseline-write での更新を推奨");
    }
    console.log("✅ baseline ラチェット OK（warn 増加なし）");
  }

  console.log(errorCount === 0 ? "✅ PASSED" : "❌ FAILED");
  process.exit(errorCount > 0 ? 1 : 0);
}

main();
