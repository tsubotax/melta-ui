---
name: ban-pattern
description: "Register AI-generated-looking UI patterns as prohibited rules in the design system. Use when user says \"AIっぽい\", \"AI臭い\", \"これ禁止\", \"このパターンやめたい\", \"ban this pattern\", \"add to prohibited\", or points out a generic/cookie-cutter UI element."
user-invocable: true
---

AI生成UIに頻出する「それっぽい」装飾パターンを特定し、DS全体の禁止ルールとして登録する。

## 手順

### Step 1: パターンを特定する

ユーザーの説明（テキスト or スクリーンショット）から、禁止対象のパターンを特定する。

以下を明確にする:
- **何が問題か**: どの視覚要素がAI生成っぽいのか
- **該当する Tailwind クラス / CSS**: 具体的な実装パターン（例: `border-l-4`, `bg-gradient-to-r`）
- **代替パターン**: DS準拠の代わりの実装

不明点があれば AskUserQuestion で確認する。推測で進めない。

### Step 2: 既存ルールと重複がないか確認する

以下を読み込む:
- `design/contracts/rules.json` の `rules[]`（**SSOT。機械可読版**。同じ pattern / 趣旨のルールが無いか）
- `foundations/prohibited.md` の「AI生成パターンの排除」セクション（人間向けミラー）

既に同じ or 類似のルールが存在する場合は、ユーザーに報告して既存ルールの更新で対応するか確認する。

### Step 3: 禁止ルールを登録する

**SSOT は `design/contracts/rules.json`**。CI / MCP `check_rule` / PostToolUse hook はすべて
rules.json を参照する。ここに機械可読ルールを足して初めて「ban → 即 enforcement」が成立する。
prohibited.md は人間向けの解説ミラーであり、enforcement の実体ではない。順序厳守:

#### 3-1. `design/contracts/rules.json` — 機械可読ルールを追加（最優先）

`rules[]` 配列にルールオブジェクトを 1 件追加する。スキーマは `design/schemas/rule.schema.json`。

**detector の選び方**（これで自動検出されるか・人手参照に留まるかが決まる）:

| detector | いつ使う | 必須フィールド | 例 |
|---|---|---|---|
| `tailwind-class` | 単一の固定クラスを禁止 | `pattern`（クラス名） | `border-l-4`, `shadow-2xl` |
| `tailwind-class-prefix` | 前方一致で複数バリアントを一網打尽 | `pattern`（接頭辞）。任意値回避経路があれば `prefixPatterns` も | `bg-gradient-` |
| `tailwind-class-segment` | クラスを `-` 分割したセグメント一致（色名等） | `matchPatterns`（セグメント配列）、`pattern: null` | `purple`/`violet` |
| `manual` | 静的検出が原理的に不能（文脈判断） | `pattern: null`、`contractLint: "skip"` | 「色だけで状態を伝達」 |

**フィールド規約**:
- `id`: 大文字スネーク（`^[A-Z][A-Z0-9_]+$`）。AI生成装飾は `AI_NO_*`、特定コンポーネントは `<COMPONENT>_NO_*`
- `category`: `ai-pattern`（AI装飾）/ または該当カテゴリ（`color` `spacing` `form` 等、schema の enum 参照）
- `severity`: `error`（明確なNG）/ `warn`（文脈次第・段階導入）
- `alternative`: DS準拠の代替実装（必須・具体的に）
- `contractLint`: `enforce`（自動検出可・contract も検査）/ `warn` / `skip`（manual・html-attr・文脈依存）

**テンプレ（自動検出する典型の AI パターン）**:
```json
{
  "id": "AI_NO_GLASS_BLUR",
  "category": "ai-pattern",
  "severity": "error",
  "description": "ガラスモーフィズム（backdrop-blur）はAI生成UIの典型tell。安っぽく散漫に見える",
  "detector": "tailwind-class-prefix",
  "pattern": "backdrop-blur",
  "alternative": "不透明な bg-white / bg-slate-50 + border border-slate-200 で面を作る",
  "contractLint": "enforce"
}
```

**テンプレ（manual = 文脈判断が要るもの）**:
```json
{
  "id": "FORM_NO_PLACEHOLDER_AS_LABEL",
  "category": "form",
  "severity": "warn",
  "description": "プレースホルダーのみでラベル省略は入力開始で消え目的がわからなくなる",
  "detector": "manual",
  "pattern": null,
  "alternative": "<label> を必ず使用",
  "contractLint": "skip"
}
```

#### 3-2. 人間向けドキュメントと件数の整合

1. `foundations/prohibited.md` の該当セクション（AIパターンなら「## AI生成パターンの排除」、無ければ
   `## コンポーネント` の直前に同テンプレで新設）のテーブルに prose 行を追加する:
   ```
   | 禁止パターン（具体的な Tailwind クラス） | 理由（なぜAI生成っぽいか） | 代替（DS準拠の実装） |
   ```
   **detector が `manual` のルールは orphan 0 検証の対象**なので、行末に ` <!-- RULE_ID -->`（HTMLコメント・
   レンダリング不可視・表非破壊）を必ず付け、drift-check が参照経路を見つけられるようにする。
   auto 系（tailwind-*）は contract / lint で到達できるためコメントは任意。
2. ルール総数が 1 件増えるので、**prose に書かれた件数を全て +1** する:
   `DESIGN.md`（`全ルール（N 件）`）/ `README.md`（`N 禁止ルール` `N ルール` 複数箇所）/ `AGENTS.md`（`N 禁止ルール` `N ルール`）/
   `README.en.md`（英語: `N prohibition rules` / `N rules`）。
   どこが古いかは 3-4 の `design:drift` がファイル名・数値付きで指摘するので（英語入口の数値整合も検証する）、それに従って直す。
3. パターンが特定コンポーネントに紐づく場合、該当 `components/*.md` の禁止事項にも追記する（任意）。

#### 3-3. 生成ビューを再生成する

```bash
npm run design:build            # llms.txt / llms-full.txt / metadata/components.json
npm run design:update-showcase  # docs/index.html の数値
npm run design:coverage         # README の検証カバレッジ表（manual を足すと manual 件数が動く）
```

#### 3-4. 検証 — 「即 CI / MCP 反映」を自分で確認する

```bash
npm run design:drift   # 件数 drift を全部指摘。NO DRIFT になるまで 3-2 を直す
npm run design:check   # rules.json スキーマ + contract lint が PASSED であること
```

- どちらも green になって初めて登録完了。落ちたら指摘に従って直してから報告する。
- auto detector のルールは、違反 HTML を 1 つ作って `npm run design:lint-generated -- <file>` で
  実際に発火することを確認すると「enforcement に乗った」証拠になる（任意・デモ向け）。

### Step 4: 既存サンプルを走査・修正する

`examples/` と `docs/` 配下のHTMLファイルを Grep で走査し、禁止パターンに該当する実装が既にないか確認する。

該当がある場合:
- 全箇所をリストアップしてユーザーに報告する
- ユーザーの承認後、DS準拠の代替パターンに修正する

該当がない場合:
- 「既存サンプルに該当なし」と報告する

### Step 5: 結果を報告する

以下のフォーマットで報告する:

```
## 禁止パターン登録完了

**ルール ID**: `[RULE_ID]`（rules.json に追加 → CI / MCP check_rule / hook で即 enforcement）
**パターン**: [禁止したパターンの説明]
**detector**: `[tailwind-class / -prefix / -segment / manual]`（[自動検出 / 人手参照のみ]）
**代替**: `[DS準拠の代替]`

### 更新ファイル
- design/contracts/rules.json — 機械可読ルールを追加（SSOT・enforcement の実体）
- foundations/prohibited.md — 人間向け解説に追加（[manual の場合: <!-- RULE_ID --> 付き]）
- DESIGN.md / README.md / AGENTS.md — ルール件数を N→N+1
- llms / docs/index.html / README カバレッジ表 — 再生成

### 検証
- npm run design:drift — NO DRIFT ✅
- npm run design:check — PASSED ✅
- [auto の場合: npm run design:lint-generated で発火確認]

### サンプル修正
- [修正した箇所のリスト or 「該当なし」]
```

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| `design/contracts/rules.json` のスキーマ検証で落ちる | `design:check` のエラー文に従う。`id` は大文字スネーク、detector に応じた必須フィールド（tailwind-class→pattern / segment→matchPatterns / manual→pattern:null + contractLint:skip）を確認 |
| `design:drift` が件数 mismatch を出す | 指摘されたファイル・数値の「N ルール」「全ルール（N 件）」を実数に直し、`design:build` / `update-showcase` / `design:coverage` を再実行 |
| manual ルールを足したら orphan 0 検証で落ちる | prohibited.md（または該当 foundations/patterns md）の行末に ` <!-- RULE_ID -->` を付けて参照経路を作る |
| 禁止パターンの Tailwind クラスが特定できない | AskUserQuestion でスクリーンショットや具体例を求める。単一クラスでなく色名なら `tailwind-class-segment`、接頭辞バリアント群なら `tailwind-class-prefix` を検討 |
| 既存ルールと部分的に重複する | 既存ルールの拡張（pattern / matchPatterns の追加）で対応するか、新規ルールにするかをユーザーに確認する |
