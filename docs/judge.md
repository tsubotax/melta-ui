# shadow judge（PR1: judge core）

`design/judge/` は melta の「評価不可」規律の実装。ハーネスに該当ルールが無い観点は、一般 UX 知識で補完せず `not-evaluable` と返し、不足ルール候補を出す。

初版は **observation only**。judge は CI を落とさないし、`rules.json` も書き換えない。

---

## 位置づけ

| 項目 | 初版の扱い |
|---|---|
| judge の `fail` | CI を落とさない。exit code が非 0 になるのは実装障害と `invalid` だけ |
| `proposal`（不足ルール候補） | 非 authoritative。`design/judge/results/` に残し、`rules.json` へは人間が別 PR で反映する（Memory Quarantine） |
| 監査 | 各 run が `.melta-loop/runs.jsonl` に 1 行残す（`workflow: "shadow-judge"` / `level: "observation"`） |
| README の coverage 表 | 触らない。`llm-judge-candidate` は初版では「無防備」のまま数える |
| MCP 公開契約 | 変えない。judge の MCP tool 化は enforcement 昇格と同じ human gate |

**「導入」の定義**: `llm-judge-candidate` を「自動検証あり」と数え直してよいのは、human-gated enforcement へ昇格したときだけ。昇格と公開文言の変更は実測後の別 human gate。

---

## aspect

**aspect は「判定できる 1 つの問い」**。`ruleCategories` ではない（あれは語彙で、form には 11 本のルールがある）。

`design/judge/aspects.json` が authoring source。SSOT の派生ではないので人が書き、`rules.json` との整合は `tests/judge.spec.ts` のテスト 8 が固定する。

| フィールド | 意味 |
|---|---|
| `aspectId` | 初版は `ruleIds[0]` と同一。将来 1 aspect 複数 rule を許すため配列を持つ |
| `question` | 人が読める判定質問 |
| `category` / `automationStatus` | `rules.json` と一致していることをテストで固定する |
| `staticObservability` | `yes` / `partial` / `no`。`not-observable-static` を許すかを決める |
| `siblings[]` | 同じ欠陥を拾う別ルール。陰性対照の既定対象から外す判断に使う |

初版は `llm-judge-candidate` 43 本 + `human-only` 9 本の 52 aspect。

---

## 陰性対照

judge には**常に aspect 全件を渡し、ルール本文の集合だけを操作する**。ルール X の本文を抜いても aspect X は残るので、期待値は「aspect X が `not-evaluable` / `reason: missing-rule` になり、X を pass / fail で引用しない」で一意に決まる。同一カテゴリの他ルールが残っていても曖昧にならない。

既定の対象は `siblings` が空で `staticObservability` が `yes` の aspect に限る。対象外は run のレポートに理由つきで一覧化される。

**陰性対照は target ごとに期待 verdict の宣言を要求する。** `--expect fail|pass` か `--expect-map` が無ければ CLI は起動しない。

| 条件 | 成功の定義 |
|---|---|
| with-rule | `valid` かつ verdict が宣言どおり かつ **target 自身の ruleId を引用している** |
| without-rule | `valid` かつ `not-evaluable` / `missing-rule` |

with-rule を「評価された」で成功にすると、違反 fixture に `pass` が返っても成功に数えられる。それでは「X あり → fail@X / X なし → not-evaluable」の遷移表が偽陽性になり、記事の証拠として使えない。

| 対象外の理由 | 意味 |
|---|---|
| `sibling` | X を抜いても兄弟ルールが同じ欠陥を拾うので、abstain の証拠として弱い |
| `not-observable-static` | 静的 HTML から観測できない。Esc 挙動・時間経過・レンダリング結果に依存する |
| `human-only` | LLM に渡さない。verdict は adapter が決定論で付ける |

`aspects.json` の `representativeAspects` が `--negative-control` の既定対象。

---

## 検証器が担保すること・しないこと

`design/judge/validate.ts` は決定論の fail-closed 層。1 つでも破れば `invalid` を返す。

**担保する（形式の正直さ）**

1. スキーマ適合。出力全体を `JSON.parse` にかけ、**切り出しはしない**。provider にも加工させない（judge は `rawText: true` を渡し、`anthropic.ts` の ```html フェンス抽出を通さない）。コードフェンス・前置き・後置きの説明文が 1 文字でも付いていたら invalid。top-level は「キーが `verdicts` だけの非配列 object」に限定し、分岐ごとのキー集合も完全一致で見る。**定義外のキーが 1 つでもあれば invalid**。配列直返しも invalid
2. 全 aspect にちょうど 1 つの verdict。欠落・重複・未知の `aspectId` はすべて invalid
3. `ruleId` が供給集合に実在し、かつその aspect の `ruleIds` 内。`pass` / `fail` / `not-applicable` / `not-observable-static` の全分岐に適用する
4. `human-only` aspect は `not-evaluable/human-only` のみ。LLM 出力に混ざっていたら invalid
5. `missing-rule` はルール本文が供給されていない場合だけ許可。`missing` は未供給集合と完全一致。`proposal.ruleId` はその aspect の未供給 ruleId に限る（初版は aspect : rule が 1:1 なので、新規 ID を許すと無関係な提案が素通りする）
6. `not-observable-static` は `staticObservability` が `partial` / `no` の aspect だけ
7. `evidence.line` が範囲内、`snippet` が当該行に空白正規化後で含まれ、かつ非空
8. ルール本文が供給されていない aspect は `missing-rule` 以外を全て invalid。`not-applicable` で回避できない

**担保しない**

- 意味的な判定精度。`fail` が本当に違反かは検証しない
- `pass` が見落としでないこと
- モデルが規律に従ったこと。CI の mock テストが確かめるのは配線と検証器の回帰だけ

---

## 限界（記事で過大主張しない）

**「一般 UX 知識で補完しない」は verdict 層でしか機械担保できない。**

検証器が塞げるのは「ルールが無いのに pass / fail を返す」「供給されていない ID を引用する」までである。ギャップの発見そのもの、つまり `proposal` に何を書くかは、モデルの一般知識を使う。ここは規律の外側にある。

したがって主張できるのは「該当ルールが無い観点について、判定を出さずに評価不可を返した」までである。「一般 UX 知識を一切使っていない」とは言えない。

mock provider の abstain は mock が自分でそう作っている tautology で、モデルの挙動の証拠ではない。証拠になるのは実 provider の実測（PR3）だけ。

---

## CLI

```
tsx design/judge/run.ts --file <html> --provider anthropic|mock \
  [--drop-rule <ID>]... [--targets <ID,...>] [--trials N] [--negative-control] [--model <id>]
```

| オプション | 意味 |
|---|---|
| `--file` | 審査対象 HTML。必須 |
| `--provider` | `anthropic` か `mock` のみ。必須。`openai` は placeholder なので受け付けない |
| `--drop-rule` | ルール本文を供給集合から抜く。複数回指定できる |
| `--targets` | **drop と集計の対象を選ぶだけ**。LLM への入力と検証器の「全 aspect ちょうど 1 回」は常に全件 |
| `--trials` | 条件ごとの試行数。既定 1 |
| `--negative-control` | 対象 aspect について「ルールあり」「ルールなし」の 2 条件を回す。`--expect` か `--expect-map` が必須 |
| `--expect` | with-rule 側の期待 verdict。全 target 共通。`fail` か `pass` |
| `--expect-map` | target ごとの期待 verdict。`{"<aspectId>":"fail"}` 形式で `--expect` を個別に上書きする |
| `--model` | 既定は `claude-opus-4-6` |

`--expect` / `--expect-map` は `--negative-control` と一緒にしか指定できない。`--targets` のいずれかに期待 verdict が無ければ起動前に落ちる。

`--targets` は空文字・空リスト・重複・未知の aspect ID をすべて usage error にする。重複を黙って除くと集計の母数と成果物のファイル名が暗黙に変わるので、除かずに拒否する。`--targets ""` も未指定扱いにせず拒否する。

`--targets` は母集団を絞らない。母集団を絞る口を置くと実装者ごとに陰性対照の母集団が変わるため、意図的に用意していない。

### `--model` の既定値

既定は **`claude-opus-4-6`**。`design/benchmarks/runner.ts` の `claude-sonnet-4-20250514` は古い ID なのでコピーしていない。

judge は `temperature: 0` を固定で渡し、`design/benchmarks/providers/anthropic.ts` はそれをそのまま API に転送する。したがって **`temperature` を受け付けるモデルしか選べない**。`claude-api` スキルの Sampling 列が `Allowed` なのは Opus 4.6 / Sonnet 4.6 / Haiku 4.5 で、その中で最も能力が高い `claude-opus-4-6` を既定にした。

`temperature` を受け付けないと分かっているモデル（`claude-opus-5` / `claude-opus-4-8` / `claude-opus-4-7` / `claude-sonnet-5` / Fable 5 系 / Mythos 5 系）は、API を叩く前に CLI が usage error で落とす。対応表は `design/judge/adapter.ts` の `TEMPERATURE_UNSUPPORTED_MODELS`。モデル世代が変わったらこの定数と既定値を更新する。

---

## 出力

| 出力先 | 中身 | git |
|---|---|---|
| `design/judge/results/<日時>/` | trial ごとの `*.input.json`（送信した system / prompt の原文）と `*.output.json`（raw 出力・検証結果）・`provenance.json`・`report.md` | **ignore**（`design/benchmarks/results/` と同じ扱い） |
| `design/judge/history.json` | run 単位 + trial 単位の provenance | **git 正本**。`--provider mock` では書かない |
| `.melta-loop/runs.jsonl` | 監査レコード 1 行 | ignore（playbook の Audit Log） |

`history.json` は第三者が検算できる粒度で残す。run 単位に commit / dirty / model / temperature / `toolsEnabled=false` / fixture digest / 宣言した期待 verdict / 対象外 aspect 一覧と理由 / `aspects.json` と `rules.json` の hash、trial 単位に target aspect / drop ID / 期待 verdict / verdict / reason / ruleId / raw 出力の sha256 / **system prompt と user prompt の sha256** / 供給ルール集合の hash / treatment の hash。

artifact は **trial ごとに即時書き出す**。まとめ書きにすると途中の API エラーで完了済み trial の raw も監査記録も消えるため。途中で落ちた run は provenance に `interrupted`（何ステップ目・どの target・エラー文）を持ち、監査ログに `status: "failed"` を残して非 0 で終了する。**中断した run は `history.json` に追記しない** — 部分計測が完了 run と混ざると記事の証拠として誤読されるため、証跡は `results/` の artifact と `.melta-loop/runs.jsonl` の failed 行に残す。

送信した system / prompt の**原文**は `results/<日時>/<target>-<条件>-t<n>.input.json` に残る。drop 後のルール本文・human-only の除外・指示文を第三者が読み直せる粒度で、`history.json` の sha256 と突き合わせて検算できる。

**raw 本体の保持**: `results/` に置く raw 入出力は記事公開までローカルに残す。引用する抜粋は `design/audits/<date>_shadow-judge-negative-control.md` に貼る。

---

## 実 provider で回す

`ANTHROPIC_API_KEY` が必要。CI には live API 呼び出しを入れない。

```bash
export ANTHROPIC_API_KEY=...   # このリポには置かない
npx tsx design/judge/run.ts \
  --file examples/nagomi-hr.html \
  --provider anthropic \
  --model claude-opus-4-6 \
  --negative-control \
  --targets TYPO_NO_XS_BODY,MODAL_OVERLAY_REQUIRED \
  --expect fail \
  --trials 3
```

`--file` は実在する HTML を指す。`examples/` の既存ページはどれも DS 準拠なので、`--expect fail` を宣言すると with-rule 側は不一致として数えられる。**遷移表の証拠を取るには対象 aspect の違反を含む fixture が要る**。PR3 でその fixture を用意し、ここに正式なコマンドを書く。それまでは `--expect pass` で「ルールがあれば pass、抜けば not-evaluable」の配線確認に使う。

API キーが無い環境では `--provider mock` だけが走る。mock の結果はレポートに `MOCK FIXTURE — NOT EVIDENCE` 表示が付き、`history.json` には書かれない。

---

## 評価不可の運用（2026-09-05 決定）

評価不可は割り込みではなくバックログとして扱う。PR ごとに人を呼ぶのは「ルール ID つきの fail」だけで、評価不可は溜めて定期的に仕分ける。HITL の回数を増やさず、今まで「なんとなく OK」に混ざっていた未確認の領域を表に出すのが目的。

評価不可 1 件の出口は 3 つ。

1. **ルールにする**。「見極める判断」に落ちるもの。観察できる条件に翻訳し、ID と強度を付けて rules.json へ（human gate）。次の run からその aspect は採点される
2. **人が見ると決める**。正解が一つに決まらない「決める判断」（ブランドの「らしさ」、プロダクト適合）。`human-only` として印を付け、以後は評価不可でなく「人間確認」として別に数える。決めていない判断はルールにできない
3. **別の検査器に回す**。静的 HTML から観測できないもの（Esc で閉じる、reduced-motion の尊重）。`staticObservability: no` にして実機テストへ

仕分けの順序と条件:

- 頻度 × 深刻度で上から。毎回出る評価不可を先に潰す
- 観察できる条件に翻訳できたものだけルールにする。翻訳できないうちは 2 に留める
- ルールを足したら違反 fixture と適合 fixture を 1 組付け、そのルールを 1 本抜くと評価不可に戻ることを確認する（陰性対照をルール単位で）
- まず静的検出（detector / composition / html-attr）を狙い、無理なものだけ LLM 審査に残す。LLM 審査は静的に書けないものの受け皿で、ルールを増やす先としては最後
- 曖昧なルールを量産しない。評価不可を減らしたい一心で書くと試験官がばらつき、検証器の invalid が増える。「書き込むほど賢くなるとは限らない」

一般知識による指摘は捨てず、契約審査（ルール ID つき、合否を信じてよい）とは別チャンネルの「参考意見」として出す設計を PR2 以降で検討する。混ぜないことが条件。

## 次の PR

| PR | 中身 |
|---|---|
| PR2 skill 移行 | `skills/design-review` が `rules.json` を読み、ID を引用し、「評価不可」節を出す。参照 ID の実在テストを足す |
| PR3 実測 | 実 provider で陽性・陰性対照を複数 aspect × 複数 trial。遷移表・対象外一覧・invalid 件数を残す。README の公開文言は human gate |

---

## human question

`docs/melta-loop-playbook.md` の Workflow Ledger に shadow judge の行（W6 相当）を足すかどうかは決めていない。playbook は `scripts/design/loops/drift-heal.ts` の `SSOT_PROTECTED_PATHS` に載る保護パスなので、この PR では編集していない。

足す場合の想定は次の通り。

- Classification: Level 3 observation cron（生成のみ。判定は人間が読む）
- Trigger: ルール追加・`aspects.json` 変更・記事の実測
- Stop: レポート産出。ルール追加も enforcement 昇格も自動ではしない
- Human Gate: `proposal` の採用、`rules.json` への反映、enforcement への昇格
- Memory: `design/judge/results/` と `docs/loop-learnings/` に隔離
