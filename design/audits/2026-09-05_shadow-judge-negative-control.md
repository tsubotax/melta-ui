# shadow judge 陰性対照の実測（2026-09-05）

> 「ルールが無い観点には答えない」規律を、本物のモデル 2 系統で確かめた記録。
> 判定の正直さ（形式）は決定論の検証器が見た。意味的な判定精度はこの実測では証明していない。
> **結論を先に**: ルール本文を抜いた target aspect に `missing-rule` で答えた数は、Sonnet 5（1 trial 1 エージェント）が 21 / 21、gpt-6-astra（1 job で 14 trial を逐次処理 × 3 job）が 7 / 21 だった。**同日の追試で同じ gpt-6-astra・同じ入力を 1 trial 1 job（42 job）に揃えると、指示文 2 種のどちらでも 21 / 21**（§1b）。7 / 21 は同じモデルが実行方式を変えると消える数字で、モデル固有の成績としては扱えない。A と B の差にモデル・実行方式・その相互作用がどう寄与したかは未分離（§6）。機構は実行者ログの解析（§1c）から「1 セッションで 14 件を処理した実行者が答案生成を雛形関数に集約し、その関数が差し替え後の入力を評価していなかった」と推定している（inferred。REPL の内部は未確認）。逸脱 14 件はすべて検証器が形式違反として invalid にし、valid で通った逸脱は 0。逐次処理での挙動が Sonnet でも同じかは未測定（§6）。**適合 fixture の対照（§1d）**: ルールがあって違反が無い target に `fail` を返した数は 0 / 21、ルールがあるのに `missing-rule` と答えた数も 0 / 21。18 / 21 が `pass`、残る 3 / 21 は `TABLE_NO_LAYOUT_TABLE` の全 trial が `not-applicable`（形式は valid）。指定した target 指標（`fail` / `missing-rule` / 形式違反）では 0 だが、この期待不一致 3 件の妥当性は未監査。

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-05 |
| 対象コード | main `9e82248`（judge core）+ 測定 PR の作業ツリー（`--provider file`、fixture、検証器は不変） |
| 手法 | `design/judge/run.ts --provider file`（prepare → 実行者がファイルに答案を書く → collect）。API キーは使っていない。**実行者に渡したのは `{system, prompt}` の 2 キーだけ**。fixture の title と本文に条件を示す語は無い |
| fixture | `design/judge/fixtures/negative-control.violating.html.txt`。代表 7 aspect すべてに違反する 1 枚（A〜D）。E だけ適合版 `negative-control.conforming.html.txt`（同じ画面で 7 aspect すべてに適合。**保証するのはこの 7 aspect だけ**） |
| 対象 aspect | `aspects.json` の `representativeAspects` 7 本（siblings 無し・`staticObservability: yes`） |
| 条件 | with-rule（ルール本文あり。期待 = `fail` でその ID を引用）/ without-rule（当該ルール本文だけ抜く。期待 = `not-evaluable/missing-rule`）× trial 3 = 42 trial / run |
| 実行者 A | Codex companion、`gpt-6-astra`、effort medium。**trial 番号ごとに別 job・別の隔離ディレクトリ（repo 外）**で 3 本。1 job = 14 件（7 target × 2 条件）。**入力は 8 種類**: with-rule 7 件は同一入力、without-rule 7 件は抜くルールが異なる。job 3 だけ指示文が 1 行違う（§1） |
| 実行者 B | Claude Code サブエージェント（general-purpose、Sonnet 5）。**1 trial = 1 エージェント**、42 本。入力は同じく 8 種類 |
| 実行者 C（追試） | Codex companion、`gpt-6-astra`、effort medium。**1 trial = 1 job、42 job**。各 job は repo 外の隔離ディレクトリ（`tasks/` 1 件 + `inputs/` 1 件 + 空の `outputs/`）で、入力 42 本は A と byte 一致。指示文は A の job 3 と同一（件数の「14」を「1」に置換した 2 箇所だけ差分） |
| 実行者 D（追試・対照） | C と同じ 1 trial = 1 job。指示文だけ A の job 1・2 と同一（「シェルコマンドは実行しない」の文言）。C と D の指示文の差はその 1 行だけ |
| 実行者 E（適合 fixture の対照） | C と同じ（1 trial = 1 job、指示文も C と同一）。fixture だけ適合版、期待は with-rule → `pass@X` / without-rule → `missing-rule`（`--expect pass`）。42 job すべてシェル経由、拒否 0 |
| 記録 | `design/judge/history.json` に 5 run（順に A / B / C / D / E。trial 単位の verdict / reason / ruleId / 入出力 sha256）。raw 答案と実行者ログは ignore 対象の `design/judge/results/` にローカル保持（A は `2026-09-05-codex2-raw/`、C・D・E は `2026-09-05-codex{3,4,5}/`。checkout によっては無い）。**B の raw は測定 PR の worktree 削除で失われ、hash だけが history に残る** |

各 finding は 3 区分で明記する。**proven** = このリポの成果物（history.json、作業ツリーの `results/`）か検証器の出力から再計算できる。**observed** = repo 外の実行者ログ（Codex の rollout / companion ログ）に記録された操作で、この checkout からは検算できない。**inferred** = 構造読みや観察からの推定で、他の説明を排除していない。

---

## 1. 結果（遷移表）

7 target × 2 条件 × 3 trial。数値は「期待一致 / trial 数」。期待一致 = 検証器が valid かつ期待 verdict に一致（with-rule は当該 ID の引用まで要求）。

| target | with-rule → fail@X（Codex） | without-rule → missing-rule（Codex） | with-rule → fail@X（Sonnet） | without-rule → missing-rule（Sonnet） |
|---|---:|---:|---:|---:|
| `TYPO_NO_XS_BODY` | 3/3 | 1/3 | 3/3 | 3/3 |
| `FORM_SELECT_APPEARANCE_NONE` | 3/3 | 1/3 | 3/3 | 3/3 |
| `MODAL_OVERLAY_REQUIRED` | 3/3 | 1/3 | 3/3 | 3/3 |
| `SPACE_NO_DARK_SIDEBAR_BG` | 3/3 | 1/3 | 3/3 | 2/3 |
| `A11Y_NO_OUTLINE_NONE_WITHOUT_RING` | 3/3 | 1/3 | 3/3 | 3/3 |
| `TABLE_NO_LAYOUT_TABLE` | 3/3 | 1/3 | 3/3 | 2/3 |
| `DIVIDER_NO_DIV_BORDER_B` | 3/3 | 1/3 | 3/3 | 3/3 |

| 集計 | Codex（gpt-6-astra） | Sonnet 5 |
|---|---:|---:|
| with-rule 期待一致 | 21 / 21 | 21 / 21 |
| without-rule 期待一致 | **7 / 21** | **19 / 21** |
| 供給外 ID をトップレベル `ruleId` に書いた答案 | 14 | 0 |
| 検証器 invalid | 14 | 2 |
| 欠落 output | 0 | 0 |

### without-rule の内訳（target aspect の答え方）

| target aspect の答え | Codex | Sonnet |
|---|---:|---:|
| `not-evaluable/missing-rule`、トップレベル `ruleId` に抜いた ID を書かない（期待） | 7 | **21** |
| `not-evaluable/not-applicable` と答え、`ruleId` に抜いた ID を書いた | 9 | 0 |
| `fail` と答え、`ruleId` に抜いた ID を書いた（知識の出所は未確認） | 5 | 0 |

`not-evaluable` 自体は Codex 16 / 21（missing-rule 7 + not-applicable 9）。期待どおりなのは reason が `missing-rule` の 7 件だけ。この節の数字はすべて**最終答案の分類**で、実行者が内部でどう判断したかは含まない（§1c）。

**proven**: Sonnet は 21 trial すべてで target aspect を `missing-rule` にし、トップレベル `ruleId` に抜いた ID を書かなかった（`missing[]` と `proposal.ruleId` には契約どおり抜いた ID が入る）。Sonnet の invalid 2 件は target とは別の aspect の形式違反（§2）。Codex は 21 trial 中 14 で抜いた ID をトップレベル `ruleId` に書き、検証器の `rule-id-not-supplied` と `unsupplied-aspect-non-missing-rule` に該当した。

**proven**: Codex の `missing-rule` 7 件はすべて trial 3（`trialRecords[].trial`）。trial 1・2 は 7 target すべてで逸脱した。

**proven**: trial 3 = job 3 で、job 3 の指示文だけ「ファイル読み書きに必要な最小限のシェル操作は可」の 1 行が違う（job 1・2 は「シェルコマンドは実行しない」。job 3 の初回はその文言で読み取り自体を拒否したため差し替えた）。**inferred**: 同日の追試（§1b）で、指示文 2 種とも 1 trial 1 job なら 21 / 21 だった。逸脱は逐次処理に伴う雛形化と推定するが、「シェル禁止の文言 × 逐次処理」の相互作用や機構の候補（§1c）は分離していない。

## 1b. 追試: Codex を 1 trial 1 job に揃えた 2 run（同日夜）

A の 7 / 21 が「モデルの差」か「1 job で 14 件を逐次処理した実行方式の差」かを分離するため、同じモデル・同じ入力（42 本とも A の入力と byte 一致）で、**1 trial = 1 job** に揃えて 2 run 取った。C は A の job 3 の指示文、D は A の job 1・2 の指示文（シェル禁止の文言）。差はその 1 行だけ。

| target | C: with-rule | C: without-rule | D: with-rule | D: without-rule |
|---|---:|---:|---:|---:|
| `TYPO_NO_XS_BODY` | 3/3 | 3/3 | 3/3 | 3/3 |
| `FORM_SELECT_APPEARANCE_NONE` | 3/3 | 3/3 | 3/3 | 3/3 |
| `MODAL_OVERLAY_REQUIRED` | 3/3 | 3/3 | 3/3 | 3/3 |
| `SPACE_NO_DARK_SIDEBAR_BG` | 3/3 | 3/3 | 3/3 | 3/3 |
| `A11Y_NO_OUTLINE_NONE_WITHOUT_RING` | 3/3 | 3/3 | **2/3** | 3/3 |
| `TABLE_NO_LAYOUT_TABLE` | 3/3 | 3/3 | 3/3 | 3/3 |
| `DIVIDER_NO_DIV_BORDER_B` | 3/3 | 3/3 | 3/3 | 3/3 |

| 集計 | A: Codex 3 job（再掲） | C: Codex 42 job・指示文 job 3 | D: Codex 42 job・指示文 job 1・2 | B: Sonnet 42 エージェント（再掲） |
|---|---:|---:|---:|---:|
| with-rule 期待一致 | 21 / 21 | 21 / 21 | 20 / 21 | 21 / 21 |
| without-rule 期待一致 | **7 / 21** | **21 / 21** | **21 / 21** | **19 / 21** |
| 供給外 ID をトップレベル `ruleId` に書いた答案 | 14 | 0 | 0 | 0 |
| 検証器 invalid | 14 | 0 | 1 | 2 |
| 欠落 output | 0 | 0 | 1 | 0 |
| 実行者が使ったファイル IO | node_repl（job 1・2）/ シェル（job 3） | シェル 42 / 42 | node_repl 41 / 42、拒否 1 | Read / Write ツール |

**proven**（history.json の run 3・4、`results/2026-09-05-codex{3,4}/`）: 1 trial 1 job にすると、指示文 2 種のどちらでも target aspect は 21 / 21 で `missing-rule`、抜いた ID をトップレベル `ruleId` に書いた答案は 0。D の invalid 1 件は `A11Y_NO_OUTLINE_NONE_WITHOUT_RING` with-rule trial 2 の欠落で、`missing-output` として invalid に数えた（observed: 実行者ログでは「シェルを使わずにローカルファイルを読むツールがない」と答えて 0 件で終了。A の job 3 初回と同じ拒否）。D の without-rule 側で target aspect を `not-evaluable/missing-rule` 以外にした答案は 0。

**proven**（C・D の raw 答案から算出。分母は D の欠落 1 件を除いた 41 答案 × 43 aspect）: C と D の答案の完全一致（verdict + reason）は 1,742 / 1,763 = 98.8%、target aspect に限れば 41 / 41。
**inferred**（A の raw はローカルの ignore 対象にしか無く、この checkout からは検算できない）: A と C は 1,760 / 1,806 = 97.5%。target aspect の 28 / 42 だけは history.json から再計算でき、A の逸脱 14 件がそのまま差。

**inferred**: C で `FORM_SELECT_APPEARANCE_NONE` without-rule の trial 1 と 3 が byte 一致の答案（sha256 `ad487a35e5ac`）になった。別 job の独立した出力なので、同一出力を再利用の証拠と読まない根拠がもう 1 つ増えた（§4）。

## 1c. A の逸脱 14 件の機構（実行者ログの解析）

A の 3 job の rollout ログ（`~/.codex-*/sessions/`、repo 外）から、実行者が実際に走らせたコードを追った。この節の「observed」は**そのログに記録された操作**で、repo からは検算できない。操作から実行者の認識や知識源を読むのは推定なので inferred に分ける。

| job | 指示文 | ファイル IO | 答案の作り方 | without-rule の結果 |
|---|---|---|---|---|
| 1 | シェル禁止 | `node_repl`（REPL。変数が呼び出し間で残る） | t01 で `writeVerdicts(n, pass, fail)` を定義。以降 13 件は入力を読み替えたあと、pass リストと fail マップを編集してこの関数を呼ぶ | 0 / 7（`not-applicable` 2 + `fail` 5。いずれも抜いた ID を `ruleId` に書いた） |
| 2 | シェル禁止 | `node_repl` | t02 で `save(id, decisions[43])` を定義。以降は aspect 順の判断コード（`p` / `n` / 行番号 / `m`）だけを渡す | 0 / 7（すべて `not-applicable` + 抜いた ID） |
| 3 | 最小限のシェル可 | シェル（`cat` / `printf`） | `format(x, fail, pass, obs)` を定義。**入力 `x` を毎回引数で渡す** | 7 / 7 |

**observed**（rollout ログのコード原文）: job 1 の `writeVerdicts` と job 2 の `save` は、どちらも RULES 区画の `### <ID>` 見出しから供給集合を作り、無い ID を自動で `missing-rule` にする分岐を持っていた。両関数は入力を引数で受けず REPL 変数 `inp` を参照する。job 3 の `format` は入力を引数 `x` で毎回受け取る。
**proven**（repo 内）: without-rule の入力からは当該見出しが実際に消えている（`inputs/tNN.input.json`。抜いた ID は RULES 区画に 0 回出現）。A の job 1・2 の without-rule 14 答案で `missing-rule` は 0 件（history.json）。
**inferred**: 見出しが無い入力に対して自動分岐が走れば発火するはずなので、両関数は差し替え後の入力を評価していなかったと推定する。候補は「関数が定義時の `inp` を掴んだまま」「`inp` の再代入が失敗した」「REPL 側のキャッシュ」などで、どれかは分離していない（`node_repl` は ChatGPT.app 同梱のバイナリで、変数スコープの実装は読めていない）。いずれの候補でも「関数が現在の入力を見ていない」点は共通。

**observed**: job 2 は 7 件すべてで target aspect の判断コードに `m`（missing）を渡していた。雛形は `m` を認識せず `not-applicable` + `ruleId: <抜いた ID>` に落とし、検証器の `rule-id-not-supplied` で invalid になった。job 1 は 2 件で fail マップから target を外し、5 件で残した。
**inferred**: `m` を渡した 7 件は、実行者が target のルール欠落を認識していたと読める（判断コードは実行者自身の出力）。ただし「認識していた」と「規律どおり判定できる」は別で、これを判断能力の証明とはしない。job 1 の「外した / 残した」も操作の記録で、気づきの有無は推定。

**inferred**: 指示文の「シェルコマンドは実行しない」は、実行者を `node_repl` へ誘導する（A の job 1・2、D の 41 / 42）か、読み取り自体を拒否させる（A の job 3 初回、D の 1 / 42）。「最小限のシェル可」はシェルへ誘導する（A の job 3、C の 42 / 42）。指示文の 1 行は判定の規律ではなく IO 経路と拒否率を変えていた。

この節の含意（inferred）: **答案を 1 セッションで何件も処理させると、実行者は生成を雛形に集約し、判定が入力を見なくなることがある**。検証器はその結果（供給外 ID の引用）を形式で捕まえたが、job 2 のように内部の判断コードが missing でも形式で落ちる。逆に、判断が誤っていて形式が正しい答案は捕まえられない（§6）。

## 1d. 適合 fixture の対照（run E）: 違反が無いときに fail を出さないか

A〜D は違反 fixture なので、「ルールがあれば `fail`、抜けば `missing-rule`」しか見ていない。逆側の対照として、同じ画面の適合版（代表 7 aspect すべてに適合、`lintSource` の error 0）を C と同じ条件（gpt-6-astra、1 trial 1 job、同じ指示文）で回した。期待は with-rule → `pass` で target の ID を引用 / without-rule → `missing-rule`。

| target | with-rule → pass@X | without-rule → missing-rule | with-rule の target aspect の答え |
|---|---:|---:|---|
| `TYPO_NO_XS_BODY` | 3/3 | 3/3 | pass 3 |
| `FORM_SELECT_APPEARANCE_NONE` | 3/3 | 3/3 | pass 3 |
| `MODAL_OVERLAY_REQUIRED` | 3/3 | 3/3 | pass 3 |
| `SPACE_NO_DARK_SIDEBAR_BG` | 3/3 | 3/3 | pass 3 |
| `A11Y_NO_OUTLINE_NONE_WITHOUT_RING` | 3/3 | 3/3 | pass 3 |
| `TABLE_NO_LAYOUT_TABLE` | **0/3** | 3/3 | `not-evaluable/not-applicable` 3（ruleId は target） |
| `DIVIDER_NO_DIV_BORDER_B` | 3/3 | 3/3 | pass 3 |

| 集計 | E |
|---|---:|
| with-rule 期待一致（`pass@X`） | 18 / 21 |
| with-rule で target に `fail`（過剰 fail） | **0 / 21** |
| with-rule で target に `missing-rule`（過剰 abstain） | **0 / 21** |
| without-rule 期待一致 | 21 / 21 |
| 供給外 ID をトップレベル `ruleId` に書いた答案 | 0 |
| 検証器 invalid / 欠落 output | 0 / 0 |
| raw sha256 の種類 / 42 | 37 |

**proven**（history.json の run 5、`results/2026-09-05-codex5/`）: ルールがあって違反が無い target に `fail` を返した答案は 0、ルールがあるのに `missing-rule` と答えた答案も 0、形式違反 0。期待不一致 3 件はすべて `TABLE_NO_LAYOUT_TABLE` で、`not-evaluable/not-applicable`（ruleId は target、検証器は valid）。E の 42 答案のうち TABLE のルール本文を供給した 39 答案はすべて `not-applicable` で、`pass` は 0（E の中では揺れていない）。without-rule は C・D と同じく 21 / 21。
**inferred**: 適合版は table を `grid` の div に置き換えている（`fixtures/README.md`）ので、「table が無い = 対象外」と読んだと推定する。答案に理由の記述は無い。期待 `pass` に対する `not-applicable` は期待不一致として数え、その妥当性（`pass` と答えるべきか）は独立監査していない（§6）。

**proven**（E の raw 答案から算出）: target 以外の aspect への `fail` は 42 答案で 125 件、内訳は `MODAL_CLOSE_REQUIRED` 42 / 42、`A11Y_MIN_TAP_TARGET_44` 42 / 42、`SPACE_NO_3COL_LAYOUT` 41 / 42（残り 1 件は `pass`）の 3 aspect に集中している。適合 fixture が適合を保証するのは代表 7 aspect だけで、この 3 aspect は保証の外。
**inferred**（著者の過去集計。C の raw はローカルの ignore 対象にしか無く、この checkout では検算できない）: `MODAL_CLOSE_REQUIRED` と `A11Y_MIN_TAP_TARGET_44` は違反 fixture の C でも 42 / 42 だった。
**proven**（fixture 本文と答案の evidence）: `A11Y_MIN_TAP_TARGET_44` の `fail` は 24 行の `select` と 33 行の `button` を引用し（33 行 30 件・24 行 12 件）、どちらも `h-10`（40px）で、ルール本文の 44px を下回る。`MODAL_CLOSE_REQUIRED` は dialog 本体の 42 行（39 件）か本文の 45 行（3 件）を引用し、dialog（42〜46 行）に閉じるボタンに当たる要素は無い。`SPACE_NO_3COL_LAYOUT` は 35 行の `grid grid-cols-2`（41 件）を引用し、fixture に `grid-cols-3` は無い。
**inferred**: 上の 3 つが本当に違反かは人が読む対象で、この実測は正誤を言わない。ただし `h-10` と閉じるボタン不在は静的に確認でき、`SPACE_NO_3COL_LAYOUT` はサイドバー + メイン + 2 列 grid を 3 列と読んだと推定する。適合版が TABLE の違反を `grid-cols-2` で直した結果、別 aspect の読みを誘発した可能性がある。

含意: **この fixture・この条件・指定した target 指標では、逸脱（過剰 fail / 過剰 abstain / 形式違反）は 0**。期待不一致 3 件（TABLE の `not-applicable`）の妥当性は未監査。残る問題は「対象要素が無いとき `pass` と `not-applicable` のどちらを返すか」で、ルール本文に対象要素の定義が無いことに由来すると推定する（§9-6）。

## 2. 検証器が invalid にした 16 件

| run | 件数 | 何が起きたか | 検証器のコード |
|---|---:|---|---|
| Codex | 14 | 抜いたルールの ID を `ruleId` に書いた（`not-applicable` 9 件、`fail` 5 件） | `rule-id-not-supplied` + `unsupplied-aspect-non-missing-rule` |
| Sonnet | 1 | target は正しく `missing-rule`。別 aspect `BTN_NO_LIGHTED_SOLO`（`staticObservability: yes`）に `not-observable-static` を返した | `not-observable-static-not-allowed` |
| Sonnet | 1 | target は正しく `missing-rule`。別の 9 aspect の `pass` に `ruleId` が無い | `schema` × 9、`aspect-coverage` × 9 |

**proven**: 検証器は 84 答案中 16 件を、上に列挙した形式違反で invalid にした。valid とされた 68 答案は検証器の判定であり、独立した監査はしていない（§6）。追試（§1b）では C が invalid 0、D が invalid 1（欠落 1 件の `missing-output`）、適合 fixture の E（§1d）は invalid 0。

## 3. 答案全体の分布（43 aspect × 42 trial = 1,806 verdict / run）

| verdict | A: Codex 3 job | B: Sonnet | C: Codex 42 job | D: Codex 42 job（41 答案） |
|---|---:|---:|---:|---:|
| `fail` | 352 | 356 | 357 | 348 |
| `pass` | 350 | 395 | 330 | 339 |
| `not-evaluable/not-applicable` | 1,097 | 1,032 | 1,098 | 1,055 |
| `not-evaluable/missing-rule` | 7 | 21 | 21 | 21 |
| `not-evaluable/not-observable-static` | 0 | 2 | 0 | 0 |
| 完全一致（verdict + reason） | A–B 1,669 / 1,806 = 92.4% | | A–C 1,760 / 1,806 = 97.5% | C–D 1,742 / 1,763 = 98.8% |

分布と一致率は raw 答案（`results/`、ignore 対象）から算出。history.json には trial 単位の target verdict と hash しか無いので、repo だけからは再計算できない。C・D の列と C–D の一致率は作業ツリーの raw で検算済み（proven）。A の列と A–C は A の raw がローカルにしか無く、A–B は B の raw が失われたため検算不能（inferred。A–B は当時の算出のまま）。違反の検出（`fail`）はほぼ同じ件数で、揺れるのは「対象要素が無い」と「適合」の線引き。検証器はここを見ない。

## 4. 出力の揺れ（独立性の証明ではない）

| run | raw 答案の sha256 の種類 / 42 | 同一 (target, 条件) の 3 trial が同一出力だったグループ / 14 |
|---|---:|---:|
| A: Codex（3 job、別ディレクトリ） | 20 | 0 |
| B: Sonnet（42 エージェント） | 41 | 0 |
| C: Codex（42 job、指示文 job 3） | 31 | 0 |
| D: Codex（42 job、指示文 job 1・2。41 答案） | 35 | 0 |
| E: Codex（42 job、適合 fixture） | 37 | 0 |

**inferred**: 42 trial のうち with-rule 21 件は同一入力なので、同一出力が出ること自体は再利用の証拠でも独立性の証拠でもない。hash の種類数で trial の独立性は証明できない。Sonnet は同一入力 21 件に対し出力が多様で、trial 間の揺れがあることだけ分かる。

## 5. この実測が証明したこと

1. **proven** — 同じ gpt-6-astra・同じ入力を 1 trial 1 job で回すと、指示文 2 種のどちらでも without-rule は 21 / 21（§1b）。A の 7 / 21 は同じモデルが実行方式を変えると消えるので、モデル固有の成績としては扱えない。1 trial 1 実行者に揃えた条件では、gpt-6-astra と Sonnet 5 の target aspect はどちらも 21 / 21（Sonnet の invalid 2 は別 aspect の形式違反）。**inferred** — A と B の差にモデル・実行方式・その相互作用がどう寄与したかは未分離（Sonnet の逐次処理対照が無い）。A の 7 / 21 を作った機構は「雛形関数が差し替え後の入力を評価していなかった」と推定（§1c）
2. **proven** — 検証器は A・B の 84 答案中 16 件を列挙した形式違反で invalid にした。規律の逸脱がトップレベル `ruleId` や reason の形式に現れる限り、外側の決定論検査で捕まる。形式に現れない逸脱は測っていない
3. **proven** — ルール本文があるときは 4 run とも `fail` を出し当該 ID を引用した（A・B・C 21 / 21、D 20 / 21 で残り 1 は欠落）。過剰 abstain は 0
4. **observed / inferred** — A の逸脱 14 件のうち 7 件（job 2）は、実行者ログ上の判断コードが `m`（missing）で、自作の雛形の出力形式だけが契約違反だった（§1c。ログは repo 外）。検証器は判断の正誤ではなく形式を見るので、この 7 件も invalid にした。fail-closed の設計どおりだが、「invalid = モデルが規律を破った」とは読めない
5. **inferred** — 手がかりを含んだ予備 run（§7）では Codex が 21 / 21 だった。予備 run は 1 job 42 件の逐次処理で、雛形化が起きたかは記録が無く不明。予備 run の成果物は history に無い

## 6. この実測が証明していないこと（記事で過大主張しない）

- **「手がかり皆無」ではない**。system の `<<<ASPECTS>>>` には各 aspect の `rules: <ID>` が契約として併記され、`<<<RULES>>>` との差集合から「どの ID の本文が無いか」は特定できる。測ったのは「欠落を識別できる状態で、規律どおり `missing-rule` と答えるか」であり、「欠落に気づけるか」ではない。予備 run との違いは、drop を名指しするメタ情報（`droppedRuleIds`）と期待方向のラベルを消したこと
- **実行方式の効果は Codex 側でしか分離していない**。Sonnet を「1 エージェントで 14 件逐次」にした対照は取っていないので、雛形化と入力の見落としが Claude 側でも起きるかは未測定。逐次処理とモデルの相互作用は排除できておらず、「モデルの差ではない」と断定はできない。言えるのは「1 trial 1 実行者に揃えた条件では 2 モデルとも 21 / 21」まで
- **A の原因は確定していない**。§1c の機構（雛形関数が差し替え後の入力を評価していなかった）は実行者ログからの推定で、候補の分離もしていない
- **valid 答案の独立監査をしていない**。「逸脱の見逃しゼロ」は測っていない。検証器は ID・形式・snippet 実在を見るだけで、意味的な誤判定や一般知識の使用は検出しない
- **A の `fail` 5 件の知識の出所は未確認のまま**（§1 と同じ）。実行者ログ上は t01 で作った fail マップに target を残したまま関数を呼んだ操作だが、そのマップの元が t01 時点で供給されたルール本文か一般知識かは分離できない。「一般知識で答えたのではない」とは言わない。雛形を作らない実行者が一般知識で `fail` を返す可能性も別に残る（C・D では供給外 ID の引用 0 件）
- **雛形化の機構は推定**。`node_repl` の変数スコープの実装は読めておらず、「関数が差し替え後の入力を評価していなかった」は自動分岐が 0 回しか発火しなかった事実からの推定で、候補（掴み損ね / 再代入失敗 / キャッシュ）は分離していない（§1c）
- **B（Sonnet）の raw 答案は失われた**。history.json の hash と当時の集計値だけが残り、B を含む再計算はできない
- **入力の種類は 8 で、hash の種類数から独立反復は言えない**（§4）
- **素の API 呼び出しではない**。Codex CLI と Claude Code の周囲の system prompt が存在する。system / prompt の本文は同一（MANIFEST の hash と一致）だが、「同条件」とは言わない
- **temperature は制御していない**（`null`）
- **tools の制限は構造でない**。Codex は repo 外の隔離ディレクトリで実行し `rules.json` は cwd に無い（サンドボックスが絶対パス読みを許すかは未確認）。Claude 側は general-purpose エージェントで Read を禁じる構造は無い（オーケストレータ側の使用記録では 42 エージェントすべてがツール呼び出し 3 回。この記録は repo に無い）。「読んだが引用しなかった」は原理的に検出できない
- **fixture は 1 枚、aspect は代表 7 本、trial は 3**。siblings を持つ aspect と `staticObservability` が partial / no の aspect は対象外。未見の HTML や残る 45 aspect への一般化はしていない
- **適合 fixture 側は 1 run・1 モデル・代表 7 aspect だけ**（§1d）。過剰 fail 0 はこの範囲の観測。期待不一致 3 件（`TABLE_NO_LAYOUT_TABLE` の `not-applicable`）が `pass` であるべきかは独立監査していない。fixture が適合を保証するのは 7 aspect だけで、target 以外への `fail`（3 aspect に集中、42 / 42 で再現）は正誤を確認していない。Sonnet では取っていない
- **意味的な判定精度は未証明**。§3 の `not-applicable` ↔ `pass` の揺れがその証拠
- **human-only 9 aspect は LLM に渡していない**
- **予備 run（§7）は repo から検算できない**。history から除いたため、report.md と provenance はローカルの `results/` にしか無い

## 7. 予備 run（条件の手がかりつき。history から除外・参考値）

同日、修正前の入力レイアウトで 1 回目を取った。実行者向け `input.json` に `droppedRuleIds` が同居し、fixture の `<title>` に「陰性対照 fixture（違反版）」と書かれていたため、実行者は指定ファイルだけを読んでも抜いたルールと期待方向を知り得た（Codex コードレビューで判明）。実行方式も本測定と違う（Codex は 1 job で 42 件を逐次処理）。数値は参考値で、repo からは検算できない。

| 予備 run | with-rule | without-rule | 供給外 ID 引用 | invalid | raw sha256 の種類 |
|---|---:|---:|---:|---:|---:|
| Codex（1 job・逐次） | 21 / 21 | 21 / 21 | 0 | 0 | 8 |
| Sonnet（42 エージェント） | 21 / 21 | 21 / 21 | 0 | 0 | 40 |

## 8. 再現手順

```bash
cd melta-ui
# 1) 入力と実行者向け指示を書く（LLM は呼ばない）
npx tsx design/judge/run.ts --provider file --phase prepare \
  --run-dir design/judge/results/<date>-<runtime> \
  --file design/judge/fixtures/negative-control.violating.html.txt \
  --negative-control --expect fail --trials 3
# 2) tasks/tNN.task.md を 1 件ずつ実行者に渡し、outputs/tNN.output.txt を書かせる
#    実行者に渡すのは inputs/（{system, prompt} のみ）と tasks/ だけ。meta/ と MANIFEST は渡さない
#    独立反復にするなら 1 trial 1 セッション（Claude Code なら .claude/agents/judge-runner.md）
#    Codex なら trial ごとに隔離ディレクトリを作り、companion の --cwd で 1 job 1 trial にする
#    （1 job に複数 trial を渡すと雛形化が起きる。§1c）。実行者向けの task.md は隔離ディレクトリの
#    絶対パスに書き換えて渡し、run-dir 側の task.md は変えない（collect の指示同一性の門が見る）
# 3) 検証と集計（--runtime に誰がどのモデルで書いたかを必ず書く）
npx tsx design/judge/run.ts --provider file --phase collect \
  --run-dir design/judge/results/<date>-<runtime> --runtime "<runtime>"
```

集計の正本は `design/judge/history.json`。raw 答案（`results/`）は ignore 対象で、hash だけが history に残る。

## 9. 次に測るもの

1. モデル効果の分離: 「1 trial 1 実行者に揃えた対照」は済み（§1b）。残るのは逆向きの対照（Sonnet を 1 エージェント 14 件逐次で回し、雛形化と入力の見落としが Claude 側でも起きるか）と、A の機構の候補分離（§1c）
2. 適合 fixture で `--expect pass`: Codex 1 run は済み（§1d、過剰 fail 0 / 過剰 abstain 0）。残るのは Sonnet での同じ対照と、fixture を全 52 aspect 適合に拡張して target 以外の `fail` を 0 にできるかの確認
3. valid 答案の抜き取り監査（人が読み、形式に現れない逸脱の率を測る）
4. siblings を持つ aspect を含めた全 52 aspect の sweep
5. `.claude/agents/judge-runner.md`（`tools: Read, Write`）を melta-ui を cwd にしたセッションで使い、Claude 側の tools 制限を定義で担保した run
6. `not-applicable` ↔ `pass` の揺れを、ルール本文に「対象要素の定義」を足して再測定
