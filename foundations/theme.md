# Theme Configuration

> プロジェクトごとのカスタマイズはこのファイルで完結する。
> プロジェクト側に `design-system/foundations/theme.md` がある場合はそちらの値で上書きされる。

---

## Brand

- Primary color: `#2B70EF`（OKLCH再生成 — WCAG AA 4.50:1）
- Brand name: （プロジェクトで設定）

## Primary Palette

```css
--color-primary-50:  #f0f5ff;
--color-primary-100: #dde8ff;
--color-primary-200: #c0d4ff;
--color-primary-300: #95b6ff;
--color-primary-400: #6492ff;
--color-primary-500: #2b70ef;   /* ★ CTA・ボタン・アクティブ状態（hover は 700） */
--color-primary-600: #2250df;
--color-primary-700: #1a40b5;
--color-primary-800: #13318d;
--color-primary-900: #0e266a;
--color-primary-950: #07194e;
```

WCAGコントラスト比:
- 白文字 on primary-500: **4.50:1** — AA準拠
- primary-500 on 白背景: **4.50:1** — AA準拠

ダークモードでの使い分け:

| 用途 | Light | Dark | 理由 |
|------|-------|------|------|
| CTAボタン背景 | primary-500 | primary-500 | 暗い背景での視認性確保 |
| テキストリンク | primary-500 | primary-400 | slate-800上でのコントラスト比確保 |
| Subtle背景 | primary-50 | primary-500/12% | 透過で暗い背景に馴染ませる |
| フォーカスリング | primary-500/50 | primary-400/50 | 同上 |

## Font Stack

```
font-sans: "Inter", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif
font-mono: "JetBrains Mono", "SF Mono", monospace
```

## Icon Library

デュアルソース構成。Charcoal をプライマリとし、SaaS 向けの不足分を Lucide で補完する。

### プライマリ: Charcoal Icons 2.0

- Source: **Charcoal Icons 2.0**（pixiv design system）
- Format: SVGファイル（`assets/icons/{Name}.svg`）全207個
- Size: 24px統一（表示サイズはTailwindクラスで制御）
- Naming: PascalCase（例: `ArrowDown`, `OpenInNew`）
- Color: `fill="currentColor"` でテーマカラーを継承

### セカンダリ: Lucide Icons（補完用）

- Source: **Lucide Icons**（Charcoal に存在しないアイコンのみ）
- Format: SVGファイル（`assets/icons/lucide/{name}.svg`）15個
- Size: 24px viewBox（表示サイズはTailwindクラスで制御）
- Naming: kebab-case（例: `bar-chart-2`, `trending-up`）
- Color: `stroke="currentColor"` + `fill="none"` でテーマカラーを継承
- 対象: Analytics（bar-chart-2, trending-up/down, activity）、Time（clock）、Security（shield, key）、Infrastructure（cloud, database, server）、Files（folder）、Payment（credit-card）、Device（monitor）、International（globe）、Communication（phone）

> **ルール**: 同じ概念のアイコンが Charcoal にある場合は必ず Charcoal を使う。Lucide は Charcoal に明確に存在しないアイコンのみ許可。

- 詳細: `foundations/icons.md` を参照

## Tech Stack

- CSS: Tailwind CSS 4
- Component: （プロジェクトで設定 — Stimulus / React / Vue / etc.）
- Template: HTML（プロジェクトで設定 — HTML / ERB / JSX / etc.）

## Locale

- Language: ja（日本語）
- ラベル例: 保存する、キャンセル、削除する、閉じる、戻る、次へ
- 日付形式: YYYY-MM-DD
- 通貨形式: ¥1,000

## CSS変数の定義

`application.css`（または同等のエントリCSS）の `@theme` ブロックで以下を定義する:

```css
@theme {
  --color-primary-50:  #f0f5ff;
  --color-primary-100: #dde8ff;
  --color-primary-200: #c0d4ff;
  --color-primary-300: #95b6ff;
  --color-primary-400: #6492ff;
  --color-primary-500: #2b70ef;
  --color-primary-600: #2250df;
  --color-primary-700: #1a40b5;
  --color-primary-800: #13318d;
  --color-primary-900: #0e266a;
  --color-primary-950: #07194e;

  /* text-body: 本文デフォルト色（slate-600〜700の中間） */
  --color-body: #3d4b5f;

  /* セマンティックカラー変数（ダークモード対応） */
  --color-bg-page:        var(--bg-page);
  --color-bg-surface:     var(--bg-surface);
  --color-text-heading:   var(--text-heading);
  --color-text-default:   var(--text-default);
  --color-text-muted:     var(--text-muted);
  --color-border-default: var(--border-default);
}

/* ---- Light Theme (default) ---- */
:root {
  --bg-page:        #f9fafb;   /* gray-50 */
  --bg-page-alt:    #f3f4f6;   /* gray-100 */
  --bg-surface:     #ffffff;
  --bg-surface-alt: #f9fafb;   /* gray-50 */
  --text-heading:   #0f172a;   /* slate-900 */
  --text-default:   #3d4b5f;   /* body */
  --text-muted:     #64748b;   /* slate-500 */
  --border-default: #e2e8f0;   /* slate-200 */
  --border-strong:  #cbd5e1;   /* slate-300 */
  --input-bg:       #ffffff;
  --input-border:   #cbd5e1;   /* slate-300 */
  --shadow-color:   0, 0, 0;   /* black base */
  --shadow-opacity: 0.05;
}

/* ---- Dark Theme ---- */
/* 切替: prefers-color-scheme OR html[data-theme="dark"] */
@media (prefers-color-scheme: dark) {
  :root { @mixin dark-tokens; }
}
html[data-theme="dark"] { @mixin dark-tokens; }

/* dark-tokens mixin（実際のCSS実装では共通ブロックにまとめる） */
/*
  --bg-page:        #0f172a;    slate-900
  --bg-page-alt:    #334155;    slate-700
  --bg-surface:     #1e293b;    slate-800
  --bg-surface-alt: #0f172a;    slate-900
  --text-heading:   #f1f5f9;    slate-100
  --text-default:   #cbd5e1;    slate-300
  --text-muted:     #94a3b8;    slate-400
  --border-default: #334155;    slate-700
  --border-strong:  #475569;    slate-600
  --input-bg:       #0f172a;    slate-900
  --input-border:   #475569;    slate-600
  --shadow-color:   0, 0, 0;
  --shadow-opacity: 0.3;
*/
```

> `text-body` は Tailwind 4 のカスタムカラーとして `--color-body` で定義する。`text-body` クラスで自動的に適用される。
> ダークモードでは `--color-body` を `:root` の `--text-default` にバインドし、`prefers-color-scheme: dark` または `data-theme="dark"` で `#cbd5e1`（slate-300）に切り替える。

---

## Semantic Colors

セマンティックカラーマッピング。CSS変数として `@theme` に定義し、ダークモードで値を切り替える。

> 全トークン詳細（Background / Surface / Text / Border / Focus / Input / Shadow）: `foundations/color.md` 参照

## Elevation (Shadow)

| トークン | Tailwind | 用途 |
|---------|----------|------|
| elevation-none | `shadow-none` | フラット、disabled |
| elevation-sm | `shadow-sm` | カード、トースト |
| elevation-md | `shadow-md` | カード hover、ドロップダウン |
| elevation-overlay | `shadow-xl` | モーダル |

> 詳細: `foundations/elevation.md`

## Border Radius

| トークン | Tailwind | 用途 |
|---------|----------|------|
| radius-sm | `rounded` | チェックボックス |
| radius-md | `rounded-lg` | ボタン、入力欄、トースト |
| radius-lg | `rounded-xl` | カード、モーダル |
| radius-full | `rounded-full` | バッジ、トグル |

> 詳細: `foundations/radius.md`

## Motion

| トークン | 値 | 用途 |
|---------|-----|------|
| duration-fast | 150ms | ボタン hover 等 |
| duration-normal | 200ms | フェード |
| duration-slow | 300ms | トースト、複合 |

> 詳細: `foundations/motion.md`

## Z-index

| トークン | Tailwind | 用途 |
|---------|----------|------|
| z-base | `z-0` | コンテンツ |
| z-dropdown | `z-20` | ドロップダウン |
| z-sticky | `z-30` | sticky ヘッダー |
| z-overlay | `z-40` | モーダル背景 |
| z-modal | `z-50` | モーダル本体、トースト |

> 詳細: `foundations/z-index.md`
