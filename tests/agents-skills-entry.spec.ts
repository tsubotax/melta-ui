/**
 * agents-skills-entry.spec.ts — `.agents/skills/` の入口が実物と一致していることの検査
 *
 * Cursor / Codex は `.agents/skills/<name>/SKILL.md` を探索する。melta はここに実体を置かず、
 * `skills/<name>` への symlink を 1 本ずつ張って配布している（実体を 1 つに保ち drift を避けるため）。
 *
 * この構成は「入口があること」と「入口が正しい先を指していること」が別なので、次の 3 つが
 * 無言で成立してしまう。どれも既存のゲート（design:check / drift / validate / build）では
 * 検出できないため、ここで構造として押さえる。
 *
 *   1. 入口を別のスキルへ張り替える。symlink としては健全で SKILL.md も読めるが、中身が違う
 *   2. 入口が実ディレクトリに置き換わる。.gitignore の否定パターンが配下ごと再包含する
 *   3. 公開スキルを増やしたのに入口を足し忘れる。`.gitignore` の `/.agents/skills/*` に
 *      当たって追跡されず、ローカルには入口があるので配布漏れに気づけない
 *
 * 判定は git の index を正とする（ワーキングコピーにあるローカル専用のスキルを巻き込まないため）。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync, lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { test, expect } from "@playwright/test";

// playwright は testDir の親（リポジトリ直下）を cwd にして走る。既存 spec と同じ流儀
const REPO_ROOT = resolve(".");
const ENTRY_DIR = ".agents/skills";
const SOURCE_DIR = "skills";

/** git の index に入っているパスと mode と blob を引く（`<mode> <sha> <stage>\t<path>`） */
function lsFiles(pathspec: string): { mode: string; sha: string; path: string }[] {
  const stdout = execFileSync("git", ["ls-files", "-s", "--", pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, sha] = meta.split(" ");
      return { mode, sha, path };
    });
}

/** index 側の blob の中身。mode 120000 の blob はリンク先文字列そのもの */
function blobContent(sha: string): string {
  return execFileSync("git", ["cat-file", "blob", sha], { cwd: REPO_ROOT, encoding: "utf8" });
}

/**
 * SKILL.md の frontmatter から name を引く。
 * 引用符は対応が取れているときだけ剥がす。`name: "design-review`（閉じ忘れ）を
 * 黙って `design-review` に直してしまうと、壊れた YAML が検査を素通りする
 */
function frontmatterName(skillMdPath: string): string | null {
  const body = readFileSync(skillMdPath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (match == null) return null;
  const nameLine = match[1].split(/\r?\n/).find((line) => line.startsWith("name:"));
  if (nameLine == null) return null;
  const raw = nameLine.slice("name:".length).trim();
  for (const quote of ['"', "'"]) {
    if (!raw.startsWith(quote)) continue;
    // 開いたら必ず閉じる。閉じていなければ不正な値として扱い、剥がさない
    if (raw.length >= 2 && raw.endsWith(quote)) return raw.slice(1, -1);
    return raw;
  }
  return raw;
}

test.describe(".agents/skills の入口と skills/ の実体が一致する", () => {
  test("入口はすべて symlink で、`../../skills/<同名>` を指す", () => {
    const entries = lsFiles(ENTRY_DIR);
    expect(entries.length, "`.agents/skills/` に追跡された入口が 1 つも無い").toBeGreaterThan(0);

    for (const entry of entries) {
      const name = basename(entry.path);
      // 実ディレクトリへの置き換えを止める。否定パターンが配下ごと再包含するため
      expect(entry.mode, `${entry.path} が symlink (120000) ではない`).toBe("120000");

      const absolute = join(REPO_ROOT, entry.path);
      expect(lstatSync(absolute).isSymbolicLink(), `${entry.path} が symlink として存在しない`).toBe(
        true
      );
      // 別のスキルへの張り替えを止める。解決できるだけでは中身の同一性を担保しない。
      // index と作業ツリーの両方を見る（誤リンクを stage した後で作業ツリーだけ戻すと、
      // 作業ツリーしか見ない検査は緑のまま誤った内容が commit される）
      const expected = `../../${SOURCE_DIR}/${name}`;
      expect(readlinkSync(absolute), `${entry.path} のリンク先が実体と対応しない`).toBe(expected);
      expect(blobContent(entry.sha), `${entry.path} は index 側のリンク先が実体と対応しない`).toBe(
        expected
      );
    }
  });

  test("入口の先の SKILL.md が読め、frontmatter の name が入口名と一致する", () => {
    for (const entry of lsFiles(ENTRY_DIR)) {
      const name = basename(entry.path);
      const skillMd = join(REPO_ROOT, entry.path, "SKILL.md");
      const declared = frontmatterName(skillMd);
      expect(declared, `${entry.path}/SKILL.md の frontmatter に name が無い`).not.toBeNull();
      expect(declared, `${entry.path} の入口名と SKILL.md の name が食い違う`).toBe(name);
    }
  });

  test("配布される skills/ の全スキルに入口がある（足し忘れを検出する）", () => {
    // 追跡されている skills/<name>/SKILL.md が配布対象の公開スキル。
    // ローカル専用物（skills/skill-improver 等）は .gitignore で index に入らないので自然に外れる
    const distributed = lsFiles(`${SOURCE_DIR}/*/SKILL.md`)
      .map((f) => f.path.split("/")[1])
      .sort();
    const entries = lsFiles(ENTRY_DIR)
      .map((e) => basename(e.path))
      .sort();

    expect(distributed.length, "配布対象の skills/<name>/SKILL.md が 1 つも無い").toBeGreaterThan(0);
    // 片側だけ増えると Cursor / Codex から無言で見えなくなる（または実体の無い入口が残る）
    expect(entries, "skills/ の公開スキルと .agents/skills/ の入口が一致しない").toEqual(
      distributed
    );
  });
});
