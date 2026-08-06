<!-- sec: hero -->
# melta UI

[![Design System Check](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml/badge.svg?branch=main)](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml)

**AI 向けデザインガイドラインを、違反を止める実行可能な契約へ。**

> 🇬🇧 English: [README.en.md](./README.en.md) · Site: https://melta.tsubotax.com

<!-- sec: lead -->
AI にガイドラインを読ませることはできる。守るかどうかは AI 任せになる。melta UI は、その「任せ」を機械に置き換える。生成の**前**（MCP で契約を参照させる）・**直後**（lint / hook が違反を突き返す）・**マージ前**（CI が止める）・**その後**（drift 検査がドキュメントと実装の腐りを検知し続ける）の 4 点で機械が関与する。読ませるだけでなく、守らせる。

**境界**: melta UI は完成済みの CSS コンポーネント集ではない。配るのは値（tokens）・規則（rules）・仕様（contracts）・検証器（lint / MCP）で、`import` して貼れば動く UI ライブラリではない。web の実装は HTML + Tailwind クラスの参照実装として同梱している。

<!-- sec: who -->
## 誰のためのものか

**向いている**

- AI コーディングエージェント（Claude Code / Cursor / Codex 等）で UI を生成・運用しているチーム
- 「ガイドラインは書いたのに守られない」を仕組みで潰したい個人・少人数チーム
- web と React Native で 1 つのデザイン契約を共有したいプロダクト

**向いていない**

- 完成済みの Web コンポーネント集（React コンポーネントを install してすぐ使いたい）が欲しい場合
- Tailwind / class ベース以外のスタイリング（CSS-in-JS の props 経由など）が主体で、スタイルがマークアップに現れない場合。静的 lint が効かない

<!-- sec: proof -->
## Proof — 主張には検証経路をつける

- **106 禁止ルールのうち 48 / 106 を静的に自動検出**。残りも「なぜ自動検出しないか」を `automationStatus` で分類・可視化する（[rules.json](./design/contracts/rules.json) / 内訳は[制約と正直な範囲](#制約と正直な範囲)）
- **Playwright + axe-core 248 tests** が CI 必須ゲート（[.github/workflows/design-check.yml](./.github/workflows/design-check.yml) / [実行履歴](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml)）
- **5 種の代表的リセット CSS 環境で VRT 差分ピクセル 0**。pixelmatch の literal 比較で機械検証（[tests/reset-vrt.spec.ts](./tests/reset-vrt.spec.ts)、`npm run test:reset-vrt`）
- **npm 3 パッケージ + MCP Registry で配布**（[melta-contracts](https://www.npmjs.com/package/melta-contracts) / [melta-ds-mcp](https://www.npmjs.com/package/melta-ds-mcp) / [melta-app](https://www.npmjs.com/package/melta-app)、Registry ID `io.github.tsubotax/melta-ui`）
- **別リポジトリの React Native 実装が同じ契約を購読**し、契約の破壊的変更は APP 側が契約バージョンを取り込んだ時点で consumer テストが検出する（[melta-app](https://github.com/tsubotax/melta-app) / npm 公開版との互換は `npm run design:compat` が publish 前に検査）
- **外部プロジェクトで「AI が違反を書く → 即検出 → 自己修正」ループを実測**（2026-08、非公開 RN アプリへ npm 経由で導入。[melta-app README のステータス節](https://github.com/tsubotax/melta-app/blob/main/README.md#ステータス)）
- **drift 検査自身に負のテストがある**（わざと壊して発火することを固定：[tests/drift-heal.spec.ts](./tests/drift-heal.spec.ts)）

<!-- sec: ships -->
## 配布物 — いま install できるもの

| パッケージ | 役割 | 使い方 |
|---|---|---|
| [`melta-contracts`](https://www.npmjs.com/package/melta-contracts) | **契約データ**（tokens / rules / component contracts / recipes の JSON）。ビルド不要・フレームワーク非依存 | `npm install melta-contracts` |
| [`melta-ds-mcp`](https://www.npmjs.com/package/melta-ds-mcp) | **MCP サーバー + lint エンジン**（このリポジトリ）。`check_html` は CI / hook と同一ロジック | `npx -y melta-ds-mcp` / `melta-ds-mcp/lint-core` |
| [`melta-app`](https://www.npmjs.com/package/melta-app) | **React Native 実装**。消費者プロジェクト向け eslint plugin を同梱 | `npm install melta-app` |

> `melta-ds-mcp` 自体の bare import（`import "melta-ds-mcp"`）は非サポート。entry は import しただけで stdio サーバーが起動する CLI なので、`npx melta-ds-mcp` か subpath 経由で使う。entry 規約・deep import 互換・パッケージ分割の予定は [docs/distribution.md](./docs/distribution.md)。

<!-- sec: requirements -->
## 前提条件・互換性

| 項目 | 値 |
|---|---|
| Node | 22 以上（CI は 22 で検証） |
| MCP クライアント | stdio MCP に対応したもの（Claude Code で検証。Cursor / Codex は同じ stdio コマンドで登録） |
| スタイリング | **Tailwind CSS の class ベース前提**。静的 lint は class 属性 / HTML 属性 / DOM 構造を読む |
| 生成物の表示 | プロトタイプは Tailwind CDN + `DESIGN.md` の `tailwind.config`、プロダクションは `foundations/theme.md` の v4 `@theme` |
| JSX / Vue | class 属性と HTML 属性の lint は効く。**composition lint（ネスト構造・a11y DOM）は HTML のみ**。JSX の変数経由 class・spread は静的には追えない |
| ライセンス | MIT |

<!-- sec: quickstart -->
## 5 分クイックスタート

### 経路 A — npm（MCP サーバー、推奨）

clone せずに、契約参照と自己検証だけを既存プロジェクトへ足す経路。

```bash
claude mcp add melta-ui -- npx -y melta-ds-mcp
claude mcp list
```

**成功判定** — `claude mcp list` にこの行が出る:

```text
melta-ui: npx -y melta-ds-mcp - ✔ Connected
```

接続時に MCP `instructions` が渡るので、「melta は完成 CSS ライブラリではない」「先に `melta://design-constitution` を読む」「生成後は `check_html` で自己検証する」を利用側が毎回プロンプトに書く必要はない。あとは UI を指示するだけ:

> ユーザー一覧のテーブルを作って

**成功判定** — AI が生成 HTML を `check_html` に通し、この形の応答を得る（違反があれば修正して再検証する）:

```jsonc
{
  "passed": false,
  "errorCount": 2,
  "warnCount": 0,
  "violations": [
    { "ruleId": "AI_NO_CARD_COLOR_BAR_TOP", "severity": "error", "token": "border-t-4",
      "reason": "AI生成UIの典型パターン。装飾過剰で汎用性が低い",
      "alternative": "border border-slate-200 のみでカードを構成" },
    { "ruleId": "COLOR_NO_BLUE_BG", "severity": "error", "token": "bg-blue-500",
      "reason": "primaryで統一する", "alternative": "bg-primary-*" }
  ],
  "coverage": { "automated": "...", "notAutomated": "..." }
}
```

生成された HTML を**ブラウザで表示する**には Tailwind と melta のトークン設定が要る。プロトタイプなら CDN でよい:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  // DESIGN.md「Quick Reference → HTML テンプレート」の tailwind.config をそのまま貼る。
  // fontSize は 8 段すべて Tailwind デフォルトと異なる（本文 18px / 行間 2.0 が melta の核）。
</script>
```

### 経路 B — clone（フルハーネス）

hook / CI / lint CLI まで含めた強制層が要る場合。`npm install` した消費者にはこの 3 層は届かない（[制約と正直な範囲](#制約と正直な範囲)）。

```bash
git clone https://github.com/tsubotax/melta-ui.git
cd melta-ui && npm install
printf '<div class="text-black shadow-2xl">x</div>' > /tmp/melta-bad.html
npm run design:lint-generated -- /tmp/melta-bad.html
```

`npm install` で有効になるもの: `.mcp.json`（Claude Code へ MCP 自動接続）/ `.claude/settings.json` の PostToolUse hook / lint CLI。

**成功判定 1** — 違反ファイルに lint CLI をかけると exit 1 で落ちる:

```text
  ✗ [error] COLOR_NO_TEXT_BLACK: "text-black" → text-slate-900（純黒はコントラストが強すぎて長時間の利用で目が疲れる）
  ✗ [error] SPACE_NO_SHADOW_2XL: "shadow-2xl" → shadow-sm 〜 shadow-md（オーバーレイ: shadow-xl）（影が強すぎてノイズになる）

1 ファイル走査 / error 2 / warn 0
❌ FAILED
```

**成功判定 2** — Claude Code が `.html` / `.tsx` / `.jsx` / `.vue` を Write / Edit した直後、hook がこの JSON を返して修正ループに乗せる（warn のみなら `additionalContext` で助言注入）:

```json
{"decision":"block","reason":"melta UI 禁止パターン検出（error 2 / warn 0）。書き込まれたファイルを修正してください: ..."}
```

<!-- sec: how -->
## 仕組み — 契約・参照・検証・監視の 4 層

```
① 契約（SSOT）        design/contracts/
                        tokens.json      101 デザイントークン
                        rules.json       106 禁止ルール（ID + severity + detector + alternative）
                        components/      40 contract（web 28 / app 先行 12）
                        recipes/         プラットフォーム具象（web: 生成ミラー / app: RN styleRefs）
                      DESIGN.md / AGENTS.md   AI が最初に読む憲法と作業ガイド

② 参照（生成の前）     MCP サーバー（melta-ds-mcp）
                        必要な仕様・値・ルールだけをオンデマンドで渡す

③ 検証（生成の直後〜マージ前）
                      PostToolUse hook   Write/Edit 直後に lint → error は block で自動修正
                      lint CLI / CI      .github/workflows/design-check.yml
                      MCP check_html     CI と同一ロジックの自己検証

④ 監視（その後）       design:drift       ドキュメント ↔ contracts の腐りを検知
                      design:compat      npm 公開版との破壊的変更 × semver 検査
                      design:drift-heal  drift を検出して derived のみ再生成（SSOT は human gate）
```

MCP が公開するツール:

| ツール | 説明 | 入力例 |
|--------|------|--------|
| `get_token` | トークン検索 | `{ "path": "color.primary.600" }` |
| `get_component` | コンポーネント仕様取得（variants / sizes / stateSpecs / anatomy / a11y） | `{ "id": "button" }` |
| `check_rule` | クラス文字列の禁止パターン検査（34パターン自動検出）。文脈依存は conditional 付き | `{ "classes": "text-black shadow-2xl" }` |
| `check_html` | 生成 HTML / JSX 全体を CI / hook と同一ロジックで lint | `{ "source": "<div class=...>" }` |
| `get_rules` | 106 禁止ルール参照（manual 含む全件、filter 対応） | `{ "category": "accessibility" }` |
| `search` | 全文検索（最大 20 件 + truncated 通知） | `{ "query": "card" }` |

Resource は `melta://design-constitution`（`DESIGN.md` 全文）/ `melta://tokens` / `melta://components` / `melta://components/{id}` / `melta://rules` / `melta://rules/auto-detectable`。

web の実装対象は 28 コンポーネント + 13 ファウンデーション + 5 パターン。設計原則は Content First / WCAG 2.1 AA / Semantic Color / 3-Color Rule / 4px Grid / Minimal Elevation / No AI-ish Decoration の 7 つ（[DESIGN.md](./DESIGN.md)）。

<!-- sec: platforms -->
## Web と APP — 1 つの契約が両方に降りる

同じ契約パッケージ（[`melta-contracts`](https://www.npmjs.com/package/melta-contracts)）を web（このリポジトリ / HTML + Tailwind）と APP（[melta-app](https://github.com/tsubotax/melta-app) / React Native）の両実装が購読する。トークンを各実装にコピーして持つ経路は存在しない（二重化の物理防止）。

契約は**規範と具象の 2 層**。規範（`components/*.contract.json`）は variant の語彙・states・tokenRefs・a11y で、全プラットフォーム共通。分岐が正当な箇所（hover→pressed、elevation の表現差、タッチターゲット 44pt 等）は `platformSemantics` で意味論だけを宣言する。具象（`recipes/`）は web が契約の Tailwind からの導出ミラー（鮮度を CI が担保）、app が RN の styleRefs（色は 100% token 参照）を手書きする authoring source。

守らせる仕組みも双方向:

- **web 側 → 互換ゲート**（`npm run design:compat`）: npm 公開版と HEAD の golden diff。token 削除・variant 削除・rule の意味変更を breaking 分類し、semver bump を機械強制する
- **APP 側 → consumer テスト**: melta-app の CI が「契約 subset・token 実在・contractVersion 同期」を照合する。web 側が契約を壊すと APP のテストが赤くなる

melta-app は消費者プロジェクト向けの eslint plugin も npm で配っており、**使う側のコード**で生値の直書きが止まる。RN カタログの live showcase は https://app.melta.tsubotax.com。

<!-- sec: limits -->
## 制約と正直な範囲

**48 / 106 の意味**。「106 禁止ルールを強制する」とは言えない。静的に自動検出できるのは 48 件で、残りは検証経路を `automationStatus` で分類して可視化している（宣言だけのルールをゼロにするための棚卸し）。

<!-- BEGIN:coverage (npm run design:coverage で再生成) -->
| 経路 | 件数 | 内容 |
|------|------|------|
| 静的自動検証 | **48 / 106** | class マッチ 34（MCP `check_rule` 同経路）+ html-attr 7 + composition 7（ネスト + a11y DOM） |
| interaction test | 3 | `tests/modal.spec.ts` が focus trap / Escape / focus 復帰を実機検証 |
| 静的検出 不能 | 3（うち error 3） | `impossible-static`（active/selected/current の特定が意味依存） |
| LLM 審査候補 | 43（うち error 31） | `llm-judge-candidate`（shadow judge 導入までは自動検証なし） |
| human-only | 9（うち error 9） | 人間レビューでのみ守る。`get_rules` で AI に提示 |
| 未分類 | 0（うち error 0） | 棚卸し未了（automationStatus 未宣言） |
<!-- END:coverage -->

この表は `npm run design:coverage` が contracts から生成し、鮮度を `npm run design:drift` が守る。数字は改善のたびに動く。各ルールの状態の SSOT は `rules.json` の `automationStatus`。

**その他の制約**:

- **clone 経路と npm 経路で届く層が違う**。PostToolUse hook / CI / lint CLI は「このリポジトリを clone して使う」前提の層で、`npm install` した消費者には届かない。npm 経路の強制層は `melta-ds-mcp/lint-core` と MCP の `check_html` の 2 つで、これを各プロジェクトのフック / CI に自前で組み込む
- **class ベースでないスタイリングは検査できない**。スタイルがマークアップ（class / 属性）に現れないコードでは静的 lint が空振りする
- **JSX の composition lint は未対応**。ネスト構造・a11y DOM の検査は HTML のみ。JSX は class / 属性 lint まで
- **`check_html.passed` は完成承認ではない**。lint-clean draft であってブランド適合の判定ではなく、最終判断は人間に渡す

<!-- sec: security -->
## セキュリティ・データ境界

MCP サーバーも lint エンジンもローカルプロセスで完結する。生成コード・プロンプト・検査結果を外部へ送信する経路はなく、telemetry も持たない。ネットワークに出るのは `npx` によるパッケージ取得と、`npm run design:compat` / `npm run check:pack` が npm registry の公開バージョンを照会するときだけ。

<!-- sec: maturity -->
## 成熟度とメンテナンス

- **個人メンテナンスの OSS**（tsubotax）。SLA も専任チームもない。実運用の dogfood（web showcase / RN アプリ）で回している
- **0.x / 1.x の方針**: 契約パッケージ `melta-contracts` は 0.x で、破壊的変更は minor bump で入りうる。ただし破壊的変更の分類は人手ではなく `npm run design:compat` の機械判定で、semver bump を強制する
- **変更の通知経路は [CHANGELOG.md](./CHANGELOG.md)**。リリースごとに Added / Changed / Removed を残す
- **バグ・要望は [GitHub Issues](https://github.com/tsubotax/melta-ui/issues)** へ。手を動かすなら [CONTRIBUTING.md](./CONTRIBUTING.md)（ローカル CI ミラー・生成物の扱い・PR 前チェックリスト）
- **脆弱性は issue ではなく [SECURITY.md](./SECURITY.md) の非公開経路**（GitHub private vulnerability reporting）へ。セキュリティ修正は各パッケージの最新 minor にのみ提供する

<!-- sec: learn-more -->
## もっと知る

| ドキュメント | 内容 |
|---|---|
| [DESIGN.md](./DESIGN.md) | デザイン憲法 + Quick Reference。これだけで基本 UI を生成できる |
| [AGENTS.md](./AGENTS.md) | AI エージェント共通の作業ガイド（読み込みモード・タスク別ガイド・npm scripts） |
| [design/authority.md](./design/authority.md) | SSOT 宣言と値競合時の優先順位 |
| [docs/melta-loop-playbook.md](./docs/melta-loop-playbook.md) | loop / pipeline 自動化の統治原則（自動化 3 Level 分類・SSOT write-protect・Human Gate の Hard / Soft 2 層化・監査ログ）。現状 W2 drift repair が稼働 |
| [docs/benchmarks.md](./docs/benchmarks.md) | ベンチマークのプロトコル（5 条件 × N トライアルで DS 準拠スコアの lift を測る）と既知の限界 |
| [docs/distribution.md](./docs/distribution.md) | npm entry 規約・deep import 互換・vendor 経路・パッケージ分割の予定 |
| [docs/ai-ready-ds-maturity-model.md](./docs/ai-ready-ds-maturity-model.md) | AI-Ready 成熟度モデル（Lv0 None → Lv4 Verified）。任意のプロジェクトに当てられる |
| [design/compat/google-designmd.md](./design/compat/google-designmd.md) | Google Labs [design.md spec](https://github.com/google-labs-code/design.md) との対応表。melta の `DESIGN.md` は spec 互換の front matter を含み、`npx @google/design.md lint` が errors: 0 で通る。守備範囲の違いは「spec は DESIGN.md ファイル自体の検証まで、melta は生成コードの検証・CI・hook まで」 |

<!-- sec: license -->
## License

MIT License — [LICENSE](./LICENSE)。同梱アイコンのライセンスは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) を参照。

Acknowledgments: [Charcoal Icons](https://github.com/pixiv/charcoal)（pixiv Inc., Apache License 2.0）/ [Lucide Icons](https://github.com/lucide-icons/lucide)（ISC License）/ [Tailwind CSS](https://tailwindcss.com/)
