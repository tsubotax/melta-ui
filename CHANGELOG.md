# Changelog

## [Unreleased]

## [1.5.0] - 2026-08-04

### 配布整備 — stale 配布の物理防止 + 公開 entry の明示 + vendor 経路の堅牢化

npm 上の 1.4.0 が 7/19 時点の contracts 0.5.0 を同梱したまま stale 化していた事故を受けた配布まわりの整備。あわせて、将来の engine / ruleset 分離に向けた非破壊の前準備を入れた。

#### Added

- **consumer pack smoke test（`npm run check:pack`）** — `npm pack` した tarball を展開し、① 同梱 `design/contracts/package.json` の version がリポの contracts version と一致するか ② 展開先の `dist/utils/lint-core.js` を deep import して lint が実際に動くか、を消費者視点で検査する。CI（design-check）の必須ステップに追加し、stale 配布を物理的に再発させない（`scripts/design/pack-smoke.ts`）
- **`prepack` script** — pack / publish の直前に必ず `npm run build` が走る。dist の作り忘れによる空配布を封じる
- **`exports` フィールド** — `.` / `./lint-core` / `./loader` / `./package.json` の公開 entry を明示。既存の deep import（`melta-ds-mcp/dist/*` / `./design/*` / `./metadata/*`）は pattern で維持し非破壊。解決経路は実際の Node 解決器で検査（`tests/package-exports.spec.ts`）
- **`--melta-root=<path>` 引数でのアセット root 差し替え** — 優先順位は `--melta-root` > `MELTA_ROOT` > パッケージ相対。MCP の起動コマンドに直接書けるようになった（従来の `MELTA_ROOT` 経路は完全互換で維持）
- **`design/schemas` を配布物に追加** — component contract / recipe / rule の 3 スキーマを公開資産化。vendor 先が自前の契約を melta のスキーマで検証できる
- **`design/contracts/package.json` を配布物に追加** — 同梱 contracts の version を消費者が確認できる（pack smoke の照合対象）
- MELTA_ROOT / `--melta-root` 経路のテスト補強 — fixture に `design/contracts/tokens.json` を追加し、`get_token` / `search` が root 差し替えで動くことと、引数が env より優先されることを固定（`tests/mcp-server.spec.ts`）

#### Changed

- **`loadTokens` / `loadComponents` に診断付き try/catch** — アセット欠落時に生の ENOENT を投げていた経路を、期待パス・解決した root・`--melta-root` / `MELTA_ROOT` の案内を含むメッセージに統一（`loadRules` / `loadDesignConstitution` と同じ流儀）

#### Removed

- **`loadScreens` を削除** — `metadata/screens.json` を読む loader だが src / scripts のどこからも呼ばれていないデッドコードだった。`metadata/screens.json` 自体は配布物として残す

## [1.4.0] - 2026-07-19

### DADS 取り込み — Baseline 線引き + disabled 併記 + 44px タップ領域 + リセットCSS VRT

デジタル庁デザインシステム（DADS）4 リポの深掘り調査から採用を決めた 4 項目を導入（設計と Codex レビュー反映は `docs/dads-adoption-plan.md`）。ルールは 99 → **105 件**、contracts は **0.5.0**（npm publish 済）。

#### Added

- **BASELINE_* ルール 5 件（warn）** — CSS/HTML 機能を Baseline **Widely available** に限定する原則を DESIGN.md 原則 8 に明文化し、AI が出しがちな未普及機能（Anchor Positioning / Invoker Commands / popover / View Transitions / text-box-trim）を denylist 検知。attr-lint に新 kind `attr-present`（開始タグ抽出 + 引用符内除去で属性値内の同名語を誤検知しない）
- **A11Y_DISABLED_REQUIRES_ARIA（warn）** — 契約既存の規範（button stateSpecs.disabled = `disabled` + `aria-disabled` 併用）を composition lint で HTML に機械強制。タブ順維持が要る文脈の `aria-disabled` 単独 + JS ガードパターンは DESIGN.md に注記
- **リセットCSS差し替え VRT**（`npm run test:reset-vrt`）— Normalize / Bootstrap Reboot / Tailwind Preflight / Eric Meyer / kiso.css の 5 種を melta スタックより前に注入し、pixelmatch threshold 0 + includeAA の literal 比較で **diff 0px** を検証。fixture は契約 htmlSample から実行時組み立て（コピー drift なし）、スナップショット無しの同一セッション内比較 + A/A 決定性テスト（DADS 方式）。CI には non-blocking で組み込み（安定確認後に required 昇格）
- **Host-Reset Defense 層（ds-theme.css）** — 監査で発見した 3 系統の漏れを封鎖: ① Reboot 系の body 直指定 font/color が Preflight の html レベル指定を貫通 ② Meyer 系の要素セレクタ `border: 0` が Preflight の `*`（specificity 0）に常勝して枠線消失 ③ kiso.css の日本語タイポプロパティ（text-autospace 等）継承でテキスト幅シフト
- **タップ領域拡張の受け入れテスト**（`tests/tap-target.spec.ts`）— ジオメトリ不変 / elementFromPoint 拡張帯ヒット / overflow クリップ制約 / disabled 無効化を実ブラウザで固定

#### Changed（contracts 0.5.0 / button 2.1.0）

- **BTN_MIN_TAP_TARGET を manual → composition 自動検出に昇格**（新 kind `dom-class-required` + `excludeWhen: icon-only`。無防備 error 43 → 42）。button 契約 sizes.small/medium に `after:` 擬似要素のタップ領域拡張を追加（見た目不変・実効 44px、WCAG 2.2 基準）。touchTarget prose の「web は h-8 まで許容」との矛盾を解消。icon-only の幅拡張は第二弾
- 社内コーパス migration: aria-disabled 併記 10 箇所 + タップ領域拡張 167 箇所 + 契約 htmlSample 5 箇所（examples / docs/index.html / verification）
- 新規則で既存合法 HTML の判定が変わる変更を行動互換性破壊とみなし contracts を 0.5.0 に（プロジェクト判断。compat 機械分類は additive でも minor bump）

#### Added（contracts 0.4.3）

rally-nav（melta-app 初の dogfood 消費者）からのフィードバック 2 件をトークン契約に反映。

- **semantic color `text-accent`** — light `#2b70ef`（primary-500）/ dark `#6492ff`（primary-400）。タブ active 状態・リンク的テキスト用。`foundations/color.md` に既記載だった概念を tokens.json に契約化（light の 4.50:1 は 1.3.1 で明文化済みの axe 基準を踏襲）
- **fontSize `xxs`** — 10px / 0.625rem / lh 1.4。タブラベル等の最小ラベル専用（本文には使わない）。text contract に variant `xxs` 追加（text 0.2.0）

#### Removed

- **旧 tokens パス `tokens/tokens.json` を削除** — `design/contracts/` への移行時に互換 symlink として残っていたもの。最後の参照元だった `tools/` 4 スクリプトを SSOT 直参照に統一し、孤児化したため撤去（npm 配布物には元から非同梱）。復活は `npm run design:check` がファイル・symlink を問わず検出する（`design/authority.md` の移行ルール 6）

## [1.3.1] - 2026-07-03

### DESIGN.md 品質ループ（Google 公式ツール導入 + contrast 判断）

手順の言語化は `docs/designmd-quality-loop.md`（他 DS へ移植可能なプレイブック）。

#### Added

- **DESIGN.md components 全量生成** — front matter の components を recipes/web 全 variant から抽出生成（2 → 85 個）。色は token 参照優先 + 未知色 fail-loud（`scripts/design/export-designmd.ts`）
- **Google 公式 linter を CI ゲート化** — `@google/design.md@0.3.0` で spec 準拠 / token 参照 / WCAG contrast を検証。errors 0 をゲート、warnings はデザイン判断の題材としてレポート（`npm run design:designmd-lint`）
- **DESIGN.md にコントラスト境界の意図宣言** — `primary-500 × 白` の 4.50:1 は axe 基準（pass）を採用して意図的に維持、と原則 2 直下に明文化

#### Changed（contracts 0.4.1）

- **danger ramp を一段シフト** — base `#ef4444` → `#dc2626`（白文字 3.76 → 4.83:1 で AA 通過）、text-light `#dc2626` → `#b91c1c`。warning 系と同じ base=600 番手 / text=700 番手構造に統一し、従来のラベル不整合も解消
- **primary-50 背景の文字を primary-600 に** — lighted ボタン / avatar initials / sidebar active（4.12 → 5.85:1）。docs / examples 123 箇所追従
- MCP パッケージ（melta-ds-mcp 1.3.1）と melta-app 0.4.1 同期で web / APP / MCP の全配信面に伝播

#### Fixed

- `design:build` の生成順序 — export-designmd が export-recipes より先に走り、recipe 由来の components が 1 周遅れるバグ

## [1.2.0] - 2026-04-11

### AI-Ready 2.0 アーキテクチャ

CLAUDE.md 一枚に全部入りだった v1 から、3 層分離（憲法 / 仕様 / 検証）の v2 に移行。

#### Added

- **DESIGN.md** — AI が最初に読むデザイン憲法 + Quick Reference（8.6KB）
- **design/contracts/** — 機械可読な SSOT
  - `tokens.json` — 99 デザイントークン（旧 tokens/ から移動）
  - `rules.json` — 89 禁止ルール registry（ID + severity + detector）
  - `components/*.contract.json` — 28 コンポーネント contract（全件 enriched）
- **design/schemas/** — rule + component-contract の JSON Schema
- **design/authority.md** — Source of Truth 宣言
- **scripts/design/**
  - `validate.ts` — Schema 検証 + ルール整合 + tokenRef 確認（`npm run design:check`）
  - `drift-check.ts` — ドキュメント ↔ contracts の drift 検出（`npm run design:drift`）
  - `build-legacy.ts` — contract → metadata/components.json 互換生成（`npm run design:build`）
  - `update-showcase.ts` — showcase の数値を contracts から自動更新
  - `hook-check-rule.sh` — PostToolUse hook で HTML 禁止パターン自動検出
- **tests/showcase.spec.ts** — Playwright + axe-core（9 テスト）
- **design/benchmarks/** — Agent benchmark（5 standard + 3 red-team prompt + rubric）
- **.github/workflows/design-check.yml** — CI で design:check + drift + test を自動実行

#### Changed

- **CLAUDE.md** — 18KB → 5.5KB（-70%）。デザイン仕様を DESIGN.md に委譲、作業手順書に変身
- **src/utils/loader.ts** — ハードコード 19 件 → `rules.json` 読み込み（32 パターン自動検出、fail-fast）
- **metadata/components.json** — 手書き → contracts から 100% 生成
- **foundations/prohibited.md** — SSOT を `rules.json` に移譲。人間向け解説文書に格下げ
- **docs/index.html** — AI-Ready 2.0 セクション追加、数値を contracts から自動反映、読み込みモード更新
- **README.md** — 2.0 アーキテクチャに全面書き直し

#### Fixed

- MCP check_rule のパターン乖離（prohibited.md 76 件 vs loader.ts 19 件 → rules.json 89 件に統一）
- showcase のハードコード数値 drift（version, コンポーネント数, トークン数, ルール数）
- checkbox/radio contract の不要な aria-checked 指定
- select contract の role を native control に合わせて修正

---

## [1.1.1] - 2026-03-25

- docs/index.html レスポンシブ対応
- 作業用画像削除（3.8MB 削減）
- デプロイ手順を CLAUDE.md に追記
- OGP バリエーション追加

## [1.1.0] - 2026-03-20

- 初回公開
- 28 コンポーネント + 10 ファウンデーション + 5 パターン
- MCP サーバー（get_token / get_component / check_rule / search）
- Showcase サイト
- 12 サンプルページ
