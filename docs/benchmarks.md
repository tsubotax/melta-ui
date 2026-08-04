# Benchmark protocol — DS を読ませると DS 準拠スコアが何点上がるか

> README から分離した詳細（2026-08-04）。実装は `design/benchmarks/` と `tools/`。

`design/benchmarks/` は **5 条件で同一 prompt から UI を生成し、共通 lint core（MCP `check_html` と同じ採点）で DS 準拠スコアを測る**ハーネス。「context engine を足すと精度が上がる」式の限界寄与（lift）を自前の一次データとして出す。

## 条件

| 条件 | 与えるもの | tools |
|------|-----------|-------|
| `cold` | DS コンテキスト無し（素の LLM のベースライン） | なし |
| `designmd` | `DESIGN.md` のみ（静的コンテキスト） | なし |
| `contracts` | `DESIGN.md` + contracts 要約 | なし |
| `mcp-raw` | 上記 + MCP tools、接続時 instructions 無し | あり |
| `full` | 上記 + 接続時 instructions（実際の Melta MCP workflow） | あり |

各セル（prompt × 条件）を N トライアル実行し、mean±range と条件間 lift を `report.md` に出力する。実際の system prompt + tools 有無を条件別に hash し、実験定義の世代 `benchmarkProtocolVersion` とともに `design/benchmarks/history.json` へ追記する。時系列比較は同じ protocol version の run 同士に限定する。

## 実行

```bash
# 全 prompt × 5 条件 × 3 trials（ANTHROPIC_API_KEY が必要）
npm run benchmark

# トライアル数・prompt・条件を絞る
npm run benchmark -- --trials 5
npm run benchmark -- --prompt 1 --conditions cold,full

# メーター API を使わない採点経路: 生成済み HTML を採点（サブエージェント等で先に
# <dir>/<promptId>-<conditionId>-t<k>.html を用意 → 共通 lint core で採点 + history 追記）
npm run benchmark -- --score-dir design/benchmarks/results/<dir> --trials 3

# API 不要のパイプライン検証（mock provider。history には追記しない）
npm run benchmark -- --provider mock
```

## provider

`ModelProvider` インターフェースで anthropic（実装済み・MCP の 6 tool を Claude API の tool use として渡す）/ mock（オフライン検証）/ openai（placeholder、未実装）を切り替える。tools 条件では AI が何回どの tool を呼び、どの resource を参照したかに加え、`check_html` 到達率を記録する。`mcp-raw→full` の差が initialize instructions の寄与になる。

red-team prompt は 5 本（neon / heavy shadow / color bar / placeholder-only form / icon-only buttons）。standard と red-team はスコアの意味が違う（前者 = 準拠生成、後者 = 悪い指示への抵抗）ため report で分離集計する。CI は live API を叩かず、`tests/benchmark-pipeline.spec.ts` が stats・採点の gaming 耐性・集約ロジックの回帰を守る。

## 測定しているもの / 限界（発信時の前提）

- スコアは **DS 準拠の proxy**（lint core 違反 + class / 属性ベースの準拠シグナル）であって、見た目の美しさそのものではない。準拠シグナルはコメント等への文字列埋め込みでは稼げない（実 class 属性のみ集計）
- tools 条件は多ターンの tool use を含み得る。`contracts→mcp-raw` は MCP tools 自体、`mcp-raw→full` は initialize instructions の寄与として分離する。スコア差と `check_html` 到達率を併読する
- `mcp-raw` / `full` はどちらも `DESIGN.md` と contracts を静的 context に持つ。この比較は `melta://design-constitution` resource が、Melta 知識を MCP からしか得ない利用者へ情報を届ける効果を測らない
- n は trial 数。headline には mean ± 95%CI を併記し、small-n の不確実性を隠さない。人手評価との相関検証は未実施（既知の限界）
