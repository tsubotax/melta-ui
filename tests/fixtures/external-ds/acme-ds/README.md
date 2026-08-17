# acme-ds — 外部 DS fixture（melta と無関係な架空デザインシステム）

Phase 2 / S2 W8 の回帰対象。**melta のデータを 1 つも含まない** data-only bundle で、
engine（MCP / lint）が第三者 DS を素通しで扱えることを `tests/external-ds.spec.ts` が端到端で測る。

**BYO-DS の参照実装としても読める**（`docs/distribution.md` の「自分のデザインシステムを持ち込む」節から参照）。
ただし役割は「CI で継続検証される完全例」で、コピー用の最小例は distribution.md 側の 4 ファイル構成。
このディレクトリは **npm tarball には同梱されない**（このリポジトリを clone したときだけ手に入る）。
detector 6 種のうち `tailwind-class-segment` 以外の 5 種を踏む。`DESIGN.md` は意図的に置いていない
（doc capability off の側を測るため。自分の bundle では置くことを推奨）。

melta との差分を意図的に付けてある（「melta のデータに fallback したら落ちる」を成立させるため）:

| 軸 | melta | acme-ds |
|---|---|---|
| category 語彙 | color / spacing / accessibility … | brand-color / surface / data-table / content |
| token 名前空間 | color / spacing / radius … | brand / rhythm |
| クラス命名 | melta の Tailwind 設定 | `text-ink` / `bg-sand` / `gap-tight` |
| ルール ID 接頭辞 | `NO_` / `MODAL_` … | `ACME_` |
| クラス文字列のキー | 40 契約すべて `tailwind`（legacy） | panel=`class`（正）/ data-grid=`tailwind`（alias） |
| doc（DESIGN.md） | あり | **無し**（doc capability off の側を測る） |

## 中身

- `design/contracts/rules.json` — 5 ルール。detector は tailwind-class / tailwind-class-prefix /
  html-attr / composition / manual を 1 つずつ（engine の capability 表 6 種のうち
  `tailwind-class-segment` 以外）
- `design/contracts/tokens.json` — melta に存在しない名前空間のトークン
- `design/contracts/components/*.contract.json` — `class` 正と `tailwind` alias の両方（W3）
- `metadata/components.json` / `design/contracts/recipes/web/*.json` — **contract からの導出物**。
  MCP の component 系 3 経路は metadata を読む（contract は読まない）。手書きしないこと
- `samples/violations.html` — 既知違反を仕込んだ検体（error 3 / warn 1）
- `samples/clean.html` — 違反ゼロの検体

## 更新のしかた

contract を変えたら導出物を再生成する:

```
MELTA_ROOT=tests/fixtures/external-ds/acme-ds npx tsx scripts/design/build-legacy.ts
MELTA_ROOT=tests/fixtures/external-ds/acme-ds npx tsx scripts/design/export-recipes.ts
```

`npm run design:build` は使わない。後続の `export-designmd` / `export-dtcg` / `build-llms-txt` が
engine root 固定・melta のトークン構造前提で、第三者 bundle では偽合格かクラッシュになる
（Phase 2 W9 の実測表を参照）。

検査は bundle 自身のルールで回す（melta のルールで検査すると仕込んだ違反が melta の違反として出る）:

```
MELTA_ROOT=tests/fixtures/external-ds/acme-ds MELTA_VALIDATE_SKIP=dtcg npm run design:check
```

`tests/external-ds.spec.ts` の「同梱の metadata / web recipes は契約からの再生成と一致する」が
生成漏れを落とすので、忘れても CI が気づく。
