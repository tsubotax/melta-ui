## 概要

<!-- 何を、なぜ変えたか。関連 issue があれば "Closes #123" -->

## 変更の種類

- [ ] バグ修正
- [ ] 機能追加
- [ ] ドキュメント
- [ ] 契約（tokens / rules / component contracts）の変更 ← 変更理由を上に書いてください
- [ ] ハーネス（CI / lint / harness scripts）の変更

## 検証（ローカル CI ミラー）

<!-- CONTRIBUTING.md「ローカル CI ミラー」参照。通していないものはチェックを外したままで構いません -->

- [ ] `npm run design:check`
- [ ] `npm run design:drift`（README を触ったなら日英 parity もここで見ます）
- [ ] `npm run design:designmd-lint`
- [ ] `npm run validate` / `npm run build`
- [ ] `npm test`（Playwright + axe）
- [ ] `npm run design:compat -- --require-network`（契約を触った場合）
- [ ] `npm run check:pack -- --require-network`（配布物に影響する場合）

## 確認事項

- [ ] 生成物を手編集していない（生成コマンドを回した差分を含めた）
- [ ] `README.md` を触ったなら `README.en.md` も同じ構造で更新した
- [ ] 破壊的変更がある場合、`design:compat` の semver bump 要求に従った
- [ ] `CHANGELOG.md` を更新した（利用者に見える変更の場合）
