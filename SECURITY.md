# Security Policy / セキュリティポリシー

## 報告経路 / Reporting a vulnerability

**日本語** — 脆弱性を見つけた場合は、**public issue を立てずに** GitHub の private vulnerability
reporting を使ってください。このリポジトリの **Security タブ → "Report a vulnerability"** から
非公開で報告できます。melta は AI コーディングエージェントのローカルプロセスとして動く MCP サーバー
（`melta-ds-mcp`）とエディタ hook を配布しているため、**報告経路そのものの信頼性**を重視しています。
第三者の目に触れる経路（issue / PR / SNS）で詳細を先に出さないでください。

**English** — Please **do not open a public issue**. Report privately through GitHub private
vulnerability reporting: **Security tab → "Report a vulnerability"** on this repository. melta ships
an MCP server (`melta-ds-mcp`) and editor hooks that run as local processes inside AI coding agents,
so the trustworthiness of the reporting path itself matters. Do not disclose details on any public
channel (issues, PRs, social media) before a fix is available.

含めてほしい情報 / What to include:

- 影響するパッケージとバージョン / affected package and version
- 再現手順、可能なら最小再現 / reproduction steps, ideally a minimal repro
- 想定される影響 / expected impact

## 対応方針 / Response

個人メンテナンスの OSS（tsubotax）のため、以下は SLA ではなく **best effort の目安**です。
This is a personally maintained OSS project; the following are best-effort targets, not an SLA.

| | 目安 / Target |
|---|---|
| 初回応答 / First response | 7 日以内 / within 7 days |
| 影響評価の共有 / Triage result | 14 日以内 / within 14 days |
| 修正版のリリース / Patched release | 深刻度に応じて。重大なものは最優先 / severity-dependent; critical issues take priority |

## 開示ポリシー / Disclosure

協調的開示（coordinated disclosure）を取ります。修正版を npm に公開したあと、GitHub Security
Advisory として公開し、`CHANGELOG.md` にも記載します。報告者のクレジットは希望に応じて記載します。
修正が難しい場合でも、**報告から 90 日**を目安に状況を公開します。

We follow coordinated disclosure. After a patched version is published to npm, we publish a GitHub
Security Advisory and record it in `CHANGELOG.md`. Reporters are credited on request. Even when a fix
is hard, we aim to disclose the status **within 90 days** of the report.

## サポート対象バージョン / Supported versions

セキュリティ修正は **各パッケージの npm 最新 minor のみ**に提供します。過去の minor への
バックポートはありません。
Security fixes are provided for **the latest published minor of each package only**. There are no
backports to older minors.

| パッケージ / Package | サポート対象 / Supported |
|---|---|
| [`melta-ds-mcp`](https://www.npmjs.com/package/melta-ds-mcp) | 1.5.x |
| [`melta-contracts`](https://www.npmjs.com/package/melta-contracts) | 0.7.x |

React Native 実装 [`melta-app`](https://github.com/tsubotax/melta-app) は別リポジトリです。
そちらの脆弱性は [melta-app の SECURITY.md](https://github.com/tsubotax/melta-app/blob/main/SECURITY.md)
の経路で報告してください。
The React Native implementation lives in a separate repository — report issues there.

## 対象外 / Out of scope

- 生成された UI コードの品質・アクセシビリティ上の不備（バグとして issue へ / file a normal issue）
- 依存パッケージ自体の既知脆弱性で、melta 側に悪用経路がないもの（upstream へ / report upstream）
- ネットワーク境界に関する誤解に基づく報告 — MCP サーバーも lint エンジンもローカルプロセスで完結し、
  コード・プロンプト・検査結果を外部送信する経路はありません（[README](./README.md) の
  「セキュリティ・データ境界」参照）/ both the MCP server and the lint engine run entirely locally
