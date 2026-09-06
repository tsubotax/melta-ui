# melta UI - Claude Code 作業指示

> 作業ルール・アーキテクチャ・読み込みモード・タスク別ガイドは @AGENTS.md（全エージェント共通の SSOT）。
> デザイン仕様は `DESIGN.md`。本ファイルは Claude Code 固有の挙動のみを記述する。

## Claude Code 固有

- **MCP サーバー**: `.mcp.json` で melta-ui サーバーが自動接続される（`npm install` 後）。ツール: `get_token` / `get_component` / `check_rule` / `check_html` / `get_rules` / `search`。UI 生成後は `check_html` で自己検証する
- **PostToolUse hook**: `.claude/settings.json` に同梱。`.html/.tsx/.jsx/.vue` の Write/Edit 直後に禁止パターン lint が走る。error は block フィードバック（修正して再 Write する）、warn は additionalContext で通知される
- **Skills**: `skills/design-review`（HTML の DS 準拠レビュー）、`skills/ban-pattern`（AIっぽいパターンを禁止ルールとして登録）、`skills/build-screen`（契約から画面 1 枚を生成し check_html で自己検証）
