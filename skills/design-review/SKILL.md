---
name: design-review
description: HTMLファイルをmelta UIデザインシステムに照らしてレビューし、違反を検出・分類・修正提案する。トリガー: 「デザインレビュー」「DSチェック」「禁止パターンチェック」「design review」「check compliance」「DS準拠確認」。対象ファイルのパスを引数で受け取る。
---

# デザインレビュー

HTMLファイルを melta UI デザインシステム（`design/contracts/rules.json` を正とする）に照らしてレビューし、違反を検出・分類・修正提案する。

## 手順

### Step 1: 対象のHTMLファイルを特定する

- 引数でファイルパスが指定されている場合 → そのファイルを読み込む
- 引数がない場合 → `examples/` 配下のHTMLファイルを一覧表示し、ユーザーに選択してもらう
- 対象がHTMLファイルでない場合 → 「HTMLファイルを指定してください」と返す

対象ファイルを全文読み込む。

### Step 2: DSリファレンスを読む

- `design/contracts/rules.json`（**SSOT**。ID / severity / detector / pattern / alternative / automationStatus を持つ全禁止ルール）

補助（任意）:
- `foundations/prohibited.md` — 人間向けの prose 版。SSOT ではなく、pattern を持つルールの一部しか載っていないので、これだけで判定しない

### Step 3: チェックリストに沿って違反を検出する

以下の2つを読み込む:

- `references/rules-index.md` — **網羅**。rules.json から生成したルール索引（カテゴリ別の表 + human-only 節 + 機械検出済み節）
- `references/checklist.md` — **観点**。HTML のどこをどう見るかの手順。各項目に該当ルール ID が併記されている

`checklist.md` のカテゴリ順にHTMLを走査する:

1. カラー
2. スペーシング・レイアウト
3. タイポグラフィ
4. モーション
5. ボーダー
6. フォーム（fieldset/legend カード干渉、日付セレクト幅を含む）
7. アクセシビリティ

`checklist.md` に載っていないカテゴリ（modal / stepper / tag / list / table / skeleton / datepicker / baseline / ai-pattern / philosophy / button / divider）の違反を見つけた場合は、`rules-index.md` から ID を引いて報告する。

**報告する違反には必ずルール ID を添える。** rules.json に存在しない ID を書かない（`tests/skill-rule-refs.spec.ts` が実在性を検査している）。対応するルールが無い指摘は違反ではなく「評価不可（ルール無し）」として扱う。

### Step 4: 偽陽性を排除し、重大度を判定する

`references/severity-rules.md` を読み込み、以下を実行:

1. **「推奨」と「必須」を区別** — 推奨事項は違反として報告しない
2. **文脈判定で偽陽性を排除** — label/aria-current/text-xs の文脈確認
3. **重大度を割り当て** — Critical / High / Medium / Low の4段階。固定ルールに従い、表に無いものは rules.json の `severity` から変換する

### Step 5: レポートを出力する

`references/report-template.md` を読み込み、テンプレートに沿ってレポートを出力する。

レポートには **`## 評価不可` 節を必ず含める**（human-only / 静的に観測できない / 対応ルール無しの3種）。評価不可の項目は違反件数に含めない。

出力前に **サマリー整合チェック** を実施: 本文中の各重大度の件数と冒頭サマリーの件数が一致することを確認する。
