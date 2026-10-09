/**
 * Claude Code PostToolUse hook の入力（stdin の JSON）から検体のパスを取り出す。
 *
 * 以前は bash の wrapper（scripts/design/hook-check-rule.sh）が grep で `"file_path": "..."` を
 * 抜いていたが、値に `\"` や `\\` が入る・別の階層に同名キーがある、で取り違える。
 * JSON として読み、`tool_input.file_path` だけを見る。plugin 配布では wrapper を介さず
 * `melta-lint --hook` が stdin を直接読むので、ここが唯一の入口になる。
 *
 * 純関数にして tests/hook-input.spec.ts から検査する（CLI 本体は import すると main() が走る）。
 */
import { resolve } from "node:path";

export type HookInput =
  | { ok: true; filePath: string }
  | { ok: false; reason: string };

/**
 * @param raw stdin の生テキスト
 * @param cwd 相対パスの基準（Claude Code は絶対パスを渡すが、手で叩いたときの保険）
 */
export function parseHookInput(raw: string, cwd: string = process.cwd()): HookInput {
  if (raw.trim() === "") return { ok: false, reason: "hook の入力（stdin）が空です" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "hook の入力（stdin）を JSON として読めません" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "hook の入力（stdin）が JSON オブジェクトではありません" };
  }
  const toolInput = (parsed as { tool_input?: unknown }).tool_input;
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return { ok: false, reason: "hook の入力に tool_input がありません" };
  }
  const filePath = (toolInput as { file_path?: unknown }).file_path;
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { ok: false, reason: "hook の入力に tool_input.file_path がありません" };
  }
  return { ok: true, filePath: resolve(cwd, filePath) };
}

/**
 * hook で意図的に検査しないパス。テスト・ベンチマーク・検証用の検体は違反を含むのが仕事なので、
 * 書くたびに block されると作業が止まる。CI の `melta-lint <file...>` にはこの除外は無い
 * （明示的に渡した検体は検査する）。
 */
const EXCLUDED_SEGMENTS = ["/tests/", "/test/", "/benchmarks/results/", "/verification/"];

export function isExcludedHookPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return EXCLUDED_SEGMENTS.some((seg) => normalized.includes(seg));
}
