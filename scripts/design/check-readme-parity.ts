/**
 * check-readme-parity.ts — 日英 README の構造 parity 検査
 *
 * README.md（日本語・正本）と README.en.md（英語）は手書き 2 枚なので、片方だけ
 * 更新されると内容が静かに乖離する（実際に 1.4.0 まで乖離していた）。
 * 「同一アウトラインで運用する」という運用ルールは SSOT ではないため、機械照合する。
 *
 * 照合項目（internal/readme-v2-design.md v2.1 の仕様）:
 *   1. セクションキーの集合と順序（`<!-- sec: <key> -->` マーカー）
 *   2. セクションごとのコードフェンス数
 *   3. 外部リンク URL の集合
 *   4. 主要数値（107 / 49 / 372 / 40 / 28 / 101）の同値出現
 *
 * 単独実行: npm run check:readme-parity
 * 統合実行: npm run design:drift（drift-check.ts が checkReadmeParity を呼ぶ）
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(__dirname, "../..");

/** 両 README に同値で出現すべき主要数値（設計書 v2.1 で固定） */
export const PARITY_NUMBERS = [107, 49, 372, 40, 28, 101] as const;

const SECTION_MARKER = /<!--\s*sec:\s*([a-z0-9-]+)\s*-->/g;

export interface ParitySection {
  key: string;
  /** マーカー行を除いた本文 */
  body: string;
  /** ``` で始まる行の数（開始 + 終了の合計） */
  fenceLines: number;
}

/** md 本文をセクションマーカーで分割する。マーカー前の前書きは無視する */
export function parseSections(md: string): ParitySection[] {
  const markers = [...md.matchAll(SECTION_MARKER)];
  const sections: ParitySection[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index ?? md.length : md.length;
    const body = md.slice(start, end);
    sections.push({
      key: m[1],
      body,
      fenceLines: body.split(/\r?\n/).filter((line) => /^\s*```/.test(line)).length,
    });
  }
  return sections;
}

/**
 * 外部リンク（http/https）の URL 集合。
 * URL に日本語アンカー（#ステータス 等）が入りうるので文字クラスで非 ASCII を弾けない。
 * 代わりに末尾の句読点・閉じ括弧（半角・全角とも）を落とす。
 */
export function extractExternalUrls(md: string): Set<string> {
  const urls = new Set<string>();
  for (const m of md.matchAll(/https?:\/\/[^\s)\]"'<>`|]+/g)) {
    urls.add(m[0].replace(/[.,;:。、，．）」』]+$/u, ""));
  }
  return urls;
}

function countNumber(md: string, n: number): number {
  const re = new RegExp(`(?<!\\d)${n}(?!\\d)`, "g");
  return [...md.matchAll(re)].length;
}

export interface ParityResult {
  drifts: string[];
  oks: string[];
}

/**
 * 日英 README の parity を照合する。drift-check.ts からも呼ぶため、
 * 出力はせず結果だけ返す（報告形式は呼び出し側に合わせる）。
 */
export function checkReadmeParity(root: string = defaultRoot): ParityResult {
  const drifts: string[] = [];
  const oks: string[] = [];

  const jaPath = resolve(root, "README.md");
  const enPath = resolve(root, "README.en.md");
  if (!existsSync(jaPath) || !existsSync(enPath)) {
    drifts.push("README.md / README.en.md の両方が必要です（日英 parity 検査の対象）");
    return { drifts, oks };
  }

  const ja = readFileSync(jaPath, "utf-8");
  const en = readFileSync(enPath, "utf-8");

  // --- 1. セクションキーの集合と順序 ---
  const jaSections = parseSections(ja);
  const enSections = parseSections(en);

  if (jaSections.length === 0) {
    drifts.push("README.md にセクションマーカー（<!-- sec: ... -->）がありません");
  }
  if (enSections.length === 0) {
    drifts.push("README.en.md にセクションマーカー（<!-- sec: ... -->）がありません");
  }

  const jaKeys = jaSections.map((s) => s.key);
  const enKeys = enSections.map((s) => s.key);

  const dupJa = jaKeys.filter((k, i) => jaKeys.indexOf(k) !== i);
  const dupEn = enKeys.filter((k, i) => enKeys.indexOf(k) !== i);
  if (dupJa.length > 0) drifts.push(`README.md: セクションキーの重複: ${[...new Set(dupJa)].join(", ")}`);
  if (dupEn.length > 0) drifts.push(`README.en.md: セクションキーの重複: ${[...new Set(dupEn)].join(", ")}`);

  const onlyJa = jaKeys.filter((k) => !enKeys.includes(k));
  const onlyEn = enKeys.filter((k) => !jaKeys.includes(k));
  if (onlyJa.length > 0) drifts.push(`README.en.md に無いセクション: ${onlyJa.join(", ")}`);
  if (onlyEn.length > 0) drifts.push(`README.md に無いセクション: ${onlyEn.join(", ")}`);

  if (onlyJa.length === 0 && onlyEn.length === 0 && dupJa.length === 0 && dupEn.length === 0) {
    if (jaKeys.join(">") !== enKeys.join(">")) {
      drifts.push(
        `セクションの順序が不一致:\n      ja: ${jaKeys.join(" > ")}\n      en: ${enKeys.join(" > ")}`
      );
    } else if (jaKeys.length > 0) {
      oks.push(`セクション ${jaKeys.length} 個のキー・順序が一致`);
    }
  }

  // --- 2. セクションごとのコードフェンス数 ---
  const enByKey = new Map(enSections.map((s) => [s.key, s]));
  const fenceMismatch: string[] = [];
  const oddFences: string[] = [];
  for (const s of jaSections) {
    if (s.fenceLines % 2 !== 0) oddFences.push(`README.md:${s.key}(${s.fenceLines})`);
    const e = enByKey.get(s.key);
    if (!e) continue;
    if (e.fenceLines % 2 !== 0) oddFences.push(`README.en.md:${e.key}(${e.fenceLines})`);
    if (s.fenceLines !== e.fenceLines) {
      fenceMismatch.push(`${s.key}: ja ${s.fenceLines / 2} vs en ${e.fenceLines / 2}`);
    }
  }
  if (oddFences.length > 0) {
    drifts.push(`コードフェンスが閉じていないセクション: ${oddFences.join(", ")}`);
  }
  if (fenceMismatch.length > 0) {
    drifts.push(`セクションのコードブロック数が不一致: ${fenceMismatch.join(" / ")}`);
  } else if (jaSections.length > 0 && oddFences.length === 0) {
    const total = jaSections.reduce((a, s) => a + s.fenceLines, 0) / 2;
    oks.push(`コードブロック数がセクション単位で一致（計 ${total} ブロック）`);
  }

  // --- 3. 外部リンク URL の集合 ---
  const jaUrls = extractExternalUrls(ja);
  const enUrls = extractExternalUrls(en);
  const urlOnlyJa = [...jaUrls].filter((u) => !enUrls.has(u));
  const urlOnlyEn = [...enUrls].filter((u) => !jaUrls.has(u));
  if (urlOnlyJa.length > 0) drifts.push(`README.en.md に無い外部リンク: ${urlOnlyJa.join(", ")}`);
  if (urlOnlyEn.length > 0) drifts.push(`README.md に無い外部リンク: ${urlOnlyEn.join(", ")}`);
  if (urlOnlyJa.length === 0 && urlOnlyEn.length === 0) {
    oks.push(`外部リンク ${jaUrls.size} 件の URL 集合が一致`);
  }

  // --- 4. 主要数値の同値出現 ---
  const missing: string[] = [];
  for (const n of PARITY_NUMBERS) {
    const inJa = countNumber(ja, n);
    const inEn = countNumber(en, n);
    if (inJa === 0 || inEn === 0) {
      missing.push(`${n}（ja ${inJa} 回 / en ${inEn} 回）`);
    }
  }
  if (missing.length > 0) {
    drifts.push(`主要数値が片方の README に出現しません: ${missing.join(", ")}`);
  } else {
    oks.push(`主要数値 ${PARITY_NUMBERS.join(" / ")} が両 README に出現`);
  }

  return { drifts, oks };
}

// --- CLI ---
const isCli = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  console.log("\n=== README 日英 parity ===\n");
  const { drifts, oks } = checkReadmeParity();
  for (const o of oks) console.log(`  ✓ ${o}`);
  for (const d of drifts) console.error(`  ⚠️  DRIFT: ${d}`);
  console.log(`\n  ${drifts.length === 0 ? "✅ NO DRIFT" : `⚠️  ${drifts.length} DRIFT(S) DETECTED`}\n`);
  process.exit(drifts.length > 0 ? 1 : 0);
}
