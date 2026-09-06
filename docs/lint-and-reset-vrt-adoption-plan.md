# 導入設計 — lint ルール群 + リセットCSS差し替えVRT

> 2026-07-19 起草 → **同日 v2: Codex レビュー（blocker 5 / should-fix 9）を実ファイル検算のうえ全面反映**。
> 調査経緯とスコープ判断（forced-colors 見送り等）はメモリ `dads-research-2026-07` 参照。
> ステータス: **v2 設計（tsubotax 承認待ち。特に R1 の転換）**

---

## v1 からの主要変更（Codex レビュー反映）

| 項目 | v1 | v2 | 根拠 |
|------|----|----|------|
| R1 | native `disabled` を error 禁止 | **禁止を撤回**。契約既存の「disabled + aria-disabled 併用」規範を機械強制する warn ルールに転換 | 契約 SSOT（`button.contract.json` stateSpecs.disabled）が併用を規範化済み。aria-disabled 単独は click/Enter/submit を止めず JS ガード必須 = 静的 HTML 生成と非互換 |
| R2 | 新 ID `BUTTON_MIN_TAP_TARGET_44` 追加 | **既存 `BTN_MIN_TAP_TARGET`（manual/error）を自動検出化**。新 ID は作らない。契約 prose の「web は h-8 まで許容」との矛盾も同時解消 | `rules.json` に既存 ID あり（llm-judge-candidate）。二重規範の禁止 |
| R3 | 「既存 detector のみ」 | html-attr に **新 kind `attr-present` が必要**（popover / commandfor は属性存在検知） | `types.ts` の HtmlAttrCheck union に該当 kind なし |
| V1 | examples 4 ページで検証 | **専用 hermetic fixture に変更**。選定 4 ページ中 3 つは ds-theme.css 不使用・Tailwind CDN（Preflight 既適用）で「差し替え」検証にならない | copy-button/tabs-bar/kanade は CDN 直、ds-theme.css を読むのは sidebar-demo のみ |
| バッチ | version bump は最後 | **B1 で 0.5.0 に bump**。design:compat は main push 毎に走り rules.json の内容変更で即 bump 要求 | `design-check.yml` compat step + `contract-compat.ts` raw golden diff |
| ルール数 | 99 → 107 | **99 → 105**（R1 +1 / R3 +5 / R2 +0） | 下記各節 |

---

## スコープ（4項目・実装順）

| # | 項目 | 種別 | 規模感 |
|---|------|------|--------|
| R3 | Baseline "Widely available" 線引き | rules +5 / attr-lint 新 kind `attr-present` | 小 |
| R1 | disabled + aria-disabled 併用の機械強制 | rules +1 / 既存 composition kind 流用 | 小 |
| R2 | `BTN_MIN_TAP_TARGET` の自動検出化 + 44px 契約変更 | 既存 rule 更新 / composition 新 kind / 契約変更 | 中 |
| V1 | リセットCSS 5種差し替え VRT | fixture 新設 / playwright スペック / 依存追加 | 中〜大 |

実装順を v1 の R1 先頭から **R3 → R1 → R2 → V1** に変更（Codex 提案採用）: R3 が最小・エンジン追加 1 kind で肩慣らしになり、R1 は縮小版なのでリスク減、R2 は契約変更 + 既存ルールの breaking 更新で慎重に、V1 は fixture 新設から。

### 共通の前提・波及（v2 で精緻化）

- **ルール数 99 → 105**。伝播先は3系統に分かれ、各バッチで全て更新する:
  1. `design:build` 再生成系（llms.txt / metadata）
  2. **`design:build` が呼ばない生成系**: `design:coverage`（README の検証経路表）と `design:update-showcase`（docs/index.html）は別コマンド。明示的に実行する
  3. **drift 対象外の手書き焼き付き**: `docs/ds-health-check.md:134,162` / `design/compat/google-designmd.md:22,46` / `scripts/design/coverage-stats.ts:4` コメント / README・DESIGN.md 内の複数箇所。grep `\b99\b` で棚卸しして手動更新
- **semver**: 機械分類上は rule 追加＝compatible（patch でも通る）だが、「新規則で既存合法 HTML の判定が変わる変更は行動互換性破壊とみなす」を**プロジェクト判断として明記**し 0.4.3 → **0.5.0**。R2 の既存ルール detector/severity 変更は compat 上も breaking 分類で 0.5.0 と整合。**bump は B1（最初のバッチ）で実施**（compat gate が main push 毎に走るため。bump 済みなら以降のバッチは同一バージョン内の追加変更として通る — 通らない場合は各バッチで patch を刻む）
- **新 kind の変更範囲**（v1 で漏れ）: 実装ファイルに加えて `src/utils/types.ts` の union（HtmlAttrCheck / CompositionCheck）と `design/schemas/rule.schema.json` の enum、および RuleEntry 必須フィールド（`pattern: null` 明記等）の整合
- **contractLint の実態**: `validate.ts` の contract lint は `isAutoDetectable` な class 系ルールのみ対象。html-attr / composition ルールには効かないため、新ルールの `contractLint` は **`"skip"`** とする（v1 の enforce/warn 指定は誤り）
- 各バッチの完了条件: rules.json + 実装 + tests + 社内コーパス migration + ローカル CI ミラー（design:check / drift / **compat** / test / validate / build）全緑。コーパスは **examples/ 16 ファイル（index.html 含む — CI の lint-generated は除外しない）+ docs/index.html**

---

## R3: Baseline "Widely available" 線引き

### 方針宣言

DESIGN.md の原則セクションに 1 行追加:

> CSS/HTML 機能は Baseline **Widely available** のみ使用する。Newly available / Limited の機能は fallback を併記し、コメントで明示宣言した場合のみ許可。

### ルール定義（rules.json に 5 件追加、全て warn / contractLint: skip）

| ID | detector | 検知対象 | 2026-07 時点の Baseline |
|----|----------|---------|------|
| `BASELINE_NO_ANCHOR_POSITIONING` | tailwind-class-prefix | `[anchor-name:` + prefixPatterns `[position-anchor:` `[position-area:` `[position-try` | Limited |
| `BASELINE_NO_INVOKER_COMMANDS` | html-attr **新 kind `attr-present`** | `commandfor` / `command` 属性 | Limited |
| `BASELINE_NO_POPOVER_ATTR` | html-attr `attr-present` | `popover` 属性 | Newly→Widely 境界 |
| `BASELINE_NO_VIEW_TRANSITION` | tailwind-class-prefix | `[view-transition-name:` | same-doc Newly / cross-doc Limited |
| `BASELINE_NO_TEXT_BOX_TRIM` | tailwind-class-prefix | `[text-box-trim:` + `[text-box-edge:` | Newly |

### attr-lint.ts 新 kind `attr-present`

```ts
/** attr が任意の要素に存在したら違反（例: popover / commandfor）。tag 指定は任意 */
| { kind: "attr-present"; attr: string; tag?: string }
```

実装は `ATTR_BOUNDARY` + lookahead `(?![\w-])` で開始タグ内の属性位置のみ照合（約 12 行）。`data-popover` 等の前置詞付きは boundary で除外。**属性値文字列内の同名語（`title="popover を開く"` 等）を拾わない**よう、照合対象を `<[a-z][^>]*` の開始タグ抽出後に限定する。types.ts union + rule.schema.json enum への追加を同時に行う。

### Migration

実装時に examples 16 + docs/index.html を grep。現時点の事前確認では該当ゼロ見込み → ゼロなら migration なし。

---

## R1: disabled + aria-disabled 併用の機械強制（v1 の「禁止」から転換）

### v1 を撤回した理由（Codex blocker 1・2 を検算して確定）

1. **契約 SSOT と矛盾**: `button.contract.json` stateSpecs.disabled の ariaChanges は既に「`disabled` 属性 + `aria-disabled="true"`」の**併用**を規範化している（loading も `aria-busy` + `disabled`）。v1 の「native disabled 禁止」は自リポの規範を破壊する
2. **挙動の非対称**: `aria-disabled` は意味論のみで、click / Enter / Space / form submit / フォーム値除外を一切止めない。DADS が aria-disabled 単独で成立するのは React 実装が preventDefault ガードを持つから。melta の主戦場（静的 HTML 生成、JS 配線は消費者任せ）では native disabled を外すと**押せてしまう disabled ボタン**が生まれる。さらに契約は `type` 属性必須を宣言する一方 htmlSample には `type` が無く、フォーム内で暗黙 submit する複合リスクもある
3. **regex 検出の限界**: 「タグ内に disabled 文字列」の照合は `aria-label="disabled"` / `className={disabled ? ...}` / `<button-group disabled>` / `disabled={x > 0}` の `>` 切れで false positive/negative を避けられず、attr-lint の「false positive を出さない」方針と両立しない

### v2 ルール定義（rules.json に 1 件追加）

契約が既に規範化している「併用」を、HTML 側で機械強制する:

```jsonc
{
  "id": "A11Y_DISABLED_REQUIRES_ARIA",
  "category": "accessibility",
  "severity": "warn",
  "description": "disabled 属性単独では支援技術への状態通知が実装依存になる。契約（stateSpecs.disabled）の規範どおり aria-disabled=\"true\" を併記し、視覚状態クラス（opacity-50 cursor-not-allowed）とセットにする",
  "detector": "composition",
  "compositionCheck": {
    "kind": "dom-attr-required",
    "selector": "button[disabled]",
    "requireAnyAttr": ["aria-disabled"]
  },
  "pattern": null,
  "alternative": "disabled aria-disabled=\"true\" class=\"opacity-50 cursor-not-allowed pointer-events-none ...\"（契約 stateSpecs.disabled の tailwind 準拠）",
  "contractLint": "skip"
}
```

- **既存 kind `dom-attr-required` をそのまま流用**（新 kind 不要・regex 問題も DOM パースで消える）。attribute selector `button[disabled]` が node-html-parser で動くことを実装冒頭で検証し、非対応なら selector を `button` + when 述語追加に切り替える
- composition lint は .html のみ対象（既存制約）。JSX の検出漏れは許容し README 経路表に明記
- DADS の「フォーカス可能な disabled（aria-disabled 単独 + JS ガード）」パターンは、**lint 化せず DESIGN.md の prose 注記**として採録する: 「ツールバー/ページネーション等でタブ順維持が要る場合は aria-disabled 単独 + click ガード実装を検討（JS ガード必須）」

### Migration

- `examples/bunraku-cms.html:464`（bare disabled）→ aria-disabled 併記
- `docs/index.html` の disabled ボタン 6〜8 箇所を棚卸しして併記
- sorano-medical.html のカレンダーは既に併用 → 変更なし（v1 では「併用も禁止」だったが撤回）

### テスト

`tests/composition-lint.spec.ts` に: ①`<button disabled>` → warn ②`<button disabled aria-disabled="true">` → clean ③`<button aria-disabled="true">`（native なし）→ clean（このルールの対象外）④`<div disabled>` → clean。

---

## R2: `BTN_MIN_TAP_TARGET` の自動検出化 + 44px 契約変更

### 既存ルールとの統合（v1 の新 ID 追加を撤回）

`BTN_MIN_TAP_TARGET` は既存（manual / error / llm-judge-candidate / 「パディングでタップ領域 44px 以上を確保」）。**この ID を composition 自動検出に昇格**させる。detector: manual → composition、compositionCheck 追加、automationStatus 更新。**severity は error のまま維持**（warn に落とすと既存規範の弱体化 = 別の breaking）。compat 上 detector 変更は breaking 分類 → 0.5.0 と整合。

### 契約変更

1. `button.contract.json` sizes.small / sizes.medium の tailwind に当たり判定拡張を追加:
   `relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']`
2. **platformSemantics.touchTarget の prose 修正**（現行「web はポインタ前提で h-8（32px）まで許容」が新方針と矛盾）→「web も after: 拡張で実効 44px を保証する（見た目の高さは h-8/h-10 のまま）」
3. contract version 2.0.0 → 2.1.0、`design:recipes` で recipes/web 再生成

### 隣接重複の扱い（v1 の gap 計算誤りを修正）

small(32px)→44px は**上下 6px ずつ**張り出す。非重複に必要な縦 gap は small 同士 12px / medium 同士 4px / small+medium 8px。**melta の最小 gap-2（8px）では small 同士が 4px 重なる**。方針:

- 重複時の挙動はブラウザの hit-testing（DOM 後勝ち・stacking context 依存）に委ね、**縦積みボタン列（gap-2 以下）では拡張を外してよい**例外を DESIGN.md に明記
- 受け入れテストに `elementFromPoint()` による境界検証を含める（拡張領域クリックが正しい button に落ちるか、隣接時にどちらが勝つか）

### `::after` 副作用の受け入れ条件（v1 で未定義 → 明文化）

Playwright で以下を確認してから契約変更を確定する:

1. **overflow クリップ**: `overflow: hidden/clip` の祖先内で拡張領域が切れることを確認し、「スクロールコンテナ内ボタンでは実効領域が縮む」制約を prose 化
2. **event.target**: 子 SVG/span を持つボタンで `::after` が前面に来ると click の `event.target` が button 側に変わる → 委譲リスナー実装への影響を検証・記録
3. **focus ring**: リングは元の 32/40px box に付く（44px 領域ではない）ことを仕様として明記（視覚変化なしの確認）
4. disabled 状態（pointer-events-none）で拡張領域もイベント無効になること

### ルール spec（composition 新 kind `dom-class-required`）

```jsonc
"compositionCheck": {
  "kind": "dom-class-required",
  "selector": "button.h-6, button.h-7, button.h-8, button.h-9, button.h-10",
  "requireAnyClass": ["after:h-11", "min-h-11"],
  "excludeWhen": "icon-only"
}
```

- **icon-only は `excludeWhen` で第一弾から明示除外**（v1 は「第二弾送り」と言いつつ selector が拾う矛盾があった）。既存の when 述語 `icon-only` 判定ロジックを exclude 方向で流用
- icon-only（`w-10 h-10` 等）は縦だけ拡張しても 40×44 で未達のため、幅方向 spec（`after:w-11` + inset 式）を較正して**第二弾**で対象化
- types.ts / rule.schema.json への kind 追加は R3 と同様

### Migration

examples / docs/index.html の小サイズボタン（テキストあり）に recipe 準拠の拡張クラスを付与。icon-only（bunraku ページネーション等）は第一弾対象外なので触らない。error ルールなので**コーパス green 化がバッチ完了条件**。

---

## V1: リセットCSS 5種差し替え VRT

### fixture の再設計（v1 の examples 流用を撤回）

v1 で選定した 4 ページは検証に使えない（copy-button = 独自 style のみ / tabs-bar・kanade-finance = Tailwind CDN で Preflight 既適用 / ds-theme.css を読むのは sidebar-demo のみ）。CDN ページにリセットを注入しても「差し替え」でなく「Preflight への重ね掛け」になる。

**専用 hermetic fixture を新設する**:

- `tests/fixtures/reset-vrt/index.html` — 代表コンポーネント（button 全 variant×size / textfield / card / tabs / badge 等、recipes/web から生成 or 手組み）を1ページに並べた canonical fixture
- CSS は**ローカル生成物のみ**: `ds-theme.css` + ローカルビルドした Tailwind CSS（CDN 禁止）。フォントもローカル/システムフォントに固定
- リセットは**排他的に 1 種ずつ** `<head>` 先頭（melta CSS より前 = ホスト環境の再現）に注入。累積させない（各比較は fresh page）
- baseline は「リセット注入なし」。将来「melta CSS より後にリセット」順も追加検討（実サイトの読み込み順は保証されないため）が、第一弾は前挿入のみ

### 比較仕様（v1 の「1px も変わらない」表現を修正）

- pixelmatch は `threshold: 0.1` + アンチエイリアス既定除外だと文字通りの完全一致ではない。方針: **`threshold: 0` + `includeAA: true` で literal 一致を狙い**、CI 実測でフレークするなら閾値を緩めて保証文言を「有意差 0px」に変更
- **A/A テストを先に入れる**: リセット注入なしで同一ページを 2 回 screenshot して diff 0 を確認（環境自体の決定性検証）。これが通らない環境で差し替え比較は無意味
- 決定性の固定: viewport / deviceScaleFactor を spec 内で明示指定（現 playwright.config.ts は未固定）、`document.fonts.ready` 待ち、animation/transition/caret 無効化 CSS 注入
- スナップショットファイルは持たない（同一セッション内比較、DADS 方式）。失敗時のみ baseline/comparison/diff PNG を test-results に添付

### 実装・依存

- 新規: `tests/reset-vrt.spec.ts` + `tests/helpers/reset-vrt.ts` + `tests/fixtures/resets/*.css`（5 種 vendor: Normalize=MIT / Bootstrap Reboot=MIT / Tailwind Preflight=MIT / Eric Meyer=PublicDomain / kiso.css=MIT）
- vendor ファイルには **upstream URL + 取得 version/commit + SHA-256** をヘッダコメントで持たせ、`THIRD_PARTY_LICENSES.md` に追記
- devDependencies: `pixelmatch` / `pngjs`（+型）
- **`npm test`（playwright test）には最初から含めない**: 監査段階で落ちる spec が CI test job を壊すため、`npm run test:reset-vrt` の別 script + playwright project 分離で opt-in 実行。green 化後に design-check.yml の別 job（`continue-on-error: true` → 安定後 required）として組み込む

### 導入 3 段階（v1 と同じ）

1. **監査モード**（ローカル opt-in）: A/A 決定性確認 → 5 リセット実測 → 崩れ棚卸しレポート
2. **補修**: コンポーネントルートへの self-reset（`color` / `font-*` / `line-height` / `letter-spacing` / `border-style` 等）を ds-theme.css / recipes に追加。契約 tailwind に及ぶ場合は compat ゲート対象
3. **CI 昇格**: green 化後に required 化 — **2026-09-07 完了（#14 / #17）**。job 新設の 2026-07-19 から 2026-09-06 まで main の 32 run 連続で fail していた（落ちるのは 6 本中 `kiso.css` の 1 本だけ・毎回ちょうど 31548px・ローカル macOS では 6 passed）。原因は kiso.css の `:where(:root){ scrollbar-gutter: stable }` × Linux のクラシックスクロールバー（macOS はオーバーレイで幅 0）× `fullPage` 撮影の組み合わせで、スクロールバー自体が出なくても幅ぶんの余白が予約され本文幅が縮む → ページ全体が再レイアウトされていた。上記 2 の補修として Host-Reset Defense（`tools/generate-css.ts` の `hostResetDefense`）に 4 項目目の `html { scrollbar-gutter: auto; }` を追加（melta の規範 = ブラウザ既定。`:where()` は specificity 0 なので `html` が読み順に関係なく勝つ）→ CI Linux で 6 passed、`continue-on-error: true` を削除

---

## 実装バッチとコミット粒度（v2）

| バッチ | 内容 | 主な検証 |
|--------|------|----------|
| B1 | **contracts 0.5.0 bump** + R3（rules +5 / attr-lint 新 kind `attr-present` / types・schema 更新 / DESIGN.md 方針 1 行） | design:check, compat, lint-generated, test |
| B2 | R1 縮小版（rules +1 / 既存 kind 流用 / examples + docs/index.html migration / DESIGN.md 注記） | 同上 + composition-lint.spec |
| B3 | R2（既存ルール昇格 + 契約変更 + composition 新 kind + ::after 受け入れテスト + migration） | 同上 + design:compat 分類確認 + design:recipes + elementFromPoint テスト |
| B4 | V1 監査モード（fixture + helpers + deps、`npm test` 非統合） | A/A 決定性 → 5 リセット実測 → 棚卸しレポート |
| B5 | V1 補修 + CI 組み込み（continue-on-error → required） | reset-vrt green + compat |
| 最終 | ルール数 105 の3系統伝播（design:build + design:coverage + design:update-showcase + 手書き焼き付き grep 棚卸し）+ melta-contracts 0.5.0 publish | design:build, drift, 全緑 |

各バッチは main 直 commit（個人プロジェクト運用）。B4→B5 の間に崩れ規模次第で設計見直しの human gate。

## 未決事項（tsubotax 判断待ち）

1. **R1 の転換承認**: 「native disabled 禁止」→「併用の機械強制（warn）」への縮小。DADS 式のフォーカス可能 disabled は prose 注記のみ
2. R2 の縦積み gap-2 重複の例外方針（拡張を外す例外を認めるか、最小 gap を 12px に上げるか）
3. V1 fixture のコンポーネント選定範囲（第一弾で何を並べるか）
