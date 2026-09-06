---
name: build-screen
description: melta DS の契約から画面 1 枚（ページ / スクリーン）を生成し、check_html で自己検証して coverage と評価不可まで報告する。トリガー: 「画面を作って」「〜ページを生成」「画面生成」「ダッシュボードを作って」「設定画面を作って」「build screen」「generate a page」。AGENTS.md のタスクベース読み込みガイドで契約を引き当て、最大 3 問だけ意図を確認してから生成する。ボタン 1 個・カード 1 枚のようなコンポーネント単体の生成には使わない（DESIGN.md のクイックモードで足りる）。既存 HTML のレビューにも使わない（design-review skill が担当）。
user-invocable: true
---

# 画面を作る

melta の契約から画面 1 枚を生成し、生成物を自分で lint して、「何を自動検査したか / 何を検査していないか」まで含めて報告する。依頼から提出までの往復を 1 回に潰すための手順書。

参照の実体は MCP ツールと `AGENTS.md` / `DESIGN.md` / `design/contracts/` に置く。**この手順書に仕様を複製しない**（複製した瞬間に drift する）。

## Step 1: 依頼の分類と契約の引き当て

1. `AGENTS.md` の「## タスクベース読み込みガイド」の表を読み、依頼を該当行に当てる。**表をここに写さない**（`AGENTS.md` が正）。複数の行に跨る依頼（例: 「サイドバー付きの設定画面」= サイドバー付きページ + 設定画面）は該当行の**和集合**を取る
2. 該当行が挙げるファイルを、表の順序どおりに読む
   - MCP が使えるなら `get_component`（契約の exact value）と `search`（どの契約が該当するかの探索）を優先する
   - MCP が無ければ `design/contracts/components/*.contract.json` を直接読む
   - 値の正本は契約、原則の正本は `DESIGN.md`。競合したら契約が勝つ（`design/authority.md`）
3. 引き当てた契約名と読んだファイルを控える。Step 5 でそのまま報告する

引き当てが 1 つも無い依頼（DS に契約が存在しないコンポーネントを含む）は、生成前にその旨を伝える。契約の無い部品を勝手に発明しない。

## Step 2: 意図確認（**最大 3 問**）

下の質問バンクを上から見て、**依頼文から答えが取れる問いは飛ばす**。残ったものだけを 1 回でまとめて聞く。**4 問以上聞かない**。3 問を超える不確定さが残るなら、残りは仮置きして Step 5 の報告に「こう仮定した」と書く。

- Q1: 画面の主目的と主動作を 1 つ（例: 一覧から詳細へ / フォームを送信する）
- Q2: 含めるデータ状態（通常のみ / + 空状態 / + 読み込み中 / + エラー）
- Q3: 出力先パスと幅（ファイルパス / デスクトップのみ or レスポンシブ）

出力先が未指定なら提案する。`examples/` は CI の Full Scan 対象なので、DS 公式サンプルにする意図が無い限り避ける。

**拡張子は `.html` に揃える**（Step 4 の CLI 経路が検査できるのは `.html` / `.tsx` / `.jsx` / `.vue` だけ。`.htm` などを渡すと検査自体が実行されない）。

ダークモードは聞かない。`AGENTS.md` の「テーマ・ダークモード」表の設定に従う。

Claude Code では AskUserQuestion で聞く。他のクライアントでは箇条書きで聞いて**回答を待つ**（推測で進めない）。

## Step 3: 生成

- `DESIGN.md` の原則 + Step 1 で引き当てた契約の exact value で HTML を 1 枚書く。Tailwind class は契約の値を使う（近い値を目分量で選ばない）
- **Step 4 が拾えるルールも最初から守って書く**（例: [TABLE_TH_SCOPE_REQUIRED] / [A11Y_NO_TABINDEX_POSITIVE] / [BTN_ICON_ONLY_ARIA_REQUIRED]）。修正ループは検算であって、生成の手抜き分を回収する装置ではない
- **severity が `error` でも detector が `manual` のルールは Step 4 で絶対に捕まらない**（例: 実効タップ標的 44px の下限 [A11Y_MIN_TAP_TARGET_44]）。生成時に守るのが唯一の機会なので、使うコンポーネントのカテゴリのルールを `design/contracts/rules.json` で先に見る

## Step 4: 自己検証（検査は最大 3 回 = 初回 + 修正後の再検査 2 回）

1. 生成物を検査する。経路は 2 つあり、**返ってくる情報が違う**。どちらを使ったかを覚えておく（Step 5 の書き方が変わる）
   - **MCP 経路**: `check_html` に生成物を渡す。`passed` / `violations` / `coverage.automated` / `coverage.notAutomated` が返る
   - **CLI 経路**（MCP が無い環境）: `npm run design:lint-generated -- <生成ファイルのパス>`。error があれば exit 1。返るのは**違反一覧と件数と PASSED / FAILED だけで、`passed` フィールドも coverage も返らない**
2. severity `error` を全部直して再検査する。`warn` は残してよいが Step 5 に列挙する
3. 3 回目の検査でも error が残るなら、**残った violations を報告に載せて止まる**。ルールを黙って緩めない・生成物を検査対象から外さない
4. **検査そのものが実行できなかったとき**（CLI が exit 2 = 対象拡張子でない / パスが解決できない / ruleset を読めない、ツールのエラー、MCP が応答しない）は、**修正ループに入らない**。生成物は無検査のままなので、エラー出力をそのまま持って Step 5 へ行く。「たぶん通る」で埋めない

## Step 5: 報告（この順・この書式）

1. **使った契約と読んだファイル** — Step 1 で控えたもの。Step 2 で仮置きした前提があればここに書く
2. **lint 結果** — 最終検査の結果を、**使った経路が実際に返した形のまま**書く。要約も補完もしない
   - MCP 経路: `passed` の値と violations
   - CLI 経路: コマンドの exit code と出力の違反一覧（返っていないので `passed` という語は使わない）
   - error 0 なら「error 0」と書ける。error が残ったまま Step 4 の上限に達したなら、件数と残った violations を全部載せる
   - **検査が実行できなかったとき**は、件数を書かずに**エラー出力をそのまま転記する**（exit code と標準エラー出力）。違反 0 件と書かない
   - `warn` が残っていれば、どちらの経路でも全件列挙する
3. **coverage**
   - MCP 経路: `coverage.automated` / `coverage.notAutomated` をそのまま転記する（要約しない）
   - CLI 経路: **「未取得（CLI 経路では返らない。`check_html` が使える環境で再検査すると取れる）」と書く**。件数を推測して埋めない
4. **評価不可** — この画面に関係するのに自動検査で判定できないルールを `design/contracts/rules.json` から ID で引いて列挙する。列は design-review の `## 評価不可` 節と同じ 3 列。ただし **`reason` の語彙は design-review（human-only / not-observable-static / ルール無し）とは違い、rules.json の `automationStatus` の値を使う**

   | aspect | reason | proposal |
   |--------|--------|----------|
   | サイドバーの現在ページ表示 `[SPACE_NO_MISSING_ARIA_CURRENT]` | impossible-static | 実際のルーティングと突き合わせる |
   | Drawer のフォーカストラップ `[SPACE_NO_DRAWER_NO_FOCUS_TRAP]` | human-only | 実機で Tab / Shift+Tab の循環を確認する |

   - `human-only` — 人が実機を操作しないと判定できない
   - `impossible-static` — 静的 HTML からは判定できない（属性は書けるが、その中身が正しいかは外部の情報が要る）
   - `llm-judge-candidate` — 自動検査は無いが design-review skill が審査できる
   - `covered-by-test` — 既存テストがルールを担保しているが、**この生成物**の実動作は別に確認が要る
   - `未分類` — `automationStatus` の宣言が無いルール（rules.json に 44 件ある。例: `[SPACE_NO_P0_CARDS]`）。分類が未了なだけで、検査されているかは別に確認する
   - `ルール無し` — 対応するルールが `design/contracts/rules.json` に無い。この行に ID は書かない
   - この 3 分岐（`automationStatus` の値 / 無ければ `未分類` / ルール自体が無ければ `ルール無し`）で**どのルールにも reason を割り当てられる**。空欄にしない
   - `automationStatus` が `auto` のルールは Step 4 が検査するので、この節には載せない
   - **実在しない ID を書かない**
5. 最後に 1 行。**3 分岐**。どれにも共通して「ブランド未承認」を書く
   - error 0: 「lint-clean draft・ブランド未承認。最終判断は人間」
   - error 残り: 「**lint 未通過**・ブランド未承認。残った violations は上の 2 に列挙した」
   - 検査未完了: 「**検査未完了**・ブランド未承認。理由は上の 2 に転記した」

## やらないこと

- **`context: fork` にしない** — 生成物と検証結果はメインコンテキストに残す必要がある。fork すると呼び出し元に要約しか戻らず、Step 5 の転記が伝聞になる
- **実行時に原文を取りに行かない**（`gh api` 等でのリモート取得）。インストール済みのファイルと MCP だけを読む
- **「学習ポイント」「なぜこうするか」の散文を生成物に混ぜない**。人間向けの「なぜ」は `docs/` と hook の block 文言に置く
- **`check_html` の `passed` を完成承認と言わない**。lint-clean draft であってブランド適合の保証ではない
- **コンポーネント単体の生成に使わない**。ボタン 1 個・カード 1 枚は `DESIGN.md` のクイックモードで足りる
- **既存 HTML のレビューに使わない**。それは design-review skill の担当
