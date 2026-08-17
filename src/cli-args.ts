/**
 * CLI 引数の解釈。process.argv を読むのは CLI entry（src/index.ts）だけに閉じ、
 * ここは配列を受け取る純関数に留める（loader が argv を無条件走査すると、
 * テストランナーや埋め込み先ホストの同名オプションを誤採用しうるため）。
 */

export const MELTA_ROOT_FLAG = "--melta-root";

/** melta が所有する引数の名前空間。この接頭辞を持つ未知オプションは typo とみなして拒否する */
const MELTA_NAMESPACE = "--melta-";

/**
 * 実測事故の綴り違い（2026-08-17 Codex 監査で `--melat-root=/x` が黙って内蔵 melta に
 * fallback していた）。接頭辞が崩れているため名前空間検査では拾えないので、個別に予約する。
 * 汎用の編集距離検知は `--meta-root` のような無関係な引数まで拾って「名前空間外は無視」と
 * 衝突するため採用しない。
 */
// --melta-roto のように接頭辞が正しい typo は名前空間検査で落ちるので、ここには接頭辞が崩れるものだけ置く
const RESERVED_TYPOS = new Set(["--melat-root", "--metla-root"]);

/** CLI 設定の誤りを実行前に落とすためのエラー。fallback で握り潰さない */
export class CliArgError extends Error {}

function optionName(arg: string): string {
  const eq = arg.indexOf("=");
  return eq === -1 ? arg : arg.slice(0, eq);
}

/**
 * `--melta-root=<path>` / `--melta-root <path>` を取り出す。
 * 指定が無ければ null。
 *
 * fail-fast の対象（黙って env / パッケージ相対に落ちると、差し替えたつもりの root で
 * 動かない = BYO-DS のつもりで別の DS が「合格」を返す最悪の事故になる）:
 *   - フラグはあるのに値が無い
 *   - `--melta-` 名前空間内の未知オプション（`--melta-config` 等）
 *   - 予約 typo（`--melat-root` 等）
 *   - `--melta-root` の重複指定で値が異なる
 *
 * 全 argv を走査してから返す（正しい指定を見つけた時点で return すると、後ろの
 * 未知オプションを見逃して検査が引数順依存になる）。
 * melta 名前空間の外（`--root` / `--verbose` / `--meta-root` 等）は MCP ホストの
 * 独自引数でありうるため無視する。
 */
export function parseMeltaRootArg(argv: readonly string[]): string | null {
  let root: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = optionName(arg);

    if (RESERVED_TYPOS.has(name)) {
      throw new CliArgError(
        `[melta-ui] ${name} は ${MELTA_ROOT_FLAG} の綴り違いです。${MELTA_ROOT_FLAG}=<path> の形式で指定してください`
      );
    }

    if (name === MELTA_ROOT_FLAG) {
      let value: string | undefined;
      if (arg === MELTA_ROOT_FLAG) {
        value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          throw new CliArgError(
            `[melta-ui] ${MELTA_ROOT_FLAG} に値がありません。${MELTA_ROOT_FLAG}=<path> の形式で指定してください`
          );
        }
        i++; // 値を消費
      } else {
        value = arg.slice(MELTA_ROOT_FLAG.length + 1);
        if (!value) {
          throw new CliArgError(
            `[melta-ui] ${MELTA_ROOT_FLAG} に値がありません。${MELTA_ROOT_FLAG}=<path> の形式で指定してください`
          );
        }
      }
      if (root !== null && root !== value) {
        throw new CliArgError(
          `[melta-ui] ${MELTA_ROOT_FLAG} が異なる値で複数回指定されています（${root} / ${value}）。どちらを使うか一つに絞ってください`
        );
      }
      root = value;
      continue;
    }

    if (name.startsWith(MELTA_NAMESPACE)) {
      throw new CliArgError(
        `[melta-ui] 未知のオプション ${name}。melta-ui が受け付けるのは ${MELTA_ROOT_FLAG} だけです（typo なら内蔵 melta に fallback せず、ここで止めます）`
      );
    }
  }

  return root;
}
