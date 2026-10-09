/**
 * designmd-lint.ts — Google 公式 linter（@google/design.md）で DESIGN.md を検証する CI ゲート。
 *
 * ゲート仕様: errors > 0 で exit 1（spec 逸脱・壊れた token 参照は即失敗）。
 * warnings はレポートのみ（コントラスト境界・未参照 token はデザイン判断の題材であり、
 * 機械的に潰す対象ではない — 運用は docs/designmd-quality-loop.md §3 を参照）。
 *
 * パッケージはバージョン固定で npx 実行（発行者は Google 公式 bot google-wombot）。
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// 2026-10-09 に 0.3.0 → 0.4.0。findings は同数（warnings 12 / infos 1）で出力の形も同じ。
// 0.4.0 の `omitted` frontmatter は、5 区分（colors / typography / rounded / spacing / components）を
// 全部持つ melta には不要。
const LINTER = "@google/design.md@0.4.0";

interface Finding {
  severity: "error" | "warning" | "info";
  path?: string;
  message: string;
}

let stdout: string;
try {
  stdout = execFileSync("npx", ["--yes", LINTER, "lint", resolve(root, "DESIGN.md")], {
    encoding: "utf-8",
    // linter が findings ありで非ゼロ exit しても JSON は stdout に出る想定で拾う
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (e) {
  const err = e as { stdout?: string };
  if (!err.stdout) throw e;
  stdout = err.stdout;
}

const result = JSON.parse(stdout) as {
  findings: Finding[];
  summary: { errors: number; warnings: number; infos: number };
};

const { errors, warnings } = result.summary;

for (const f of result.findings) {
  if (f.severity === "error") console.error(`  ✗ [error] ${f.path ?? ""} — ${f.message}`);
}
for (const f of result.findings) {
  if (f.severity === "warning") console.log(`  ⚠ [warn] ${f.path ?? ""} — ${f.message}`);
}

if (errors > 0) {
  console.error(`\n❌ DESIGN.md lint: errors ${errors}（spec 逸脱は許容しない）`);
  process.exit(1);
}
console.log(
  `\n✅ DESIGN.md lint: errors 0 / warnings ${warnings}（warn はデザイン判断の題材としてレポートのみ）`,
);
