/**
 * check-deploy-docs.ts — AGENTS.md のデプロイ手順と netlify.toml の構造的 parity 検査
 *
 * 背景: 2026-07-06 の allowlist 化（5dee761）で netlify.toml の publish が `.` → `site-public` に
 * 変わったが、AGENTS.md のデプロイ節は `publish = "."` のまま 42 日間残った。この手順を信じて
 * デプロイすると site:build を挟まず stale な site-public が出る（= 配信断の再発装置）。
 * ドキュメント drift 検査（drift-check.ts）は netlify.toml を見ていなかった。
 *
 * 検査の設計（Codex 設計レビュー 2026-08-17 反映）:
 *   - 「AGENTS.md 全体に publish 値が 1 回出れば OK」は fail-open（別文脈で偶然同じ文字列が
 *     出れば通り、肝心の表・deploy コマンドが古いままでも検知できない）
 *   - なので (1) netlify.toml の [build] から publish / command を抽出し（未検出・複数検出は error）
 *     (2) AGENTS.md は `## デプロイ` 節に限定して (3) 以下を別々に照合する:
 *         a. publish 値がリテラルで出現する
 *         b. build command がリテラルで出現する
 *         c. `netlify deploy --prod` が出現する
 *         d. 旧手順の残骸（`publish = "."` / `--dir=`）が無い
 *
 * drift-check.ts から呼ぶため、出力はせず結果だけ返す（check-readme-parity.ts と同じ型）。
 * 単独実行: npx tsx scripts/design/check-deploy-docs.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(__dirname, "../..");

export interface DeployDocsResult {
  drifts: string[];
  oks: string[];
}

export interface NetlifyBuild {
  publish: string;
  command: string;
}

/**
 * netlify.toml から `netlify deploy --prod` の実効 publish / command を取り出す。
 * TOML パーサは持ち込まない（依存を増やさない）。`key = "value"` 形式だけを読む。
 *
 * [build] を base とし、[context.production] に同キーがあればそちらで上書きする
 * （production deploy の実効値は context override が勝つ。base だけ見ると AGENTS.md と
 * base が一致していても実際のデプロイと違う、という誤合格になる）。
 * [build] に publish / command が無い、または同一セクション内で複数ある場合は throw（fail-fast）。
 */
export function parseNetlifyBuild(toml: string): NetlifyBuild {
  const lines = toml.split(/\r?\n/);
  let section: string | null = null;
  const found: Record<string, Record<string, string[]>> = {
    "[build]": { publish: [], command: [] },
    "[context.production]": { publish: [], command: [] },
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      section = line in found ? line : null;
      continue;
    }
    if (section === null || line.startsWith("#") || line === "") continue;
    const m = line.match(/^(publish|command)\s*=\s*"([^"]*)"/);
    if (m) found[section][m[1]].push(m[2]);
  }
  for (const sec of Object.keys(found)) {
    for (const key of ["publish", "command"] as const) {
      if (found[sec][key].length > 1) {
        throw new Error(`netlify.toml の ${sec} に ${key} が複数あります: ${found[sec][key].join(" / ")}`);
      }
    }
  }
  for (const key of ["publish", "command"] as const) {
    if (found["[build]"][key].length === 0) {
      throw new Error(`netlify.toml の [build] に ${key} がありません`);
    }
  }
  const pick = (key: "publish" | "command"): string =>
    found["[context.production]"][key][0] ?? found["[build]"][key][0];
  return { publish: pick("publish"), command: pick("command") };
}

/**
 * AGENTS.md から `## デプロイ` 節（見出しから次の `## ` まで）を取り出す。無ければ null。
 */
export function extractDeploySection(agentsMd: string): string | null {
  const lines = agentsMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## デプロイ\s*$/.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * 表の中から「| <ラベル> | <値セル> |」の行を探し、値セルの最初のバッククォート内を返す。
 * ラベルは部分一致（「publish ディレクトリ」「build コマンド」）。無ければ null。
 * 値を「どこに書いてあるか」に結び付けるための抽出で、節内 substring 検査は使わない
 * （参考文に正しい値が 1 回出るだけで表が間違っていても通る fail-open になる）。
 */
export function extractTableCell(section: string, labelPattern: RegExp): string | null {
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] は先頭 "|" の左（空）、cells[1] がラベル、cells[2] が値
    if (cells.length < 3 || !labelPattern.test(cells[1])) continue;
    const m = cells[2].match(/`([^`]+)`/);
    return m ? m[1] : "";
  }
  return null;
}

/**
 * コードフェンス（``` / ~~~）の中身を、行継続（末尾 `\`）を結合した「論理行」の配列で返す。
 * 実行例だけを対象にするため。地の文の「--dir=docs は NG」は禁止の明記なので見ない
 * （語彙で否定文脈を判定すると表現が変わった瞬間に壊れる）。
 */
export function extractFencedCommands(section: string): string[] {
  const out: string[] = [];
  const fenceRe = /^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
  for (const m of section.matchAll(fenceRe)) {
    const lines = m[2].split(/\r?\n/);
    let logical = "";
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (line.endsWith("\\")) {
        logical += line.slice(0, -1) + " ";
        continue;
      }
      logical += line;
      const norm = logical.trim().replace(/\s+/g, " ");
      if (norm !== "" && !norm.startsWith("#")) out.push(norm);
      logical = "";
    }
    const tail = logical.trim().replace(/\s+/g, " ");
    if (tail !== "") out.push(tail);
  }
  return out;
}

/**
 * デプロイ節と netlify.toml を照合する。純関数（ファイル I/O なし）なので fixture でテストできる。
 *
 * 各項目を「値がどこにあるか」に結び付けて別々に照合する:
 *   a. 表の publish 行の値セル === netlify.toml の publish
 *   b. 表の build コマンド行の値セル === netlify.toml の command
 *   c. コードフェンス内に `netlify deploy` の実行例があり、`--prod` を含む
 *   d. 実行例に `--dir=` / `--dir <x>` が無い（allowlist 迂回）/ 節に旧 `publish = "."` が無い
 */
export function compareDeployDocs(section: string, build: NetlifyBuild): DeployDocsResult {
  const drifts: string[] = [];
  const oks: string[] = [];

  // a. publish 行
  const publishCell = extractTableCell(section, /publish/i);
  if (publishCell === null) {
    drifts.push("AGENTS.md デプロイ節: 表に publish ディレクトリの行がない");
  } else if (publishCell !== build.publish) {
    drifts.push(
      `AGENTS.md デプロイ節: 表の publish ディレクトリ \`${publishCell}\` が netlify.toml の \`${build.publish}\` と不一致`
    );
  } else {
    ok(oks, `AGENTS.md デプロイ節: 表の publish ディレクトリ \`${build.publish}\` が netlify.toml と一致`);
  }

  // b. build コマンド行
  const commandCell = extractTableCell(section, /build\s*コマンド|build\s*command/i);
  if (commandCell === null) {
    drifts.push("AGENTS.md デプロイ節: 表に build コマンドの行がない");
  } else if (commandCell !== build.command) {
    drifts.push(
      `AGENTS.md デプロイ節: 表の build コマンド \`${commandCell}\` が netlify.toml の \`${build.command}\` と不一致`
    );
  } else {
    ok(oks, `AGENTS.md デプロイ節: 表の build コマンド \`${build.command}\` が netlify.toml と一致`);
  }

  // c. 実行例
  const commands = extractFencedCommands(section);
  const deployCmds = commands.filter((c) => /\bnetlify\s+deploy\b/.test(c));
  if (deployCmds.length === 0) {
    drifts.push("AGENTS.md デプロイ節: コードフェンス内に `netlify deploy` の実行例がない");
  } else if (!deployCmds.some((c) => /\s--prod(\s|$)/.test(c))) {
    drifts.push("AGENTS.md デプロイ節: `netlify deploy` の実行例に --prod がない");
  } else {
    ok(oks, "AGENTS.md デプロイ節: `netlify deploy --prod` の実行例がある");
  }

  // d. 旧手順の残骸
  const stale: string[] = [];
  if (build.publish !== "." && /publish\s*=\s*"\."/.test(section)) stale.push('publish = "."');
  if (deployCmds.some((c) => /\s--dir(=|\s)/.test(c))) {
    stale.push("実行例の netlify deploy に --dir 指定（allowlist を迂回する）");
  }
  if (stale.length === 0) {
    ok(oks, "AGENTS.md デプロイ節: 旧手順の残骸なし");
  } else {
    drifts.push(`AGENTS.md デプロイ節: 旧手順の残骸 ${stale.join(" / ")}`);
  }

  return { drifts, oks };
}

function ok(list: string[], msg: string): void {
  list.push(msg);
}

/**
 * ファイルを読んで照合する入口。drift-check.ts はこれを呼ぶ。
 */
export function checkDeployDocs(root: string = defaultRoot): DeployDocsResult {
  const tomlPath = resolve(root, "netlify.toml");
  const agentsPath = resolve(root, "AGENTS.md");
  if (!existsSync(tomlPath)) {
    return { drifts: ["netlify.toml が存在しません（デプロイ手順の照合元）"], oks: [] };
  }
  if (!existsSync(agentsPath)) {
    return { drifts: ["AGENTS.md が存在しません（デプロイ手順の記載先）"], oks: [] };
  }
  let build: NetlifyBuild;
  try {
    build = parseNetlifyBuild(readFileSync(tomlPath, "utf-8"));
  } catch (e) {
    return { drifts: [(e as Error).message], oks: [] };
  }
  const section = extractDeploySection(readFileSync(agentsPath, "utf-8"));
  if (section === null) {
    return { drifts: ["AGENTS.md に `## デプロイ` 節がありません"], oks: [] };
  }
  return compareDeployDocs(section, build);
}

// 単独実行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDeployDocs();
  for (const o of result.oks) console.log(`  ✓ ${o}`);
  for (const d of result.drifts) console.log(`  ✗ ${d}`);
  process.exit(result.drifts.length === 0 ? 0 : 1);
}
