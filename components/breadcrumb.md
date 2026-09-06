# Breadcrumb

> 階層パスナビゲーションコンポーネント仕様。
> Tailwind CSS 4

---

## 1. 原則

- **階層構造の可視化**: 現在のページがサイト構造のどこに位置するかを示す
- **ナビゲーション補助**: 上位階層へ素早く移動できる
- **省略対応**: 深い階層は `...` で中間を省略し、簡潔に表示する
- **セマンティック**: `<nav aria-label="パンくずリスト">` + `<ol>` で構造を明示。`<nav>` にはアクセシブルネームを必ず付与する

---

## 2. 解剖

```
  ホーム  /  プロジェクト  /  設定
```

| パーツ | 役割 | 必須 |
|--------|------|------|
| Nav Container | `<nav aria-label="パンくずリスト">` | Yes |
| Ordered List | `<ol>` でリスト構造を明示 | Yes |
| Link Item | 上位階層へのリンク | Yes |
| Separator | 階層間の区切り文字（`/` または chevron） | Yes |
| Current Page | 現在のページ名（リンクなし） | Yes |
| Ellipsis | 省略記号 `...`（深い階層時） | No |
| Home Icon | ホームアイコン（テキストの代替） | No |

---

## 3. パターン

### 3-1. セパレータ

| 種類 | 表示 | 用途 |
|------|------|------|
| スラッシュ | `/` (`text-slate-500`) | デフォルト。シンプルな区切り |
| Chevron | `>` SVGアイコン (`text-slate-500 w-4 h-4`) | より明確な方向性が必要な場合 |

### 3-2. バリエーション

| バリエーション | 説明 |
|----------------|------|
| 基本 | テキストリンク + スラッシュ区切り |
| ホームアイコン付き | 先頭をホームアイコンに置換 |
| 省略パターン | Home / ... / Parent / Current |
| Chevron セパレータ | `>` 型の矢印アイコンで区切り |

---

## 4. 振る舞い

> このコンポーネントは静的表示のため、スタイル仕様を記載する。

| パーツ | クラス |
|--------|--------|
| リスト | `flex items-center gap-2 text-sm` |
| リンク | `text-slate-500 hover:text-slate-700 transition-colors` |
| セパレータ | `text-slate-500` |
| 現在のページ | `text-slate-900 font-medium` |
| 省略記号 | `text-slate-500` |
| ホームアイコン | `w-4 h-4` + `currentColor` |
| Chevron | `w-4 h-4 text-slate-500` |

---

## 5. アクセシビリティ

| 属性 | 値 |
|------|------|
| `<nav aria-label>` | `"パンくずリスト"` |
| `<ol>` | 順序付きリストで構造を明示 |
| `aria-current` | 現在のページに `"page"` を設定 |
| ホームアイコン | `aria-label="ホーム"` 必須 |
| 現在のページ | `<span>`（リンクにしない） |

> 共通: prohibited.md「カラー」「アクセシビリティ」参照

---

## 6. Tailwind サンプル

### 基本

```html
<nav aria-label="パンくずリスト">
  <ol class="flex items-center gap-2 text-sm">
    <li><a href="#" class="text-slate-500 hover:text-slate-700 transition-colors">ホーム</a></li>
    <li class="text-slate-500">/</li>
    <li><a href="#" class="text-slate-500 hover:text-slate-700 transition-colors">プロジェクト</a></li>
    <li class="text-slate-500">/</li>
    <li><span class="text-slate-900 font-medium" aria-current="page">設定</span></li>
  </ol>
</nav>
```

### ホームアイコン付き

```html
<nav aria-label="パンくずリスト">
  <ol class="flex items-center gap-2 text-sm">
    <li>
      <a href="#" class="text-slate-500 hover:text-slate-700 transition-colors" aria-label="ホーム">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
        </svg>
      </a>
    </li>
    <li class="text-slate-500">/</li>
    <li><a href="#" class="text-slate-500 hover:text-slate-700 transition-colors">カテゴリ</a></li>
    <li class="text-slate-500">/</li>
    <li><span class="text-slate-900 font-medium" aria-current="page">詳細</span></li>
  </ol>
</nav>
```

### 省略パターン

```html
<nav aria-label="パンくずリスト">
  <ol class="flex items-center gap-2 text-sm">
    <li>
      <a href="#" class="text-slate-500 hover:text-slate-700 transition-colors" aria-label="ホーム">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">...</svg>
      </a>
    </li>
    <li class="text-slate-500">/</li>
    <li><span class="text-slate-500" aria-hidden="true">...</span></li>
    <li class="text-slate-500">/</li>
    <li><a href="#" class="text-slate-500 hover:text-slate-700 transition-colors">親ページ</a></li>
    <li class="text-slate-500">/</li>
    <li><span class="text-slate-900 font-medium" aria-current="page">現在のページ</span></li>
  </ol>
</nav>
```
