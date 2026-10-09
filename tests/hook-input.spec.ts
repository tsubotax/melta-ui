/**
 * hook の入力（stdin の PostToolUse JSON）から検体のパスを取り出す経路の検査。
 *
 * 純関数 parseHookInput / isExcludedHookPath（src/utils/hook-input.ts）と、
 * CLI の `--hook`（引数なし = stdin を読む）を通した E2E の両方を置く。
 * 旧 wrapper の grep が取り違えていた入力（値の \" / 別階層の同名キー）を陰性対照として固定する。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { isExcludedHookPath, parseHookInput } from "../src/utils/hook-input.js";

test.describe("parseHookInput: stdin JSON から tool_input.file_path を取る", () => {
  test("絶対パスはそのまま返す", () => {
    const r = parseHookInput(JSON.stringify({ tool_input: { file_path: "/abs/page.html" } }));
    expect(r).toEqual({ ok: true, filePath: "/abs/page.html" });
  });

  test("相対パスは cwd 基準で絶対化する", () => {
    const r = parseHookInput(JSON.stringify({ tool_input: { file_path: "docs/page.html" } }), "/base");
    expect(r).toEqual({ ok: true, filePath: resolve("/base", "docs/page.html") });
  });

  test("値の \\\" や別階層の file_path に惑わされない（旧 grep の取り違え）", () => {
    const raw = JSON.stringify({
      tool_response: { file_path: "/decoy/response.html" },
      tool_input: {
        content: 'x "file_path": "/decoy/in-content.html" and \\"quoted\\"',
        file_path: "/real/page.html",
      },
    });
    expect(parseHookInput(raw)).toEqual({ ok: true, filePath: "/real/page.html" });
  });

  for (const [label, raw] of [
    ["空", ""],
    ["空白のみ", "  \n"],
    ["JSON でない", "not json"],
    ["配列", "[]"],
    ["tool_input が無い", JSON.stringify({ tool_response: { file_path: "/x.html" } })],
    ["tool_input が文字列", JSON.stringify({ tool_input: "/x.html" })],
    ["file_path が無い", JSON.stringify({ tool_input: { content: "x" } })],
    ["file_path が数値", JSON.stringify({ tool_input: { file_path: 1 } })],
    ["file_path が空文字", JSON.stringify({ tool_input: { file_path: "  " } })],
  ] as const) {
    test(`不正な入力（${label}）は ok: false で理由を返す`, () => {
      const r = parseHookInput(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/hook の入力/);
    });
  }
});

test.describe("isExcludedHookPath: テスト・ベンチ・検証用の検体は hook で検査しない", () => {
  test("除外セグメントを含むパスは true", () => {
    for (const p of [
      "/repo/tests/fixtures/bad.html",
      "/repo/test/a.tsx",
      "/repo/design/benchmarks/results/2026/x.html",
      "/repo/verification/case.html",
      "C:\\repo\\tests\\x.html",
    ]) {
      expect(isExcludedHookPath(p), p).toBe(true);
    }
  });

  test("通常のパスは false（testsite など部分一致では除外しない）", () => {
    for (const p of ["/repo/docs/index.html", "/repo/src/testsite/page.html", "/repo/latest/x.html"]) {
      expect(isExcludedHookPath(p), p).toBe(false);
    }
  });
});

test.describe("CLI --hook（引数なし）は stdin の JSON を読む", () => {
  const CLI = resolve("src/cli/lint-generated.ts");

  function runHook(input: string): { status: number; stdout: string } {
    try {
      const stdout = execFileSync("node", ["--import", "tsx", CLI, "--hook"], {
        input,
        encoding: "utf-8",
        timeout: 60000,
      });
      return { status: 0, stdout };
    } catch (e) {
      const err = e as { status: number | null; stdout?: string };
      return { status: err.status ?? -1, stdout: err.stdout ?? "" };
    }
  }

  test("違反を含む HTML のパスを stdin で渡すと block の JSON（exit 0）", () => {
    const dir = mkdtempSync(join(tmpdir(), "melta-hook-input-"));
    const file = join(dir, "page.html");
    writeFileSync(file, '<div class="text-black shadow-2xl">x</div>', "utf-8");
    try {
      const r = runHook(JSON.stringify({ tool_input: { file_path: file } }));
      expect(r.status).toBe(0);
      const payload = JSON.parse(r.stdout) as { decision?: string; reason?: string };
      expect(payload.decision).toBe("block");
      expect(payload.reason).toContain("禁止パターン検出");
    } finally {
      unlinkSync(file);
      rmdirSync(dir);
    }
  });

  test("JSON として読めない stdin は未検査を通知する（無言で合格にしない）", () => {
    const r = runHook("not json");
    expect(r.status).toBe(0);
    const context = (JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } })
      .hookSpecificOutput?.additionalContext;
    expect(context).toContain("JSON として読めません");
    expect(context).toContain("この書き込みは未検査です");
  });

  test("対象外の拡張子は無言で抜ける", () => {
    const r = runHook(JSON.stringify({ tool_input: { file_path: "/tmp/notes.md" } }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  test("除外ディレクトリ（tests/）の検体は無言で抜ける", () => {
    const r = runHook(JSON.stringify({ tool_input: { file_path: "/repo/tests/fixtures/bad.html" } }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  test("従来の --hook <file> も引き続き動く", () => {
    const dir = mkdtempSync(join(tmpdir(), "melta-hook-input-"));
    const file = join(dir, "page.html");
    writeFileSync(file, '<div class="text-black">x</div>', "utf-8");
    try {
      const stdout = execFileSync("node", ["--import", "tsx", CLI, "--hook", file], {
        encoding: "utf-8",
        timeout: 60000,
      });
      expect((JSON.parse(stdout) as { decision?: string }).decision).toBe("block");
    } finally {
      unlinkSync(file);
      rmdirSync(dir);
    }
  });
});
