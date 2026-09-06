# デザインレビュー チェックリスト

> SKILL.md Step 3 の詳細。**観点の索引**（HTML のどこをどう見るか）であって、ルールの網羅ではない。
> 網羅は `rules-index.md`（`design/contracts/rules.json` から生成）が持つ。ここに無いカテゴリの違反を見つけたら `rules-index.md` の ID を引いて報告する。

各項目の末尾の `[ID]` は `design/contracts/rules.json` のルール ID。**レポートには必ずこの ID を引用する。**
`[評価不可候補: ルール無し]` の項目は対応するルールが rules.json に無い。違反として数えず「評価不可」節に回す。
ルール ID をバッククォートで引用しない（`[ID]` に統一。`tests/skill-rule-refs.spec.ts` が記法を検査する）。ID でない大文字_大文字語（例: FORM_DATA）を書くときはバッククォートも角括弧も付けない。

---

## 3-1. カラー

- `text-black` → `text-slate-900` [COLOR_NO_TEXT_BLACK]
- `text-gray-400` を本文・ラベルに使用 → `text-body` または `text-slate-500` [COLOR_NO_GRAY_400_BODY]
- `bg-green-*` → `bg-emerald-*` [COLOR_NO_GREEN]
- `bg-yellow-*` → `bg-amber-*` [COLOR_NO_YELLOW]
- `bg-rose-*` → `bg-red-*` [COLOR_NO_ROSE]
- `text-blue-*` for links → `text-primary-500` [COLOR_NO_BLUE_LINKS]
- `bg-primary-400` → `bg-primary-500` [COLOR_NO_PRIMARY_400]
- `bg-gray-300` 以上の暗い背景 → `bg-gray-50` 〜 `bg-gray-200` [COLOR_NO_DARK_BG_GRAY]
- サイドバーに暗い背景色（`bg-slate-800` 等）→ `bg-white` + ボーダー [SPACE_NO_DARK_SIDEBAR_BG]

## 3-2. スペーシング・レイアウト

- `rounded-none` on cards → `rounded-xl` [SPACE_NO_ROUNDED_NONE_CARDS]
- `shadow-lg` / `shadow-2xl`（hover含む）→ `shadow-sm` 〜 `shadow-md` [SPACE_NO_SHADOW_LG] [SPACE_NO_SHADOW_2XL]
- `p-0` 〜 `p-4` on cards（p-5未満）→ `p-5` 以上 [SPACE_NO_P0_CARDS]
- `py-0.5` on buttons → `h-8` 以上（S: h-8 / M: h-10 / L: h-12。padding だけ変えても高さ要件を満たさない）[SPACE_NO_PY_05_BTN]
- `gap-0` between sections → `gap-6` 以上 [SPACE_NO_GAP0_SECTIONS]
- サイドバー幅 `w-60` 等の非標準値 → `w-64` or `w-16` [SPACE_NO_NONSTANDARD_SIDEBAR_WIDTH]
- ナビアイテムの `rounded-xl` → `rounded-lg` [SPACE_NO_ROUNDED_XL_NAV]
- ナビアイコン `w-6 h-6` 以上 → `w-5 h-5`（サイドバー内のアイコンも含む。SVG要素の `class` 属性を確認すること）[SPACE_NO_LARGE_NAV_ICON]

`p-0` 〜 `p-4` は `[SPACE_NO_P0_CARDS]` が `p-0` だけを機械検出する。`p-1` 〜 `p-4` に対応するルールは rules.json に無いので、指摘するなら「観点」であって違反件数には入れない。

## 3-3. タイポグラフィ

- `tracking-tight` → `tracking-normal` 以上 [TYPO_NO_TRACKING_TIGHT]
- `text-xs` for body text → `text-base`（ただし `text-xs` はバッジ・メタ情報・補助ラベル・カードラベルの正規サイズ。違反として報告するのは本文段落 `<p>` または主要見出し `<h1>`〜`<h4>` に使用されている場合のみ）[TYPO_NO_XS_BODY]
- `font-light`（300）→ `font-normal`（400）以上 [TYPO_NO_FONT_LIGHT]

## 3-4. モーション

- `duration-500` 以上 → `duration-300` 以下 [MOTION_NO_LONG_DURATION]

## 3-5. ボーダー

- `border-gray-100` → `border-slate-200`（区切り線に使われている場合は divider 側のルールで引く）[COLOR_NO_GRAY_100_BORDER] [DIVIDER_NO_GRAY_100]

## 3-6. フォーム

- `<select>` に `appearance-none` なし → `appearance-none` + `pr-10` + カスタムSVGシェブロン（`<div class="relative">` で囲む）[FORM_SELECT_APPEARANCE_NONE]
- `<label>` なしの入力欄（プレースホルダーのみ）→ `<label>` を `for` で関連付け。検索欄等で視覚的に非表示にする場合は `sr-only` クラスまたは `aria-label` を使用 [FORM_NO_LABEL_OMIT] [TYPO_NO_PLACEHOLDER_ONLY]
- チェックボックス・ラジオのグループに `<fieldset>` / `<legend>` なし → 必ず使用 [FORM_FIELDSET_LEGEND_REQUIRED]
- `focus:outline-none` で ring なし → `focus:ring-2 focus:ring-primary-500/50` [A11Y_NO_OUTLINE_NONE_WITHOUT_RING]
- `<fieldset>` がカード（`border` + `rounded-xl` 等）の直下にある場合 → `<legend>` のブラウザデフォルト描画がカードのボーダーと干渉し、視覚的に破綻する。カードレベルのセクション見出しには `<div>` + `<h2>` を使用する（`<fieldset>` / `<legend>` はカード内部のフォームコントロールグループに限定）[FORM_NO_CARD_FIELDSET_LEGEND]
- 日付セレクト（年月日）が均等幅（`grid-cols-3` 等）→ 年は `w-28`、月・日は `w-20` で `flex` レイアウトに。年/月/日のサフィックスラベル付与を推奨 [FORM_NO_DATE_EQUAL_WIDTH]

## 3-7. アクセシビリティ

- `<nav>` に `aria-label` なし → **navの数にかかわらず必ず付与する**（1つしかない場合でも `aria-label="メインナビゲーション"` 等を付与。将来的にnavが増えた場合の後方互換性を確保するため）[A11Y_NAV_ARIA_LABEL_REQUIRED]
- Active ナビアイテムに `aria-current="page"` なし → 必ず付与。Active がどれか検体から判定できない場合は違反にせず、評価不可（not-observable-static）へ回す [SPACE_NO_MISSING_ARIA_CURRENT]
- `<th>` に `scope` なし → `scope="col"` or `scope="row"` を付与 [TABLE_TH_SCOPE_REQUIRED]
- アイコンボタンに `aria-label` なし → 操作内容を `aria-label` で明示 [BTN_ICON_ONLY_ARIA_REQUIRED]

---

## 評価不可（human-only）

静的な HTML からは判定できない。**違反件数に入れず**、レポートの「評価不可」節に `reason: human-only` で載せる。

- Drawer にフォーカストラップなし（Tab/Shift+Tab が Drawer 内を循環するか）→ 実行時の挙動なので静的レビューでは判定しない [SPACE_NO_DRAWER_NO_FOCUS_TRAP]

他の human-only ルール（全 9 件）は `rules-index.md` の「人間確認待ち」節を参照する。
