# 配布とパッケージ互換

> README から分離した詳細（2026-08-04）。リリースごとの差分は [CHANGELOG.md](../CHANGELOG.md)。

## 公開パッケージ

| パッケージ | 中身 | 主な entry |
|---|---|---|
| `melta-contracts` | tokens / rules / component contracts / recipes の JSON。ビルド不要・フレームワーク非依存 | `melta-contracts/tokens` `melta-contracts/rules` `melta-contracts/components/<id>` |
| `melta-ds-mcp` | MCP サーバー（このリポジトリ）+ lint エンジン | `npx melta-ds-mcp`（stdio MCP）/ `melta-ds-mcp/lint-core` |
| `melta-app` | React Native 実装 + 消費者向け eslint plugin | `melta-app` / `melta-app/icons` / `melta-app/safe-area` / `melta-app/eslint-plugin` |

MCP Registry の ID は `io.github.tsubotax/melta-ui`（マニフェストは `server.json`）。

## `melta-contracts` の読み方

ビルドツール（Node / Metro）に依存しない最も確実な読み方は `require.resolve` + `readFileSync`:

```js
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const tokens = JSON.parse(readFileSync(require.resolve("melta-contracts/tokens"), "utf8"));
const rules = JSON.parse(readFileSync(require.resolve("melta-contracts/rules"), "utf8"));
```

`import tokens from "melta-contracts/tokens" with { type: "json" }`（JSON import attributes）は Node では使えるが、React Native / Metro での挙動は実機検証が必要。確実性を優先するなら上記を使う。

## `melta-ds-mcp` の entry 規約

- **公開 entry**: `melta-ds-mcp/lint-core`（1.5.0 で `exports` に明示）。`lintSource(source)` は **class lint + html-attr lint まで**を返す。**composition lint（ネスト modal / interactive 内 interactive 等）は含まない** — composition は MCP `check_html` と CI の lint CLI が別途足している。つまり `lintSource()` の `[]` は「class / html-attr の違反なし」であって「CI と同じ判定で違反なし」ではない
  - 以前この行は「CI / hook / MCP check_html と同一の lint ロジック」と書いていたが誤り（2026-08-17 訂正）
  - composition まで含めた判定が要る場合は MCP の `check_html` を使う。`dist/tools/check-html.js` の deep import は動くが公開 API として推奨しない（下記 passthrough は互換維持であって契約ではない）
  - **未解決**: npm 経路の消費者が composition 込みの単一 API を持てない状態は残る。単一 `lint()` API 化は Phase 2 S4（config resolver + 公開 entry 整理）で扱う
- **互換 passthrough**: `melta-ds-mcp/dist/*` / `melta-ds-mcp/design/*` / `melta-ds-mcp/metadata/*` の deep import は pattern で維持する。予告なく壊さない
- **bare import は非サポート**: `import "melta-ds-mcp"` は entry ではない。`dist/index.js` は import しただけで stdio サーバーが起動する CLI entry であり、公開 API にしない。利用は `npx melta-ds-mcp`（MCP サーバー）か上記 subpath 経由
- 解決経路は実際の Node 解決器で `tests/package-exports.spec.ts` が固定する

## vendor 経路（自前 contracts を同じサーバーで配る）

`--melta-root=<path>` でアセット root を差し替えられる。優先順位は `--melta-root` > `MELTA_ROOT` > パッケージ相対。値なしの `--melta-root` は黙って fallback せず設定エラーで終了する。tarball には `design/schemas/{component-contract,recipe,rule}.schema.json` と `design/contracts/package.json`（同梱 contracts の version 確認用）を同梱しているので、vendor 先は自前の契約を melta のスキーマで検証できる。

## stale 配布の物理防止 — `npm run check:pack`

npm 上の 1.4.0 が古い contracts を同梱したまま stale 化した事故を受けた消費者視点の smoke ゲート。CI（design-check）の必須ステップ。

1. `npm pack` した tarball を展開
2. registry の `melta-contracts` version とリポの contracts version を同期検査（registry が先行 = リポが stale なら fail、リポが先行なら「contracts を先に publish せよ」の warn、取得不能なら warn 継続）
3. 同梱スキーマ 3 種の存在と JSON parse
4. tmp consumer に `npm install <tarball>` して、公開 entry と互換 passthrough の**両 specifier**で lint が発火するか確認

あわせて `prepack` が `npm run build` を強制するため、dist の作り忘れによる空配布も起きない。

## パッケージ分割の予定

将来、検証エンジン（`melta`）とルールセット（`melta-contracts`）を eslint 型に分離する方向で検討している。`melta-ds-mcp` は互換を維持したまま段階的に移行する予定で、現在の entry（`melta-ds-mcp/lint-core` および `dist/*`・`design/*`・`metadata/*` の deep import）を予告なく壊すことはしない。時期・パッケージ名は未確定。
