<!-- sec: hero -->
# melta UI

[![Design System Check](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml/badge.svg?branch=main)](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml)

**Turn AI design guidelines into executable contracts that catch violations.**

> 🇯🇵 日本語版（正本）: [README.md](./README.md) · Site: https://melta.tsubotax.com

<!-- sec: lead -->
You can make an AI read your guidelines. Whether it *follows* them is up to the AI. melta UI replaces that "up to the AI" with machinery. A machine is in the loop at four points: **before** generation (the MCP server hands the agent the contract), **immediately after** (lint and the editor hook push violations back), **before merge** (CI blocks), and **afterwards** (drift checks keep catching docs and implementation rotting apart). Not just readable — enforced.

**Scope boundary**: melta UI is *not* a ready-made CSS component library. What ships is values (tokens), rules, specs (contracts) and verifiers (lint / MCP) — not a package you `import` and drop in. The web implementation is included as a reference implementation in HTML + Tailwind classes.

<!-- sec: who -->
## Who it's for

**A good fit**

- Teams generating and maintaining UI with AI coding agents (Claude Code / Cursor / Codex …)
- Individuals or small teams who want "we wrote the guideline but nobody follows it" solved structurally
- Products that want one design contract shared between web and React Native

**Not a fit**

- You want a finished web component library to install and use immediately
- Your styling is not class-based (e.g. CSS-in-JS through props) so style never appears in the markup — static lint has nothing to read

<!-- sec: proof -->
## Proof — every claim has a verification path

- **48 of the 105 prohibition rules are statically auto-detected.** The rest are classified and surfaced by `automationStatus` instead of being silently unenforced ([rules.json](./design/contracts/rules.json) / breakdown under [Limits](#limits-and-the-honest-scope))
- **Playwright + axe-core, 248 tests**, as a required CI gate ([.github/workflows/design-check.yml](./.github/workflows/design-check.yml) / [run history](https://github.com/tsubotax/melta-ui/actions/workflows/design-check.yml))
- **0 diff pixels across five representative reset-CSS environments**, machine-verified with literal pixelmatch comparison ([tests/reset-vrt.spec.ts](./tests/reset-vrt.spec.ts), `npm run test:reset-vrt`)
- **Distributed as three npm packages plus the MCP Registry** ([melta-contracts](https://www.npmjs.com/package/melta-contracts) / [melta-ds-mcp](https://www.npmjs.com/package/melta-ds-mcp) / [melta-app](https://www.npmjs.com/package/melta-app), Registry ID `io.github.tsubotax/melta-ui`)
- **A React Native implementation in a separate repository subscribes to the same contract**; breaking contract changes are caught by its consumer tests when the APP side picks up the new contract version ([melta-app](https://github.com/tsubotax/melta-app) / `npm run design:compat` checks compatibility against the published npm version before publishing)
- **The "AI writes a violation → instant detection → self-repair" loop was measured on an outside project** (2026-08, installed via npm into a private RN app — see [the status section of the melta-app README](https://github.com/tsubotax/melta-app/blob/main/README.md#ステータス))
- **The drift checks have negative tests of their own** — deliberately breaking things is pinned as a firing condition ([tests/drift-heal.spec.ts](./tests/drift-heal.spec.ts))

<!-- sec: ships -->
## What ships — installable today

| Package | Role | Usage |
|---|---|---|
| [`melta-contracts`](https://www.npmjs.com/package/melta-contracts) | **Contract data** (tokens / rules / component contracts / recipes, JSON only). No build step, framework-agnostic | `npm install melta-contracts` |
| [`melta-ds-mcp`](https://www.npmjs.com/package/melta-ds-mcp) | **MCP server + lint engine** (this repository). `check_html` runs the same logic as CI and the hook | `npx -y melta-ds-mcp` / `melta-ds-mcp/lint-core` |
| [`melta-app`](https://www.npmjs.com/package/melta-app) | **React Native implementation**, shipping an eslint plugin for consumer projects | `npm install melta-app` |

> A bare import of `melta-ds-mcp` (`import "melta-ds-mcp"`) is unsupported: the entry is a CLI that boots a stdio server on import. Use `npx melta-ds-mcp` or the subpaths. Entry contract, deep-import compatibility and the package-split plan live in [docs/distribution.md](./docs/distribution.md).

<!-- sec: requirements -->
## Requirements and compatibility

| Item | Value |
|---|---|
| Node | 22 or later (CI verifies on 22) |
| MCP client | Anything speaking stdio MCP (verified with Claude Code; Cursor / Codex register the same stdio command) |
| Styling | **Tailwind, class-based.** Static lint reads class attributes, HTML attributes and DOM structure |
| Rendering the output | Prototype: Tailwind CDN + the `tailwind.config` in `DESIGN.md`. Production: the v4 `@theme` block in `foundations/theme.md` |
| JSX / Vue | Class and HTML-attribute lint applies. **Composition lint (nesting, a11y DOM) is HTML-only.** Classes reaching JSX through a variable or spread are not statically traceable |
| License | MIT |

<!-- sec: quickstart -->
## Five-minute quick start

### Path A — npm (MCP server, recommended)

Add contract lookup and self-verification to an existing project without cloning anything.

```bash
claude mcp add melta-ui -- npx -y melta-ds-mcp
claude mcp list
```

**Success check** — `claude mcp list` prints this line:

```text
melta-ui: npx -y melta-ds-mcp - ✔ Connected
```

On connect the server hands over MCP `instructions`, so you don't have to repeat "melta is not a ready-made CSS library", "read `melta://design-constitution` first" and "run `check_html` before presenting" in every prompt. Then just ask for UI:

> Build me a user list table

**Success check** — the agent runs its generated HTML through `check_html` and gets a response shaped like this (then fixes and re-checks):

```jsonc
{
  "passed": false,
  "errorCount": 2,
  "warnCount": 0,
  "violations": [
    { "ruleId": "AI_NO_CARD_COLOR_BAR_TOP", "severity": "error", "token": "border-t-4",
      "reason": "AI生成UIの典型パターン。装飾過剰で汎用性が低い",
      "alternative": "border border-slate-200 のみでカードを構成" },
    { "ruleId": "COLOR_NO_BLUE_BG", "severity": "error", "token": "bg-blue-500",
      "reason": "primaryで統一する", "alternative": "bg-primary-*" }
  ],
  "coverage": { "automated": "...", "notAutomated": "..." }
}
```

To actually **render** the generated HTML you need Tailwind plus melta's token config. For a prototype the CDN is enough:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  // Paste the tailwind.config from DESIGN.md ("Quick Reference → HTML template") verbatim.
  // All eight fontSize steps differ from the Tailwind defaults (18px body / 2.0 line-height is core to melta).
</script>
```

### Path B — clone (full harness)

Use this when you want the enforcing layers — hook, CI and the lint CLI. Those three do *not* reach a project that merely ran `npm install` (see [Limits](#limits-and-the-honest-scope)).

```bash
git clone https://github.com/tsubotax/melta-ui.git
cd melta-ui && npm install
printf '<div class="text-black shadow-2xl">x</div>' > /tmp/melta-bad.html
npm run design:lint-generated -- /tmp/melta-bad.html
```

`npm install` activates: `.mcp.json` (auto-connects the MCP server in Claude Code), the PostToolUse hook in `.claude/settings.json`, and the lint CLI.

**Success check 1** — running the lint CLI on a violating file exits 1:

```text
  ✗ [error] COLOR_NO_TEXT_BLACK: "text-black" → text-slate-900（純黒はコントラストが強すぎて長時間の利用で目が疲れる）
  ✗ [error] SPACE_NO_SHADOW_2XL: "shadow-2xl" → shadow-sm 〜 shadow-md（オーバーレイ: shadow-xl）（影が強すぎてノイズになる）

1 ファイル走査 / error 2 / warn 0
❌ FAILED
```

**Success check 2** — right after Claude Code writes or edits a `.html` / `.tsx` / `.jsx` / `.vue` file, the hook returns this JSON and drives the fix loop (warn-only findings are injected as `additionalContext` instead):

```json
{"decision":"block","reason":"melta UI 禁止パターン検出（error 2 / warn 0）。書き込まれたファイルを修正してください: ..."}
```

> Note: tool output (lint messages, hook feedback) is currently Japanese-only.

<!-- sec: how -->
## How it works — contract, lookup, verification, monitoring

```
① Contract (SSOT)     design/contracts/
                        tokens.json      101 design tokens
                        rules.json       105 prohibition rules (id + severity + detector + alternative)
                        components/      40 contracts (28 web / 12 app-first)
                        recipes/         platform concretions (web: generated mirror / app: RN styleRefs)
                      DESIGN.md / AGENTS.md   the constitution and working guide an agent reads first

② Lookup (before generation)
                      MCP server (melta-ds-mcp)
                        hands over only the spec, value or rule that is needed, on demand

③ Verification (right after generation → before merge)
                      PostToolUse hook   lint on Write/Edit; errors block and drive an auto-fix
                      lint CLI / CI      .github/workflows/design-check.yml
                      MCP check_html     self-verification with the same logic as CI

④ Monitoring (afterwards)
                      design:drift       catches docs drifting away from contracts
                      design:compat      breaking-change × semver gate against the published npm version
                      design:drift-heal  detects drift and regenerates derived files only (SSOT stays human-gated)
```

The MCP server exposes 6 tools:

| Tool | What it does | Example input |
|------|--------------|---------------|
| `get_token` | Token lookup | `{ "path": "color.primary.600" }` |
| `get_component` | Component spec (variants / sizes / stateSpecs / anatomy / a11y) | `{ "id": "button" }` |
| `check_rule` | Prohibition check on a class string (34 patterns auto-detected; context-dependent ones come back flagged `conditional`) | `{ "classes": "text-black shadow-2xl" }` |
| `check_html` | Lint a whole HTML / JSX source with the same logic as CI and the hook | `{ "source": "<div class=...>" }` |
| `get_rules` | Read the rule registry (all entries including manual ones, filterable) | `{ "category": "accessibility" }` |
| `search` | Full-text search (up to 20 results + a truncated flag) | `{ "query": "card" }` |

Resources: `melta://design-constitution` (the full `DESIGN.md`) / `melta://tokens` / `melta://components` / `melta://components/{id}` / `melta://rules` / `melta://rules/auto-detectable`.

The web surface covers 28 components, 13 foundations and 5 patterns. The design principles are Content First / WCAG 2.1 AA / Semantic Color / 3-Color Rule / 4px Grid / Minimal Elevation / No AI-ish Decoration ([DESIGN.md](./DESIGN.md)).

<!-- sec: platforms -->
## Web and APP — one contract feeds both

The same contract package ([`melta-contracts`](https://www.npmjs.com/package/melta-contracts)) is consumed by the web implementation (this repository, HTML + Tailwind) and by the APP implementation ([melta-app](https://github.com/tsubotax/melta-app), React Native). There is no path where a token is copied into an implementation — duplication is physically prevented.

Contracts have **two layers: normative and concrete**. The normative core (`components/*.contract.json`) holds variant vocabulary, states, tokenRefs and a11y, shared across platforms; where divergence is legitimate (hover→pressed, elevation decomposition, 44pt touch targets) `platformSemantics` declares only the semantics. The concrete layer (`recipes/`) is a generated mirror of the contract's Tailwind on web (freshness enforced in CI) and hand-authored RN styleRefs on app (colors are 100% token references).

Enforcement runs both ways:

- **Web side → compat gate** (`npm run design:compat`): a golden diff between the published npm version and HEAD. Token removals, variant removals and rule semantics changes are classified as breaking, and a semver bump is machine-enforced
- **APP side → consumer tests**: melta-app's CI checks contract subset, token existence and contractVersion sync. Contract breakage on the web side is caught when the APP updates its contract dependency

melta-app also ships an eslint plugin on npm for consumer projects, so raw literal values are blocked in **the code that uses the library**. The live RN catalog showcase is at https://app.melta.tsubotax.com.

<!-- sec: limits -->
## Limits and the honest scope

**What 48 / 105 means.** We do not claim to "enforce 105 prohibition rules". 48 are statically auto-detectable; for the rest, the verification path is classified and made visible via `automationStatus` — the point of the inventory is to leave zero rules that are declared but never checked.

<!-- BEGIN:coverage-en (npm run design:coverage で再生成) -->
| Route | Count | What |
|-------|-------|------|
| Static auto-detection | **48 / 105** | class-match 34 (same path as MCP `check_rule`) + html-attr 7 + composition 7 (nesting + a11y DOM) |
| Interaction test | 3 | `tests/modal.spec.ts` verifies focus trap / Escape / focus return in a real browser |
| Statically undetectable | 3 (3 error) | `impossible-static` (active/selected/current are semantically dependent) |
| LLM-judge candidate | 42 (30 error) | `llm-judge-candidate` (no automated verification until the shadow judge ships) |
| Human-only | 9 (9 error) | Guarded by human review only; surfaced to the AI via `get_rules` |
| Unclassified | 0 (0 error) | Inventory pending (no automationStatus declared) |
<!-- END:coverage-en -->

`npm run design:coverage` generates this table from the contracts and `npm run design:drift` guards its freshness, so the numbers move whenever the harness improves. The SSOT for each rule's state is the `automationStatus` field in `rules.json`.

**Other limits**:

- **The clone path and the npm path ship different layers.** The PostToolUse hook, CI and the lint CLI assume you cloned this repository; they do not reach a project that merely ran `npm install`. What the npm path gives you is `melta-ds-mcp/lint-core` and the MCP `check_html` tool — wire either into your own hook or CI
- **Styling that isn't class-based cannot be inspected.** If style never lands in the markup (class / attributes), static lint fires on nothing
- **Composition lint does not cover JSX.** Nesting and a11y-DOM checks are HTML-only; JSX gets class and attribute lint
- **`check_html.passed` is not sign-off.** It means lint-clean draft, not brand-approved. The final call stays with a human

<!-- sec: security -->
## Security and data boundary

Both the MCP server and the lint engine run entirely as local processes. There is no path that sends generated code, prompts or check results anywhere, and there is no telemetry. The only network traffic is `npx` fetching the package, plus `npm run design:compat` / `npm run check:pack` querying published versions on the npm registry.

<!-- sec: maturity -->
## Maturity and maintenance

- **A personally maintained OSS project** (tsubotax). No SLA, no dedicated team. It is kept honest by dogfooding in production (the web showcase and an RN app)
- **0.x / 1.x policy**: the contract package `melta-contracts` is still 0.x, so breaking changes can arrive in a minor bump. What is *not* left to judgement is the classification — `npm run design:compat` decides mechanically and forces the semver bump
- **Changes are announced through [CHANGELOG.md](./CHANGELOG.md)**, with Added / Changed / Removed per release
- **Bugs and requests go to [GitHub Issues](https://github.com/tsubotax/melta-ui/issues)**

<!-- sec: learn-more -->
## Learn more

| Document | What's in it |
|---|---|
| [DESIGN.md](./DESIGN.md) | The design constitution + Quick Reference. Enough on its own to generate basic UI |
| [AGENTS.md](./AGENTS.md) | Agent-neutral working guide (reading modes, task-based guide, npm scripts) |
| [design/authority.md](./design/authority.md) | SSOT declaration and precedence when values conflict |
| [docs/melta-loop-playbook.md](./docs/melta-loop-playbook.md) | Governance for loop / pipeline automation (three automation levels, SSOT write-protect, hard/soft human gates, audit log). W2 drift repair is live today |
| [docs/benchmarks.md](./docs/benchmarks.md) | The benchmark protocol (five conditions × N trials measuring the lift in DS-compliance score) and its known limits |
| [docs/distribution.md](./docs/distribution.md) | npm entry contract, deep-import compatibility, vendor path, package-split plan |
| [docs/ai-ready-ds-maturity-model.md](./docs/ai-ready-ds-maturity-model.md) | An AI-Ready maturity model (Lv0 None → Lv4 Verified) you can run against any project |
| [design/compat/google-designmd.md](./design/compat/google-designmd.md) | Mapping against the Google Labs [design.md spec](https://github.com/google-labs-code/design.md). melta's `DESIGN.md` carries spec-compatible front matter and passes `npx @google/design.md lint` with errors: 0. The difference in reach: the spec validates the DESIGN.md file itself, melta validates the generated code through CI and hooks |

<!-- sec: license -->
## License

MIT License — [LICENSE](./LICENSE). Icon licenses are listed in [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

Acknowledgments: [Charcoal Icons](https://github.com/pixiv/charcoal) (pixiv Inc., Apache License 2.0) / [Lucide Icons](https://github.com/lucide-icons/lucide) (ISC License) / [Tailwind CSS](https://tailwindcss.com/)
