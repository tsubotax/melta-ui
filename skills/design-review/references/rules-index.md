# 禁止ルール索引（生成物）

> **生成物。手で編集しない。** `npm run design:skill-index` で再生成する。
> 正本は `design/contracts/rules.json`（全 107 ルール）。
> 観点の索引（人間が curation した検出手順）は `checklist.md`。網羅はこのファイルが持つ。
> skill の必読ではない。人間と CI 向けの生成層であり、skill にとっては「checklist に無いカテゴリを横断で探すときの索引」。判定に使う値は SSOT の `design/contracts/rules.json` を見る。

`automationStatus` 列の `—` は未宣言。未宣言のルールは、detector が参照する pattern 系フィールド（`pattern` / `prefixPatterns` / `matchPatterns`）か `htmlAttrCheck` / `compositionCheck` のいずれかを必ず持つ（`tests/coverage-stats.spec.ts` が未分類 0 件を維持する）。これは検出経路の存在であって、各レビュー対象を検査済みという保証ではない。

## accessibility（9）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| A11Y_NO_NESTED_INTERACTIVE | error | composition | `入れ子を解消する。クリック領域を分ける、外側を div 等の非インタラクティブ要素にする、または stretched-link パターンを使う` | インタラクティブ要素の入れ子（button/a/role=button の中に別のインタラクティブ要素）は HTML 仕様上不正で、キーボード操作・スクリーンリーダー・クリック判定が壊れる。合法な部品でも組み方で崩壊する典型 | — |
| A11Y_NO_OUTLINE_NONE_WITHOUT_RING | error | manual | `focus:ring-2 focus:ring-primary-500/50` | フォーカスインジケーターが消える | llm-judge-candidate |
| A11Y_NO_TABINDEX_POSITIVE | error | html-attr | `DOM順に従い、tabindex="0" or "-1" のみ使用` | フォーカス順序が混乱する | — |
| A11Y_NO_TIME_LIMIT | error | manual | `時間制限を設けない` | ユーザーが操作を完了できない可能性 | human-only |
| A11Y_NO_DECORATIVE_ANIMATION | warn | manual | `状態変化のフィードバックのみ` | 動きに敏感なユーザーへの配慮不足 | llm-judge-candidate |
| A11Y_NO_TEXT_TRUNCATION_200 | error | manual | `レスポンシブに対応` | コンテンツにアクセスできなくなる | human-only |
| A11Y_DISABLED_REQUIRES_ARIA | warn | composition | `disabled aria-disabled="true" class="opacity-50 cursor-not-allowed ..."（契約 stateSpecs.disabled の tailwind 準拠）` | disabled 属性単独では支援技術への状態通知が実装依存になる。契約（button stateSpecs.disabled）の規範どおり aria-disabled="true" を併記し、視覚状態クラス（opacity-50 cursor-not-allowed）とセットにする。タブ順維持が要る文脈（ツールバー/ページネーション）では aria-disabled 単独 + JS click ガードも可（DESIGN.md 注記参照） | — |
| A11Y_MIN_TAP_TARGET_44 | error | manual | `視覚寸法は変えずタップ領域だけ拡張する。web: relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2（または min-h-11）/ app: hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} か minHeight: 44` | すべての操作要素は実効タップ標的 44pt（web は 44px）を下回らない — melta の横断方針（WCAG 2.2 SC 2.5.5 Target Size (Enhanced) = AAA の 44px 水準を採る。AA の SC 2.5.8 は 24px だが melta はそこで止めない。インラインテキストリンクは例外）。視覚寸法は契約どおり据え置き、当たり判定だけを広げる: web は h-8/h-10 のまま after: 擬似要素で 44px（または min-h-11）、app は視覚 24pt + hitSlop 10 の正典パターンか minHeight で下限を保証する（height 固定は fontScale でクリップするので使わない）。コンポーネント別の BTN_MIN_TAP_TARGET / TAG_X_MIN_TAP_TARGET は本方針の実装形であり、方針そのものの正本は本ルール | llm-judge-candidate |
| A11Y_NAV_ARIA_LABEL_REQUIRED | error | composition | `<nav aria-label="メインナビゲーション"> のように aria-label を付与する（見出し要素を指す aria-labelledby でもよい）` | \<nav\>（および role="navigation"）にアクセシブルネームが無いと、スクリーンリーダーのランドマーク一覧で複数のナビゲーションを区別できない。nav が 1 つしか無い画面でも、後から増えたときに無名ランドマークが並ぶため常に付与する | auto |

## ai-pattern（4）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| AI_NO_CARD_COLOR_BAR_TOP | error | tailwind-class | `border-t-4` → `border border-slate-200 のみでカードを構成` | AI生成UIの典型パターン。装飾過剰で汎用性が低い | — |
| AI_NO_CARD_COLOR_BAR_LEFT | error | tailwind-class | `border-l-4` → `border border-*-200 rounded-lg で全周ボーダー` | Alert含め全コンポーネントで禁止 | — |
| AI_NO_GRADIENT_BG | error | tailwind-class-prefix | `bg-gradient-` → `単色の bg-primary-500 / bg-white / bg-slate-50 を使う` | 装飾的なグラデーション背景はAI生成UIの典型tell。安っぽく見える | — |
| AI_NO_DECORATIVE_PURPLE | error | tailwind-class-segment | match: `purple`, `violet`, `fuchsia` → `bg-primary-* / text-primary-* （brand color）を使う` | purple/violet/fuchsia 系の装飾カラーはAI生成UIの典型tell。brand colorを使う | — |

## baseline（5）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| BASELINE_NO_ANCHOR_POSITIONING | warn | tailwind-class-prefix | `[anchor-name:` → `absolute + top/left トークン系ユーティリティによる従来配置（DESIGN.md の配置パターン準拠）` | CSS Anchor Positioning は Baseline Limited（2026-07 時点, webstatus.dev）。fallback なしでは非対応ブラウザで配置が崩壊する。Baseline Widely available 未達機能は fallback 併記 + コメント明示宣言がない限り使わない | — |
| BASELINE_NO_INVOKER_COMMANDS | warn | html-attr | `明示的な JS イベントリスナー、または dialog は showModal() 呼び出しで開閉する` | Invoker Commands（commandfor / command 属性）は Baseline Limited（2026-07 時点）。非対応ブラウザではボタンが完全に無反応になる | — |
| BASELINE_NO_POPOVER_ATTR | warn | html-attr | `dropdown/tooltip contract の実装パターン（絶対配置 + JS toggle）を使う` | popover 属性は Baseline Newly → Widely 境界（2026-07 時点）。polyfill なしの生成では古い環境で開閉不能になる。使う場合は fallback かコメント明示宣言を伴うこと | — |
| BASELINE_NO_VIEW_TRANSITION | warn | tailwind-class-prefix | `[view-transition-name:` → `motion トークン（duration/easing）による CSS transition で代替する` | View Transitions は same-document が Baseline Newly / cross-document が Limited（2026-07 時点）。演出前提の UI 構造にすると非対応環境で意味が壊れる | — |
| BASELINE_NO_TEXT_BOX_TRIM | warn | tailwind-class-prefix | `[text-box-trim:` → `spacing トークン（py-* / leading-*）で余白を明示指定する` | text-box-trim / text-box-edge は Baseline Newly（2026-07 時点）。行ボックスの光学調整に依存したレイアウトは非対応環境で余白がズレる | — |

## button（4）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| BTN_NO_SAME_STYLE_PARALLEL | warn | manual | `階層の異なるボタンを組み合わせる` | 重要度の区別がつかない（Neutralのみ例外） | llm-judge-candidate |
| BTN_NO_LIGHTED_SOLO | warn | manual | `Neutralとペアで使用` | トグル状態の対比がないと意味不明 | llm-judge-candidate |
| BTN_ICON_ONLY_ARIA_REQUIRED | error | composition | `aria-label="閉じる" 等を付与` | 操作内容がスクリーンリーダーに伝わらない | auto |
| BTN_MIN_TAP_TARGET | error | composition | `relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 を付与（button recipe 準拠なら自動で付く）` | 高さ 44px 未満のボタン（h-6〜h-10）は当たり判定拡張が無いとモバイルで操作困難（WCAG 2.2 SC 2.5.5 Target Size (Enhanced) = AAA の 44px 水準。AA の SC 2.5.8 は 24px だが melta は 44px を採る。インラインテキストリンクを除く）。見た目を変えず after: 擬似要素でタップ領域だけ広げる。icon-only ボタンは幅拡張が別式のため第一弾対象外（2026-07-19 に manual から composition 自動検出へ昇格）。横断方針は A11Y_MIN_TAP_TARGET_44 が正。本ルールはその web（button）実装形 | auto |

## color（16）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| COLOR_NO_TEXT_BLACK | error | tailwind-class | `text-black` → `text-slate-900` | 純黒はコントラストが強すぎて長時間の利用で目が疲れる | — |
| COLOR_NO_ARBITRARY_TEXT_HEX | warn | tailwind-class-prefix | `text-[#` → `text-slate-900 / text-primary-600 などカラートークンを使う` | text-[#...] / text-[rgb(...)] / text-[hsl(...)] / text-[black] 等で色を直書きすると tokens.json のパレット外になりセマンティックカラー原則を回避できてしまう（最頻の検知すり抜け）。フォントサイズの text-[1rem] 等は対象外 | — |
| COLOR_NO_ARBITRARY_BG_HEX | warn | tailwind-class-prefix | `bg-[#` → `bg-white / bg-slate-50 / bg-primary-500 などカラートークンを使う` | bg-[#...] / bg-[rgb(...)] / bg-[hsl(...)] / bg-[black] 等で背景色を直書きするとパレット外の色が混入する。bg-[url(...)] 等は対象外 | — |
| COLOR_NO_ARBITRARY_BORDER_HEX | warn | tailwind-class-prefix | `border-[#` → `border-slate-200 / border-primary-500 などカラートークンを使う` | border-[#...] / border-[rgb(...)] / border-[hsl(...)] / border-[black] 等で枠線色を直書きするとパレット外の色が混入する。border-[1px] 等の太さ指定は対象外 | — |
| COLOR_NO_INLINE_STYLE_HARDCODE | warn | html-attr | `Tailwind カラートークン(bg-primary-600 等) か CSS 変数 var(--text-default) を使う` | inline style で色をハードコードするとカラールール(class 検査)を迂回できる。var(--...) 経由の CSS 変数は対象外で、# / rgb / hsl の直書きのみ検知する | — |
| COLOR_NO_DARK_BG_GRAY | error | tailwind-class-prefix | `bg-gray-[3-9]00` → `bg-gray-50 〜 bg-gray-200` | テキストのコントラスト確保が困難になる | — |
| COLOR_NO_PRIMARY_400 | warn | tailwind-class | `bg-primary-400` → `bg-primary-500` | CTAとして弱く、目立たない | — |
| COLOR_NO_GRAY_400_BODY | error | tailwind-class | `text-gray-400` → `text-body (#3d4b5f)` | WCAG不適合（コントラスト比不足） | — |
| COLOR_NO_GRAY_100_BORDER | error | tailwind-class | `border-gray-100` → `border-slate-200` | 薄すぎて境界が見えない | — |
| COLOR_NO_GREEN | error | tailwind-class-prefix | `bg-green-` → `bg-emerald-*` | emeraldで統一する | — |
| COLOR_NO_YELLOW | error | tailwind-class-prefix | `bg-yellow-` → `bg-amber-*` | amberで統一する | — |
| COLOR_NO_ROSE | error | tailwind-class-prefix | `bg-rose-` → `bg-red-*` | redで統一する | — |
| COLOR_NO_BLUE_BG | error | tailwind-class-prefix | `bg-blue-` → `bg-primary-*` | primaryで統一する | — |
| COLOR_NO_BLUE_LINKS | error | tailwind-class-prefix | `text-blue-` → `text-primary-500` | primaryで統一する | — |
| COLOR_NO_INDIGO | error | tailwind-class-prefix | `bg-indigo-` → `bg-primary-*` | primaryで統一する | — |
| COLOR_ONLY_FORBIDDEN | error | manual | `アイコン/テキストを必ず併用` | 色だけで情報伝達すると色覚多様性への非対応になる | llm-judge-candidate |

## datepicker（6）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| DATEPICKER_NO_NATIVE_INPUT | warn | html-attr | `カスタム Date Picker を使用` | ブラウザ間で表示が不統一 | — |
| DATEPICKER_NO_SHADOW_LG | error | manual | `shadow-md` | 影が強すぎてノイズになる（datepicker コンテキスト。汎用は SPACE_NO_SHADOW_LG で検出） | llm-judge-candidate |
| DATEPICKER_Z_INDEX_20 | error | manual | `z-20（Dropdown レイヤー）` | Dropdown レイヤーの統一が崩れる | llm-judge-candidate |
| DATEPICKER_NO_COLOR_ONLY_TODAY | error | manual | `font-semibold を併用` | 色覚多様性への非対応 | llm-judge-candidate |
| DATEPICKER_KEYBOARD_NAV_REQUIRED | error | manual | `矢印 + Enter + Escape を実装` | キーボードユーザーが操作不可 | human-only |
| DATEPICKER_WEEKDAY_HEADER_REQUIRED | error | manual | `日〜土のラベルを必ず表示` | 日付の曜日が判別できない | llm-judge-candidate |

## divider（3）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| DIVIDER_NO_DIV_BORDER_B | error | manual | `<hr> or role="separator"` | セマンティクス違反。支援技術が区切りを認識できない | llm-judge-candidate |
| DIVIDER_NO_GRAY_100 | error | tailwind-class | `border-gray-100` → `border-slate-200` | 薄すぎて境界が見えない | — |
| DIVIDER_NO_SLATE_400_PLUS | warn | manual | `border-slate-200（標準）/ border-slate-300（強調）` | 線が強すぎてノイズになる | llm-judge-candidate |

## form（11）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| FORM_SELECT_APPEARANCE_NONE | error | manual | `appearance-none + pr-10 + カスタムSVGシェブロン` | ネイティブ矢印はブラウザ間で位置・余白が不安定 | llm-judge-candidate |
| FORM_NO_LABEL_OMIT | error | manual | `<label> を for 属性で関連付け` | スクリーンリーダーが目的を読み上げられない | llm-judge-candidate |
| FORM_NO_SIDE_LABEL | warn | manual | `ラベルは入力欄の上` | モバイルで破綻し、視線移動が増える | llm-judge-candidate |
| FORM_FIELDSET_LEGEND_REQUIRED | error | manual | `グループ時は <fieldset> / <legend> を使用` | グループの目的が伝わらない | llm-judge-candidate |
| FORM_NO_AUTO_HIDE_ERROR | error | manual | `修正されるまで表示` | ユーザーが読む前に消える | human-only |
| FORM_NO_COLOR_ONLY_ERROR | error | manual | `ボーダー色 + エラーアイコン + テキスト` | 色覚多様性への非対応 | llm-judge-candidate |
| FORM_NO_CARD_FIELDSET_LEGEND | error | manual | `カードレベルは <div> + <h2>。<fieldset>/<legend> はカード内部のフォームグループに限定` | \<legend\> のブラウザデフォルト描画がカードの border と干渉する | llm-judge-candidate |
| FORM_NO_DATE_EQUAL_WIDTH | warn | manual | `flex レイアウトで年 w-28、月・日 w-20 に固定` | 月・日セレクトが不必要に広くなり選択しにくい | llm-judge-candidate |
| FORM_NO_CHECK_ONLY_CONFIRM | error | manual | `確認ボタンを必ず配置` | 意図しない確定が起きる | human-only |
| FORM_NO_AUTO_FOCUS_MOVE | error | manual | `ユーザー操作に任せる` | ユーザーを混乱させる | human-only |
| FORM_NO_DISTANT_ERROR | error | manual | `フィールド直下に表示` | フィールドとの対応がわからない | llm-judge-candidate |

## list（4）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| LIST_NO_FIXED_HEIGHT_MISMATCH | error | manual | `可変高さにする` | テキストが切れる or 余白が不均等 | llm-judge-candidate |
| LIST_NO_COLOR_ONLY_SELECTION | error | manual | `ボーダー太さ + 背景スタイルを併用` | 色覚多様性への非対応 | llm-judge-candidate |
| LIST_NO_GESTURE_ONLY | error | manual | `ボタンによる代替操作を提供` | キーボード/スクリーンリーダーで操作不可 | human-only |
| LIST_NO_ICON_BORDER | warn | manual | `ボーダーはアイテム間のみ` | 情報の断絶を誤解させる | llm-judge-candidate |

## modal（6）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| MODAL_FOCUS_TRAP_REQUIRED | error | manual | `Tab/Shift+Tabがモーダル内を循環` | キーボードユーザーがモーダル外に出てしまう | covered-by-test |
| MODAL_ESC_CLOSE_REQUIRED | error | manual | `Escキーで閉じる` | ユーザーが脱出できない | covered-by-test |
| MODAL_CLOSE_REQUIRED | error | manual | `閉じるボタン + Esc + オーバーレイクリック` | ユーザーが操作を中断できない | llm-judge-candidate |
| MODAL_ROLE_DIALOG_REQUIRED | error | html-attr | `role="dialog" を必ず付与` | スクリーンリーダーがモーダルを認識できない | covered-by-test |
| MODAL_OVERLAY_REQUIRED | error | manual | `bg-black/50 のオーバーレイ` | 背景との分離が不明確 | llm-judge-candidate |
| MODAL_NO_NESTED | error | composition | `設計を見直す（role=dialog を2階層以上ネストしない）` | モーダルの中にモーダルを開くとUXが複雑になりすぎる。合法な部品だけで構成しても合成として崩壊する | — |

## motion（2）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| MOTION_NO_LONG_DURATION | error | tailwind-class-prefix | `duration-[5-9]00\|duration-1000` → `duration-300 以下` | 操作が鈍く感じる（Progress フィルバーは例外） | — |
| MOTION_REDUCED_MOTION_REQUIRED | error | manual | `メディアクエリで対応` | prefers-reduced-motion 無視はアクセシビリティ違反 | llm-judge-candidate |

## philosophy（2）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| PHILOSOPHY_NO_STYLE_BLOCK | warn | html-attr | `Tailwind ユーティリティ / デザイントークンで表現する。どうしても必要なら @layer で正規化` | 生 CSS の \<style\> ブロックは Tailwind トークン体系を迂回する escape hatch。CDN 運用では意図的回避でしか発生しない | — |
| PHILOSOPHY_NO_EXCESSIVE_ANIMATION | error | manual | `150〜300ms の状態変化フィードバックに限定` | 操作の邪魔になり、認知コストを増加させる | llm-judge-candidate |

## skeleton（4）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| SKELETON_BG_SLATE_200_ONLY | error | manual | `bg-slate-200 固定` | DS統一から外れる | llm-judge-candidate |
| SKELETON_NO_SPINNER_ONLY | warn | manual | `スケルトン or プログレスバーを併用` | 進捗が伝わらず不安を与える | llm-judge-candidate |
| SKELETON_ARIA_BUSY_REQUIRED | error | composition | `コンテナに aria-busy="true" + role="status"` | スクリーンリーダーがローディング状態を認識できない | auto |
| SKELETON_ARIA_BUSY_RELEASE | error | manual | `aria-busy="false" に変更` | ローディング完了が伝わらない | human-only |

## spacing（15）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| SPACE_NO_ARBITRARY_SHADOW | warn | tailwind-class-prefix | `shadow-[` → `shadow-sm / shadow-md など elevation トークンを使う` | shadow-[...] で影を直書きすると elevation トークンを回避でき、過剰な影で安っぽく見える | — |
| SPACE_NO_ROUNDED_NONE_CARDS | error | tailwind-class | `rounded-none` → `rounded-xl（12px）` | UIの統一感を損なう | — |
| SPACE_NO_SHADOW_LG | error | tailwind-class | `shadow-lg` → `shadow-sm 〜 shadow-md（オーバーレイ: shadow-xl）` | 影が強すぎてノイズになる | — |
| SPACE_NO_SHADOW_2XL | error | tailwind-class | `shadow-2xl` → `shadow-sm 〜 shadow-md（オーバーレイ: shadow-xl）` | 影が強すぎてノイズになる | — |
| SPACE_NO_PY_05_BTN | error | tailwind-class | `py-0.5` → `h-8 以上（S: h-8 / M: h-10 / L: h-12）` | タップターゲットが小さすぎる | — |
| SPACE_NO_P0_CARDS | error | tailwind-class | `p-0` → `p-5 以上` | コンテンツが窮屈になる | — |
| SPACE_NO_GAP0_SECTIONS | warn | tailwind-class | `gap-0` → `gap-6 以上` | セクションの区切りが不明瞭 | — |
| SPACE_NO_M0_PAGE | warn | manual | `px-6 py-8 以上` | ページ端にコンテンツが張り付く | llm-judge-candidate |
| SPACE_NO_DARK_SIDEBAR_BG | error | manual | `bg-white + ボーダー` | メインコンテンツとのコントラストが強すぎる | llm-judge-candidate |
| SPACE_NO_NONSTANDARD_SIDEBAR_WIDTH | error | tailwind-class | `w-60` → `w-64（標準）or w-16（コンパクト）` | 実装ごとにバラつきが出る | — |
| SPACE_NO_ROUNDED_XL_NAV | error | manual | `rounded-lg` | ボタン等他コンポーネントとの一貫性を損なう | llm-judge-candidate |
| SPACE_NO_LARGE_NAV_ICON | error | manual | `w-5 h-5` | DS標準アイコンサイズからの逸脱 | llm-judge-candidate |
| SPACE_NO_DRAWER_NO_FOCUS_TRAP | error | manual | `フォーカストラップを実装` | キーボードユーザーが背面要素を操作してしまう | human-only |
| SPACE_NO_MISSING_ARIA_CURRENT | error | html-attr | `Active ナビアイテムに aria-current="page" を付与` | スクリーンリーダーが現在ページを識別できない | impossible-static |
| SPACE_NO_3COL_LAYOUT | warn | manual | `サイドバー + メインの2列` | 認知負荷が高い | llm-judge-candidate |

## stepper（4）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| STEPPER_NO_COLOR_ONLY_STATE | error | manual | `アイコン + ボーダー + 背景色を併用` | 色覚多様性への非対応 | llm-judge-candidate |
| STEPPER_ARIA_CURRENT_REQUIRED | error | html-attr | `Active ステップに aria-current="step" を付与` | スクリーンリーダーが現在ステップを識別できない | impossible-static |
| STEPPER_MIN_INDICATOR_SIZE | error | manual | `w-8 h-8（標準）/ w-6 h-6（コンパクト最小）` | タップターゲットが小さすぎる | llm-judge-candidate |
| STEPPER_NO_DARK_CONNECTOR | warn | manual | `bg-primary-500（完了区間）/ bg-slate-200（未着手区間）` | 線が強すぎてノイズになる | llm-judge-candidate |

## table（2）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| TABLE_NO_LAYOUT_TABLE | error | manual | `flex / grid を使う` | セマンティクス違反 | llm-judge-candidate |
| TABLE_TH_SCOPE_REQUIRED | error | html-attr | `scope="col" を付与` | ヘッダーとデータの関係が不明確 | — |

## tag（5）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| TAG_REMOVABLE_X_REQUIRED | error | manual | `×ボタンを必ず表示` | キーボードのみでは削除操作を発見できない | llm-judge-candidate |
| TAG_X_MIN_TAP_TARGET | error | manual | `p-0.5 + SVG w-3 h-3（実質24px以上）` | モバイルで誤タップが頻発する。横断方針は A11Y_MIN_TAP_TARGET_44 が正。本ルールはその web（tag の × ボタン）実装形 | llm-judge-candidate |
| TAG_X_ARIA_LABEL_REQUIRED | error | composition | `aria-label="{タグ名}を削除" を付与` | スクリーンリーダーがボタンの目的を読み上げられない | auto |
| TAG_FILTER_ARIA_SELECTED_REQUIRED | error | html-attr | `aria-selected="true" / "false" を付与` | 選択状態がスクリーンリーダーに伝わらない | impossible-static |
| TAG_BADGE_CONFUSION | warn | manual | `用途に応じて badge / tag を使い分ける` | Badge はステータス表示、Tag はユーザー管理メタデータ | llm-judge-candidate |

## typography（5）

| ID | severity | detector | 検出条件 → alternative | 説明 | automationStatus |
|---|---|---|---|---|---|
| TYPO_NO_ARBITRARY_FONT | warn | tailwind-class-prefix | `font-[` → `font-normal / font-medium / font-semibold などタイポグラフィトークンを使う` | font-[...] で font-weight / font-family を直書きすると typography トークンを回避できる（font-[300] など細すぎる weight の混入経路） | — |
| TYPO_NO_TRACKING_TIGHT | error | tailwind-class | `tracking-tight` → `tracking-normal 以上（本文2%、見出し1%）` | 日本語の可読性が低下する | — |
| TYPO_NO_XS_BODY | error | manual | `text-base（16px）` | 本文には小さすぎて読みづらい | llm-judge-candidate |
| TYPO_NO_FONT_LIGHT | error | tailwind-class | `font-light` → `font-normal（400）以上` | 細すぎて可読性が低い | — |
| TYPO_NO_PLACEHOLDER_ONLY | error | manual | `<label> を必ず使用` | 入力開始で消え、目的がわからなくなる | llm-judge-candidate |

## 人間確認待ち（human-only・9）

静的な HTML からは判定できない（実行時の挙動・時間経過・入力操作を見ないと分からない）。**skill はこれらを違反件数に入れない。** レポートでは「評価不可（human-only）」として分離する。

- `SPACE_NO_DRAWER_NO_FOCUS_TRAP` — キーボードユーザーが背面要素を操作してしまう
- `FORM_NO_AUTO_HIDE_ERROR` — ユーザーが読む前に消える
- `FORM_NO_CHECK_ONLY_CONFIRM` — 意図しない確定が起きる
- `FORM_NO_AUTO_FOCUS_MOVE` — ユーザーを混乱させる
- `LIST_NO_GESTURE_ONLY` — キーボード/スクリーンリーダーで操作不可
- `DATEPICKER_KEYBOARD_NAV_REQUIRED` — キーボードユーザーが操作不可
- `SKELETON_ARIA_BUSY_RELEASE` — ローディング完了が伝わらない
- `A11Y_NO_TIME_LIMIT` — ユーザーが操作を完了できない可能性
- `A11Y_NO_TEXT_TRUNCATION_200` — コンテンツにアクセスできなくなる

## 機械検出済み（auto / covered-by-test・8）

lint（composition 検出）または Playwright テストが既に見ている。**skill は二重報告しない。** レビュー対象の HTML で明らかな違反を見つけた場合だけ、機械検出済みである旨を添えて報告する。

- `BTN_ICON_ONLY_ARIA_REQUIRED`（auto） — 操作内容がスクリーンリーダーに伝わらない
- `BTN_MIN_TAP_TARGET`（auto） — 高さ 44px 未満のボタン（h-6〜h-10）は当たり判定拡張が無いとモバイルで操作困難（WCAG 2.2 SC 2.5.5 Target Size (Enhanced) = AAA の 44px 水準。AA の SC 2.5.8 は 24px だが melta は 44px を採る。インラインテキストリンクを除く）。見た目を変えず after: 擬似要素でタップ領域だけ広げる。icon-only ボタンは幅拡張が別式のため第一弾対象外（2026-07-19 に manual から composition 自動検出へ昇格）。横断方針は A11Y_MIN_TAP_TARGET_44 が正。本ルールはその web（button）実装形
- `MODAL_FOCUS_TRAP_REQUIRED`（covered-by-test） — キーボードユーザーがモーダル外に出てしまう
- `MODAL_ESC_CLOSE_REQUIRED`（covered-by-test） — ユーザーが脱出できない
- `MODAL_ROLE_DIALOG_REQUIRED`（covered-by-test） — スクリーンリーダーがモーダルを認識できない
- `TAG_X_ARIA_LABEL_REQUIRED`（auto） — スクリーンリーダーがボタンの目的を読み上げられない
- `SKELETON_ARIA_BUSY_REQUIRED`（auto） — スクリーンリーダーがローディング状態を認識できない
- `A11Y_NAV_ARIA_LABEL_REQUIRED`（auto） — \<nav\>（および role="navigation"）にアクセシブルネームが無いと、スクリーンリーダーのランドマーク一覧で複数のナビゲーションを区別できない。nav が 1 つしか無い画面でも、後から増えたときに無名ランドマークが並ぶため常に付与する
