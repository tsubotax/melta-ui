# Card

> カードコンポーネント仕様。
> Tailwind CSS 4

---

## 1. 原則

- **カードは関連する情報をグループ化するコンテナ**: 視覚的な境界を持つことで、情報のまとまりを明示する
- **1カード1コンテキスト**: 1つのカードに詰め込みすぎない。複数のコンテキストは複数のカードに分割する
- **視覚的階層**: タイトル → 説明 → アクションの順で情報を配置し、読み取りやすさを担保する
- **ホバー浮き上がり**: インタラクティブなカードは `shadow-md` でフィードバックを返し、クリック可能であることを暗示する

---

## 2. 解剖

```
┌──────────────────────────────────┐
│ [Image / Media]                   │  ← Optional
├──────────────────────────────────┤
│  Title                            │
│  Description                      │
│                                   │
│  [Meta]          [Action Button]  │
└──────────────────────────────────┘
```

| パーツ | 役割 | 必須 |
|--------|------|------|
| Container | カードの外枠。背景・ボーダー・シャドウで境界を示す | Yes |
| Image / Media | サムネイルやビジュアル要素 | No |
| Title | カードの主題を示すテキスト | Yes |
| Description | 補足説明文 | No |
| Meta | 日付、カテゴリ、著者などのメタ情報 | No |
| Actions | ボタンやリンクなどのインタラクション要素 | No |

---

## 3. パターン

### 基本カード
タイトルと説明のみのシンプルな構成。情報の表示に使用。

### メトリクスカード
数値を大きく表示するダッシュボード用カード。KPIやサマリー値の表示に使用。

### メディアカード
画像やサムネイルを上部に配置。ブログ記事やギャラリーに使用。

### アクションカード
フッターにボタンを配置。確認や操作を伴うコンテンツに使用。

### リンクカード
カード全体がクリック可能。一覧から詳細への遷移に使用。

---

## 4. 振る舞い

### 状態遷移

| 状態 | 視覚変化 | 備考 |
|------|---------|------|
| Default | 標準表示（`shadow-sm`） | 初期状態 |
| Hover | シャドウが強まる（`shadow-md`） | リンクカードのみ |
| Active | さらにシャドウが変化 | クリック中 |
| Focus | フォーカスリング表示 | キーボード操作時 |

### リンクカード
- `hover:shadow-md transition-shadow` でホバー時の浮き上がりを表現する
- カード全体を `<a>` タグで囲む
- **グリッド内では高さ揃え必須**: `<a>` と `<article>` に `h-full`、コンテンツ部を `flex flex-col flex-1`、末尾要素（価格等）に `mt-auto` を付与する。これによりバッジ有無等でカード高さが異なる場合もホバー shadow の範囲が統一される

### 静的カード
- ホバー効果なし。情報表示のみの場合に使用する
- カード内のアクションボタンは個別にインタラクションを持つ

---

## 5. アクセシビリティ

### 必須事項
- リンクカードは `<a>` タグで囲み、フォーカス可能にする
- カード内のアクションボタンは個別にフォーカス可能にする
- テキストのコントラスト比は背景との間で 4.5:1 以上を確保する
- 画像には適切な `alt` 属性を付与する
- カードグリッドはキーボードで順序通りにナビゲート可能にする

### 禁止事項

> 共通: `foundations/prohibited.md`「カラー」参照

- リンクカード内にネストされたインタラクティブ要素を配置すること
- `alt` なしの画像をメディアカードで使用すること
- 色だけでカードの状態や種類を伝達すること
- カード上部や左端にカラーバー/カラーストライプを装飾として付けること（AI生成UIの典型パターン）

---

## 6. Tailwind サンプル

### 基本カード

```html
<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
  <h3 class="text-xl font-semibold text-slate-900">カードタイトル</h3>
  <p class="mt-2 text-base text-body">カードの説明文がここに入ります。</p>
</div>
```

### メトリクスカード

```html
<div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
  <p class="text-sm font-medium text-body">月間アクティブユーザー</p>
  <p class="mt-1 text-3xl font-bold text-slate-900">12,345</p>
  <p class="mt-1 text-sm text-emerald-600">+12.5% 前月比</p>
</div>
```

### メディアカード

```html
<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
  <img src="..." alt="画像の説明" class="w-full h-48 object-cover">
  <div class="p-6">
    <h3 class="text-lg font-semibold text-slate-900">タイトル</h3>
    <p class="mt-2 text-sm text-body">説明文</p>
  </div>
</div>
```

### アクションカード

```html
<div class="bg-white rounded-xl border border-slate-200 shadow-sm">
  <div class="p-6">
    <h3 class="text-lg font-semibold text-slate-900">タイトル</h3>
    <p class="mt-2 text-sm text-body">説明文</p>
  </div>
  <div class="px-6 py-3 border-t border-slate-200 flex justify-end gap-3">
    <button class="h-8 px-3 text-[0.875rem] font-medium text-body rounded-lg hover:bg-gray-100 transition-colors">キャンセル</button>
    <button class="h-8 px-3 text-[0.875rem] font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-700 transition-colors">保存</button>
  </div>
</div>
```

### リンクカード（単体）

```html
<a href="#" class="block bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
  <h3 class="text-lg font-semibold text-slate-900">タイトル</h3>
  <p class="mt-2 text-sm text-body">クリックで詳細ページに遷移します。</p>
</a>
```

### リンクカード（グリッド内・高さ揃え）

```html
<a href="#" class="block h-full hover:shadow-md transition-shadow rounded-xl">
  <article class="h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
    <img src="..." alt="画像の説明" class="w-full h-48 object-cover">
    <div class="p-4 flex flex-col flex-1">
      <h3 class="text-base font-medium text-slate-900">タイトル</h3>
      <p class="mt-auto pt-3 text-base font-bold text-slate-900">末尾要素</p>
    </div>
  </article>
</a>
```

### カードグリッド

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
    <h3 class="text-lg font-semibold text-slate-900">カード 1</h3>
    <p class="mt-2 text-sm text-body">説明文</p>
  </div>
  <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
    <h3 class="text-lg font-semibold text-slate-900">カード 2</h3>
    <p class="mt-2 text-sm text-body">説明文</p>
  </div>
  <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
    <h3 class="text-lg font-semibold text-slate-900">カード 3</h3>
    <p class="mt-2 text-sm text-body">説明文</p>
  </div>
</div>
```

## APPの影なし指定

`elevation="none"` は製品テーマがフラットな面を使う場合の明示指定。既定値 `default` は従来の影を維持する。none時は押下中も影を付けず、背景・枠・余白は維持する。操作は引き続きprimaryActionで到達できる。
