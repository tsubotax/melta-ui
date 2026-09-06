# サイドバー (Sidebar)

> アプリケーションのメインナビゲーションを提供するサイドバーコンポーネント仕様。
> Tailwind CSS 4

---

## 1. 原則

- **ナビゲーションの拠点**: サイドバーはアプリの全ページに共通するメインナビゲーション。ユーザーが現在地を把握し、目的の画面に最短で到達できる構造を保つ
- **3ゾーン構成**: Header（ブランド識別）、Navigation（メインナビ）、Footer（ユーザー/設定）の3ゾーンで構成する。Navigation が最も広い面積を占める
- **現在地を常に明示**: アクティブなナビアイテムは背景色 + テキスト色の2つの視覚的手がかりで現在地を示す。色のみの伝達は禁止
- **レスポンシブに適応**: デスクトップでは固定表示、タブレットではコンパクト表示（アイコンのみ）、モバイルではDrawer化する

---

## 2. 解剖

### 2-1. 標準バリアント（w-64）

```
┌──────────────────── aside (w-64) ──────────────┐
│ [Header Zone]                                   │
│   Logo / アプリ名                                │
│─────────────── border-t ────────────────────────│
│ [Navigation Zone]  ← flex-1 overflow-y-auto     │
│   [Group Label（任意）]                          │
│   ┌─────────────────────────────────────────┐   │
│   │ [Icon]  ダッシュボード         ← Active  │   │
│   ├─────────────────────────────────────────┤   │
│   │ [Icon]  プロジェクト           ← Default │   │
│   ├─────────────────────────────────────────┤   │
│   │ [Icon]  通知 [Badge]                     │   │
│   └─────────────────────────────────────────┘   │
│   [Separator（任意）]                            │
│   [Group Label（任意）]                          │
│   ┌─────────────────────────────────────────┐   │
│   │ [Icon]  設定                             │   │
│   └─────────────────────────────────────────┘   │
│─────────────── border-t ────────────────────────│
│ [Footer Zone]  ← mt-auto                       │
│   [Avatar]  ユーザー名 / メール                  │
└─────────────────────────────────────────────────┘
```

### 2-2. コンパクトバリアント（w-16）

```
┌── aside (w-16) ──┐
│   [Logo Icon]     │
│───────────────────│
│     [Icon] Active │
│     [Icon]        │
│     [Icon] ●      │
│     [Icon]        │
│───────────────────│
│     [Avatar]      │
└───────────────────┘
```

### パーツ

| パーツ | 要素 | 必須 | 説明 |
|--------|------|:----:|------|
| Container | `<aside>` | Yes | サイドバー全体。`flex flex-col` で3ゾーンを縦配置 |
| Header | `<div>` | Yes | ロゴまたはアプリ名を表示 |
| Navigation | `<nav aria-label="メインナビゲーション">` | Yes | メインナビゲーション。`aria-label`（または `aria-labelledby`）は必須。`flex-1 overflow-y-auto` で残りの高さを占有 |
| Nav Item | `<a>` / `<button>` | Yes | 個々のナビゲーションリンク。アイコン + テキスト |
| Nav Group Label | `<p>` | No | ナビゲーションのセクション見出し |
| Separator | `<div>` | No | ナビグループ間の区切り線 |
| Badge | `<span>` | No | ナビアイテムのテキスト右横に配置する通知バッジ |
| Footer | `<div>` | No | ユーザー情報・設定へのリンク。`mt-auto` でボトム固定 |

---

## 3. パターン

### 3-1. ナビアイテム状態

| 状態 | スタイル | 説明 |
|------|---------|------|
| Active | `text-primary-600 bg-primary-50 font-medium rounded-lg` + `aria-current="page"` | 現在のページ |
| Default | `text-body font-medium hover:bg-gray-50 rounded-lg transition-colors` | 通常状態 |
| Hover | `text-body bg-gray-50` | マウスオーバー時 |
| Focus | `focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:outline-none` | キーボードフォーカス時 |
| Disabled | `text-slate-400 cursor-not-allowed` + `aria-disabled="true"` + `tabindex="-1"` | 選択不可 |

### 3-2. バリエーション

| バリエーション | 幅 | 説明 | 用途 |
|----------------|-----|------|------|
| 標準 | `w-64`（256px） | アイコン + テキスト表示 | デスクトップ（lg: 以上） |
| コンパクト | `w-16`（64px） | アイコンのみ。`aria-label` + `title` でテキスト補完 | タブレット（md:）またはユーザー設定 |

### 3-3. ナビグループ

| パターン | クラス | 用途 |
|----------|--------|------|
| セパレータ区切り | `border-t border-slate-200 my-2 mx-1` | シンプルな区切り |
| ラベル付きグループ | `text-xs font-medium text-slate-500 uppercase tracking-wider px-4 pb-1`（先頭グループ以降は `pt-2` 追加） | セクション名が必要な場合 |

### 3-4. バッジ付きナビアイテム

テキスト直後にバッジを配置する。右寄せにはしない。

- **標準**: テキストとバッジを `inline-flex items-center gap-1.5` でラップ
- **コンパクト**: ドットバッジ（`absolute top-1 right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-white`）

バッジ: `bg-red-50 text-red-600 text-xs font-medium rounded-full min-w-[1.25rem] h-5 inline-flex items-center justify-center px-1.5`

---

## 4. 振る舞い

### 4-1. 標準バリアント

| 項目 | 仕様 |
|------|------|
| 表示位置 | ページ左端に固定。`h-screen` で画面高さ全体を占有 |
| スクロール | Navigation ゾーンのみ `overflow-y-auto`。Header / Footer は固定 |
| z-index | `z-30`（z-sticky トークン） |

### 4-2. コンパクトバリアント

| 項目 | 仕様 |
|------|------|
| テキスト | 非表示。アイコンのみ表示 |
| ツールチップ | ナビアイテムに `aria-label` + `title` でテキスト補完 |
| Group Label | 非表示 |
| Footer | アバターのみ表示（テキスト非表示） |
| ナビアイテム | `w-10 h-10 inline-flex items-center justify-center rounded-lg`、中央配置 |

### 4-3. 標準 ←→ コンパクト切り替え

| 項目 | 仕様 |
|------|------|
| トリガー | サイドバー下部のトグルボタン、またはブレークポイント自動切替 |
| アニメーション | `transition: width 300ms ease-in-out`（`w-64` ←→ `w-16`） |
| テキスト | `transition: opacity 200ms ease`（opacity 1 ←→ 0） |
| コンパクト時のナビアイテム | CSS で `w-10 h-10` 正方形、`justify-content: center`、`gap: 0`、`margin: 0 auto` |

### 4-4. モバイルDrawer（lg: 未満）

| 項目 | 仕様 |
|------|------|
| 初期状態 | 非表示。モバイルヘッダー（ハンバーガーメニュー）を表示 |
| トリガー | ハンバーガーボタン（`w-10 h-10`、`aria-label="メニューを開く"`） |
| 表示 | `fixed inset-y-0 left-0 w-64 z-50` + `role="dialog"` + `aria-modal="true"` |
| オーバーレイ | `fixed inset-0 bg-black/50 z-40` |
| 閉じ方 | (1) 閉じるボタン (2) オーバーレイクリック (3) Escape キー |
| 開くアニメーション | `translateX(-100%)` → `translateX(0)` / `300ms ease-out` |
| 閉じるアニメーション | `translateX(0)` → `translateX(-100%)` / `200ms ease-in` |
| フォーカス | 開いたら Drawer 内の最初のリンクにフォーカス。閉じたらトリガーにフォーカス復帰 |

---

## 5. アクセシビリティ

| 項目 | 要件 |
|------|------|
| `<nav>` に `aria-label` | `aria-label="メインナビゲーション"`。ページに複数 `<nav>` がある場合に区別するため必須 |
| 現在のページ | Active なナビアイテムに `aria-current="page"` を付与 |
| Drawer | `role="dialog"` + `aria-modal="true"` + `aria-label="ナビゲーションメニュー"` |
| Drawer トリガー | `aria-expanded="true/false"` + `aria-controls="drawer-id"` |
| Drawer 閉じ後 | フォーカスをトリガーボタンに戻す |
| Escape キー | Drawer を閉じる |
| コンパクト時 | 各アイコンボタンに `aria-label` + `title` でテキスト補完 |
| Disabled | `aria-disabled="true"` + `tabindex="-1"` |
| ランドマーク | `<aside>` を使用。メインコンテンツは `<main>` で囲む |

### 禁止事項

> 共通: `foundations/prohibited.md`「スペーシング・レイアウト」「アクセシビリティ」参照

- `aria-label` なしの `<nav>` 要素
- `aria-current="page"` なしの Active 状態（色のみでの伝達）
- コンパクト時にアイコンの `aria-label` を省略すること
- Drawer 表示中にフォーカスが背面要素に抜けること
- サイドバーに暗い背景色を適用すること

---

## 6. Tailwind サンプル

> primary カラーの具体値は `foundations/theme.md` を参照。

### 6-1. 標準サイドバー（3ゾーン + グループ）

```html
<div class="flex h-screen">
  <aside class="w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col h-full">
    <!-- Header -->
    <div class="px-4 py-4 border-b border-slate-200">
      <div class="flex items-center gap-2">
        <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="currentColor"><!-- ロゴ --></svg>
        <span class="text-lg font-bold text-slate-900">AppName</span>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="メインナビゲーション">
      <!-- Group Label -->
      <p class="text-xs font-medium text-slate-500 uppercase tracking-wider px-4 pb-1">メイン</p>
      <!-- Active -->
      <a href="#" aria-current="page" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
        </svg>
        ダッシュボード
      </a>
      <!-- Default -->
      <a href="#" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 rounded-lg transition-colors">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        プロジェクト
      </a>
      <!-- Badge付き -->
      <a href="#" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 rounded-lg transition-colors">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        <span class="inline-flex items-center gap-1.5">通知<span class="bg-red-50 text-red-600 text-xs font-medium rounded-full min-w-[1.25rem] h-5 inline-flex items-center justify-center px-1.5">3</span></span>
      </a>

      <!-- Separator -->
      <div class="border-t border-slate-200 my-2 mx-1"></div>

      <!-- Group Label -->
      <p class="text-xs font-medium text-slate-500 uppercase tracking-wider px-4 pt-2 pb-1">管理</p>
      <a href="#" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 rounded-lg transition-colors">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        設定
      </a>
      <!-- Disabled -->
      <a class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-400 cursor-not-allowed rounded-lg" aria-disabled="true" tabindex="-1">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
        </svg>
        管理者設定
      </a>
    </nav>

    <!-- Footer -->
    <div class="mt-auto border-t border-slate-200 p-4">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-primary-50 text-primary-600 font-medium text-sm flex items-center justify-center flex-shrink-0">YT</div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-900 truncate">山田 太郎</p>
          <p class="text-xs text-slate-500 truncate">taro@example.com</p>
        </div>
      </div>
    </div>
  </aside>

  <main class="flex-1 bg-gray-50 overflow-y-auto">
    <div class="max-w-5xl mx-auto px-6 py-8">
      <!-- コンテンツ -->
    </div>
  </main>
</div>
```

### 6-2. コンパクトサイドバー（w-16）

```html
<aside class="w-16 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col items-center h-screen">
  <!-- Header -->
  <div class="py-4">
    <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="currentColor"><!-- ロゴ --></svg>
  </div>

  <!-- Navigation -->
  <nav class="flex-1 overflow-y-auto py-4 space-y-1 w-full flex flex-col items-center" aria-label="メインナビゲーション">
    <!-- Active -->
    <a href="#" aria-current="page" aria-label="ダッシュボード" title="ダッシュボード" class="w-10 h-10 inline-flex items-center justify-center text-primary-600 bg-primary-50 rounded-lg">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
    </a>
    <!-- Default -->
    <a href="#" aria-label="プロジェクト" title="プロジェクト" class="w-10 h-10 inline-flex items-center justify-center text-body hover:bg-gray-50 rounded-lg transition-colors">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
    </a>
    <!-- Badge（ドット） -->
    <a href="#" aria-label="通知（3件）" title="通知（3件）" class="relative w-10 h-10 inline-flex items-center justify-center text-body hover:bg-gray-50 rounded-lg transition-colors">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
      </svg>
      <span class="absolute top-1 right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-white"></span>
    </a>

    <div class="border-t border-slate-200 my-2 w-8"></div>

    <a href="#" aria-label="設定" title="設定" class="w-10 h-10 inline-flex items-center justify-center text-body hover:bg-gray-50 rounded-lg transition-colors">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    </a>
  </nav>

  <!-- Footer -->
  <div class="mt-auto border-t border-slate-200 py-4">
    <div class="w-8 h-8 rounded-full bg-primary-50 text-primary-600 font-medium text-sm flex items-center justify-center">YT</div>
  </div>
</aside>
```

### 6-3. レスポンシブサイドバー（モバイルDrawer + デスクトップ固定）

```html
<div class="flex h-screen">
  <!-- Desktop Sidebar (lg: 以上で表示) -->
  <aside class="hidden lg:flex lg:flex-col lg:w-64 bg-white border-r border-slate-200 flex-shrink-0 h-screen">
    <!-- Header / Nav / Footer は §6-1 と同じ -->
  </aside>

  <!-- Mobile Header (lg: 未満で表示) -->
  <div class="lg:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <svg class="w-6 h-6 text-primary-500" viewBox="0 0 24 24" fill="currentColor"><!-- ロゴ --></svg>
      <span class="text-lg font-bold text-slate-900">AppName</span>
    </div>
    <button id="sidebar-trigger" aria-label="メニューを開く" aria-expanded="false" aria-controls="sidebar-drawer"
      class="w-10 h-10 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
      <svg class="w-6 h-6 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
    </button>
  </div>

  <!-- Drawer Overlay -->
  <div id="sidebar-overlay" class="hidden fixed inset-0 bg-black/50 z-40" onclick="closeSidebarDrawer()"></div>

  <!-- Drawer -->
  <aside id="sidebar-drawer" role="dialog" aria-modal="true" aria-label="ナビゲーションメニュー"
    class="fixed inset-y-0 left-0 w-64 bg-white z-50 flex flex-col shadow-xl -translate-x-full transition-transform duration-300 ease-out">
    <!-- Header（閉じるボタン付き） -->
    <div class="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="currentColor"><!-- ロゴ --></svg>
        <span class="text-lg font-bold text-slate-900">AppName</span>
      </div>
      <button onclick="closeSidebarDrawer()" aria-label="メニューを閉じる"
        class="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-slate-500">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <!-- Nav / Footer は §6-1 と同じ -->
  </aside>

  <!-- Main -->
  <main class="flex-1 bg-gray-50 overflow-y-auto pt-14 lg:pt-0">
    <div class="max-w-7xl mx-auto px-4 py-6 md:px-6 md:py-8 lg:px-8 lg:py-12">
      <!-- コンテンツ -->
    </div>
  </main>
</div>
```

### 6-4. JavaScript（Drawer 開閉）

```javascript
// フォーカストラップ（Drawer 内で Tab を循環させる）
function trapFocus(drawerEl) {
  var focusable = drawerEl.querySelectorAll(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];

  drawerEl._focusTrapHandler = function(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  drawerEl.addEventListener('keydown', drawerEl._focusTrapHandler);
}

function releaseFocusTrap(drawerEl) {
  if (drawerEl._focusTrapHandler) {
    drawerEl.removeEventListener('keydown', drawerEl._focusTrapHandler);
    drawerEl._focusTrapHandler = null;
  }
}

function openSidebarDrawer() {
  var overlay = document.getElementById('sidebar-overlay');
  var drawer = document.getElementById('sidebar-drawer');
  var trigger = document.getElementById('sidebar-trigger');

  overlay.classList.remove('hidden');
  drawer.classList.remove('-translate-x-full');
  trigger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';

  trapFocus(drawer);
  var firstFocusable = drawer.querySelector('a, button');
  if (firstFocusable) firstFocusable.focus();
}

function closeSidebarDrawer() {
  var overlay = document.getElementById('sidebar-overlay');
  var drawer = document.getElementById('sidebar-drawer');
  var trigger = document.getElementById('sidebar-trigger');

  releaseFocusTrap(drawer);
  drawer.classList.add('-translate-x-full');
  overlay.classList.add('hidden');
  trigger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  trigger.focus();
}

// Escape キーで閉じる
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var drawer = document.getElementById('sidebar-drawer');
    if (drawer && !drawer.classList.contains('-translate-x-full')) {
      closeSidebarDrawer();
    }
  }
});
```

> `prefers-reduced-motion` 対応: Drawer のスライドアニメーションは `@media (prefers-reduced-motion: reduce) { .sidebar-drawer { transition: none; } }` で無効化する。
