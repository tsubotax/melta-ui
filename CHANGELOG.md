# Changelog

## [Unreleased]

### Fixed

- **reset-vrt の `kiso.css` 差分（CI Linux 限定・毎回 31548px）を解消し、job を required へ昇格** —
  `design-check.yml` の `reset-vrt` job は 2026-07-19 の新設から一度も green になっておらず、
  `continue-on-error: true` で non-blocking だったため 2 か月気づかれなかった（main の 32 run 連続 fail。
  落ちるのは 6 本中 `kiso.css` の 1 本だけで、ローカル macOS では 6 passed）。原因は kiso.css の
  `:where(:root){ scrollbar-gutter: stable }` が Linux のクラシックスクロールバー環境で
  スクロールバー幅ぶんの余白を予約し（`fullPage` 撮影でスクロールバー自体が出なくても予約は効く）、
  本文幅が縮んでページ全体が再レイアウトされていたこと。Host-Reset Defense
  （`tools/generate-css.ts` の `hostResetDefense`）に 4 項目目として
  `html { scrollbar-gutter: auto; }`（melta の規範 = ブラウザ既定。`:where()` は specificity 0 なので
  `html` が読み順に関係なく勝つ）を追加して塞ぎ、`continue-on-error` を削除した（#14 / #17）
- **reset-vrt の失敗時に diff / baseline / with-reset の PNG が artifact に残るようにした** —
  `testInfo.attach(name, { body })` はデフォルトの list reporter だと中間ファイルを作らないため、
  `test-results/` を upload しても `error-context.md` しか入らず差分の位置が確認できなかった。
  `testInfo.outputPath()` へ書き出してから `{ path }` で attach する形に変更（#14）
- **judge の適合 fixture がタップ領域拡張を持たず composition lint で error 1 件だった問題**
  （`BTN_MIN_TAP_TARGET`）— `design/judge/fixtures/negative-control.conforming.html.txt` の送信
  ボタンに `relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2`
  を付与し（button recipe 準拠。`h-10` の見た目は変えずタップ領域だけ 44px へ）、`lintSource` /
  composition ともに error 0 にした。「規範に適合した対照」の看板と lint 結果の矛盾を解消
  （`tests/judge.spec.ts` の期待値は既知 1 件の固定から `[]` へ。増えたら落ちる。#15）

## [1.7.0] - 2026-09-06

### 同梱 contracts を 0.8.1 へ更新（ルール 107 本目 + engine の空白属性の締め）

npm の 1.6.0 は contracts 0.8.0 相当（106 ルール）を同梱したままで、MCP（`get_rules` /
`check_html`）が `A11Y_NAV_ARIA_LABEL_REQUIRED` と dom-attr-required 系ルールの空白属性の
扱いを配れていなかった。同時期に入ったスキル配布と `.cursor/` の整理はリポ側の変更で、
npm パッケージ（`files`）には含まれない。

### Added

- **`A11Y_NAV_ARIA_LABEL_REQUIRED`（ルール 107 本目）** — `<nav>` / `role="navigation"` に
  アクセシブルネーム（`aria-label` または `aria-labelledby`）が無いと error。スクリーンリーダーの
  ランドマーク一覧で複数のナビゲーションを区別できないため、nav が 1 つの画面でも常に付与する。
  detector=composition / kind=dom-attr-required の自動検出（lint / MCP `check_html` / PostToolUse
  hook が同経路で発火）。design-review skill の checklist にあった `[評価不可候補: ルール無し]` を
  1 件解消し、静的自動検証は 48 / 106 → 49 / 107（composition 7 → 8）になった
  （contracts 0.8.1。sidebar / breadcrumb / pagination の contract から参照）
- **`.agents/skills/` に design-review / ban-pattern / build-screen を symlink で配布**（Cursor /
  Codex が `.agents/skills/<name>/SKILL.md` から発見する）+ 入口の妥当性検査
  `tests/agents-skills-entry.spec.ts`（入口を別スキルへ張り替えても通る素通りを塞ぐ）
- **design-review skill の checklist を `rules.json` から生成** — `npm run design:skill-index` が
  `skills/design-review/references/rules-index.md` を決定論生成し（`design:build` チェーン +
  CI freshness）、checklist の `[ID]` は実在するルールしか書けない構造に
  （`tests/skill-rule-refs.spec.ts`）。error → High / warn → Medium、ルール無しは「評価不可」

### Changed

- **composition engine: dom-attr-required 全 5 ルールで空白のみの属性値を不在扱いに** —
  `aria-label=" "` のように「書いてあるだけ」の属性が検査を素通りしていた穴を塞ぐ
  （`BTN_ICON_ONLY_ARIA_REQUIRED` / `TAG_X_ARIA_LABEL_REQUIRED` / `SKELETON_ARIA_BUSY_REQUIRED` /
  `A11Y_DISABLED_REQUIRES_ARIA` / `A11Y_NAV_ARIA_LABEL_REQUIRED`。lint / `check_html` /
  PostToolUse hook の同経路で発火。支援技術は前後の空白を詰めた名前を使うため空文字と区別しない）

### Workflow Skill `build-screen` — 画面 1 枚の生成を契約引き当てから自己検証まで 1 手順に

#### Added

- **`isCheckedByGeneratedLint()`（`scripts/design/coverage-stats.ts`）** — 生成物 lint（`lintSource` + composition = CI / hook / `check_html` / `design:lint-generated`）が**実際に検査する**ルールの述語。既存の `isStaticallyDetectable` との差は `requiresContext`（文脈依存の class ルールは context-free な生成物 lint から除外される）。実測 42 件で `check_html` の coverage と一致する

- **`skills/build-screen`（+ `.agents/skills/build-screen` symlink）** — `AGENTS.md` の「タスクベース読み込みガイド」で契約を引き当て → 最大 3 問の意図確認 → 生成 → Step 4 自己検証（MCP 経路 = `check_html` / CLI 経路 = `npm run design:lint-generated`。検査は最大 3 回）→ Step 5 報告（経路ごとに書式が違う。CLI 経路は `passed` も coverage も返らないので「未取得」と明記する。結論は error 0 / error 残り / 検査未完了の 3 分岐。評価不可は `automationStatus` 別 + 未宣言は「未分類」で ID 付きに）、までを 1 本の手順にした Workflow Skill。参照の実体は MCP と contracts に置き、表や仕様は複製しない（drift させないため）
- **`tests/build-screen-skill.spec.ts`（7 本）** — frontmatter の形（引用符つき / 大文字混じりでも Claude Code 拡張キーを拒否、description はブロックスカラー禁止）/ SKILL.md が参照するリポ内パス・npm script・MCP ツール名・ルール ID の実在 / Step 3 の「Step 4 が拾う例 / 拾わない例」が生成物 lint の実際の検査条件と一致 / AGENTS.md の見出しと引き当て表の実在 / 「やらないこと」5 項目の個別存在 / Step 5 の報告 3 分岐と coverage 捏造文言の不在 / Step 2 の質問集合がちょうど Q1〜Q3。手順書が指す先が消えても、記法を変えて抽出を空振りさせても、無言で成立しないようにする

### `.cursor/` を「値を持たないポインタ」へ（並行正典の解体）

`.cursor/rules/` の 3 本は tokens / component contract の値を手書きで複製した第二の正典で、
最終更新 2026-07-15 のまま drift 検査の外にあった（`melta-ui.mdc` の原則「セマンティックな
背景クラスを使う」と `components.mdc` の全レシピが矛盾したまま半年並んでいた）。値を配るのは
contracts / llms.txt / MCP の仕事なので、Cursor 向けには所在ポインタ 1 本と MCP 設定だけを残す。

#### Added

- **`.cursor/mcp.json`** — Cursor は Claude Code の `.mcp.json` を読まないため、`mcpServers` を
  同一内容で置く。clone した Cursor ユーザーに同じサーバーの設定が同梱される（有効化は Cursor
  側の操作に従う。公式 docs はプロジェクト設定の検出後に承認を挟むかを明記していない）
- **`tests/cursor-entry.spec.ts`** — ①追跡されている `.mdc` はポインタ 1 本だけ ②frontmatter を
  YAML としてパースし（`yaml` を devDependency に追加）、Cursor が解釈する 3 キーのみ・重複なし・
  `alwaysApply` は boolean の `true`・`description` は非空の文字列 ③frontmatter と本文に
  値が無い ④参照するリポ内パスが git 管理下に実在する ⑤MCP ツールの列挙が `src/server.ts` と
  集合として完全一致 ⑥`.cursor/mcp.json` と `.mcp.json` の `mcpServers` が deep-equal。
  ③の禁止語彙は**実行時に SSOT から導出する**（`tokens.json` の `tailwind` / `cssVar` / 色の
  `value` / 色スケール名 + contract `htmlSample` の class + `rules.json` の `pattern` 系。
  禁止側にしか無い `text-black` のような語はルールから拾い、色名には `bg-` / `text-` 等の
  ユーティリティ接頭辞を明示展開する）。手書きの語彙表を置くとそれ自体が第三の正典になるため。SSOT に無い値（`16px` / `rgb(...)` / 未知パレット / キーワード色）は
  汎用リテラルで、見た目が同じ非 ASCII ハイフンによる回避は NFKC 正規化 + 畳み込みで塞ぐ

#### Changed

- **`.cursor/rules/melta-ui.mdc` を所在ポインタへ書き換え** — frontmatter は `description` +
  `alwaysApply: true`（`globs` は廃止）。本文は `AGENTS.md` / `DESIGN.md` / `design/contracts/` /
  `.agents/skills/` の所在、値が競合したときの優先順位、`check_html` の位置づけ（lint-clean
  draft でありブランド承認ではない）だけを持つ
- **README.md / README.en.md** の前提条件表と clone 経路（経路 B）に `.cursor/mcp.json` を明記
- **AGENTS.md** に「Cursor 固有の入口は `.cursor/`、仕様・値は置かない」を追記

#### Removed

- **`.cursor/rules/color-system.mdc` / `.cursor/rules/components.mdc`** — tokens / component
  contract の値の手書き複製。同じ内容は `design/contracts/` と `llms.txt`、MCP（`get_token` /
  `get_component`）が配っており、複製側だけが検査の外だった

## [1.6.0] - 2026-08-06

### 同梱 contracts を 0.7.0 へ更新（W5 契約層の配信）

npm の 1.5.0 は contracts 0.6.0 相当のデータを同梱したままで、MCP（get_token / get_rules /
check_html）が以下の更新を配れていなかった。データ同期のためのリリース（コード変更なし）。

#### Changed

- **dark の `bg-page-alt` = `#334155`** — 旧値 #1e293b は `bg-surface` と同値（コントラスト比
  1.00:1）で、Tag basic / TextField disabled がカード上で不可視になる実害バグだった
  （foundations/color.md の surface-tertiary と両モードで一致する値へ分離）
- **ルール 106 本** — 横断 a11y ルール `A11Y_MIN_TAP_TARGET_44` を新設（タップ標的 44pt の
  横断方針を accessibility カテゴリへ昇格。BTN_/TAG_X_MIN_TAP_TARGET はその実装形として相互参照）
- **recipes/app の button / textfield を `minHeight` 表現へ**（fontScale クリップ対策の契約側。
  button は `iconOnlyHeight` を追加し iconOnly の正方形固定を明示）、checkbox の description を
  「行の minHeight で 44 を確保」へ（hitSlop 方式は縦積みで当たり判定が重なるため）
- validate-tokens に背景セマンティックの同値衝突ガード（mode + 実値ピン止めの ALLOWED_SAME、
  fail-open しない）を追加。ds-theme.css の Host-Reset Defense ブロックを generator へ移設
  （手書き追加のままだと `npm run generate` で黙って消えていた）

## [1.5.0] - 2026-08-04

### 配布整備 — stale 配布の物理防止 + 公開 entry の明示 + vendor 経路の堅牢化

npm 上の 1.4.0 が 7/19 時点の contracts 0.5.0 を同梱したまま stale 化していた事故を受けた配布まわりの整備。あわせて、将来の engine / ruleset 分離に向けた非破壊の前準備を入れた。

#### Added

- **consumer pack smoke test（`npm run check:pack`）** — `npm pack` した tarball について、① registry の `melta-contracts` version とリポの contracts version の同期（registry が先行 = リポが stale なら fail、リポが先行なら「contracts を先に publish せよ」の warn、取得不能なら warn 継続）② 同梱スキーマ 3 種の存在と JSON parse ③ tmp consumer に `npm install <tarball>` して `melta-ds-mcp/lint-core`（公開 entry）と `melta-ds-mcp/dist/utils/lint-core.js`（互換 passthrough）の両 specifier で lint が発火するか、を消費者視点で検査する。CI（design-check）の必須ステップに追加（`scripts/design/pack-smoke.ts`）
- **`prepack` script** — pack / publish の直前に必ず `npm run build` が走る。dist の作り忘れによる空配布を封じる
- **`exports` フィールド** — `./lint-core` / `./package.json` の公開 entry を明示。既存の deep import（`melta-ds-mcp/dist/*` / `./design/*` / `./metadata/*`）は pattern で維持し非破壊。解決経路は実際の Node 解決器で検査（`tests/package-exports.spec.ts`）。**パッケージ名の bare import（`import "melta-ds-mcp"`）は非サポート** — `dist/index.js` は import しただけで stdio サーバーが起動する CLI entry であり、従来も server 起動の footgun だった。`bin` 起動に `.` エントリは不要なので公開 API にしない。`loader` も公開 entry には昇格させない（engine API の設計は将来フェーズ。`./dist/*` passthrough では従来同様に到達可能）
- **`--melta-root=<path>` 引数でのアセット root 差し替え** — 優先順位は `--melta-root` > `MELTA_ROOT` > パッケージ相対。MCP の起動コマンドに直接書けるようになった（従来の `MELTA_ROOT` 経路は完全互換で維持）。値なしの `--melta-root` は黙って fallback せず設定エラーで即時終了する
- **`setMeltaRoot(path)`** — アセット root の明示 API。root 解決は lazy 化し、`process.argv` の解釈は CLI entry（`src/index.ts`）だけの責務にした。loader が argv を無条件走査すると、テストランナーや埋め込み先ホストの同名オプションを誤採用しうるため
- **`design/schemas` を配布物に追加** — component contract / recipe / rule の 3 スキーマを公開資産化。vendor 先が自前の契約を melta のスキーマで検証できる
- **`design/contracts/package.json` を配布物に追加** — 同梱 contracts の version を消費者が確認できる
- root 差し替え経路のテスト補強 — fixture に `design/contracts/tokens.json` を追加し、`get_token` / `search` が root 差し替えで動くこと、`setMeltaRoot` が env より優先されキャッシュを破棄すること、CLI 起動 `--melta-root=<path>` で MCP サーバーが差し替え先のアセットを配ることを固定（`tests/mcp-server.spec.ts`）

#### Changed

- **`loadTokens` / `loadComponents` に診断付き try/catch** — アセット欠落時に生の ENOENT を投げていた経路を、期待パス・解決した root・`--melta-root` / `MELTA_ROOT` の案内を含むメッセージに統一（`loadRules` / `loadDesignConstitution` と同じ流儀）

#### Removed

- **`loadScreens` を削除** — `metadata/screens.json` を読む未使用の内部関数。src / scripts / tests のいずれからも呼ばれておらず、`loader` は公開 entry でもないため既知の消費者はゼロ。`metadata/screens.json` 自体は配布物として残す

## [1.4.0] - 2026-07-19

### 生成 UI の耐久性強化 — Baseline 線引き + disabled 併記 + 44px タップ領域 + リセットCSS VRT

外部の公開デザインシステムと実装例を調査し、melta が機械強制すべきと判断した 4 項目を導入。ルールは 99 → **105 件**、contracts は **0.5.0**（npm publish 済）。

#### Added

- **BASELINE_* ルール 5 件（warn）** — CSS/HTML 機能を Baseline **Widely available** に限定する原則を DESIGN.md 原則 8 に明文化し、AI が出しがちな未普及機能（Anchor Positioning / Invoker Commands / popover / View Transitions / text-box-trim）を denylist 検知。attr-lint に新 kind `attr-present`（開始タグ抽出 + 引用符内除去で属性値内の同名語を誤検知しない）
- **A11Y_DISABLED_REQUIRES_ARIA（warn）** — 契約既存の規範（button stateSpecs.disabled = `disabled` + `aria-disabled` 併用）を composition lint で HTML に機械強制。タブ順維持が要る文脈の `aria-disabled` 単独 + JS ガードパターンは DESIGN.md に注記
- **リセットCSS差し替え VRT**（`npm run test:reset-vrt`）— Normalize / Bootstrap Reboot / Tailwind Preflight / Eric Meyer / kiso.css の 5 種を melta スタックより前に注入し、pixelmatch threshold 0 + includeAA の literal 比較で **diff 0px** を検証。fixture は契約 htmlSample から実行時組み立て（コピー drift なし）、スナップショット無しの同一セッション内比較 + A/A 決定性テスト。CI には non-blocking で組み込み（安定確認後に required 昇格）
- **Host-Reset Defense 層（ds-theme.css）** — 監査で発見した 3 系統の漏れを封鎖: ① Reboot 系の body 直指定 font/color が Preflight の html レベル指定を貫通 ② Meyer 系の要素セレクタ `border: 0` が Preflight の `*`（specificity 0）に常勝して枠線消失 ③ kiso.css の日本語タイポプロパティ（text-autospace 等）継承でテキスト幅シフト
- **タップ領域拡張の受け入れテスト**（`tests/tap-target.spec.ts`）— ジオメトリ不変 / elementFromPoint 拡張帯ヒット / overflow クリップ制約 / disabled 無効化を実ブラウザで固定

#### Changed（contracts 0.5.0 / button 2.1.0）

- **BTN_MIN_TAP_TARGET を manual → composition 自動検出に昇格**（新 kind `dom-class-required` + `excludeWhen: icon-only`。無防備 error 43 → 42）。button 契約 sizes.small/medium に `after:` 擬似要素のタップ領域拡張を追加（見た目不変・実効 44px、WCAG 2.2 SC 2.5.5 Target Size (Enhanced) = AAA 水準）。touchTarget prose の「web は h-8 まで許容」との矛盾を解消。icon-only の幅拡張は第二弾
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
