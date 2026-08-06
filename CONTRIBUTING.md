# Contributing to melta UI

個人メンテナンスの OSS です。issue / PR は歓迎しますが、応答は best effort です。
このドキュメントは「**手元で CI と同じ検査を再現する**」ための手順書です。

> AI エージェント（Claude Code / Codex / Cursor 等）で作業する場合は [AGENTS.md](./AGENTS.md) が
> 作業ルールの SSOT です。デザイン仕様は [DESIGN.md](./DESIGN.md)、SSOT 宣言は
> [design/authority.md](./design/authority.md) を参照してください。

---

## 開発環境セットアップ

- **Node.js**: `package.json` の `engines` 宣言に従います（現在 `>=22`。CI は 22 で検証）
- 依存の取得は **`npm ci`**（`npm install` ではなく lockfile 固定で入れる。CI と同じ状態を再現するため）

```bash
git clone https://github.com/tsubotax/melta-ui.git
cd melta-ui
npm ci
```

Playwright を使うテスト（`npm test` / `npm run test:reset-vrt`）は初回だけブラウザの取得が必要です。

```bash
npx playwright install --with-deps chromium
```

---

## ローカル CI ミラー

[`.github/workflows/design-check.yml`](./.github/workflows/design-check.yml) が回す検査を、
そのままの順序でローカルに写したものです。**PR を出す前にこれを通してください。**

### 1. check ジョブ（`design-check.yml` の `check`）

```bash
npm run design:check                 # schema / rules / contracts の静的 harness
# 変更した .html/.tsx/.jsx/.vue の禁止パターン検査（CI と同じ対象抽出。対象なしなら何も走らない）
git diff --name-only --diff-filter=d "$(git merge-base main HEAD)" HEAD \
  | grep -E '\.(html|tsx|jsx|vue)$' \
  | grep -v '^tests/fixtures/external-ds/[^/]*/samples/' \
  | xargs -r npm run design:lint-generated --
npm run design:lint-generated -- --baseline .design-baseline.json examples/*.html docs/*.html
npm run design:drift                 # docs ↔ contracts の drift（README 日英 parity を含む）
npm run design:designmd-lint         # DESIGN.md を Google 公式 design.md linter で検証
npm run design:compat -- --require-network   # npm 公開版 vs HEAD の破壊的変更 × semver ゲート
npm run design:llms && git diff --exit-code llms.txt llms-full.txt         # 生成物の鮮度
npm run design:build && git diff --exit-code metadata/components.json      # 生成物の鮮度
npm run validate                     # tokens.json ↔ ds-config.js / ds-theme.css の整合
npm run build                        # TypeScript → dist/（MCP サーバー）
npm run check:pack -- --require-network      # npm pack → 展開 → consumer import の smoke
```

- full scan で使う `.design-baseline.json` は **warn のラチェット**です。既存 warn を
  増やさないための基準線なので、勝手に緩めないでください（緩和は human gate）
- 変更ファイル lint の対象抽出は CI と同じ条件にしてあります: **merge-base 基準**・
  **削除ファイル除外**（`--diff-filter=d`）・**`tests/fixtures/external-ds/*/samples/` 除外**
  （外部 DS の意図的な違反検体。melta の違反として誤検出されるため。その検査は
  `tests/external-ds.spec.ts` が担当）
- `--require-network` の 2 つは npm registry の公開版を照会します。オフラインでは
  フラグを外すと skip されますが、**PR 前は必ずネットワークありで通してください**

### 2. test ジョブ

```bash
npm test                             # Playwright + axe（webServer は自動起動）
```

### 3. reset-vrt ジョブ（non-blocking）

```bash
npm run test:reset-vrt               # リセット CSS 5 種差し替え VRT（pixelmatch diff 0）
```

CI では `continue-on-error: true` の非ブロッキング枠です（Linux での決定性を確認中）。
落ちても PR は止まりませんが、差分が出たら報告してください。

### まとめて回す

```bash
npm run design:check && npm run design:drift && npm run design:designmd-lint \
  && npm run validate && npm run build && npm test
```

ネットワーク検査（`design:compat` / `check:pack`）と生成物の鮮度検査は、上記に加えて
commit 前に一度通してください。

---

## SSOT と生成物 — 直接編集しないファイル

melta は「**authoring source（人が書く）**」と「**generated view（ビルドで作る）**」を分離しています。
生成物を手で直すと次のビルドで消え、CI の鮮度検査が落ちます。宣言の正本は
[design/authority.md](./design/authority.md) です。

### 人が編集する（authoring source）

| 対象 | ファイル |
|---|---|
| デザイントークン | `design/contracts/tokens.json` |
| コンポーネント契約 | `design/contracts/components/*.contract.json` |
| 禁止ルール | `design/contracts/rules.json` |
| APP 向けレシピ | `design/contracts/recipes/app/*.recipe.json`（手書きの authoring source） |
| デザイン憲法の本文 | `DESIGN.md`（本文・原則・Quick Reference の意味） |
| 人間向けドキュメント | `foundations/*.md` / `components/*.md` / `patterns/*.md` |

### 生成物（直接編集しない）

| 生成物 | 生成コマンド | 生成元 |
|---|---|---|
| `metadata/components.json` | `npm run design:build` | `design/contracts/components/*.contract.json` + `rules.json` + `recipes/app/*.recipe.json` |
| `llms.txt` / `llms-full.txt` | `npm run design:llms` | contracts + DESIGN.md ほか |
| `design/contracts/recipes/web/*.recipe.json` | `npm run design:recipes` | 契約の `tailwind` フィールド |
| `design/contracts/tokens.dtcg.json` | `npm run design:dtcg` | `design/contracts/tokens.json` |
| `DESIGN.md` の YAML front matter | `npm run design:designmd` | `design/contracts/tokens.json` + `recipes/web/*.recipe.json` |
| `scripts/ds-theme.css` / `scripts/ds-config.js` / `docs/melta-pen-variables.json` | `npm run generate` | `design/contracts/tokens.json` |
| `README.md` / `README.en.md` の coverage ブロック | `npm run design:coverage` | `design/contracts/rules.json` + 契約の `stateSpecs` |
| `docs/index.html` の統計・バージョン表示 | `npm run design:update-showcase` | contracts + `package.json` |
| `dist/` | `npm run build` | `src/` |

`npm run design:build` は build-legacy → recipes → DESIGN.md front matter → DTCG → llms.txt → tsc
をまとめて回すので、契約を触ったらまずこれを実行してください。

### 人間の承認が要る変更（write-protect）

自動化ループ・パイプラインが勝手に書き換えてはいけない領域が
[docs/melta-loop-playbook.md](./docs/melta-loop-playbook.md) に列挙されています。
PR でこれらに触れる場合は、**変更理由を PR 本文に書いてください**（レビューで必ず見ます）。

- `design/contracts/**` / `design/schemas/*.schema.json` / `design/authority.md`
- `DESIGN.md` の本文・原則・Quick Reference の意味
- `AGENTS.md` の作業ルール・読み込み経路・human gate の意味
- `.design-baseline.json`（warn ラチェットの緩和）
- テストの削除・アサーションの弱体化
- 既存ルールの severity / detector / pattern / alternative の変更
- MCP の公開契約（ツール名・入力 schema・出力形・リソース URI・外部から見える応答意味）
- publish / deploy / version bump / 保護ブランチへの commit・push

### README を編集するとき

`README.md`（日本語・正本）と `README.en.md`（英語）は **機械照合された対**です
（`npm run design:drift` が `check-readme-parity.ts` を呼びます）。片方だけ直すと落ちます。

照合されるのは 4 点 — セクションキー（`<!-- sec: ... -->`）の集合と順序 / セクションごとの
コードブロック数 / 外部リンク URL の集合 / 主要数値の同値出現。**必ず両方を同じ構造で更新**してください。

### 新しいコンポーネントを足すとき

1. `design/contracts/components/<name>.contract.json` に契約を書く（実装より先）
2. `npm run design:build` で生成物を更新する
3. `npm run design:check` / `npm run design:drift` を通す
4. 契約に破壊的変更が含まれるなら `npm run design:compat` が semver bump を要求します

---

## PR を出す前のチェックリスト

- [ ] `npm ci` した状態で上記のローカル CI ミラーが全部緑
- [ ] 生成物を手編集していない（生成コマンドを回して差分を commit した）
- [ ] `README.md` を触ったなら `README.en.md` も同じ構造で更新した
- [ ] contract / rules / tokens を触ったなら、その理由を PR 本文に書いた
- [ ] 破壊的変更があるなら `npm run design:compat` を通し、semver bump の要求に従った
- [ ] `CHANGELOG.md` に Added / Changed / Removed を追記した（利用者に見える変更の場合）
- [ ] コミットは論理単位で分けた（生成物の再生成は本体変更と同じコミットに含める）

## PR について

- ベースブランチは `main` です
- **fork からの PR でも CI は全ジョブ走ります**。ワークフローは secrets を一切使わず、
  ネットワークも npm registry の公開エンドポイントしか触らないためです（`pull_request` イベント
  なので fork PR は read-only の `GITHUB_TOKEN` で動きます）
- 大きな設計変更（契約の構造・ルールの意味・MCP の公開契約）は、実装前に issue で相談してください
- セキュリティ上の問題は issue ではなく [SECURITY.md](./SECURITY.md) の経路で報告してください

## ライセンス

コントリビューションは [MIT License](./LICENSE) の下で受け入れられます。
