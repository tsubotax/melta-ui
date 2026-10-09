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
import { isAbsolute, relative, resolve } from "node:path";

export type HookInput =
  | { ok: true; filePath: string }
  | { ok: false; reason: string };

/**
 * @param raw stdin の生テキスト
 * @param cwd 相対パスの基準（Claude Code は絶対パスを渡すが、手で叩いたときの保険）
 */
/** 配線ミスの通知は 1 つの句で始める（hook の E2E がこの句で「無言でない」ことを確かめる） */
export const NO_PATH_PHRASE = "hook に検体のパスが渡されていません";

export function parseHookInput(raw: string, cwd: string = process.cwd()): HookInput {
  const fail = (detail: string): HookInput => ({ ok: false, reason: `${NO_PATH_PHRASE}（${detail}）` });
  if (raw.trim() === "") return fail("stdin が空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("stdin を JSON として読めません");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("stdin が JSON オブジェクトではありません");
  }
  const toolInput = (parsed as { tool_input?: unknown }).tool_input;
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return fail("tool_input がありません");
  }
  const filePath = (toolInput as { file_path?: unknown }).file_path;
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return fail("tool_input.file_path がありません");
  }
  return { ok: true, filePath: resolve(cwd, filePath) };
}

/**
 * hook で意図的に検査しないパス。テスト・ベンチマーク・検証用の検体は違反を含むのが仕事なので、
 * 書くたびに block されると作業が止まる。CI の `melta-lint <file...>` にはこの除外は無い
 * （明示的に渡した検体は検査する）。
 *
 * 判定は **プロジェクト root（cwd）からの相対パス**に対して行う。絶対パス全体で見ると、
 * `/home/user/test/product/src/page.html` のようにプロジェクトの外側の親ディレクトリ名まで
 * 拾って、通常の画面を無通知で除外してしまう。cwd の外にある検体は除外しない。
 */
const EXCLUDED_SEGMENTS = ["tests/", "test/", "benchmarks/results/", "verification/"];

export function isExcludedHookPath(filePath: string, cwd: string = process.cwd()): boolean {
  const rel = relative(cwd, resolve(cwd, filePath)).replace(/\\/g, "/");
  // cwd の外（`../` で始まる）か別ドライブ（絶対パスのまま）は除外の対象にしない
  if (rel === "" || rel.startsWith("../") || rel === ".." || isAbsolute(rel)) return false;
  const haystack = `/${rel}`;
  return EXCLUDED_SEGMENTS.some((seg) => haystack.includes(`/${seg}`));
}
