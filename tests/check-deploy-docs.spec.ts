/**
 * check-deploy-docs（AGENTS.md デプロイ節 ↔ netlify.toml の構造的 parity）の単体テスト。
 *
 * 2026-08-17 に実際に踏んだ「AGENTS.md が publish = "." のまま 42 日間残っていた」状態を
 * fixture として固定し、検査がそれを赤にすることを保証する（故障系陽性）。
 * 一度だけ red→green を見るのではなく、誤った deploy 節を恒久 fixture にする（Codex レビュー反映）。
 *
 * さらに Codex 事後レビューで再現された 2 つの fail-open も fixture 化する:
 *   - 表は間違っているが参考文に正しい値が出ている（節内 substring 検査だと合格した）
 *   - 複数行コマンドの --dir=（行単位の正規表現だと素通りした）
 */

import { test, expect } from "@playwright/test";
import {
  checkDeployDocs,
  compareDeployDocs,
  extractDeploySection,
  extractFencedCommands,
  extractTableCell,
  parseNetlifyBuild,
} from "../scripts/design/check-deploy-docs.js";

const TOML = `
[build]
  publish = "site-public"
  command = "npm run site:build"

[[redirects]]
  from = "/"
  to = "/docs/index.html"
`;

// 2026-08-17 修正前の AGENTS.md デプロイ節（実物）
const STALE_SECTION = `
| 項目 | 値 |
|------|-----|
| ホスティング | Netlify（手動デプロイ） |
| publish ディレクトリ | \`.\`（リポジトリルート）— \`netlify.toml\` で設定済み |

\`\`\`bash
# 本番デプロイ（--dir 指定不要。netlify.toml の publish = "." が使われる）
netlify deploy --prod
\`\`\`

> **注意**: \`netlify deploy --prod --dir=docs\` は NG。\`publish = "."\` なのでルートからデプロイしないとリダイレクトが 404 になる。
`;

const GOOD_SECTION = `
| 項目 | 値 |
|------|-----|
| publish ディレクトリ | \`site-public\`（\`npm run site:build\` の生成物）— \`netlify.toml\` で設定済み |
| build コマンド | \`npm run site:build\` — \`netlify.toml\` の \`command\` |

\`\`\`bash
# 本番デプロイ
netlify deploy --prod
\`\`\`

> **注意**: \`--dir=docs\` や \`--dir=.\` を手で指定しない。
`;

test.describe("parseNetlifyBuild", () => {
  test("[build] の publish / command を取り出す", () => {
    expect(parseNetlifyBuild(TOML)).toEqual({ publish: "site-public", command: "npm run site:build" });
  });

  test("publish が無ければ throw（fail-fast）", () => {
    expect(() => parseNetlifyBuild('[build]\n  command = "x"')).toThrow(/publish/);
  });

  test("[build] / [context.production] 以外の同名キーは読まない", () => {
    const toml = '[context.deploy-preview]\n  publish = "other"\n[build]\n  publish = "a"\n  command = "b"';
    expect(parseNetlifyBuild(toml).publish).toBe("a");
  });

  test("[context.production] の override が実効値として勝つ", () => {
    const toml = '[build]\n  publish = "a"\n  command = "b"\n[context.production]\n  publish = "prod-dir"';
    expect(parseNetlifyBuild(toml)).toEqual({ publish: "prod-dir", command: "b" });
  });

  test("同一セクション内の複数検出は throw", () => {
    expect(() => parseNetlifyBuild('[build]\n  publish = "a"\n  publish = "b"\n  command = "c"')).toThrow(
      /複数/
    );
  });
});

test.describe("extractDeploySection", () => {
  test("## デプロイ から次の ## までを切り出す", () => {
    const md = "## 前\nx\n## デプロイ\nA\nB\n## 後\ny";
    expect(extractDeploySection(md)).toBe("A\nB");
  });

  test("節が無ければ null", () => {
    expect(extractDeploySection("## 前\nx")).toBeNull();
  });

  test("### の小見出しは節の途中として含める", () => {
    const md = "## デプロイ\nA\n### 詳細\nB\n## 後";
    expect(extractDeploySection(md)).toBe("A\n### 詳細\nB");
  });
});

test.describe("extractTableCell / extractFencedCommands", () => {
  test("表の値セルの最初のバッククォートを返す", () => {
    expect(extractTableCell(GOOD_SECTION, /publish/i)).toBe("site-public");
    expect(extractTableCell(GOOD_SECTION, /build\s*コマンド/i)).toBe("npm run site:build");
  });

  test("行が無ければ null、値セルにバッククォートが無ければ空文字", () => {
    expect(extractTableCell("| x | y |", /publish/i)).toBeNull();
    expect(extractTableCell("| publish | plain |", /publish/i)).toBe("");
  });

  test("行継続（末尾 \\）を 1 論理行に結合し、コメント行は除く", () => {
    const s = "```bash\n# comment\nnetlify deploy \\\n  --prod --dir=docs\n```";
    expect(extractFencedCommands(s)).toEqual(["netlify deploy --prod --dir=docs"]);
  });

  test("~~~ フェンスと複数フェンスに対応", () => {
    const s = "~~~sh\na\n~~~\n\n```\nb\n```";
    expect(extractFencedCommands(s)).toEqual(["a", "b"]);
  });
});

test.describe("compareDeployDocs（故障系陽性）", () => {
  const build = parseNetlifyBuild(TOML);

  test("2026-08-17 修正前の実物（publish = \".\"）は drift になる", () => {
    const r = compareDeployDocs(STALE_SECTION, build);
    expect(r.drifts.length).toBeGreaterThan(0);
    expect(r.drifts.join("\n")).toMatch(/publish ディレクトリ `\.` が .* と不一致/);
    expect(r.drifts.join("\n")).toMatch(/build コマンドの行がない/);
    expect(r.drifts.join("\n")).toMatch(/publish = "\."/);
  });

  test("Codex 再現 1: 表は間違い・参考文に正しい値、は合格させない", () => {
    const section = `| publish ディレクトリ | \`docs\` |
| build コマンド | \`npm run wrong\` |
参考: 以前は \`site-public\` と \`npm run site:build\` を使っていた。
\`\`\`bash
netlify deploy --prod
\`\`\``;
    const r = compareDeployDocs(section, build);
    expect(r.drifts.join("\n")).toMatch(/publish ディレクトリ `docs` が .* と不一致/);
    expect(r.drifts.join("\n")).toMatch(/build コマンド `npm run wrong` が .* と不一致/);
  });

  test("Codex 再現 2: 複数行コマンドの --dir= も残骸として拾う", () => {
    const section = `| publish ディレクトリ | \`site-public\` |
| build コマンド | \`npm run site:build\` |
\`\`\`bash
netlify deploy \\
  --prod --dir=docs
\`\`\``;
    const r = compareDeployDocs(section, build);
    expect(r.drifts.join("\n")).toMatch(/--dir 指定/);
  });

  test("--dir <space> 形式も拾う", () => {
    const section = `| publish ディレクトリ | \`site-public\` |
| build コマンド | \`npm run site:build\` |
\`\`\`bash
netlify deploy --prod --dir docs
\`\`\``;
    expect(compareDeployDocs(section, build).drifts.join("\n")).toMatch(/--dir 指定/);
  });

  test("地の文の「--dir=docs は NG」は残骸とみなさない（実行例だけを見る）", () => {
    const r = compareDeployDocs(GOOD_SECTION, build);
    expect(r.drifts.join("\n")).not.toMatch(/--dir/);
  });

  test("実行例に --prod が無ければ drift", () => {
    const section = GOOD_SECTION.replace("netlify deploy --prod", "netlify deploy");
    expect(compareDeployDocs(section, build).drifts.join("\n")).toMatch(/--prod がない/);
  });

  test("修正後の節は drift 0 / ok 4", () => {
    const r = compareDeployDocs(GOOD_SECTION, build);
    expect(r.drifts).toEqual([]);
    expect(r.oks.length).toBe(4);
  });
});

test("実リポジトリの AGENTS.md と netlify.toml は一致している", () => {
  const r = checkDeployDocs();
  expect(r.drifts, r.drifts.join("\n")).toEqual([]);
});
