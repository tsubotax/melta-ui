# 重大度判定ルール

> SKILL.md Step 4〜5 の詳細。偽陽性防止・推奨と必須の区別・重大度の固定ルールを含む。

---

## 「推奨」と「必須」の区別

以下は **必須ではなく推奨** であり、違反として報告しない:

- テキストのみボタン（アイコンなし）の `inline-flex items-center justify-center gap-2` — アイコン付きボタンのみ必須
- チェックボックス・ラジオの Tailwind サイズクラス（`w-4 h-4`）— CSS でオーバーライドされている可能性がある

---

## 偽陽性を防ぐ — 文脈判定

違反を報告する前に、以下の文脈確認を行い、正しい実装を誤検出しないようにする:

- **`<label>` チェック**: `<label>` タグが入力欄の直前に存在する場合、`for`/`id` ペアが厳密に一致していなくても「label なし」とは報告しない。HTML構造上、`<label>` が `<input>` を暗黙的にラップしている場合や、直近の兄弟要素として配置されている場合は、ラベル付与済みと判定する。`for`/`id` の不一致は「推奨改善」として注記はできるが、違反として報告しない
- **`aria-current` チェック**: サイドバーのナビゲーションアイテムには `aria-current="page"` が必須。ただし、タブUI（`role="tablist"` やタブ風の切り替えボタン群）では `aria-selected` が適切であり、`aria-current="page"` の欠如をそのまま違反とは報告しない。タブUIかどうかは、`border-b-2` スタイルやタブ風のレイアウトで判定する
- **`text-xs` チェック**: `text-xs`（13px）はDSの正規タイポグラフィスケールであり、バッジ（`rounded-full` 付き）、メタ情報、補助ラベル、カード内のサブラベル等に使用される。これらの文脈で `text-xs` が出現しても違反として報告しない。`text-xs` を違反として報告するのは、本文段落（`<p>` のメインコンテンツ）や主要見出し（`<h1>`〜`<h4>`）に使用されている場合に限定する
- **正しい実装の事前確認**: HTML内で `border-slate-200`、`text-slate-900`、`text-body`、`rounded-xl`、`shadow-sm`、`focus:ring-2` が使われている箇所はDS準拠。これらを違反リストに含めないこと

---

## 重大度の基準

| 重大度 | 基準 | 例 |
|--------|------|-----|
| Critical | スクリーンリーダー・キーボード操作に直接影響するアクセシビリティ違反 | label欠如、focus消失、nav aria-label欠如、aria-current欠如、th scope欠如、フォーカストラップなし |
| High | DSカラー体系・セマンティクスの明確な違反、ブラウザ間UI不安定 | text-black, text-gray-400, 色名不統一, サイドバー暗背景, select appearance-none（※アクセシビリティではなくブラウザ互換の問題のためHighとする） |
| Medium | スペーシング・サイズの不統一、DS一貫性の逸脱 | rounded-none, shadow-lg（静的）, p-4 on card, py-0.5, primary-400, tracking-tight, サイドバー幅の非標準値（w-60等）, ナビアイテム rounded-xl, ナビアイコン w-6+サイズ, fieldset/legend カード干渉 |
| Low | 視覚的な軽微なずれ（機能・アクセシビリティへの影響なし） | border-gray-100, duration-500超過, hover:shadow-2xl, hover:shadow-lg, 日付セレクト均等幅 |

---

## 重大度の固定ルール（例外なし）

- `<select>` の `appearance-none` 欠如 → **必ず High**（Critical にしない）
- `shadow-lg`（静的カード・コンテナに直接付与）→ **必ず Medium**
- `hover:shadow-lg` / `hover:shadow-2xl`（ホバー限定）→ **必ず Low**
- サイドバー `w-60` 等の非標準幅 → **必ず Medium**
- ナビアイテム `rounded-xl` → **必ず Medium**
- ナビアイコン `w-6 h-6` 以上 → **必ず Medium**
- `duration-500` 超過 → **必ず Low**
- `border-gray-100` → **必ず Low**
- `<label>` 完全欠如（placeholder のみ）→ **必ず Critical**
- `<fieldset>` がカード直下で `<legend>` がボーダーと干渉 → **必ず Medium**
- 日付セレクトの均等幅（`grid-cols-3`）→ **必ず Low**

---

## 重大度の変換規則（固定ルールに無いルールを報告するとき）

上の「重大度の固定ルール」が最優先。表にも固定ルールにも無いルール（`rules-index.md` から引いたルールのうち上に列挙されていないもの）は、`design/contracts/rules.json` の `severity` から機械的に変換する:

| rules.json の severity | 既定の重大度 |
|---|---|
| `error` | High |
| `warn` | Medium |

- **Critical は既定では付けない**。固定ルール表に載っているもの、または「スクリーンリーダー・キーボード操作に直接影響する」と本文で説明できるものだけ Critical に昇格させる
- 変換で決めた重大度は、固定ルール表の記載と競合したら **固定ルール表を採る**
- `automationStatus` が `human-only` のルールは重大度を付けない（`## 評価不可` 節へ回す）
