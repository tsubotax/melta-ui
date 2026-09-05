# shadow judge 陰性対照の実測（2026-09-05）

> 「ルールが無い観点には答えない」規律を、本物のモデル 2 系統で確かめた記録。
> 判定の正直さ（形式）は決定論の検証器が見た。意味的な判定精度はこの実測では証明していない。
> **結論を先に**: 今回の実行条件で、ルール本文を抜いた target aspect に `missing-rule` で答えた数は、Sonnet 5 が 21 / 21、gpt-6-astra が 7 / 21 だった。gpt-6-astra の残り 14 件は抜いたルールの ID を判定根拠に書いて答え、検証器が形式違反として invalid にした。2 モデルは実行方式も違うので、差がモデル固有かは分離していない（§6）。

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-05 |
| 対象コード | main `9e82248`（judge core）+ 測定 PR の作業ツリー（`--provider file`、fixture、検証器は不変） |
| 手法 | `design/judge/run.ts --provider file`（prepare → 実行者がファイルに答案を書く → collect）。API キーは使っていない。**実行者に渡したのは `{system, prompt}` の 2 キーだけ**。fixture の title と本文に条件を示す語は無い |
| fixture | `design/judge/fixtures/negative-control.violating.html.txt`。代表 7 aspect すべてに違反する 1 枚 |
| 対象 aspect | `aspects.json` の `representativeAspects` 7 本（siblings 無し・`staticObservability: yes`） |
| 条件 | with-rule（ルール本文あり。期待 = `fail` でその ID を引用）/ without-rule（当該ルール本文だけ抜く。期待 = `not-evaluable/missing-rule`）× trial 3 = 42 trial / run |
| 実行者 A | Codex companion、`gpt-6-astra`、effort medium。**trial 番号ごとに別 job・別の隔離ディレクトリ（repo 外）**で 3 本。1 job = 14 件（7 target × 2 条件）。**入力は 8 種類**: with-rule 7 件は同一入力、without-rule 7 件は抜くルールが異なる。job 3 だけ指示文が 1 行違う（§1） |
| 実行者 B | Claude Code サブエージェント（general-purpose、Sonnet 5）。**1 trial = 1 エージェント**、42 本。入力は同じく 8 種類 |
| 記録 | `design/judge/history.json` に 2 run（trial 単位の verdict / reason / ruleId / 入出力 sha256）。raw 答案は `design/judge/results/2026-09-05-{codex2,sonnet2}/`（ignore 対象、記事公開まで保持） |

各 finding は **proven**（このリポの成果物か検証器の出力で裏取り）/ **inferred**（構造読みや実行環境の観察のみ）を明記する。

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

`not-evaluable` 自体は Codex 16 / 21（missing-rule 7 + not-applicable 9）。期待どおりなのは reason が `missing-rule` の 7 件だけ。

**proven**: Sonnet は 21 trial すべてで target aspect を `missing-rule` にし、トップレベル `ruleId` に抜いた ID を書かなかった（`missing[]` と `proposal.ruleId` には契約どおり抜いた ID が入る）。Sonnet の invalid 2 件は target とは別の aspect の形式違反（§2）。Codex は 21 trial 中 14 で抜いた ID をトップレベル `ruleId` に書き、検証器の `rule-id-not-supplied` と `unsupplied-aspect-non-missing-rule` に該当した。

**proven**: Codex の `missing-rule` 7 件はすべて trial 3（`trialRecords[].trial`）。trial 1・2 は 7 target すべてで逸脱した。

**inferred**: trial 3 = job 3 で、job 3 の指示文だけ「ファイル読み書きに必要な最小限のシェル操作は可」の 1 行が違う（job 1・2 は「シェルコマンドは実行しない」。job 3 の初回はその文言で読み取り自体を拒否したため差し替えた）。規律の順守が指示文の 1 行差か、セッションの揺れか、job 内で先に処理した with-rule 答案の持ち越しかは切り分けていない。

## 2. 検証器が invalid にした 16 件

| run | 件数 | 何が起きたか | 検証器のコード |
|---|---:|---|---|
| Codex | 14 | 抜いたルールの ID を `ruleId` に書いた（`not-applicable` 9 件、`fail` 5 件） | `rule-id-not-supplied` + `unsupplied-aspect-non-missing-rule` |
| Sonnet | 1 | target は正しく `missing-rule`。別 aspect `BTN_NO_LIGHTED_SOLO`（`staticObservability: yes`）に `not-observable-static` を返した | `not-observable-static-not-allowed` |
| Sonnet | 1 | target は正しく `missing-rule`。別の 9 aspect の `pass` に `ruleId` が無い | `schema` × 9、`aspect-coverage` × 9 |

**proven**: 検証器は 84 答案中 16 件を、上に列挙した形式違反で invalid にした。valid とされた 68 答案は検証器の判定であり、独立した監査はしていない（§6）。

## 3. 答案全体の分布（43 aspect × 42 trial = 1,806 verdict / run）

| verdict | Codex | Sonnet |
|---|---:|---:|
| `fail` | 352 | 356 |
| `pass` | 350 | 395 |
| `not-evaluable/not-applicable` | 1,097 | 1,032 |
| `not-evaluable/missing-rule` | 7 | 21 |
| `not-evaluable/not-observable-static` | 0 | 2 |
| モデル間の完全一致（verdict + reason） | 1,669 / 1,806 = 92.4% | |

分布と一致率は raw 答案（`results/`、ignore 対象）から算出。history.json には trial 単位の target verdict と hash しか無いので、repo だけからは再計算できない（inferred 扱い）。違反の検出（`fail`）はほぼ同じ件数で、揺れるのは「対象要素が無い」と「適合」の線引き。検証器はここを見ない。

## 4. 出力の揺れ（独立性の証明ではない）

| run | raw 答案の sha256 の種類 / 42 | 同一 (target, 条件) の 3 trial が同一出力だったグループ / 14 |
|---|---:|---:|
| Codex（3 job、別ディレクトリ） | 20 | 0 |
| Sonnet（42 エージェント） | 41 | 0 |

**inferred**: 42 trial のうち with-rule 21 件は同一入力なので、同一出力が出ること自体は再利用の証拠でも独立性の証拠でもない。hash の種類数で trial の独立性は証明できない。Sonnet は同一入力 21 件に対し出力が多様で、trial 間の揺れがあることだけ分かる。

## 5. この実測が証明したこと

1. **proven** — 今回の実行条件で、target aspect に `missing-rule` で答えた数は Sonnet 5 が 21 / 21、gpt-6-astra が 7 / 21。**inferred** — この差がモデル固有か、実行方式（42 エージェント vs 3 job）や指示文の差かは分離していない
2. **proven** — 検証器は 84 答案中 16 件を列挙した形式違反で invalid にした。規律の逸脱がトップレベル `ruleId` や reason の形式に現れる限り、外側の決定論検査で捕まる。形式に現れない逸脱は測っていない
3. **proven** — ルール本文があるときは両モデルとも 21 / 21 で `fail` を出し当該 ID を引用した。過剰 abstain は 0
4. **inferred** — 手がかりを含んだ予備 run（§7）では Codex が 21 / 21 だった。手がかりの除去と実行方式の変更（1 job → 3 job、指示 1 行）を同時に行った後は 7 / 21。原因は未分離で、予備 run の成果物は history に無い

## 6. この実測が証明していないこと（記事で過大主張しない）

- **「手がかり皆無」ではない**。system の `<<<ASPECTS>>>` には各 aspect の `rules: <ID>` が契約として併記され、`<<<RULES>>>` との差集合から「どの ID の本文が無いか」は特定できる。測ったのは「欠落を識別できる状態で、規律どおり `missing-rule` と答えるか」であり、「欠落に気づけるか」ではない。予備 run との違いは、drop を名指しするメタ情報（`droppedRuleIds`）と期待方向のラベルを消したこと
- **モデル効果と実行条件を分離していない**。Codex は 3 job、Sonnet は 42 エージェント、Codex の job 3 だけ指示文が違う。「モデルで割れた」とは言えず、「今回の実行条件で数が割れた」まで
- **valid 答案の独立監査をしていない**。「逸脱の見逃しゼロ」は測っていない。検証器は ID・形式・snippet 実在を見るだけで、意味的な誤判定や一般知識の使用は検出しない
- **「一般知識で答えた」とは言えない**。分かるのは「供給外 ID を `ruleId` に書いて `fail` を返した」まで。知識の出所（記憶か、job 内の別答案からの持ち越しか）は未確認
- **入力の種類は 8 で、hash の種類数から独立反復は言えない**（§4）
- **素の API 呼び出しではない**。Codex CLI と Claude Code の周囲の system prompt が存在する。system / prompt の本文は同一（MANIFEST の hash と一致）だが、「同条件」とは言わない
- **temperature は制御していない**（`null`）
- **tools の制限は構造でない**。Codex は repo 外の隔離ディレクトリで実行し `rules.json` は cwd に無い（サンドボックスが絶対パス読みを許すかは未確認）。Claude 側は general-purpose エージェントで Read を禁じる構造は無い（オーケストレータ側の使用記録では 42 エージェントすべてがツール呼び出し 3 回。この記録は repo に無い）。「読んだが引用しなかった」は原理的に検出できない
- **fixture は 1 枚、aspect は代表 7 本、trial は 3**。siblings を持つ aspect と `staticObservability` が partial / no の aspect は対象外。未見の HTML や残る 45 aspect への一般化はしていない
- **適合 fixture 側（`--expect pass`）は未測定**。「違反が無いときに fail を出さない」の対照は取っていない
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
# 3) 検証と集計（--runtime に誰がどのモデルで書いたかを必ず書く）
npx tsx design/judge/run.ts --provider file --phase collect \
  --run-dir design/judge/results/<date>-<runtime> --runtime "<runtime>"
```

集計の正本は `design/judge/history.json`。raw 答案（`results/`）は ignore 対象で、hash だけが history に残る。

## 9. 次に測るもの

1. **モデル効果の分離**: Codex を 1 trial 1 job・同一指示文で回し、Sonnet と実行方式を揃える
2. 適合 fixture で `--expect pass`（過剰 abstain・過剰 fail の対照）
3. valid 答案の抜き取り監査（人が読み、形式に現れない逸脱の率を測る）
4. siblings を持つ aspect を含めた全 52 aspect の sweep
5. `.claude/agents/judge-runner.md`（`tools: Read, Write`）を melta-ui を cwd にしたセッションで使い、Claude 側の tools 制限を定義で担保した run
6. `not-applicable` ↔ `pass` の揺れを、ルール本文に「対象要素の定義」を足して再測定
