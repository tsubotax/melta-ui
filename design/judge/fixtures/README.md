# shadow judge の陰性対照 fixture

`--provider file` の実測（`docs/judge.md` の「API キー無しで回す」）で使う 1 組。代表 7 aspect（`aspects.json` の `representativeAspects`）すべてについて、違反版は違反し、適合版は適合する。

| ファイル | 中身 |
|---|---|
| `negative-control.violating.html.txt` | 代表 7 aspect すべてに違反する 1 枚 |
| `negative-control.conforming.html.txt` | 同じ画面で 7 aspect すべてに適合する 1 枚。`lintSource` / composition ともに error は 0 |

`lintSource` は class / html-attr までで composition 検査を含まない。composition 側に残っていた `BTN_MIN_TAP_TARGET` 1 件（送信ボタンのタップ領域）は 2026-09-07（#15）で解消し、`tests/judge.spec.ts` は composition の error が 0 件ちょうどであることを固定している（増えたら落ちる）。

記録済み run（`results/2026-09-05-codex5`）の `provenance.json` は変更前の適合 fixture の sha256 を持つ。これは**当時判定した内容の記録**なので据え置く（テストは temp dir の provenance しか照合しないため、fixture を変えても落ちない）。

**`<title>` を業務画面の文言にしてある理由**: 実行者が読むのは HTML の原文（行番号つき）なので、`title` に「違反版」「陰性対照」と書くと**期待する答えの方向を教えてから答えさせる**ことになる。2 枚の `<title>` は同一で、見分けが付くのは違反箇所だけ。fixture 本文に条件を示す語を入れないこと。

**拡張子が `.html` でない理由**: CI の Lint Generated UI が、変更された `.html` を external-ds samples 以外すべて lint する。違反 fixture を `.html` で置くとその job が落ちる。judge の `--file` はテキストなら拡張子を問わない。

---

## 違反箇所（違反版）

行番号と文字列は `tests/judge.spec.ts` のテスト 27 が実ファイルと突き合わせる。**この 2 列を書き換えると落ちる**（他の列は説明で、機械照合していない）。

保証範囲は「その行が実在し、その文字列を含む」まで。**空 snippet は行を特定しないので拒否する**。「その行が本当に違反である」ことは人が読んで判断する範囲で、この表も検証器も担保しない。

| aspectId | 行 | 文字列 | 何が違反か | 適合版での直し方 |
|---|---|---|---|---|
| `SPACE_NO_DARK_SIDEBAR_BG` | 9 | `bg-slate-900 text-white` | サイドバーが暗い背景で、メインとのコントラストが強すぎる | `bg-white border-r border-slate-200` |
| `TYPO_NO_XS_BODY` | 18 | `text-xs text-slate-600` | 本文テキストが `text-xs` で小さすぎる | `text-base` |
| `DIVIDER_NO_DIV_BORDER_B` | 19 | `<div class="my-6 border-b border-slate-200"></div>` | 区切り線を div の border で描いていて、支援技術が区切りを認識できない | `<hr class="my-6 border-slate-200" />` |
| `FORM_SELECT_APPEARANCE_NONE` | 23 | `<select id="status" class="h-10 px-3 rounded-lg border border-slate-200">` | select がネイティブ矢印のまま（`appearance-none` もカスタムシェブロンも無い） | `appearance-none pr-10` + SVG シェブロン |
| `A11Y_NO_OUTLINE_NONE_WITHOUT_RING` | 28 | `rounded-lg outline-none bg-primary-500` | `outline-none` を付けたままフォーカスリングの代替が無い | `focus:ring-2 focus:ring-primary-500/50` を併記 |
| `TABLE_NO_LAYOUT_TABLE` | 30 | `<table class="mt-6 w-full">` | 2 カラムのレイアウト目的で table を使っている（`th` も見出しも無い） | `grid grid-cols-2` の div |
| `MODAL_OVERLAY_REQUIRED` | 38 | `<div role="dialog" aria-modal="true" class="fixed inset-0 flex items-center justify-center">` | dialog の手前に背景を覆うオーバーレイが無い（**不在の違反**なので、行はダイアログ本体を指す） | 直前に `<div class="fixed inset-0 bg-black/50"></div>` |

`MODAL_OVERLAY_REQUIRED` だけは「無いこと」が違反なので、evidence の行は違反物そのものではなくダイアログ本体になる。judge の出力を人が読むときは、この 1 件だけ照合の意味が違う。

---

## 使い方

```bash
npx tsx design/judge/run.ts --provider file --phase prepare \
  --run-dir design/judge/results/$(date +%Y-%m-%d)-file \
  --file design/judge/fixtures/negative-control.violating.html.txt \
  --negative-control --expect fail --trials 3
```

`--expect fail` は違反版に対する宣言。適合版を審査するときは `--expect pass` にする。

判定の意味的な正しさ（fail が本当に違反か）は検証器の担保範囲外。この表は**人が evidence を照合するため**の対応表であって、judge の採点には使われない。
