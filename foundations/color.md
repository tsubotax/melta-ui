# Color System

> UIの色はレイヤー構造とセマンティック命名で管理する。
> プロジェクト固有の色は `foundations/theme.md` で定義する。

---

## 設計構造

```
Primitive Colors（生の色値）
  ↓ 用途に応じてマッピング
Theme Colors（UIで使う色名）
  - Background Color: 最下層
  - Surface Color: Backgroundの上に乗る表層
  - Text Color: テキスト表現（コントラスト比4.5:1必須）
  - Object Color: アイコン等（コントラスト比3:1必須）
  - Border Color: 境界線
  - Focus Color: フォーカスリング
```

---

## レイヤーアーキテクチャ

UIは3層で構成する。ダークモードでも同じレイヤー構造を維持し、明度の方向を反転させる:

| レイヤー | 役割 | Light | Dark |
|---------|------|-------|------|
| Background | 最下層・画面の地色 | `bg-gray-50` 〜 `bg-gray-200` | `bg-[var(--bg-page)]` 〜 `bg-[var(--bg-page-alt)]` |
| Surface | Backgroundの上に乗る表層 | `bg-white`, `bg-gray-50` | `bg-[var(--bg-surface)]`, `bg-[var(--bg-page)]` |
| Text/Object | Surface上のテキスト・アイコン | `text-slate-900`, `text-body` | `text-[var(--text-heading)]`, `text-[var(--text-default)]` |

> **ダークモードの原則**: Light では「暗い背景 → 明るい表層」で浮遊感を出すが、Dark では「暗い背景 → やや明るい表層」で同じ効果を再現する。明度差を保ちつつ、全体を暗い方向にシフトさせる。

---

## Tailwindカラーマッピング

### Background（最下層・画面の地色）

| セマンティック名 | Light 値 | Light クラス | Dark 値 | Dark クラス |
|----------------|---------|-------------|---------|------------|
| bg-background-primary | #f9fafb | `bg-gray-50` | #161718 | `bg-[var(--bg-page)]` |
| bg-background-secondary | #f3f4f6 | `bg-gray-100` | #1b1c1d | `bg-[var(--bg-surface)]` |
| bg-background-tertiary | #e5e7eb | `bg-gray-200` | #232525 | `bg-[var(--bg-page-alt)]` |

### Surface（表層・カード/ボタン等）

| セマンティック名 | Light 値 | Light クラス | Dark 値 | Dark クラス |
|----------------|---------|-------------|---------|------------|
| bg-surface-primary | #ffffff | `bg-white` | #1b1c1d | `bg-[var(--bg-surface)]` |
| bg-surface-secondary | #f9fafb | `bg-gray-50` | #161718 | `bg-[var(--bg-page)]` |
| bg-surface-tertiary | #f3f4f6 | `bg-gray-100` | #232525 | `bg-[var(--bg-page-alt)]` |
| bg-surface-accent | — | `bg-primary-500` | — | `bg-primary-500` |
| bg-surface-accent-subtle | #f0f5ff | `bg-primary-50` | — | `bg-primary-500/[.12]` |
| bg-surface-success | #059669 | `bg-emerald-600` | — | （共通） |
| bg-surface-success-subtle | #ecfdf5 | `bg-emerald-50` | — | `bg-emerald-500/[.12]` |
| bg-surface-warning | #d97706 | `bg-amber-600` | — | （共通） |
| bg-surface-warning-subtle | #fffbeb | `bg-amber-50` | — | `bg-amber-500/[.12]` |
| bg-surface-danger | #ef4444 | `bg-red-500` | — | （共通） |
| bg-surface-danger-subtle | #fef2f2 | `bg-red-50` | — | `bg-red-500/[.12]` |

> **ダークモードのSubtle背景**: Light の `-50` 系は Dark では `rgba(color, 0.12)` の透過に変換する。暗い背景に馴染みつつ、色のセマンティクスを保持する。

### Text（テキスト・コントラスト比4.5:1以上）

テキストカラーは3階層で運用する:

| 階層 | セマンティック名 | Light 値 | Light クラス | Dark 値 | Dark クラス |
|------|----------------|---------|-------------|---------|------------|
| 1 | text-primary | #0f172a | `text-slate-900` | #eeeeee | `text-[var(--text-heading)]` |
| 2 | text-body | #3d4b5f | `text-body` | #eeeeee | `text-[var(--text-default)]` |
| 3 | text-tertiary | #64748b | `text-slate-500` | #a3a3a3 | `text-[var(--text-muted)]` |

| セマンティック名 | Light クラス | Dark クラス |
|----------------|-------------|------------|
| text-primary | `text-slate-900` | `text-[var(--text-heading)]` |
| text-body | `text-body` | `text-[var(--text-default)]` |
| text-tertiary | `text-slate-500` | `text-[var(--text-muted)]` |
| text-inverse | `text-white` | `text-slate-900` |
| text-accent | `text-primary-500` | `text-primary-400` |
| text-success | `text-emerald-600` | `text-emerald-300` |
| text-warning | `text-amber-600` | `text-amber-300` |
| text-danger | `text-red-500` | `text-red-300` |
| text-link | `text-primary-500` | `text-primary-400` |
| text-link-hover | `text-primary-700` | `text-primary-300` |

### Border（境界線）

| セマンティック名 | Light 値 | Light クラス | Dark 値 | Dark クラス |
|----------------|---------|-------------|---------|------------|
| border-primary | #e2e8f0 | `border-slate-200` | #373839 | `border-[var(--border-default)]` |
| border-secondary | #cbd5e1 | `border-slate-300` | #777777 | `border-[var(--border-strong)]` |
| border-accent | — | `border-primary-500` | — | `border-primary-500` |
| border-focus | — | `border-primary-500` | — | `border-primary-400` |

### Focus Ring

| セマンティック名 | Light クラス | Dark クラス |
|----------------|-------------|------------|
| ring-focus | `ring-primary-500/50` | `ring-primary-400/50` |

### Input（フォーム要素）

| セマンティック名 | Light 値 | Light クラス | Dark 値 | Dark クラス |
|----------------|---------|-------------|---------|------------|
| input-bg | #ffffff | `bg-white` | #161718 | `bg-[var(--bg-page)]` |
| input-border | #cbd5e1 | `border-slate-300` | #777777 | `border-[var(--border-strong)]` |

### Shadow

| セマンティック名 | Light | Dark |
|----------------|-------|------|
| shadow-sm | `rgba(0,0,0,0.05)` | `rgba(0,0,0,0.3)` |
| shadow-md | `rgba(0,0,0,0.1)` | `rgba(0,0,0,0.4)` |
| shadow-xl | `rgba(0,0,0,0.15)` | `rgba(0,0,0,0.5)` |

> **ダークモードのシャドウ**: ダーク背景ではシャドウが見えにくくなるため、不透明度を上げる。カード等では `border` を主な区切りとし、shadow は補助的に使用する。

---

## 運用ルール

### Light Mode

| 用途 | Tailwindクラス |
|------|---------------|
| 画面背景 | `bg-gray-50` |
| カード背景 | `bg-white` |
| メインテキスト | `text-slate-900` |
| 本文テキスト | `text-body` (#3d4b5f) |
| 補助テキスト | `text-slate-500` |
| アクセント（CTA） | `bg-primary-500 text-white` |
| 成功 | `bg-emerald-600` / `text-emerald-600` |
| 警告 | `bg-amber-600` / `text-amber-600` |
| エラー/危険 | `bg-red-500` / `text-red-500` |
| リンク | `text-primary-500 hover:text-primary-700` |
| ボーダー | `border-slate-200` |
| フォーカス | `ring-2 ring-primary-500/50` |

> 禁止パターン: `foundations/prohibited.md`「カラー」参照

### Dark Mode

| 用途 | Tailwindクラス |
|------|---------------|
| 画面背景 | `bg-[var(--bg-page)]` |
| カード背景 | `bg-[var(--bg-surface)]` |
| メインテキスト | `text-[var(--text-heading)]` |
| 本文テキスト | `text-[var(--text-default)]` |
| 補助テキスト | `text-[var(--text-muted)]` |
| アクセント（CTA） | `bg-primary-500 text-white` |
| 成功 | `text-emerald-300`（テキスト） |
| 警告 | `text-amber-300`（テキスト） |
| エラー/危険 | `text-red-300`（テキスト） |
| リンク | `text-primary-400 hover:text-primary-300` |
| ボーダー | `border-[var(--border-default)]` |
| フォーカス | `ring-2 ring-primary-400/50` |
| Subtle背景 | `{color}-500/[.12]`（透過） |

> **注意**: ライトモードの色をそのままダークに持ち込まないこと。`-50` 系背景、`-700` 系テキスト、`-200` 系ボーダーはダークモードで機能しない。禁止パターン詳細: `foundations/prohibited.md`「カラー」参照

---

## 色彩心理と採用理由

melta UI では、各カラーの選定に心理的意味と哲学的根拠を持たせている。

| カラー | Tailwind | 心理効果 | melta UI での意味 | 用途 |
|--------|----------|----------|---------------------|------|
| Primary (Blue) | `primary-500` | 信頼・安定・誠実 | "静かだが確実な存在" | CTA・リンク・フォーカスリング |
| Success (Emerald) | `emerald-600` | 成長・自然・調和 | "穏やかな達成" | 成功通知・完了状態・バッジ |
| Warning (Amber) | `amber-600` | 注意・温かさ・親しみ | "優しい警告" | 警告通知・注意バッジ |
| Danger (Red) | `red-500` | 緊急・重要・行動喚起 | "明確だが叫ばない" | エラー・削除・破壊的操作 |
| Neutral (Slate) | `slate-900/600/200` | 落ち着き・知性・信頼性 | "声を張らず伝わる" | テキスト・ボーダー・背景 |

### 色温度マップ

```
Cool ←――――――――――――――――――――――――――→ Warm

 Blue    Emerald    Slate    Amber    Red
(信頼)   (成長)    (知性)   (注意)   (緊急)
```

- melta UI は **Cool〜Neutral 領域** を基調とする
- **Warm 系（Amber / Red）** は注意・エラー時の感情的フィードバックに限定する
- 1 画面に Warm 系が過剰に表示されないよう注意すること

---

## WCAGコントラスト要件

| 対象 | 最低比率 | 基準 |
|------|---------|------|
| 通常テキスト（16px未満） | 4.5:1 | AA |
| 大きなテキスト（18px以上 bold、24px以上） | 3:1 | AA |
| UI要素（アイコン、ボーダー） | 3:1 | AA |
| テキスト（AAA目標） | 7:1 | AAA |

---

## ステータスカラー

バッジ・Alert・Toast 等で使用するステータス色。`-700` はバッジ（`-50` 背景上）のテキスト色、白背景上のアイコン・テキストには `-600` を使う。

| ステータス | Light 背景 | Light テキスト | Dark 背景 | Dark テキスト |
|-----------|-----------|---------------|----------|--------------|
| 成功 | `bg-emerald-50` | `-700`（バッジ）/ `-600`（白背景） | `bg-emerald-500/[.12]` | `-300`（バッジ）/ `-400`（暗背景） |
| 警告 | `bg-amber-50` | `-700` / `-600` | `bg-amber-500/[.12]` | `-300` / `-400` |
| エラー | `bg-red-50` | `-700` / `-500` | `bg-red-500/[.12]` | `-300` / `-400` |
| ニュートラル | `bg-slate-100` | `text-slate-700` | `bg-[var(--bg-page-alt)]` | `text-[var(--text-default)]` |
| アクセント | `bg-primary-50` | `text-primary-700` | `bg-primary-500/[.12]` | `text-primary-300` |

> **変換ルール**: Light `-50` 背景 → Dark `{color}-500/[.12]`（12%透過）。Light `-700` テキスト → Dark `-300` テキスト。

### 装飾ドットの色

ステータスドット（Badge / Avatar）は小面積の装飾要素。WCAG 非テキスト UI 要素 3:1 を満たす `-500` を使用（Light/Dark共通）。

## 2026-09-27: Neutral dark palette

Substackの配信CSSのdark tokensを参照し、背景をチャコール、主要文字をオフホワイトへ更新。調査と対応関係は [dark-palette.md](../docs/dark-palette.md) を参照。ライトのMeltaトークン、Primary、ステータス色は維持する。区切り用border-defaultは装飾用。操作領域の識別には3:1以上のinput-border / border-strongを使う。
