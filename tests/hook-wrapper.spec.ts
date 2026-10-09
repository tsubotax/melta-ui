/**
 * PostToolUse hook wrapper（scripts/design/hook-check-rule.sh）の実行経路の選び方。
 *
 * wrapper は「どこに置かれた hook か」で経路を選ぶ。dev checkout（src/cli/lint-generated.ts がある）では
 * src を tsx で叩くのが正で、tsx が無いときだけ dist に落ちる。その dist も src より古ければ使わず
 * 「未検査」を通知する（CI は最新 src、hook は旧 dist、という食い違いを無通知で起こさない）。
 * 配布物（src も tsx も無い npm / plugin）では dist を node で叩く。
 *
 * 検体のパスは wrapper では取り出さず、stdin の JSON をそのまま CLI の `--hook` に流す
 * （取り出しは src/utils/hook-input.ts。tests/hook-input.spec.ts が見る）。wrapper が持つのは
 * 「対象拡張子の文字列が無ければ起動しない」という足切りだけ。
 *
 * この分岐はリポジトリの build 状態に依存させると、手元（dist あり）と CI の test job（dist なし）で
 * 別の経路を検査してしまう。そこで wrapper を tmp の疑似ルートに複製し、src / tsx / dist の有無と
 * 中身を stub で固定して経路だけを測る。lint の判定そのものは tests/external-ds.spec.ts の wrapper E2E と
 * tests/lint.spec.ts が見る。
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";

const WRAPPER = resolve("scripts/design/hook-check-rule.sh");

interface FakeRootOptions {
  /** dist/cli/lint-generated.js の中身（JS）。省略で置かない */
  distStub?: string;
  /** src/cli/lint-generated.ts を置く（dev checkout を模す）。中身は tsx stub が読むだけ */
  srcStub?: boolean;
  /** node_modules/.bin/tsx の中身（シェルスクリプト）。省略で置かない */
  tsxStub?: string;
  /** dist の mtime を src より古くする（build 前に src を直した状態） */
  distOlderThanSrc?: boolean;
}

interface FakeRoot {
  root: string;
  wrapper: string;
  sample: string;
  /** 作ったファイルとディレクトリを個別に消す（再帰削除は使わない） */
  cleanup: () => void;
}

function createFakeRoot(options: FakeRootOptions = {}): FakeRoot {
  const root = mkdtempSync(join(tmpdir(), "melta-hook-wrapper-"));
  const files: string[] = [];
  // 消す順（子 → 親）に積む
  const dirs: string[] = [];
  const mkdir = (...segments: string[]): string => {
    let cur = root;
    for (const s of segments) {
      cur = join(cur, s);
      mkdirSync(cur, { recursive: true });
      if (!dirs.includes(cur)) dirs.unshift(cur);
    }
    return cur;
  };
  const write = (path: string, body: string): void => {
    writeFileSync(path, body, "utf-8");
    files.push(path);
  };

  const designDir = mkdir("scripts", "design");
  const wrapper = join(designDir, "hook-check-rule.sh");
  copyFileSync(WRAPPER, wrapper);
  files.push(wrapper);

  let src: string | null = null;
  if (options.srcStub) {
    src = join(mkdir("src", "cli"), "lint-generated.ts");
    write(src, "// stub\n");
  }
  if (options.tsxStub !== undefined) {
    const tsx = join(mkdir("node_modules", ".bin"), "tsx");
    write(tsx, options.tsxStub);
    chmodSync(tsx, 0o755);
  }
  if (options.distStub !== undefined) {
    const dist = join(mkdir("dist", "cli"), "lint-generated.js");
    write(dist, options.distStub);
    if (options.distOlderThanSrc) {
      // src より 1 時間古い mtime にする（find -newer の判定対象）
      const old = new Date(Date.now() - 60 * 60 * 1000);
      utimesSync(dist, old, old);
    } else if (src) {
      // 既定は dist の方が新しい（build 直後の状態）
      const fresh = new Date(Date.now() + 60 * 1000);
      utimesSync(dist, fresh, fresh);
    }
  }

  const sample = join(root, "sample.html");
  write(sample, "<p>x</p>");

  return {
    root,
    wrapper,
    sample,
    cleanup: () => {
      for (const f of files) unlinkSync(f);
      // 空ディレクトリだけを消す（中身が残っていれば rmdir が落ちて気づける）
      for (const d of dirs) rmdirSync(d);
      rmdirSync(root);
    },
  };
}

function hookInput(filePath: string): string {
  return JSON.stringify({ tool_input: { file_path: filePath } });
}

function runWrapper(wrapper: string, input: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("bash", [wrapper], { input, encoding: "utf-8", timeout: 30000 });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? "" };
  }
}

function contextOf(stdout: string): string | undefined {
  return (JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } })
    .hookSpecificOutput?.additionalContext;
}

/** stub は引数と stdin をそのまま返す（wrapper が stdin を CLI へ流していることの証跡） */
const DIST_ECHO = `let d = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => { d += c; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ via: "dist", args: process.argv.slice(2), stdin: JSON.parse(d) }));
});
`;
const TSX_ECHO = `#!/bin/sh\nprintf '{"via":"tsx","args":["%s","%s"],"stdin":%s}' "$1" "$2" "$(cat)"\n`;

test.describe("hook wrapper: 実行経路の優先順位", () => {
  test("dev checkout（src + tsx + dist が揃う）では src を tsx で叩き、stdin の JSON をそのまま渡す", () => {
    const fake = createFakeRoot({ srcStub: true, tsxStub: TSX_ECHO, distStub: DIST_ECHO });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        via: "tsx",
        args: [join(fake.root, "src", "cli", "lint-generated.ts"), "--hook"],
        stdin: { tool_input: { file_path: fake.sample } },
      });
    } finally {
      fake.cleanup();
    }
  });

  test("dev checkout で tsx が無ければ、dist が src より新しいときだけ dist を使う", () => {
    const fake = createFakeRoot({ srcStub: true, distStub: DIST_ECHO });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        via: "dist",
        args: ["--hook"],
        stdin: { tool_input: { file_path: fake.sample } },
      });
    } finally {
      fake.cleanup();
    }
  });

  test("dev checkout で dist が src より古ければ、古い engine で判定せず未検査を通知する", () => {
    const fake = createFakeRoot({ srcStub: true, distStub: DIST_ECHO, distOlderThanSrc: true });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('"via"');
      const context = contextOf(result.stdout);
      expect(context).toContain("src より古い");
      expect(context).toContain("npm run build");
      expect(context).toContain("この書き込みは未検査です");
    } finally {
      fake.cleanup();
    }
  });

  test("dev checkout で tsx も dist も無ければ未検査を通知する", () => {
    const fake = createFakeRoot({ srcStub: true });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      expect(contextOf(result.stdout)).toContain("tsx も dist/cli/lint-generated.js も見つからない");
    } finally {
      fake.cleanup();
    }
  });

  test("配布物（src 無し）では dist を node で叩き、--hook と stdin の JSON を渡す", () => {
    const fake = createFakeRoot({ distStub: DIST_ECHO });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        via: "dist",
        args: ["--hook"],
        stdin: { tool_input: { file_path: fake.sample } },
      });
    } finally {
      fake.cleanup();
    }
  });

  test("パスに \\\" や別階層の file_path が混ざっても、stdin をそのまま流すので CLI 側で正しく読める", () => {
    const fake = createFakeRoot({ distStub: DIST_ECHO });
    try {
      // 旧 wrapper の grep はこの入力で `tool_response.file_path` や `\"` を拾っていた
      const input = JSON.stringify({
        tool_response: { file_path: "/decoy/other.html" },
        tool_input: { file_path: fake.sample, content: 'say \\"hi\\" "file_path": "/decoy/in-content.html"' },
      });
      const result = runWrapper(fake.wrapper, input);
      expect(result.status).toBe(0);
      expect((JSON.parse(result.stdout) as { stdin: unknown }).stdin).toEqual(JSON.parse(input));
    } finally {
      fake.cleanup();
    }
  });

  test("dist の CLI が起動に失敗したら、出力なし（= 合格に見える）にせず未検査を通知する", () => {
    // --hook は常に exit 0 が契約。非 0 は依存の未インストール等で CLI 自体が動いていない
    const fake = createFakeRoot({ distStub: `process.stderr.write("simulated crash\\n");\nprocess.exit(1);\n` });
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout) as { decision?: string };
      expect(payload.decision).toBeUndefined();
      expect(contextOf(result.stdout)).toContain("dist/cli/lint-generated.js の起動に失敗");
      expect(contextOf(result.stdout)).toContain("この書き込みは未検査です");
    } finally {
      fake.cleanup();
    }
  });

  test("dist も TS ソースも無ければ未検査を通知し、npm run build / npm install を案内する", () => {
    const fake = createFakeRoot();
    try {
      const result = runWrapper(fake.wrapper, hookInput(fake.sample));
      expect(result.status).toBe(0);
      const context = contextOf(result.stdout);
      expect(context).toContain("この書き込みは未検査です");
      expect(context).toContain("npm run build");
      expect(context).toContain("npm install");
    } finally {
      fake.cleanup();
    }
  });

  test("対象拡張子の文字列が入力のどこにも無ければ、dist があっても起動せず無言（足切り）", () => {
    const fake = createFakeRoot({ distStub: `process.stdout.write("should-not-run");\n` });
    try {
      const result = runWrapper(fake.wrapper, hookInput(join(fake.root, "notes.md")));
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      fake.cleanup();
    }
  });
});
