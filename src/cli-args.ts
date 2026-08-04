/**
 * CLI 引数の解釈。process.argv を読むのは CLI entry（src/index.ts）だけに閉じ、
 * ここは配列を受け取る純関数に留める（loader が argv を無条件走査すると、
 * テストランナーや埋め込み先ホストの同名オプションを誤採用しうるため）。
 */

export const MELTA_ROOT_FLAG = "--melta-root";

/** CLI 設定の誤りを実行前に落とすためのエラー。fallback で握り潰さない */
export class CliArgError extends Error {}

/**
 * `--melta-root=<path>` / `--melta-root <path>` を取り出す。
 * 指定が無ければ null。フラグはあるのに値が無い場合は設定エラーで即時失敗する
 * （黙って env / パッケージ相対に落ちると、差し替えたつもりの root で動かない事故になる）。
 */
export function parseMeltaRootArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === MELTA_ROOT_FLAG) {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new CliArgError(
          `[melta-ui] ${MELTA_ROOT_FLAG} に値がありません。${MELTA_ROOT_FLAG}=<path> の形式で指定してください`
        );
      }
      return value;
    }

    if (arg.startsWith(`${MELTA_ROOT_FLAG}=`)) {
      const value = arg.slice(MELTA_ROOT_FLAG.length + 1);
      if (!value) {
        throw new CliArgError(
          `[melta-ui] ${MELTA_ROOT_FLAG} に値がありません。${MELTA_ROOT_FLAG}=<path> の形式で指定してください`
        );
      }
      return value;
    }
  }
  return null;
}
