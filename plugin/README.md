# melta-ui — Claude Code plugin

melta UI の **MCP サーバー**と **PostToolUse lint hook** を 1 回の install で入れる plugin。中身は npm の `melta-ds-mcp` を exact pin で引いているだけで、このディレクトリに engine のコードは無い。

```text
/plugin marketplace add tsubotax/melta-ui
/plugin install melta-ui@melta-ui
```

install 後、`/reload-plugins` か Claude Code の再起動で有効になる。

## 入るもの

| 層 | 実体 | 何をするか |
|---|---|---|
| MCP サーバー `melta-ui` | `node_modules/melta-ds-mcp/dist/index.js` | `get_token` / `get_component` / `check_rule` / `check_html` / `get_rules` / `search`。接続時の instructions で DESIGN.md を先に読む導線を出す |
| PostToolUse hook | `node_modules/melta-ds-mcp/dist/cli/lint-generated.js --hook` | `.html` / `.tsx` / `.jsx` / `.vue` の Write / Edit 直後に禁止パターンを検査。error は `decision: block` で修正ループに戻し、warn は additionalContext で助言 |

skills（`build-screen` / `design-review` / `ban-pattern`）は入っていない。melta-ui リポジトリの文書や正本を前提にした手順なので、plugin 利用者のプロジェクトでは成立しない。MCP ツールだけで完結する形に書き直してから足す。

## 使い分け

| 使い方 | 入口 | hook / MCP の経路 |
|---|---|---|
| melta-ui を clone して開発する | リポジトリの `.claude/settings.json` と `.mcp.json` | `scripts/design/hook-check-rule.sh`（src を tsx で）/ `npx tsx src/index.ts` |
| 自分のプロジェクトで melta を使う | この plugin | `node_modules/melta-ds-mcp/dist/`（npm の公開版） |

**同じプロジェクトで両方を有効にしない。** hook も MCP も二重に走り、clone 側の開発中 engine と plugin 側の公開済み engine で判定が食い違う。

## 版の対応

`plugin.json` の `version`、`package.json` の `dependencies["melta-ds-mcp"]`、`package-lock.json` の解決版は、リポジトリ root の `package.json` の version と同じにする（`npm run design:drift` が検査）。npm に公開してから lock を更新し、その後に plugin を出す。順番を変えると install 時に存在しない版を引きに行く。

## 制約

- install 時に `npm run build` は走らない。依存の解決だけ（exact pin、60 秒、lifecycle script なし）。dist は npm の tarball に入っている
- Node 22 以上、npm が PATH にあること
- hook はプロジェクト root（cwd）基準で `tests/` `test/` `benchmarks/results/` `verification/` を検査対象から外す。CI 用の `melta-lint <file...>` にはこの除外は無い
