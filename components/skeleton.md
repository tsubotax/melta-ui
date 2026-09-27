# Skeleton

> ローディング中のコンテンツ占有領域を示すプレースホルダーコンポーネント仕様。
> Tailwind CSS 4

---

## 1. 原則

- **Effortless**: コンテンツの形状を予告し、認知コストを下げる
- **Whisper**: アニメーションは控えめに。pulse 1.5s のみ許可
- **Inclusive**: `prefers-reduced-motion` でアニメーションを停止する
- **差し替え前提**: スケルトンは実コンテンツが到着したら即座に置き換える

---

## 2. 解剖

### カードスケルトン

```
┌─────────────────────────────┐
│  ┌──┐  ████████████  70%    │
│  │  │  ████████  50%        │
│  └──┘                       │
│  ████████████████████ 100%  │
│  █████████████████  85%     │
└─────────────────────────────┘
```

| パーツ | 役割 | クラス |
|--------|------|--------|
| Container | スケルトン全体のラッパー | `space-y-4` + `aria-busy="true"` `role="status"` |
| Circle | アバター等の円形プレースホルダー | `rounded-full bg-slate-200 skeleton-pulse` |
| Bar | テキスト行のプレースホルダー | `rounded-md bg-slate-200 skeleton-pulse` + 高さ（h-3〜h-4） |
| SR-only text | スクリーンリーダー向け読み込み状態テキスト | `sr-only` |

### インラインスピナー

```
[◌ 送信中...]   ← ボタン内に配置
```

| パーツ | 役割 | クラス |
|--------|------|--------|
| Spinner | 回転インジケーター | `inline-spinner`（CSS: clip-path arc） |
| Label | 処理中テキスト | ボタンテキストを変更（例:「送信中...」） |

### ドットローダー

```
▐▌▐   ← 3バー波打ち
```

| パーツ | 役割 | クラス |
|--------|------|--------|
| Bars | 3本のバー要素 | `dot-loader` > `<span>` x 3 |
| Label | 補足テキスト | `text-sm text-slate-500 mt-3` |

---

## 3. パターン

### 3-1. スケルトン（カード型 / リスト型 / テーブル型）

コンテンツの形状を模倣し、読み込み完了後のレイアウトを予告する。

| バリエーション | 用途 | 行数目安 |
|----------------|------|----------|
| カード型 | アバター + テキスト2行 + 本文2行 | 4〜6行 |
| リスト型 | アバター + テキスト1行 を繰り返す | 3〜5アイテム |
| テーブル型 | ヘッダー + 行を繰り返す | 3〜5行 |

### 3-2. インラインスピナー（ボタン内）

ボタン操作後の処理中状態を示す。ボタンは `disabled` + `opacity-75` + `cursor-not-allowed` にする。

### 3-3. ドットローダー（部分読み込み）

ページの一部領域だけが読み込み中の場合に使用する。全画面占有は禁止。

---

## 4. 振る舞い

### スケルトン CSS

> SSOT: `patterns/interaction-states.md`「Loading」セクション

```css
@keyframes skeletonPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.skeleton-pulse { animation: skeletonPulse 1.5s ease-in-out infinite; }
```

### インラインスピナー CSS

> SSOT: `patterns/interaction-states.md`「Loading」セクション

```css
.inline-spinner {
  width: 1em;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2.5px solid currentColor;
  animation:
    spinnerClip 0.8s infinite linear alternate,
    spinnerRotate 1.6s infinite linear;
}
```

### ドットローダー CSS

> SSOT: `patterns/interaction-states.md`「Loading」セクション

```css
.dot-loader {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 34px;
}
.dot-loader span {
  width: 9px;
  height: 17px;
  background: var(--color-primary-500, #2b70ef);
  border-radius: 3px;
  animation: dotWave 1.2s infinite ease-in-out;
}
.dot-loader span:nth-child(2) { animation-delay: 0.2s; }
.dot-loader span:nth-child(3) { animation-delay: 0.4s; }
```

### prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  .skeleton-pulse { animation: none; opacity: 0.6; }
  .inline-spinner { animation: none; border-style: dotted; }
  .dot-loader span { animation: none; }
}
```

---

## 5. アクセシビリティ

| 属性 | 値 | 対象 |
|------|------|------|
| `aria-busy` | `"true"` | スケルトンのコンテナ要素 |
| `role` | `"status"` | スケルトン / ドットローダーのコンテナ |
| SR-only text | `<span class="sr-only">読み込み中</span>` | コンテナ内に配置 |
| `disabled` | — | スピナー表示中のボタン |
| `aria-busy` 解除 | `"false"` に変更 | 実コンテンツ到着時に必ず解除する |

---

## 6. Tailwind サンプル

### カードスケルトン

```html
<div aria-busy="true" role="status" class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
  <span class="sr-only">読み込み中</span>
  <div class="flex items-center gap-3">
    <div class="w-10 h-10 rounded-full bg-slate-200 skeleton-pulse"></div>
    <div class="flex-1 space-y-2">
      <div class="h-4 bg-slate-200 rounded-md w-3/4 skeleton-pulse"></div>
      <div class="h-3 bg-slate-200 rounded-md w-1/2 skeleton-pulse"></div>
    </div>
  </div>
  <div class="space-y-2">
    <div class="h-3 bg-slate-200 rounded-md w-full skeleton-pulse"></div>
    <div class="h-3 bg-slate-200 rounded-md w-5/6 skeleton-pulse"></div>
  </div>
</div>
```

### リストスケルトン（アバター + テキスト行）

```html
<div aria-busy="true" role="status" class="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-200">
  <span class="sr-only">読み込み中</span>
  <div class="flex items-center gap-3 px-6 py-4">
    <div class="w-10 h-10 rounded-full bg-slate-200 skeleton-pulse flex-shrink-0"></div>
    <div class="flex-1 space-y-2">
      <div class="h-4 bg-slate-200 rounded-md w-1/3 skeleton-pulse"></div>
      <div class="h-3 bg-slate-200 rounded-md w-1/2 skeleton-pulse"></div>
    </div>
  </div>
  <div class="flex items-center gap-3 px-6 py-4">
    <div class="w-10 h-10 rounded-full bg-slate-200 skeleton-pulse flex-shrink-0"></div>
    <div class="flex-1 space-y-2">
      <div class="h-4 bg-slate-200 rounded-md w-2/5 skeleton-pulse"></div>
      <div class="h-3 bg-slate-200 rounded-md w-1/3 skeleton-pulse"></div>
    </div>
  </div>
  <div class="flex items-center gap-3 px-6 py-4">
    <div class="w-10 h-10 rounded-full bg-slate-200 skeleton-pulse flex-shrink-0"></div>
    <div class="flex-1 space-y-2">
      <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
      <div class="h-3 bg-slate-200 rounded-md w-2/5 skeleton-pulse"></div>
    </div>
  </div>
</div>
```

### テーブルスケルトン

```html
<div aria-busy="true" role="status" class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
  <span class="sr-only">読み込み中</span>
  <!-- Header -->
  <div class="flex gap-4 px-6 py-3 border-b border-slate-200 bg-slate-50">
    <div class="h-3 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-3 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-3 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-3 bg-slate-200 rounded-md w-1/6 skeleton-pulse"></div>
  </div>
  <!-- Row 1 -->
  <div class="flex gap-4 px-6 py-4 border-b border-slate-200">
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/6 skeleton-pulse"></div>
  </div>
  <!-- Row 2 -->
  <div class="flex gap-4 px-6 py-4 border-b border-slate-200">
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/6 skeleton-pulse"></div>
  </div>
  <!-- Row 3 -->
  <div class="flex gap-4 px-6 py-4">
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/4 skeleton-pulse"></div>
    <div class="h-4 bg-slate-200 rounded-md w-1/6 skeleton-pulse"></div>
  </div>
</div>
```

### インラインスピナー（ボタン内）

```html
<button disabled class="inline-flex items-center gap-2 h-10 px-4 text-[1rem] font-medium text-white bg-primary-500 rounded-lg opacity-75 cursor-not-allowed">
  <div class="inline-spinner"></div>
  送信中...
</button>
```

### ドットローダー

```html
<div role="status" class="flex flex-col items-center justify-center py-16">
  <div class="dot-loader"><span></span><span></span><span></span></div>
  <p class="text-sm text-slate-500 mt-3">読み込み中...</p>
  <span class="sr-only">読み込み中</span>
</div>
```

---

## 禁止事項

> 共通: `foundations/prohibited.md`「スケルトン・ローディング」参照

- スケルトンに `bg-slate-200` 以外の色を使用すること
- 常時回転スピナーのみの全画面表示（スケルトン or プログレスバーを併用）
- `aria-busy="true"` の省略
- 実コンテンツ到着後に `aria-busy` を解除しないこと

## APPの影なし指定

`elevation="none"` は製品テーマがフラットな面を使う場合の明示指定。既定値 `default` は従来の影を維持する。none時は押下中も影を付けず、背景・枠・余白は維持する。text/circleではカード用の影を参照しない。
