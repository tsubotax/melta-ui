#!/bin/bash
# PostToolUse hook: 生成物(.html/.tsx/.jsx/.vue)の Write/Edit 後に禁止パターンをチェック
#
# 出力は lint CLI（src/cli/lint-generated.ts / dist/cli/lint-generated.js）の --hook が生成する PostToolUse 用 JSON:
#   - error あり → {"decision":"block","reason":...} で Claude に自動フィードバック（修正ループ）
#   - warn のみ → hookSpecificOutput.additionalContext で助言注入
# 旧実装の plain stdout + exit 0 は transcript 表示のみで model に届かなかった。
# 判定ロジックは単一 lint API(src/utils/lint.ts の lint()) に集約。MCP check_html / CI / npm 公開 entry と同じ判定。

set -uo pipefail

# stdin から tool use の JSON を読む
INPUT=$(cat)

# file_path を抽出
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

# file_path を取り出せなかった = hook の配線ミス。ここで exit 0 すると
# 「検査が走らなかった」ことが誰にも伝わらないので TS 側に委ねて通知させる
if [ -n "$FILE_PATH" ]; then
  # 対象拡張子でなければスキップ。
  # ここで弾くのは **毎回 node / tsx を起動しないための足切り**であって判定ではない
  # （拡張子の正は src/cli/lint-generated.ts の TARGET_EXT と src/utils/lint.ts の
  #   sourceTypeForPath。変更時は 3 か所を合わせること）
  case "$FILE_PATH" in
    *.html|*.tsx|*.jsx|*.vue) ;;
    *) exit 0 ;;
  esac

  # テスト / ベンチマーク / デモ用ファイルは意図的に対象外
  case "$FILE_PATH" in
    */tests/*|*/test/*|*/benchmarks/results/*|*/verification/*) exit 0 ;;
  esac
fi

# ⚠️ 「不在ならスキップ」を wrapper で判定しない。
# 対象拡張子なのに実物が無い / ディレクトリだった、は **検査が走らなかった**ケースで、
# TS 側（hookMain）が未検査通知を出す。ここで exit 0 すると
# その通知に永久に到達しない（= fail-open が wrapper 層に残る）

# プロジェクトルートを特定
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# 実行経路は「どこに置かれた hook か」で選ぶ。JSON 生成はどれも lint CLI の --hook に集約。常に exit 0
#
#   dev checkout（src/cli/lint-generated.ts がある）
#     1. node_modules/.bin/tsx で src を叩く（src が正。dist は build 前で古いことがある）
#     2. tsx が無ければ dist/cli/lint-generated.js を node で叩く。ただし src の .ts が dist より
#        新しければ古い engine で判定せず「未検査」を通知する（CI は最新 src、hook は旧 dist、
#        という食い違いを無通知で起こさない）
#   配布物（npm / plugin。src も tsx も無い）
#     3. dist/cli/lint-generated.js を node で叩く
#   どれも無ければ silent no-op にせず、未検査であることをコンテキストに注入する
#
# tsx は npx でなく node_modules/.bin を直接見る（npx --no-install は cwd 次第で別の node_modules を
# 探しに行き、どこを見たか分からなくなる）

# 検査が走らなかったことをコンテキストに注入する（silent no-op にしない）。
# $1 は JSON にそのまま埋め込むので、" や \ を含まない固定文言だけを渡す
not_checked() {
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"melta UI: 禁止パターン lint をスキップしました（%s）。この書き込みは未検査です。リポジトリルートで npm run build か npm install を実行すると Write/Edit 直後の自動 lint が有効になります。"}}\n' "$1"
}

# --hook は常に exit 0 が契約。非 0 は CLI 自体が起動できていない（依存の未インストール等）ので、
# 出力なし = 合格と区別できるよう未検査として通知する
SRC_CLI="$ROOT/src/cli/lint-generated.ts"
DIST_CLI="$ROOT/dist/cli/lint-generated.js"
TSX="$ROOT/node_modules/.bin/tsx"

run_dist() {
  node "$DIST_CLI" --hook "$FILE_PATH" || not_checked "dist/cli/lint-generated.js の起動に失敗"
}

if [ -f "$SRC_CLI" ]; then
  # dev checkout: src が正
  if [ -x "$TSX" ]; then
    "$TSX" "$SRC_CLI" --hook "$FILE_PATH" || not_checked "src/cli/lint-generated.ts の起動に失敗"
    exit 0
  fi
  if [ -f "$DIST_CLI" ]; then
    # src の .ts が 1 つでも dist より新しければ、古い engine で判定しない
    if [ -n "$(find "$ROOT/src" -name '*.ts' -newer "$DIST_CLI" -print 2>/dev/null | head -1)" ]; then
      not_checked "dist/cli/lint-generated.js が src より古い。npm run build が要る"
      exit 0
    fi
    run_dist
    exit 0
  fi
  not_checked "tsx も dist/cli/lint-generated.js も見つからない"
  exit 0
fi

# 配布物（npm / plugin）: src が無いので dist だけ
if [ -f "$DIST_CLI" ]; then
  run_dist
  exit 0
fi

not_checked "dist/cli/lint-generated.js も tsx も見つからない"
exit 0
