# List

> リストコンポーネント仕様。
> Tailwind CSS 4

---

## 1. 原則

- **左から右への情報フロー**: 主要コンテンツを左に、補助的な要素を右に配置する。自然な読み順に従う
- **アイコン位置で意味が変わる**: 左アイコンは「対象の種類」、右アイコンは「対象へのアクション」を示す
- **画像位置で意味が変わる**: 左画像は「画像が本体、テキストが修飾」、右画像は「テキストが本体、画像が修飾」
- **高さはコンテンツに追従**: 固定高さではなく、内包するテキスト量に応じた可変高さを基本とする
- **ボーダーは情報の区切りを示す**: 装飾ではなく、情報の断絶度合いを視覚化する目的で使用する
- **見出しと本文のサイズ比は120%〜150%**: テキストの階層をサイズで明確にする

---

## 2. 解剖

```
┌─────────────────────────────────────────────┐
│ [Left Icon/Image]  Primary Text    [Action] │
│                    Secondary Text   [Arrow]  │
└─────────────────────────────────────────────┘
─────────────────────────────────────────────── ← Border
┌─────────────────────────────────────────────┐
│ [Left Icon/Image]  Primary Text    [Action] │
│                    Secondary Text   [Arrow]  │
└─────────────────────────────────────────────┘
```

| パーツ | 役割 | 必須 |
|--------|------|------|
| Container | リストアイテムの外枠 | Yes |
| Primary Text | メインの情報。遷移先タイトルまたはアクション名 | Yes |
| Secondary Text | 補足情報。日付、説明、メタデータ等 | No |
| Left Icon | 対象の種類を示すアイコン | No |
| Left Image | サムネイル。画像が主体の場合に左配置 | No |
| Right Icon | アクション/遷移を示すアイコン（矢印、展開等） | No |
| Right Image | 補助的な画像。テキストが主体の場合に右配置 | No |
| Action | トグル、ボタン、チェックボックス等のインタラクション | No |
| Border | アイテム間の区切り線 | 条件付き |

---

## 3. パターン

### Link List（遷移リスト）
リストアイテムの内容が遷移先のタイトルと一致。メニューに使用。

```
┌─────────────────────────────────┐
│  カンバンボード               → │
├─────────────────────────────────┤
│  バックログ                   → │
├─────────────────────────────────┤
│  設定                         → │
└─────────────────────────────────┘
```

### Information List（情報リスト）
遷移やアクションを持たない自己完結型。

```
┌─────────────────────────────────┐
│  ステータス            進行中    │
├─────────────────────────────────┤
│  優先度                高        │
├─────────────────────────────────┤
│  作成日          2026-02-21     │
└─────────────────────────────────┘
```

### Action List（アクションリスト）
ラベルがアクション名。左アイコンで種類、右アイコンでアクションを示す。

```
┌─────────────────────────────────┐
│  📝 エピックを追加             + │
├─────────────────────────────────┤
│  📊 レポートを作成             + │
├─────────────────────────────────┤
│  🗑  削除する                    │
└─────────────────────────────────┘
```

### Overview List（プレビューリスト）
遷移先のコンテンツをプレビュー表示。

```
┌─────────────────────────────────┐
│  MVP検証エピック               → │
│  KPI接続率を100%にする...        │
├─────────────────────────────────┤
│  カンバンUI改善                → │
│  ドラッグ&ドロップで直感的に...   │
└─────────────────────────────────┘
```

### Toggle List（設定リスト）
即時反映のON/OFF設定。

```
┌─────────────────────────────────┐
│  メール通知              [==●]  │
├─────────────────────────────────┤
│  Day1リマインド          [●==]  │
└─────────────────────────────────┘
```

### Selection List（選択リスト）
選択/非選択状態を保持。色だけでなくボーダー太さや背景で状態を表現する。

### Accordion List（折りたたみ）
コンテンツの展開/折りたたみ。スペース節約に使用。

---

## 4. 振る舞い

### 状態遷移

| 状態 | 視覚変化 | 備考 |
|------|---------|------|
| Default | 標準表示 | 初期状態 |
| Hover | 背景色が薄く変化 | `hover:bg-gray-50` |
| Active | さらに濃い背景 | クリック中 |
| Focus | フォーカスリング表示 | キーボード操作時 |
| Selected | ボーダー強調 + 背景変化 | 色だけでなくボーダー太さも変更 |
| Visited | テキスト色変化 | テキストリンクのみ |

### スクロールとページング
- リストが長い場合はページネーションまたは無限スクロールを検討
- スクロール中のパフォーマンスを考慮する

### 追加/削除
- 追加: リストの前後にアイテムを追加。フレームワーク固有のリアルタイム更新を使用
- 削除: スワイプ操作に依存しない代替操作を必ず提供する（編集ボタン + タップ選択）

### Accordion
- 展開/折りたたみはアニメーション付き
- ネストされたリストや追加読み込みに対応

---

## 5. アクセシビリティ

### 必須事項
- スワイプ/ドラッグ操作にはキーボード・ボタンによる代替手段を必ず提供する
- テキスト・画像テキストのコントラスト比 4.5:1 以上
- アイコンのコントラスト比 3:1 以上
- テキストとアイコンは200%拡大時にクリッピングしない
- ラベルは押した結果・遷移先を予測可能な文言にする
- フォーカスは表示順に移動する（キーボードアクセシビリティ）
- 装飾以外のアイコンには代替テキストを付与する（特に選択状態、展開状態のインジケーター）
- 追加・削除・状態変更はスクリーンリーダーにステータスメッセージで通知する（`aria-live`）
- 選択/非選択の状態を色だけで伝達しない（ボーダー太さ、背景スタイルを併用）

### 禁止事項

> 共通: `foundations/prohibited.md`「リスト」「アクセシビリティ」参照

- 操作結果が予測できないラベル

---

## 6. Tailwind サンプル

### Link List（ナビゲーション）

```html
<nav aria-label="プロジェクトナビゲーション">
  <ul class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
    <li>
      <a href="#" class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
        <span class="text-sm font-medium text-slate-900">カンバンボード</span>
        <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </a>
    </li>
    <li>
      <a href="#" class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
        <span class="text-sm font-medium text-slate-900">バックログ</span>
        <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </a>
    </li>
  </ul>
</nav>
```

### Information List（データテーブル風）

```html
<dl class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
  <div class="flex items-center justify-between px-4 py-3">
    <dt class="text-sm text-body">ステータス</dt>
    <dd class="text-sm font-medium text-slate-900">進行中</dd>
  </div>
  <div class="flex items-center justify-between px-4 py-3">
    <dt class="text-sm text-body">優先度</dt>
    <dd>
      <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        高
      </span>
    </dd>
  </div>
  <div class="flex items-center justify-between px-4 py-3">
    <dt class="text-sm text-body">作成日</dt>
    <dd class="text-sm font-medium text-slate-900">2026-02-21</dd>
  </div>
</dl>
```

### Overview List（プレビュー付き）

```html
<ul class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
  <li>
    <a href="#" class="block px-4 py-3 hover:bg-gray-50 transition-colors">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-slate-900">MVP検証エピック</h3>
        <svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
      <p class="mt-1 text-xs text-slate-500 line-clamp-1">KPI接続率を100%にする...</p>
    </a>
  </li>
  <li>
    <a href="#" class="block px-4 py-3 hover:bg-gray-50 transition-colors">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-slate-900">カンバンUI改善</h3>
        <svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
      <p class="mt-1 text-xs text-slate-500 line-clamp-1">ドラッグ&ドロップで直感的に...</p>
    </a>
  </li>
</ul>
```

### Action List

```html
<ul class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
  <li>
    <button class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
      <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
      </svg>
      <span class="text-sm font-medium text-slate-900">エピックを追加</span>
    </button>
  </li>
  <li>
    <button class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
      <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <span class="text-sm font-medium text-slate-900">レポートを作成</span>
    </button>
  </li>
  <li>
    <button class="w-full flex items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50 transition-colors">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
      </svg>
      <span class="text-sm font-medium">削除する</span>
    </button>
  </li>
</ul>
```

### Accordion List

```html
<ul class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
  <li>
    <!-- アコーディオンアイテム: クリックで content の表示/非表示を切り替える -->
    <button
      aria-expanded="false"
      class="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
      <span class="text-sm font-medium text-slate-900">Sprint 001</span>
      <!-- 展開時は rotate-180 を付与する -->
      <svg
        class="w-4 h-4 text-slate-500 transition-transform duration-200"
        fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>
    </button>
    <!-- 折りたたみコンテンツ: 初期状態は非表示。展開時に hidden を外す -->
    <div class="hidden px-4 pb-3">
      <ul class="space-y-2 ml-4">
        <li class="text-sm text-body">MVP検証エピック</li>
        <li class="text-sm text-body">カンバンUI改善</li>
      </ul>
    </div>
  </li>
</ul>
```

### バッジ付きリスト（ステータス表示）

```html
<ul class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
  <li class="flex items-center justify-between px-4 py-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-medium text-slate-900 truncate">MVP検証エピック</h3>
    </div>
    <span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 bg-emerald-50 text-emerald-700">
      完了
    </span>
  </li>
  <li class="flex items-center justify-between px-4 py-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-medium text-slate-900 truncate">カンバンUI改善</h3>
    </div>
    <span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 bg-amber-50 text-amber-700">
      進行中
    </span>
  </li>
  <li class="flex items-center justify-between px-4 py-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-medium text-slate-900 truncate">KPIダッシュボード</h3>
    </div>
    <span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 bg-slate-100 text-slate-700">
      未着手
    </span>
  </li>
</ul>
```
