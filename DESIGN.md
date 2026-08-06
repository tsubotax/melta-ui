---
# Generated from design/contracts/tokens.json by scripts/design/export-designmd.ts — do not edit by hand.
# Format: Google DESIGN.md spec (github.com/google-labs-code/design.md). SSOT remains design/contracts/.
version: alpha
name: melta UI
description: 声を張らずに伝わる UI — Quiet Precision / Breathable / Flat & Layered / Subtle Warmth
colors:
  primary: "#2b70ef"
  primary-50: "#f0f5ff"
  primary-100: "#dde8ff"
  primary-200: "#c0d4ff"
  primary-300: "#95b6ff"
  primary-400: "#6492ff"
  primary-500: "#2b70ef"
  primary-600: "#2250df"
  primary-700: "#1a40b5"
  primary-800: "#13318d"
  primary-900: "#0e266a"
  primary-950: "#07194e"
  body: "#3d4b5f"
  neutral: "#f9fafb"
  success: "#059669"
  warning: "#d97706"
  danger: "#dc2626"
typography:
  h1:
    fontFamily: Inter
    fontSize: 2rem
    lineHeight: 1.4
    letterSpacing: 0.01em
  h2:
    fontFamily: Inter
    fontSize: 1.625rem
    lineHeight: 1.4
    letterSpacing: 0.01em
  h3:
    fontFamily: Inter
    fontSize: 1.375rem
    lineHeight: 1.4
    letterSpacing: 0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 1.25rem
    lineHeight: 1.5
    letterSpacing: 0.02em
  body:
    fontFamily: Inter
    fontSize: 1.125rem
    lineHeight: 2.0
    letterSpacing: 0.02em
  body-sm:
    fontFamily: Inter
    fontSize: 0.9375rem
    lineHeight: 1.7
    letterSpacing: 0.02em
  caption:
    fontFamily: Inter
    fontSize: 0.8125rem
    lineHeight: 1.4
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  md: 0.5rem
  lg: 0.75rem
  full: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "14": 56px
  "16": 64px
components:
  accordion-single:
    rounded: "{rounded.md}"
  accordion-multiple:
    rounded: "{rounded.md}"
  alert-info:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-800}"
    rounded: "{rounded.md}"
    padding: 16px
  alert-success:
    backgroundColor: "#ecfdf5"
    textColor: "#065f46"
    rounded: "{rounded.md}"
    padding: 16px
  alert-warning:
    backgroundColor: "#fffbeb"
    textColor: "#92400e"
    rounded: "{rounded.md}"
    padding: 16px
  alert-error:
    backgroundColor: "#fef2f2"
    textColor: "#991b1b"
    rounded: "{rounded.md}"
    padding: 16px
  avatar-image:
    height: 40px
    rounded: "{rounded.full}"
  avatar-initials:
    height: 40px
    rounded: "{rounded.full}"
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-600}"
  badge-neutral:
    rounded: "{rounded.full}"
    backgroundColor: "#f1f5f9"
    textColor: "#334155"
  badge-success:
    rounded: "{rounded.full}"
    backgroundColor: "#ecfdf5"
    textColor: "#047857"
  badge-warning:
    rounded: "{rounded.full}"
    backgroundColor: "#fffbeb"
    textColor: "#b45309"
  badge-danger:
    rounded: "{rounded.full}"
    backgroundColor: "#fef2f2"
    textColor: "#b91c1c"
  badge-accent:
    rounded: "{rounded.full}"
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-700}"
  button-contained:
    height: 40px
    backgroundColor: "{colors.primary-500}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  button-contained-hover:
    backgroundColor: "{colors.primary-700}"
  button-outlined:
    height: 40px
    backgroundColor: "#ffffff"
    textColor: "#334155"
    rounded: "{rounded.md}"
  button-outlined-hover:
    backgroundColor: "{colors.neutral}"
  button-brand-outline:
    height: 40px
    textColor: "{colors.primary-500}"
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
  button-brand-outline-hover:
    backgroundColor: "{colors.primary-50}"
  button-neutral:
    height: 40px
    backgroundColor: "#f1f5f9"
    textColor: "#334155"
    rounded: "{rounded.md}"
  button-neutral-hover:
    backgroundColor: "#e2e8f0"
  button-lighted:
    height: 40px
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-600}"
    rounded: "{rounded.md}"
  button-lighted-hover:
    backgroundColor: "{colors.primary-100}"
  button-danger:
    height: 40px
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  button-danger-hover:
    backgroundColor: "#b91c1c"
  button-subtle:
    height: 40px
    textColor: "#334155"
    rounded: "{rounded.md}"
  button-subtle-hover:
    backgroundColor: "{colors.neutral}"
  card-basic:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: 24px
  card-media:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
  card-action:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: 24px
  card-link:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: 24px
  checkbox-default:
    height: 16px
  checkbox-disabled:
    height: 16px
  checkbox-indeterminate:
    height: 16px
  copy-button-outlined:
    backgroundColor: "#ffffff"
  datepicker-trigger:
    rounded: "{rounded.md}"
    backgroundColor: "#ffffff"
  datepicker-calendar:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: 16px
  datepicker-day-cell:
    height: 40px
    rounded: "{rounded.md}"
  dropdown-basic:
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
  dropdown-with-icons:
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
  dropdown-with-separator:
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
  list-link:
    textColor: "{colors.body}"
  list-link-hover:
    backgroundColor: "{colors.neutral}"
  list-information:
    textColor: "{colors.body}"
  list-action:
    textColor: "{colors.body}"
  list-action-hover:
    backgroundColor: "{colors.neutral}"
  pagination-active:
    height: 40px
    textColor: "#ffffff"
    backgroundColor: "{colors.primary-500}"
    rounded: "{rounded.md}"
  pagination-inactive:
    height: 40px
    textColor: "#334155"
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
  pagination-inactive-hover:
    backgroundColor: "{colors.neutral}"
  pagination-disabled:
    height: 40px
    textColor: "#cbd5e1"
  progress-primary:
    backgroundColor: "#e2e8f0"
    rounded: "{rounded.full}"
    height: 8px
  progress-success:
    backgroundColor: "#e2e8f0"
    rounded: "{rounded.full}"
    height: 8px
  progress-indeterminate:
    backgroundColor: "#e2e8f0"
    rounded: "{rounded.full}"
    height: 8px
  select-default:
    rounded: "{rounded.md}"
  select-error:
    rounded: "{rounded.md}"
    backgroundColor: "#fef2f2"
  select-disabled:
    rounded: "{rounded.md}"
    backgroundColor: "#f1f5f9"
    textColor: "#94a3b8"
  sidebar-standard:
    backgroundColor: "#ffffff"
  sidebar-compact:
    backgroundColor: "#ffffff"
  sidebar-drawer:
    backgroundColor: "#ffffff"
  skeleton-text:
    backgroundColor: "#e2e8f0"
    rounded: 6px
    height: 16px
  skeleton-card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: 24px
  skeleton-circle:
    backgroundColor: "#e2e8f0"
    rounded: "{rounded.full}"
    height: 40px
  tabs-underline-active:
    textColor: "{colors.primary-500}"
  tabs-underline-inactive:
    textColor: "#64748b"
  tabs-bar-active:
    textColor: "#0f172a"
  tabs-bar-active-hover:
    backgroundColor: "#f1f5f9"
  tabs-bar-inactive:
    textColor: "#94a3b8"
  tabs-bar-inactive-hover:
    backgroundColor: "#f1f5f9"
  tag-basic:
    rounded: "{rounded.full}"
    backgroundColor: "#f1f5f9"
    textColor: "#334155"
  tag-removable:
    rounded: "{rounded.full}"
    backgroundColor: "#f1f5f9"
    textColor: "#334155"
  tag-filter-chip:
    rounded: "{rounded.full}"
    backgroundColor: "#ffffff"
    textColor: "#334155"
  textfield-default:
    rounded: "{rounded.md}"
  textfield-error:
    rounded: "{rounded.md}"
    backgroundColor: "#fef2f2"
  textfield-disabled:
    rounded: "{rounded.md}"
    backgroundColor: "#f1f5f9"
    textColor: "#94a3b8"
  textfield-success:
    rounded: "{rounded.md}"
  toast-success:
    backgroundColor: "#ecfdf5"
    textColor: "#065f46"
    rounded: "{rounded.md}"
    padding: 16px
  toast-error:
    backgroundColor: "#fef2f2"
    textColor: "#991b1b"
    rounded: "{rounded.md}"
    padding: 16px
  toast-warning:
    backgroundColor: "#fffbeb"
    textColor: "#92400e"
    rounded: "{rounded.md}"
    padding: 16px
  toast-info:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-800}"
    rounded: "{rounded.md}"
    padding: 16px
  toggle-off:
    height: 24px
    rounded: "{rounded.full}"
    backgroundColor: "#cbd5e1"
  toggle-on:
    height: 24px
    rounded: "{rounded.full}"
    backgroundColor: "{colors.primary-500}"
  tooltip-top:
    backgroundColor: "#475569"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  tooltip-bottom:
    backgroundColor: "#475569"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  tooltip-left:
    backgroundColor: "#475569"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  tooltip-right:
    backgroundColor: "#475569"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
---

# melta UI — Design Constitution

> AI エージェントが UI を生成するとき、最初に読むファイル。
> 思想・非交渉原則・クイックリファレンス・参照先をこの 1 枚に集約する。

---

## Brand Identity

**"声を張らずに伝わる UI"** — 機能的な黒子であり、たまに微笑む。

| キーワード | 意味 |
|---|---|
| Quiet Precision | 静かだが精密。目立たないところほど丁寧に |
| Breathable | 文字・要素の周囲に空気がある |
| Flat & Layered | Background → Surface → Text の 3 層で奥行き |
| Subtle Warmth | 控えめだが冷たくない。機能性にエモーショナルな温度 |

参考: Linear / Notion / Stripe / Vercel
アンチ: ネオン SaaS、Bootstrap 的テンプレート

---

## Non-Negotiable Principles

1. **Content First** — UI は黒子。コンテンツが主役
2. **WCAG 2.1 AA** — コントラスト 4.5:1 以上。アクセシビリティはデフォルト
3. **Semantic Color** — `bg-primary-500` を使う。`bg-blue-*` は使わない
4. **3-Color Rule** — 1 画面に使う色は 3 色まで（背景・アクセント・テキスト）
5. **4px Grid** — スペーシングは 4 の倍数、8 の倍数推奨
6. **Minimal Elevation** — `shadow-sm` 〜 `shadow-md`。`shadow-lg` 以上はオーバーレイ限定
7. **No AI-ish Decoration** — カード上部/左端のカラーバー禁止。全周ボーダーで構成
8. **Baseline Widely Available** — CSS/HTML 機能は Baseline **Widely available** のみ使用。Newly / Limited（Anchor Positioning・Invoker Commands・popover 等）は fallback を併記しコメントで明示宣言した場合のみ許可（`BASELINE_*` ルールが検知）

> **disabled の規範（2026-07-19）**: `disabled` 属性には `aria-disabled="true"` を併記する（`A11Y_DISABLED_REQUIRES_ARIA` が検知）。タブ順を維持したい文脈（ツールバー・ページネーション等）では native `disabled` を使わず **`aria-disabled` 単独 + JS click ガード（preventDefault）** でフォーカス可能なまま無効を伝えてよい。ただし `aria-disabled` は click / Enter / submit を止めないため JS ガード必須、フォーム送信除外も効かない（送信除外が必要なら native `disabled` を維持する）。

> **コントラストの既知境界（意図宣言, 2026-07-03）**: `primary-500 × 白`（contained ボタン / brand-outline 文字 / pagination active）は実測 4.50:1 の AA 境界上。axe の判定（4.5 ちょうど = pass）を採用し、ブランド基準色を優先して**意図的に維持**する。より高いコントラストが必要な文脈では `primary-600` を使う（lighted 系の文字・avatar initials は 600 に引き上げ済み、danger base は `#dc2626` に引き上げ済み）。disabled 状態のコントラストは WCAG 1.4.3 の除外対象で対応不要。

---

## Quick Reference

> この section だけで基本的な UI コード生成が可能。

### HTML テンプレート（Tailwind CDN）

> プロトタイプ = この CDN テンプレ（Tailwind v3 構文）/ プロダクション = `foundations/theme.md` の v4 `@theme`。
> 値の SSOT は `design/contracts/tokens.json`（`scripts/ds-config.js` / `ds-theme.css` と同期）。
> **fontSize は 8 段すべて Tailwind デフォルトと異なる**（本文 18px / 行間 2.0 が melta の核。xxs はタブラベル等の最小ラベル専用）。省略すると DS のタイポグラフィが再現されない。

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
          50:'#f0f5ff',100:'#dde8ff',200:'#c0d4ff',300:'#95b6ff',
          400:'#6492ff',500:'#2b70ef',600:'#2250df',700:'#1a40b5',
          800:'#13318d',900:'#0e266a',950:'#07194e'
        },
        body: '#3d4b5f',
        wf: { bg:'#FFFFFF', surface:'#F5F5F5', border:'#E0E0E0', text:'#333333', 'text-sub':'#888888', accent:'#666666' }
      },
      fontFamily: {
        sans: ['Inter','Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','sans-serif'],
        mono: ['JetBrains Mono','SF Mono','monospace']
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '1.4' }],
        xs: ['0.8125rem', { lineHeight: '1.4' }],
        sm: ['0.9375rem', { lineHeight: '1.7' }],
        base: ['1.125rem', { lineHeight: '2.0' }],
        lg: ['1.25rem', { lineHeight: '1.5' }],
        xl: ['1.375rem', { lineHeight: '1.4' }],
        '2xl': ['1.625rem', { lineHeight: '1.4' }],
        '3xl': ['2rem', { lineHeight: '1.4' }]
      }
    }
  }
}
</script>
<style>
  body { line-height: 2.0; letter-spacing: 0.02em; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.4; letter-spacing: 0.01em; }
  .text-body { color: #3d4b5f; } /* colors.body と同値（旧テンプレ互換） */
</style>
```

### レイアウト

```
ページ全体         : bg-gray-50 min-h-screen
ページコンテンツ   : max-w-[1042px] mx-auto px-4（melta ショーケース実装値。1サイト内では全ページ同一幅で揃える。アプリ画面は patterns/layout.md の用途別幅でも可）
サイドバー＋メイン : flex h-screen（ボーダー分離、gap不要）
セクション間隔     : mt-10 〜 mt-14
仕切り線           : border-t border-slate-200
```

### テキスト

```
見出し             : text-3xl font-bold text-slate-900（32px）
本文               : text-base text-body（18px, line-height 2.0。leading-* で上書きしない）
フォーム制御ラベル : 包含 <div> に leading-normal（body の lh 2.0 リセット）
空状態メッセージ   : text-base text-slate-500 text-center py-16
フォントスタック   : Inter, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif
```

### コンポーネント

```
カード             : bg-white rounded-xl border border-slate-200 p-6 shadow-sm
カードグリッド     : grid grid-cols-2 md:grid-cols-3 gap-6
CTAボタン（M）     : inline-flex items-center justify-center gap-2 h-10 px-4 text-[1rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
CTAボタン（L）     : inline-flex items-center justify-center gap-2 h-12 px-6 text-[1rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
CTAボタン（S）     : inline-flex items-center justify-center gap-1.5 h-8 px-3 text-[0.875rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
サブボタン         : inline-flex items-center justify-center gap-2 h-10 px-4 text-[1rem] font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 cursor-pointer
Icon+Textボタン    : inline-flex items-center justify-center gap-2 h-10 pl-3 pr-4 text-[1rem] font-medium（アイコン側を狭く）
アイコンボタン（M）: w-10 h-10 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-5 h-5）
アイコンボタン（S）: w-8 h-8 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-4 h-4）
アイコンボタン（L）: w-12 h-12 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-5 h-5）
入力欄             : w-full px-3 py-2 text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 caret-primary-500
セレクト           : appearance-none pl-3 pr-10 + relative wrapper + SVG chevron（absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4）← ネイティブ矢印は使用禁止
横並びフォーム     : flex flex-wrap items-end gap-4 + 各 div.leading-normal > label + 要素 h-11
バッジ             : bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-medium
タグ（削除可能）   : inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium + ×ボタン
Alert（Info）      : flex items-start gap-3 p-4 bg-primary-50 border border-primary-200 text-primary-800 rounded-lg
テーブル外枠       : bg-white rounded-xl border border-slate-200 overflow-hidden
テーブルヘッダ     : <th scope="col"> text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider
テーブルデータ行   : hover:bg-gray-50 transition-colors
```

### ナビゲーション

```
サイドバー（標準） : w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col h-screen
ナビ（Active）     : flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary-500 bg-primary-50 rounded-lg + aria-current="page"
ナビ（Default）    : flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 rounded-lg transition-colors
タブ（Active）     : text-sm font-semibold text-primary-500 border-b-2 border-primary-500
パンくず           : text-sm + text-slate-500 hover:text-slate-700 / 現在ページ text-slate-900 font-medium
```

### アイコン

```
Charcoal           : w-5 h-5 fill="currentColor" text-body ← assets/icons/{Name}.svg（207個）
Lucide             : w-5 h-5 stroke="currentColor" fill="none" ← assets/icons/lucide/{name}.svg（15個）
小サイズ           : w-4 h-4
```

### ワイヤーフレーム（低忠実度プロトタイプ用）

```
背景               : bg-wf-bg (#FFFFFF)
サーフェス         : bg-wf-surface (#F5F5F5)
ボーダー           : border-wf-border (#E0E0E0)
テキスト           : text-wf-text (#333333)
サブテキスト       : text-wf-text-sub (#888888)
アクセント         : text-wf-accent / bg-wf-accent (#666666)
```

### 禁止パターン要約（Top 10）

| 禁止 | 代替 |
|------|------|
| `text-black` | `text-slate-900` |
| `bg-indigo-*` / `bg-blue-*` | `primary-*` |
| `shadow-lg` / `shadow-2xl` | `shadow-sm` 〜 `shadow-md` |
| `rounded-none` on cards | `rounded-xl` |
| `border-t-4` / `border-l-4` カラーバー | `border border-*-200 rounded-lg` 全周 |
| `text-gray-400` for body | `text-body` (#3d4b5f) |
| `font-light` | `font-normal` 以上 |
| `tracking-tight` | `tracking-normal` 以上 |
| `py-0.5` for buttons | `h-8` 以上 |
| `bg-green-*` / `bg-yellow-*` | `bg-emerald-*` / `bg-amber-*` |

> 全ルール（106 件）: `design/contracts/rules.json`（machine-readable）
> 人間向け解説: `foundations/prohibited.md`

---

## Source of Truth 読み順

| # | ファイル | 役割 |
|---|---------|------|
| 1 | `DESIGN.md`（本ファイル） | 憲法 + quick ref |
| 2 | `design/authority.md` | SSOT 宣言 |
| 3 | `design/contracts/tokens.json` | トークン exact value |
| 4 | `design/contracts/rules.json` | 禁止ルール registry |
| 5 | `design/contracts/components/*.contract.json` | コンポーネント仕様 |
| 6 | `foundations/theme.md` | テーマ設定・CSS 変数 |
| 7 | `foundations/design_philosophy.md` | 哲学の詳細 |
| 8 | `components/*.md` / `patterns/*.md` | 人間向けの詳細ガイド |

---

## Agent Prompt Guide

### クイック（単体 UI 生成）

`DESIGN.md` のみ読めば OK。Quick Reference のクラスをそのまま使う。

### 標準（ページ単位）

`DESIGN.md` → `foundations/theme.md` → 関連 `components/*.md` or `*.contract.json`

### フル（新規プロジェクト / DS 変更）

全ファイルを読み順に従って読む。

### MCP

MCP ツール `get_token` / `get_component` / `check_rule` / `check_html` / `get_rules` / `search` を使用。Resource は `melta://tokens` / `melta://components` / `melta://rules`（全99件）/ `melta://rules/auto-detectable`（自動検出サブセット）。

> 生成後は `check_html` に生成コード全体を渡して自己検証する（CI / hook と同一ロジック）。violations が空でも文脈依存の manual ルールは自動検査外（応答の coverage に明記される）。

---

## Theme

| 設定 | 値 |
|------|-----|
| ダークモード | `OFF`（ライトモードのみ） |
| Primary | `#2B70EF`（WCAG AA 4.50:1） |
| Font | Inter, Hiragino Sans, Noto Sans JP |
| Icon | Charcoal 207 個 + Lucide 15 個 |
| Locale | ja（日本語） |

> 詳細: `foundations/theme.md`
