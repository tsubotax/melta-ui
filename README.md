# melta UI

[![Design System Check](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml/badge.svg?branch=main)](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml)

**人間にも、AIにも、読めるデザインシステム。**

> 🤖 **Built for AI coding agents** — Claude Code / Cursor / **Codex** が `DESIGN.md` と JSON contracts を読んで DS 準拠の UI を生成し、CI で違反を検知する。

---

デザインシステムは、人間のためだけのものだった。
スタイルガイドを読み、コンポーネントの意図を汲み取り、文脈に合わせて判断する——それはデザイナーとエンジニアの仕事だった。

しかし今、UIを書くのは人間だけではない。

AIがコードを生成し、コンポーネントを選び、レイアウトを組む時代に、
デザインシステムは **「人間が読める」だけでは足りない。**

melta UI は、この問いに対する一つの答えである。

**人間の可読性を犠牲にせず、AIの可読性を加える。** 両立こそが、melta UI の設計思想である。

---

## Architecture — AI-Ready 2.0

3 層構造で「AI が迷わない、間違えにくい、間違えても検知される」を実現する。

```
Layer 1: 憲法（AI が最初に読む入口）
  DESIGN.md          ← Brand Identity + 7原則 + Quick Reference
  CLAUDE.md          ← Claude Code 作業手順書

Layer 2: 仕様（Machine-Readable SSOT）
  design/contracts/   ← npm: melta-contracts（web / APP 両実装が購読）
    ├── tokens.json   ← 101 デザイントークン
    ├── rules.json    ← 105 禁止ルール（ID + severity + detector）
    ├── components/   ← 40 contract（web 28 + app 先行 12。variant + size + a11y + rules）
    └── recipes/      ← プラットフォーム具象（web: Tailwind 生成ミラー / app: RN styleRefs）

Layer 3: 検証（破っても通さない）
  scripts/design/     ← validate / drift-check / lint-generated / build-legacy / update-showcase
  tests/              ← Playwright + axe-core
  .github/workflows/  ← CI で自動実行
```

| レイヤー | 形式 | 読み手 | 役割 |
|---------|------|--------|------|
| **DESIGN.md** | Markdown | AI（全エージェント） | デザイン憲法 + Quick Reference。これだけで基本 UI を生成可能 |
| **CLAUDE.md** | Markdown | AI (Claude Code) | 作業手順・読み込みガイド・npm scripts |
| **contracts/** | JSON | AI + harness | 40 contract（web 28）+ 105 ルール + 101 トークンの厳密仕様 |
| **harness** | TypeScript | CI | Schema 検証・drift 検出・Playwright + axe |
| **components/*.md** | Markdown | 人間 | 設計意図・使い方・判断基準を自然言語で記述 |
| **docs/index.html** | HTML | 人間 | 全コンポーネントのインタラクティブショーケース |
| **MCP サーバー** | TypeScript | AI エージェント | トークン検索・コンポーネント取得・ルール検証をツールとして公開 |

---

## AI にとっての読みやすさ

### 1. 段階的読み込み — コンテキストを浪費しない

| モード | 読むファイル | 用途 |
|--------|------------|------|
| クイック | `DESIGN.md` のみ | 単体UIの生成 |
| 標準 | + `theme.md` + contracts / component md | ページ単位の生成 |
| MCP | `get_token` / `get_component` / `check_rule` / `get_rules` | AI ツール統合 |
| フル | 全ファイル | 新規プロジェクト構築 |

### 2. 機械可読な仕様 — 解釈ではなく参照

```jsonc
// design/contracts/components/button.contract.json
{
  "id": "button",
  "variants": {
    "contained": {
      "tokenRefs": { "bg": "color.primary.500", "radius": "radius.md" },
      "tailwind": "inline-flex items-center justify-center gap-2 h-10 px-4 ..."
    }
  },
  "rules": [
    { "id": "SPACE_NO_PY_05_BTN", "severity": "error" },
    { "id": "BTN_ICON_ONLY_ARIA_REQUIRED", "severity": "error" }
  ]
}
```

### 3. 105 ルールの禁止パターン — AI が間違えても検知される

```jsonc
// design/contracts/rules.json
{
  "id": "AI_NO_CARD_COLOR_BAR_TOP",
  "severity": "error",
  "detector": "tailwind-class",
  "pattern": "border-t-4",
  "alternative": "border border-slate-200 のみでカードを構成"
}
```

### 4. MCP サーバー — 対話的なアクセス

AI エージェントは MCP ツールを通じて、必要な情報だけをオンデマンドで取得する。

```
Human: 「ユーザー一覧テーブルを作って」

AI (内部):
  1. get_component("table")   → 仕様・HTMLサンプル取得
  2. get_component("pagination") → ページ送り仕様取得
  3. → DS準拠の HTML を生成
  4. check_html(生成したHTML) → CI と同一ロジックで自己検証
  5. 違反があれば修正して再検証 → 提示
```

### 5. Enforcement — 書いた直後に検知して直させる

「読める」だけでは AI-Ready ではない。違反コードが書かれた瞬間に検知し、修正ループに乗せる 3 層を同梱する。

| 層 | 対象 | 仕組み |
|---|---|---|
| **PostToolUse hook** | Claude Code | `.claude/settings.json` に同梱（クローンするだけで有効化候補に）。Write/Edit 直後に lint が走り、error は block フィードバックで Claude が自動修正、warn は additionalContext で助言注入 |
| **CI** | 全エージェント | `.github/workflows/design-check.yml` が PR / push の変更ファイルを禁止パターン検査 |
| **CLI** | Codex / Cursor 等 | `npm run design:lint-generated -- <file>` 。各エージェントのフック機構に組み込み可能 |

> hook は `npm install` 後に有効（未インストール時はその旨をコンテキストに通知）。Claude Code 以外のエージェントには CI + CLI が代替層。

#### 検証カバレッジ（`npm run design:coverage` で再生成）

「宣言だけ」を排し、105 ルールが**どの経路で検証されているか**を経路別に出す。

<!-- BEGIN:coverage (npm run design:coverage で再生成) -->
| 経路 | 件数 | 内容 |
|------|------|------|
| 静的自動検証 | **48 / 105** | class マッチ 34（MCP `check_rule` 同経路）+ html-attr 7 + composition 7（ネスト + a11y DOM） |
| interaction test | 3 | `tests/modal.spec.ts` が focus trap / Escape / focus 復帰を実機検証 |
| 静的検出 不能 | 3（うち error 3） | `impossible-static`（active/selected/current の特定が意味依存） |
| LLM 審査候補 | 42（うち error 30） | `llm-judge-candidate`（shadow judge 導入までは自動検証なし） |
| human-only | 9（うち error 9） | 人間レビューでのみ守る。`get_rules` で AI に提示 |
| 未分類 | 0（うち error 0） | 棚卸し未了（automationStatus 未宣言） |
<!-- END:coverage -->

> 「宣言だけで検知ゼロ」だった a11y ルール 7 件を棚卸しし、3 件を DOM 検証で蘇生（icon-only button / ×ボタン / skeleton の aria）、4 件は静的不能/test 担保として `automationStatus` で明示。各ルールの状態は `rules.json` の `automationStatus` フィールドが SSOT。

#### リセットCSS差し替え VRT — どのサイトに貼っても 1px も変わらない

生成 UI はホストサイトのリセットCSS（Normalize / Bootstrap Reboot / Tailwind Preflight / Eric Meyer / kiso.css）の上に置かれる。流派ごとの `border: 0` や body 直指定 font が数 px の崩れを起こすが、人間の目視では検出できない。melta は 5 種のリセットを melta スタックより前に注入し、**pixelmatch の literal 比較（threshold 0）で差分 0px** を機械検証する（`npm run test:reset-vrt`）。fixture は契約 htmlSample から実行時に組み立てるためコピー drift も発生しない。検証で発見した貫通経路 3 系統は `ds-theme.css` の Host-Reset Defense 層が封鎖している。

### 6. Loop governance — 「守らせ続けられる」を仕組みにする

AI-Ready の本質は「一度守らせる」ことではなく「破られ続けないこと」。自動化を 3 Level に分類し、何を loop に任せ・何を人間が決めるかを [`docs/melta-loop-playbook.md`](docs/melta-loop-playbook.md) で固定する。

| Level | 種別 | 例 | model |
|---|---|---|---|
| Level 1 | 決定論パイプライン | drift 修復 / release readiness | なし |
| Level 2 | model loop | UI 自己修復 / red-team | あり |
| Level 3 | 観測 cron | benchmark | 生成のみ |

統治の核は 2 つ。**SSOT write-protect**（loop は generated / derived / 提案のみ write 可。contracts・tokens・rules・schema は human gate）と、Human Gate の **Hard（パスで機械強制）/ Soft（意味変更は人間判断）2 層化**。

現状 **W2 drift repair が稼働**（`npm run design:drift-heal`：drift 検出 → derived のみ再生成 → SSOT に触れたら escalate / auto-commit せず diff を出して停止 / 監査ログ `.melta-loop/runs.jsonl`）。W1 UI 自己修復・W3 benchmark・W4 red-team・W5 release readiness は playbook 定義済みで順次実装。loop playbook 自身も `npm run design:drift` の監視対象に入っており、陳腐化を検知する。

### 7. マルチプラットフォーム契約 — 1 つの契約が web と APP に降りる

同じ契約パッケージ（npm: [`melta-contracts`](https://www.npmjs.com/package/melta-contracts)）を web（melta-ui / HTML + Tailwind）と APP（[melta-app](https://github.com/tsubotax/melta-app) / React Native）の両実装が購読する。token を各実装にコピーして持つ経路は存在しない（二重化の物理防止）。

契約は**規範と具象の 2 層**で持つ:

- **規範**（`components/*.contract.json`）: variant の語彙・states・tokenRefs・a11y。全プラットフォーム共通で、語彙の分岐は契約違反。分岐が正当な箇所（hover→pressed、elevation の表現差、タッチターゲット 44pt 等）は `platformSemantics` で意味論だけを宣言する
- **具象**（`recipes/`）: web は契約の Tailwind から生成される導出ミラー（鮮度を CI が担保）、app は RN の styleRefs（`{"token": "color.primary.500"}` 形式、色は 100% token 参照）を手書きする authoring source

守らせる仕組みも双方向:

- **web 側 → 互換ゲート**（`npm run design:compat`）: npm 公開版と HEAD の golden diff。token 削除・variant 削除・rule の意味変更を breaking 分類し、semver bump を機械強制する
- **APP 側 → consumer テスト**: melta-app の CI が「契約 subset・token 実在・contractVersion 同期」を照合。web 側が契約を壊すと APP のテストが赤くなる。実装と recipe の値一致（styleRefs conformance）は button で機構実証済み、他コンポーネントへ展開中

---

## Quick Start

### Claude Code

1. このリポジトリをプロジェクトルートに配置する
2. Claude Code が `DESIGN.md` + `CLAUDE.md` を自動で読み込む
3. UI を指示するだけで DS 準拠のコードが生成される

```
「ユーザー一覧のテーブルを作って」
→ table contract + badge contract を参照し、DS準拠のHTMLを生成
```

### 外部プロジェクトから使う（npm）

```bash
# contracts のみ（tokens / rules / component contracts の JSON）
npm install melta-contracts

# MCP サーバー（ビルド不要、npx 一発）
claude mcp add melta-ui -- npx -y melta-ds-mcp
```

```js
import tokens from "melta-contracts/tokens" with { type: "json" };
import rules from "melta-contracts/rules" with { type: "json" };
```

#### パッケージ構成の今後について

将来、検証エンジン（`melta`）とルールセット（`melta-contracts`）を eslint 型に分離する方向で検討している。`melta-ds-mcp` は互換を維持したまま段階的に移行する予定で、現在の entry（`melta-ds-mcp` / `melta-ds-mcp/lint-core` / `melta-ds-mcp/loader` および `dist/*`・`design/*`・`metadata/*` の deep import）を予告なく壊すことはしない。時期・パッケージ名は未確定。

### MCP サーバー（このリポジトリを clone した場合）

`.mcp.json` 同梱のため、リポジトリ内では `npm install` だけで Claude Code に自動接続される。手動登録する場合:

```bash
npm install
claude mcp add melta-ui -- npx tsx src/index.ts
```

接続時には MCP `instructions` が常駐ガイダンスとして渡される。Melta が完成 CSS
ライブラリではなく contracts / rules / lint 型の DS であること、最初に Design
Constitution を読むこと、生成後に `check_html` で自己検証することを、利用側が毎回
プロンプトに書かなくても AI が把握できる。

| ツール | 説明 | 入力例 |
|--------|------|--------|
| `get_token` | トークン検索 | `{ "path": "color.primary.600" }` |
| `get_component` | コンポーネント仕様取得 | `{ "id": "button" }` |
| `check_rule` | クラス文字列の禁止パターンチェック（31パターン自動検出。文脈依存は conditional 付き） | `{ "classes": "text-black shadow-2xl" }` |
| `check_html` | 生成 HTML/JSX 全体を CI / hook と同一ロジックで lint。生成→自己検証→修正のループ用 | `{ "source": "<div class=...>" }` |
| `get_rules` | 105 ルール参照（manual 含む全件、filter 対応） | `{ "category": "accessibility" }` |
| `search` | 全文検索（最大 20 件 + truncated 通知） | `{ "query": "card" }` |

| Resource | 内容 |
|----------|------|
| `melta://design-constitution` | `DESIGN.md` 全文。UI 作業前の入口（原則・Quick Reference・禁止 Top 10・SSOT 読み順） |
| `melta://tokens` | トークン全体 |
| `melta://components` | 28 コンポーネント仕様 |
| `melta://components/{id}` | 個別コンポーネント |
| `melta://rules` | 105 禁止ルール全件（manual含む） |
| `melta://rules/auto-detectable` | 自動検出可能サブセット（check_rule 用） |

### Cursor

`.cursor/rules/` に 3 つのルールファイルを同梱:
- `melta-ui.mdc` — DS 全体ルール
- `color-system.mdc` — カラートークン一覧
- `components.mdc` — 28 コンポーネントの Tailwind クラス一覧

### 手動

1. Tailwind CSS 4 をプロジェクトに導入
2. `foundations/theme.md` の CSS 変数をプロジェクトに追加
3. `DESIGN.md` の Quick Reference を参照してクラスを適用

---

## npm Scripts

```bash
npm run design:check          # Schema + ルール + tokenRef 検証
npm run design:coverage        # 検証カバレッジ（経路別マトリクス）
npm run design:drift           # ドキュメント ↔ contracts の drift 検出
npm run design:compat          # 互換ゲート（npm 公開版 vs HEAD の破壊的変更 × semver 検査）
npm run check:pack             # 配布物 smoke（npm pack → 展開 → 同梱 contracts version + deep import）
npm run design:recipes         # 契約 → recipes/web/ の Tailwind レシピ生成
npm run design:build           # contract → metadata/components.json 生成 + tsc
npm run design:update-showcase # showcase の数値を contracts から自動更新
npm test                       # Playwright + axe-core
npm run benchmark              # 1.0 vs 2.0 A/B ベンチマーク（multi-provider, 要 API キー）
npm run build                  # TypeScript → dist/（MCP サーバー）
npm run validate               # tokens.json vs CSS の整合性
```

---

## Design Principles

1. **Content First** — UI は黒子。コンテンツが主役
2. **WCAG 2.1 AA** — コントラスト 4.5:1 以上。アクセシビリティはデフォルト
3. **Semantic Color** — `bg-primary-500` を使う。`bg-blue-*` は使わない
4. **3-Color Rule** — 1 画面に使う色は 3 色まで
5. **4px Grid** — スペーシングは 4 の倍数を基本
6. **Minimal Elevation** — `shadow-sm` 〜 `shadow-md`。`shadow-lg` 以上はオーバーレイ限定
7. **No AI-ish Decoration** — カラーバー禁止。全周ボーダーで構成

> 詳細は `foundations/design_philosophy.md` を参照。

---

## Components

28 コンポーネント + 10 ファウンデーション + 5 パターン。

| カテゴリ | コンポーネント |
|---------|--------------|
| **入力** | Button, TextField, Select, Checkbox, Radio, Toggle, Date Picker |
| **ナビゲーション** | Sidebar, Tabs, Breadcrumb, Pagination, Stepper, Accordion |
| **データ表示** | Card, Table, List, Badge, Tag, Avatar, Progress, Divider |
| **フィードバック** | Modal, Toast, Alert, Tooltip, Skeleton, Copy Button, Dropdown |

---

## Directory

```
melta-ui/
├── DESIGN.md                        # AI 向けデザイン憲法 + Quick Reference
├── CLAUDE.md                        # Claude Code 作業手順書
├── design/
│   ├── authority.md                 # SSOT 宣言
│   ├── contracts/
│   │   ├── tokens.json              # 101 デザイントークン
│   │   ├── rules.json               # 105 禁止ルール registry
│   │   └── components/              # 40 contract（web 28 + app 先行 12）
│   ├── schemas/                     # JSON Schema（rule + component-contract）
│   └── benchmarks/                  # Agent benchmark（prompt + rubric）
├── foundations/                      # 設計基盤（13 ファイル）
├── components/                      # コンポーネント仕様（28 ファイル）
├── patterns/                        # パターン（5 ファイル）
├── metadata/components.json         # MCP 用集約データ（contracts から生成）
├── src/                             # MCP サーバー（TypeScript）
├── scripts/design/                  # validate / drift-check / build-legacy / update-showcase
├── tests/                           # Playwright + axe-core
├── docs/                            # ショーケース + OG 画像
├── examples/                        # 16 サンプルページ
├── assets/icons/                    # Charcoal 207 + Lucide 15
├── .github/workflows/               # CI（design:check + drift + test）
├── .mcp.json                        # Claude Code MCP 登録
└── .cursor/rules/                   # Cursor 用ルール
```

---

## Benchmark — DS を読ませると DS 準拠スコアが何点上がるか

`design/benchmarks/` は **5 条件で同一 prompt から UI を生成し、共通 lint core（`check_html` と同じ採点）で DS 準拠スコアを測る**ハーネス。「context engine を足すと精度が上がる」式の限界寄与（lift）を自前の一次データとして出す。

| 条件 | 与えるもの | tools |
|------|-----------|-------|
| `cold` | DS コンテキスト無し（素の LLM のベースライン） | なし |
| `designmd` | `DESIGN.md` のみ（静的コンテキスト） | なし |
| `contracts` | `DESIGN.md` + contracts 要約 | なし |
| `mcp-raw` | 上記 + MCP tools、接続時 instructions 無し | あり |
| `full` | 上記 + 接続時 instructions（実際の Melta MCP workflow） | あり |

各セル（prompt × 条件）を N トライアル実行し、mean±range と条件間 lift を `report.md` に出力。実際の system prompt + tools 有無を条件別に hash し、実験定義の世代 `benchmarkProtocolVersion` とともに `design/benchmarks/history.json` へ追記する。時系列比較は同じ protocol version の run 同士に限定する。

```bash
# 全 prompt × 5 条件 × 3 trials（ANTHROPIC_API_KEY が必要）
npm run benchmark

# トライアル数・prompt・条件を絞る
npm run benchmark -- --trials 5
npm run benchmark -- --prompt 1 --conditions cold,full

# メーター API を使わない採点経路: 生成済み HTML を採点（サブエージェント等で先に
# <dir>/<promptId>-<conditionId>-t<k>.html を用意 → 共通 lint core で採点 + history 追記）
npm run benchmark -- --score-dir design/benchmarks/results/<dir> --trials 3

# API 不要のパイプライン検証（mock provider。history には追記しない）
npm run benchmark -- --provider mock
```

**provider-pluggable**: `ModelProvider` インターフェースで anthropic（実装済み・MCP 6 tool を Claude API の tool use として渡す）/ mock（オフライン検証）/ openai（placeholder、未実装）を切替。tools 条件では AI が何回どの tool を呼び、どの resource を参照したかに加え、`check_html` 到達率を記録する。`mcp-raw→full` の差が initialize instructions の寄与になる。

red-team prompt は5本（neon / heavy shadow / color bar / placeholder-only form / icon-only buttons）。standard と red-team はスコアの意味が違う（前者=準拠生成、後者=悪い指示への抵抗）ため report で分離集計する。CI は live API を叩かず、`tests/benchmark-pipeline.spec.ts` が stats・採点の gaming 耐性・集約ロジックの回帰を守る。

**測定しているもの / 限界（発信時の前提）**:
- スコアは **DS 準拠の proxy**（lint core 違反 + class/属性ベースの準拠シグナル）であって、見た目の美しさそのものではない。準拠シグナルはコメント等への文字列埋め込みでは稼げない（実 class 属性のみ集計）。
- tools 条件は多ターンの tool use を含み得る。`contracts→mcp-raw` は MCP tools 自体、`mcp-raw→full` は initialize instructions の寄与として分離する。スコア差と `check_html` 到達率を併読する。
- `mcp-raw` / `full` はどちらも `DESIGN.md` と contracts を静的 context に持つ。この比較は `melta://design-constitution` resource が、Melta 知識を MCP からしか得ない利用者へ情報を届ける効果を測らない。
- n は trial 数。headline には mean ± 95%CI を併記し、small-n の不確実性を隠さない。人手評価との相関検証は未実施（既知の限界）。

> ベンチマークの実装は `design/benchmarks/` と `tools/` を参照。

---

## Google DESIGN.md spec との関係

melta の `DESIGN.md`（2026-04-10 導入）と Google Labs の [design.md spec](https://github.com/google-labs-code/design.md)（2026-04-21 OSS 公開）は、独立に同名・同思想へ収斂した。melta の DESIGN.md は Google spec 互換の YAML front matter（tokens.json から自動生成）を含み、`npx @google/design.md lint DESIGN.md` が errors: 0 で通る。

守備範囲の違い: **Google spec は「DESIGN.md ファイル自体の検証」まで、melta は「生成されたコードの検証・CI・hook」まで**。詳細な対応表は [`design/compat/google-designmd.md`](./design/compat/google-designmd.md)。

---

## Related — melta のツール群

- **[melta-screendiff](https://github.com/tsubotax/melta-screendiff)** — UI変更PRを Before/After の実キャプチャで視覚比較する Claude Code plugin。melta UI の enforcement が「機械で検知できる違反」を潰すのに対し、screendiff は「意図どおりに見えているか」を人間が判断するレビュー側を埋める。melta UI には依存せず、任意のリポジトリで単体で使える。

  ```
  /plugin marketplace add tsubotax/melta-screendiff
  /plugin install screendiff@melta
  ```

---

## License

MIT License — [LICENSE](./LICENSE)

同梱アイコンのライセンスは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) を参照。

### Acknowledgments

- [Charcoal Icons](https://github.com/pixiv/charcoal)（pixiv Inc.）— Apache License 2.0
- [Lucide Icons](https://github.com/lucide-icons/lucide) — ISC License
- [Tailwind CSS](https://tailwindcss.com/)
