# Authority Table — Source of Truth 宣言

> melta UI のすべての情報について、**唯一の真実の所在（SSOT）**を定義する。
> 二重管理を防ぐため、各領域の authoring source と generated view を明確に分離する。

---

## Authoring Source（人が編集する）

| 領域 | SSOT | 形式 | 説明 |
|------|------|------|------|
| AI 向け入口・デザイン憲法 | `DESIGN.md` | Markdown | 思想・原則・quick ref・読み順 |
| Claude Code 作業手順 | `CLAUDE.md` | Markdown | この repo での作業ルール |
| デザイントークン | `design/contracts/tokens.json` | JSON | 色・spacing・typography 等の exact value |
| コンポーネント仕様 | `design/contracts/components/*.contract.json` | JSON | variant・size・a11y・rules 等の厳密仕様 |
| 禁止ルール | `design/contracts/rules.json` | JSON | ルール ID + severity + detector |
| デザイン哲学 | `foundations/design_philosophy.md` | Markdown | ブランド思想の詳細 |
| テーマ設定 | `foundations/theme.md` | Markdown | プライマリカラー・フォント・アイコン等 |

## Generated View（ビルドで生成する / 直接編集しない）

| 成果物 | 生成元 | 用途 |
|--------|--------|------|
| `metadata/components.json` | `design/contracts/components/*.contract.json` | MCP サーバー・AI ツール用の集約データ |
| MCP `melta://design-constitution` レスポンス | `DESIGN.md` | MCP だけで接続する AI の最初の入口（runtime 直読、内容の複製なし） |
| MCP `melta://rules` レスポンス | `design/contracts/rules.json` | AI エージェントからのルール参照 |
| `docs/` の component count・nav | contracts + tokens | 公開サイト表示 |
| `llms.txt` / `llms-full.txt` | contracts + DESIGN.md ほか（`build-llms-txt.ts`） | AI エージェント入口（llmstxt.org 形式）。リンク先は GitHub raw。melta.tsubotax.com は showcase 専用で配信しない |

## Human-Readable Docs（参照用。値の SSOT ではない）

| ファイル群 | 役割 | SSOT との関係 |
|-----------|------|---------------|
| `foundations/*.md`（theme.md, design_philosophy.md 除く） | 人間向けの設計ガイド | contracts/tokens の値を prose で解説 |
| `components/*.md` | 人間向けのコンポーネントガイド | contracts の仕様を prose で解説 |
| `patterns/*.md` | 組み合わせパターン | 複数 contracts を横断する指針 |
| `foundations/prohibited.md` | 禁止パターン一覧（人間向け） | `rules.json` の prose 版 |

---

## 移行ルール

1. **値を変更するときは authoring source を編集する**。generated view は `build-legacy.ts` で再生成する
2. **contracts に移行済みのコンポーネント**は `*.contract.json` が SSOT。`components/*.md` と `metadata/components.json` は参照用
3. **contracts 未移行のコンポーネント**は当面 `metadata/components.json` の既存データが SSOT
4. **禁止ルール**の SSOT は `design/contracts/rules.json`。`foundations/prohibited.md` は人間向けの説明文書
5. **drift が発生したら**、authoring source を正として generated view を再生成する
6. **deprecated compatibility path `tokens/tokens.json` は存在してはならない**。tokens の SSOT は `design/contracts/tokens.json` のみで、旧パスの復活はファイル・symlink を問わず `npm run design:check` が検出する
6. **ドキュメント間で値が競合したら**、`design/contracts/` > `DESIGN.md` Quick Reference > `patterns/` / `components/` md の順で優先する
