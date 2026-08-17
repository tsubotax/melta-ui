/**
 * check-llms-links.ts — llms.txt / llms-full.txt が列挙する外部 URL の到達性を実測する（手動用）
 *
 * CI には入れない。外部到達性を CI に入れると npm 障害と同じ flaky を抱えるため。
 * llms.txt のリンク先（GitHub raw）を変えたとき、または「本当に読めるか」を確かめたいときに
 * 手で回す。2026-08-17 に BASE を GitHub raw に切り替えた際の一度きり確認を、再実行できる形にしたもの。
 *
 * 404 と 429 を区別する: raw.githubusercontent.com の匿名アクセスは rate limit の対象で、
 * 429 は「リンク切れ」ではない。429 を 404 と同列に数えると誤診する（Codex 設計レビュー指摘）。
 *
 * 使い方: npx tsx scripts/design/check-llms-links.ts
 * 終了コード: 404 / 5xx / ネットワークエラーが 1 件でもあれば 1。429 のみなら 0（警告表示）。
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const files = ["llms.txt", "llms-full.txt"];
const urlRe = /https?:\/\/[^\s)>\]"']+/g;
const urls = new Set<string>();
for (const f of files) {
  const text = readFileSync(resolve(root, f), "utf-8");
  for (const m of text.matchAll(urlRe)) urls.add(m[0].replace(/[.,;:]+$/, ""));
}

const counts = { ok: 0, notFound: 0, rateLimited: 0, other: 0 };
const problems: string[] = [];

for (const url of [...urls].sort()) {
  let status: number | string;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    status = res.status;
  } catch (e) {
    status = `ERR ${(e as Error).message}`;
  }
  if (status === 200) counts.ok++;
  else if (status === 404) {
    counts.notFound++;
    problems.push(`  404  ${url}`);
  } else if (status === 429) {
    counts.rateLimited++;
    console.log(`  429  ${url}  (rate limit — リンク切れではない。時間を置いて再実行)`);
  } else {
    counts.other++;
    problems.push(`  ${status}  ${url}`);
  }
  // rate limit を踏みにくくする
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n  検査 URL: ${urls.size} / 200: ${counts.ok} / 404: ${counts.notFound} / 429: ${counts.rateLimited} / その他: ${counts.other}`);
if (problems.length > 0) {
  console.log("\n  問題のある URL:");
  for (const p of problems) console.log(p);
}
process.exit(counts.notFound + counts.other > 0 ? 1 : 0);
