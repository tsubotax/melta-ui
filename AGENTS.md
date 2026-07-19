# melta UI — AI エージェント作業ガイド

> AI coding agents（Claude Code / Codex / Cursor / Gemini CLI 等）共通の作業指示 SSOT。
> デザイン仕様は `DESIGN.md`、exact value は `design/contracts/` を参照。
> Claude Code 固有の挙動（PostToolUse hook / MCP 自動接続 / skills）は `CLAUDE.md`。

---

## アーキテクチャ概要

この DS は 3 層構造（AI-Ready 2.0）で運用されている。

- **Layer 1: 憲法** — `DESIGN.md` が AI 向け入口。原則 + Quick Reference。これだけで基本 UI を生成可能
- **Layer 2: 仕様** — `design/contracts/` に 40 contract（web 28 + app 先行 12）+ 105 禁止ルール + 101 トークンの JSON 仕様。これが SSOT
- **Layer 3: 検証** — `scripts/design/` の harness が Schema 整合・drift・a11y を自動検証。CI + hook で守る

> 詳細: `design/authority.md`（SSOT 宣言・値競合時の優先順位）、`README.md`（全体構造）

---

## 最初に読むファイル

| 目的 | ファイル |
|------|---------|
| デザイン仕様（Quick Ref 含む） | `DESIGN.md` |
| 作業手順 | `AGENTS.md`（本ファイル） |
| SSOT 宣言 | `design/authority.md` |
| loop / pipeline 自動化の統治原則 | `docs/melta-loop-playbook.md` |

---

## 読み込みモード

| モード | 読むファイル | 概算トークン | 用途 |
|--------|------------|------------|------|
| クイック | `DESIGN.md` のみ | ~4k | 単体UIの生成（ボタン、カード等） |
| 標準 | + `foundations/theme.md` + 関連 component md or contract | ~10k | ページ単位の生成 |
| MCP | MCP ツール（`get_token` / `get_component` / `check_rule` / `check_html` / `get_rules` / `search`）| 必要分のみ | AI ツール統合。生成後は `check_html` で自己検証 |
| フル | 全ファイル（下記の読み順に従う） | ~150k | 新規プロジェクト構築・DS変更 |

**フル読み順**: `DESIGN.md` → `foundations/design_philosophy.md` → `foundations/theme.md` → `foundations/` → `components/` or `design/contracts/components/` → `patterns/` → `design/contracts/rules.json`

---

## 作業ルール

1. **UI タスク開始時**に `DESIGN.md` を読む
2. **exact value** が必要なら `design/contracts/` を参照する
3. **コンポーネント仕様**は `*.contract.json` を優先（なければ `components/*.md` → `metadata/components.json`）
4. **禁止ルール**の SSOT は `design/contracts/rules.json`（105 ルール）
5. **finish 前**に `npm run design:check` と `npm run design:lint-generated -- <生成ファイル>` を走らせる
6. **generated file**（`metadata/components.json`、`llms.txt` / `llms-full.txt`、`design/contracts/recipes/web/`）を直接編集しない → `npm run design:build` で再生成
7. **新しい component** を作る場合、まず `design/contracts/components/` に contract を書く
8. **loop / pipeline / CI 自動修復**を扱う場合は `docs/melta-loop-playbook.md` を読む。SSOT write、baseline 緩和、test 弱体化、publish/deploy は human gate
9. **recipes の2層規約**: `recipes/web/` = 契約から生成される導出ミラー（編集禁止）/ `recipes/app/` = RN styleRefs の手書き authoring source。app recipe の値は `{"token": "<tokens.json ノードパス>"}` か literal（色の hex 直書き禁止）。variants / sizes / states のキーは契約の部分集合（語彙の発明は `design:check` が error）。契約を変えたら `design:compat`（npm 公開版との互換ゲート）が semver bump を要求する

---

## npm scripts

```bash
npm run design:check          # static harness（ルール検証・contract検証・SSOT整合性）
npm run design:lint-generated # 生成 HTML/TSX の禁止パターン検査（error で exit 1）
npm run design:drift          # ドキュメント ↔ contracts の drift 検出
npm run design:compat         # 互換ゲート（npm 公開版 vs HEAD、breaking 分類 + semver 強制）
npm run design:recipes        # 契約 → recipes/web/ 生成（app recipe は手書き）
npm run design:build          # contract → metadata/components.json + llms.txt 生成
npm run validate              # tokens.json vs ds-config.js / ds-theme.css の整合性
npm run build                 # TypeScript → dist/（MCP サーバー）
```

---

## タスクベース読み込みガイド

| タスク | 読み込むファイル（順序） |
|--------|------------------------|
| 単体コンポーネント生成 | `DESIGN.md` のみ |
| ページ生成 | + `foundations/theme.md` → `patterns/layout.md` → 関連 component md |
| ダークモード対応 | + `foundations/theme.md`（CSS変数）→ `foundations/color.md`（Dark列） |
| フォーム画面 | + `patterns/form.md` → textfield / select / checkbox / button |
| データ一覧 | + `table.md` → `pagination.md` → `badge.md` |
| ダッシュボード | + `foundations/theme.md` → `layout.md` → card / table / progress / badge |
| 設定画面 | + `tabs.md` → toggle / select / radio |
| モーダル / 確認 | + `modal.md` → `button.md` |
| Loading / 空状態 | + `skeleton.md` → `interaction-states.md` |
| 通知フィードバック | + `toast.md` → `alert.md` → `interaction-states.md` |
| サイドバー付きページ | + `sidebar.md` → `layout.md` |
| ナビゲーション | + `navigation.md` → `sidebar.md` → tabs / breadcrumb |
| レスポンシブ対応 | + `patterns/responsive.md` → `layout.md` |
| アクセシビリティ確認 | + `foundations/accessibility.md` |
| アイコン選択 | + `foundations/icons.md` |
| ウィザード / ステップ画面 | + `stepper.md` → `button.md` |
| 日付入力フォーム | + `datepicker.md` → `textfield.md` → `form.md` |
| セクション分割 | + `divider.md` → `layout.md` |
| テーマカスタマイズ | `foundations/theme.md` → `foundations/color.md` |
| DS変更 / 新コンポーネント | フル読み込み |

---

## Foundation / コンポーネント一覧

**Foundations (13)**: color, spacing, typography, elevation, radius, motion, z-index, icons, accessibility, emotional-feedback, design_philosophy, theme, prohibited — 各 `foundations/{name}.md`

**Components (28)**: button, card, checkbox, modal, sidebar, textfield, select, dropdown, radio, toggle, toast, list, badge, tag, table, tooltip, tabs, breadcrumb, pagination, avatar, progress, alert, accordion, skeleton, datepicker, divider, stepper, copy-button — 各 `components/{name}.md`

**Contracts**: `design/contracts/components/*.contract.json` — 機械可読仕様（web 28 + app 先行 5）

**Patterns (5)**: layout, form, navigation, interaction-states, responsive — 各 `patterns/{name}.md`

---

## テーマ・ダークモード

> テーマ設定・CSS変数定義: `foundations/theme.md` 参照。

| 設定 | 値 |
|------|-----|
| **ダークモード** | `OFF` |

- `OFF`: ライトモードのみで設計・生成する（デフォルト）
- `ON`: ダークモード対応を含めて設計・生成する（`foundations/theme.md` + `foundations/color.md` Dark列）

---

## デプロイ

| 項目 | 値 |
|------|-----|
| ホスティング | Netlify（手動デプロイ） |
| 本番URL | https://melta.tsubotax.com |
| publish ディレクトリ | `.`（リポジトリルート）— `netlify.toml` で設定済み |

```bash
# 本番デプロイ（--dir 指定不要。netlify.toml の publish = "." が使われる）
netlify deploy --prod
```

> **注意**: `netlify deploy --prod --dir=docs` は NG。`publish = "."` なのでルートからデプロイしないとリダイレクトが 404 になる。
