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

## 自分のデザインシステムを持ち込む（BYO-DS）

`melta-ds-mcp` は、起動時に読み込むアセット root を自分の DS bundle へ切り替えられる（`--melta-root=<path>`）。切り替えると melta のトークン・ルール・コンポーネント仕様は一切読まれず、**同じエンジンが自分の DS の辞書で検査する**。melta のルールとは混在しない。

優先順位は `--melta-root` > `MELTA_ROOT` 環境変数 > パッケージ相対（同梱の melta）。値なしの `--melta-root`、未知の `--melta-*` オプション、予約された綴り違い（`--melat-root` / `--metla-root`）は黙って同梱 melta に fallback せず、起動時にエラーで止まる（あらゆる typo を検出するわけではない。`--melta-` 名前空間の中だけを厳格にしている）。

以下は **`melta-ds-mcp@1.6.0` で 2026-08-17 に実測**した内容。

### 最小 lint / token 構成 — 4 ファイルで起動する

トークン参照・ルール検査（`get_token` / `search` / `check_rule` / `check_html` / `get_rules`）だけを使うなら、この 4 ファイルで起動する。**component 系（`get_component` / `melta://components`）は使えない**（後述）。

```
my-ds/
├── package.json
├── design/contracts/
│   ├── tokens.json
│   └── rules.json
└── metadata/
    └── components.json
```

`package.json`（`version` が MCP サーバーの自己申告バージョンになる。`name` は読まれない — サーバー名は既定 `melta-ui`、後述の環境変数で変える）:

```json
{ "name": "my-ds", "version": "0.1.0", "private": true }
```

`design/contracts/tokens.json`（任意のネスト。末端に `value`、Tailwind クラス名があれば `tailwind`。`get_token` / `search` が読む）:

```json
{
  "color": { "brand": { "value": "#0f766e", "tailwind": "brand" } }
}
```

`design/contracts/rules.json`（1 ルールの最小例。フィールドの意味は次節）:

```json
{
  "version": "0.1.0",
  "rules": [
    {
      "id": "MYDS_NO_COMIC_FONT",
      "category": "typography",
      "severity": "error",
      "description": "Comic Sans はブランドトーンから外れる",
      "detector": "tailwind-class",
      "pattern": "font-comic",
      "alternative": "font-sans",
      "contractLint": "enforce"
    }
  ]
}
```

`metadata/components.json`（component が無いことの明示。空にすると component 系ツールは「1 件もない」エラーを返す）:

```json
{ "version": "0.1.0", "components": [] }
```

### 起動と成功判定

直接起動（`--melta-root` の相対パスは**このコマンドを実行するディレクトリ基準**で解決される）:

```bash
npx -y melta-ds-mcp@1.6.0 --melta-root=./my-ds
```

Claude Code に登録するときは**絶対パス**を渡す（MCP サーバーの cwd は不定なので、相対パスは別の場所を指しうる）:

```bash
claude mcp add my-ds -- npx -y melta-ds-mcp@1.6.0 --melta-root=/absolute/path/to/my-ds
```

**成功判定** — 接続後、`check_html` に `<p class="font-comic">hi</p>` を渡すとこの形が返る。`violations[0].ruleId` が**自分の**ルール ID で、`coverage.automated` の総数が**自分の**ルール数（ここでは 1）になっていれば、melta のルールは読まれていない:

```json
{
  "passed": false,
  "errorCount": 1,
  "warnCount": 0,
  "violations": [
    { "ruleId": "MYDS_NO_COMIC_FONT", "severity": "error", "token": "font-comic",
      "category": "typography", "reason": "Comic Sans はブランドトーンから外れる", "alternative": "font-sans" }
  ],
  "coverage": {
    "automated": "1 ルール中 1 件を自動検査（class: 1 / html-attr: 0 / composition: 0）",
    "notAutomated": "残り 0 件は…"
  }
}
```

（`notAutomated` は長文のため省略。比較するのは `violations` / `errorCount` / `coverage.automated`）

`passed` は **error が 0 件かどうか**で決まる。`severity: "warn"` の違反だけなら `passed: true` のまま `warnCount` に出る。

`search` に `brand` を渡すと自分のトークンが 1 件返る。逆に `get_component` は `isError: true`（「metadata/components.json に component が 1 件もありません」）になる — これは想定どおりで、この構成では component 系を使わない。**ただし診断が出るのは `get_component` だけ**で、`search` の component 結果と `melta://components` resource は無言で空になる。「component が見つからない」を `search` だけで判断しないこと。

登録名を `my-ds` にしても、サーバーの内部名は既定で `melta-ui`、resource URI は `melta://…` のまま。変えたい場合は環境変数 `MELTA_SERVER_NAME` / `MELTA_URI_SCHEME` を起動コマンドに添える。

### rules.json の書き方

**全ルール共通の必須フィールド**（`design/schemas/rule.schema.json`、tarball に同梱）: `id` / `category` / `severity`（`error` | `warn`）/ `description` / `detector` / `alternative` / `contractLint`（`enforce` | `warn` | `skip`）。

`contractLint` は `check_html` の強さ**ではない**。component contract の中に書かれた class を `design:check` で検査するときの扱い（contract 側の lint。効くのは class 自動検出ルールだけ）。lint-only の bundle なら `enforce` にしておけばよい。

**detector は 6 種**。自動検査に効くフィールドは detector ごとに違う。schema は形式しか見ないので、2 種類の失敗があることに注意:

- **spec そのものが無い**（`html-attr` に `htmlAttrCheck` が無い等）→ 起動は通るが「宣言はあるが検査されない」ルールになる。`check_html` の `coverage` で `automated` に数えられていなければこの状態
- **spec はあるが kind 別の必須フィールドが欠けている / 型が違う**（`tag-missing-attr` に `requiredAttr` が無い等）→ **起動時に ruleset エラーで止まる**（黙って素通りしない）

どちらも schema 検証では出ないので、起動して `check_html` の `coverage` を見るまでを成功判定にする。

| detector | 自動検査に必要なフィールド | 何を見るか |
|---|---|---|
| `tailwind-class` | `pattern`（class 名の完全一致）または `matchPatterns`（配列、いずれかに完全一致）。**両方あると `matchPatterns` だけが読まれ、`pattern` は無視される**（OR ではない） | class 属性のトークン |
| `tailwind-class-prefix` | `prefixPatterns`（前方一致）/ `matchPatterns`（完全一致 + `/modifier`）/ `pattern`（前方一致）のいずれか。`matchPatterns` があると `pattern` は読まれない | 同上 |
| `tailwind-class-segment` | `matchPatterns`（`-` で分割した segment のいずれかに完全一致） | 同上 |
| `html-attr` | `htmlAttrCheck`（`kind` と kind 別の必須: `attr-value-forbidden` / `attr-value-contains` → `attr` + `valueRegex`、`attr-present` → `attr`、`tag-present` → `tag`、`tag-missing-attr` → `tag` + `requiredAttr`、`element-present` → `tag` + `attr` + `attrValue`）。無ければ宣言のみ | HTML / JSX の属性 |
| `composition` | `compositionCheck`（`nested-selector` → `selector`、`dom-class-required` → `selector` + `requireAnyClass`、`dom-attr-required` → `selector` + `requireAnyAttr`。加えて `excludeWhen` / `when` に `text-glyph` を使うなら `glyphs` が必須）。無ければ宣言のみ | DOM 構造。**`sourceType="html"` のときだけ**走る（JSX では未検査） |
| `manual` | なし | 自動検査しない。`get_rules` には出る。「未自動検査」の宣言であって、代替の detector ではない |

各 detector の実例は参照実装（下記）の `rules.json` にある。schema 検証（`ajv` 等で `rule.schema.json` に通す）は形式のチェックにしかならないので、**必ず MCP を起動して `check_html` を叩くところまでを成功判定にする**。

### 推奨構成 — 5 ファイル目に `DESIGN.md`

MCP 接続時の instructions は「先に `melta://design-constitution` を読め」と AI に伝える。bundle root に `DESIGN.md` があればそれが配られ、無ければ resource から外れる（接続は失敗しない）。AI に「このプロジェクトのデザイン方針」を最初に読ませたいなら、短くてもよいので `DESIGN.md` を置く。

### 参照実装

`tests/fixtures/external-ds/acme-ds`（このリポジトリ内。**npm tarball には同梱されない**）— melta のデータを 1 つも含まない架空 DS。detector 6 種のうち 5 種（`tailwind-class-segment` 以外）と、component contract → metadata の生成、違反 / クリーンの検体を含み、CI（`tests/external-ds.spec.ts`）が毎回「melta のデータに fallback したら落ちる」形で端到端に検査している。上の 4 ファイル例は「コピー用の最小」、acme-ds は「CI で継続検証される完全例」という役割分担。

### 限界（正直に）

- **静的検査の範囲**: class トークンと HTML 属性は HTML / JSX のソース文字列を**正規表現で**、composition は HTML の DOM を見る。属性検査は DOM / AST パースではないので、属性値の中の生 `>` など、正規表現ベース特有の誤判定余地がある。JSX の変数経由 class・spread・実行時に組み立てる class・CSS の最終計算結果は追わない。意味・ブランド適合・実行時のインタラクションは判定しない
- **detector の追加はできない**: bundle はデータだけ（任意コード実行なし）なので、上の 6 種で表現できないルールは `manual` になる。新しい検査ロジックはエンジン側の変更が要る
- **component metadata の生成ツールは npm に未同梱**: `metadata/components.json` は本来 component contract からの生成物で、その生成スクリプト（`scripts/design/build-legacy.ts`）は tarball に入っていない。component 系ツールを本気で使うなら、手書きするか、このリポジトリを clone して `MELTA_ROOT=<bundle> npx tsx scripts/design/build-legacy.ts` を回す（`npm run design:build` は melta 固有構造前提の後続 generator を含むので使わない）。生成ツールの配布は Phase 2 の宿題
- **`engineCompat`**（`rules.json` に書ける engine バージョン範囲）は現在 semver 範囲の**文法**しか検査しない。実際の engine version との照合は未実装なので、互換保証としては機能しない
- 相対 `--melta-root` は起動プロセスの cwd 基準。永続設定には絶対パス

## stale 配布の物理防止 — `npm run check:pack`

npm 上の 1.4.0 が古い contracts を同梱したまま stale 化した事故を受けた消費者視点の smoke ゲート。CI（design-check）の必須ステップ。

1. `npm pack` した tarball を展開
2. registry の `melta-contracts` version とリポの contracts version を同期検査（registry が先行 = リポが stale なら fail、リポが先行なら「contracts を先に publish せよ」の warn、取得不能なら warn 継続）
3. 同梱スキーマ 3 種の存在と JSON parse
4. tmp consumer に `npm install <tarball>` して、公開 entry と互換 passthrough の**両 specifier**で lint が発火するか確認

あわせて `prepack` が `npm run build` を強制するため、dist の作り忘れによる空配布も起きない。

## パッケージ分割の予定

将来、検証エンジン（`melta`）とルールセット（`melta-contracts`）を eslint 型に分離する方向で検討している。`melta-ds-mcp` は互換を維持したまま段階的に移行する予定で、現在の entry（`melta-ds-mcp/lint-core` および `dist/*`・`design/*`・`metadata/*` の deep import）を予告なく壊すことはしない。時期・パッケージ名は未確定。
