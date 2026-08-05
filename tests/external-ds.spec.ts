/**
 * 外部 DS bundle の端到端回帰（Phase 2 / S2 W8）
 *
 * `tests/fixtures/external-ds/acme-ds` は melta 由来のデータを 1 つも含まない架空 DS。
 * ここでは engine（MCP / lint / 設計検査）がその bundle だけで動くことを実行結果で測る。
 *
 * 既存の mcp-server.spec.ts との違い:
 *   あちらは **melta の rules / components を temp root にコピーして** root 差し替えが
 *   効くことを見る。つまり「別の場所にある melta」であって第三者 DS ではない。
 *   こちらは語彙・トークン名前空間・クラス命名・ルール ID 接頭辞のすべてが melta と
 *   異なる bundle を食わせ、**melta のデータへ fallback したら落ちる**形で測る。
 *
 * S4（config resolver）で 4 層を書き換えるときの安全網でもある。
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const FIXTURE = resolve("tests/fixtures/external-ds/acme-ds");

/** fixture を temp へ複製する（テストが bundle を壊す側の検査でも本体を汚さない） */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "melta-external-ds-"));
  const root = join(dir, "acme-ds");
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

/** `src/index.ts --melta-root=<root>` を stdio MCP サーバーとして起動し、client を渡す */
async function withClient<T>(root: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "external-ds-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("src/index.ts"), `--melta-root=${root}`],
    cwd: resolve("."),
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** tool 呼び出しの本文（1 件目の text）を返す */
async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text?: string }>;
  };
  return result.content[0]?.text ?? "";
}

async function callJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  return JSON.parse(await callText(client, name, args)) as T;
}

/** scripts を外部 root に向けて実行し、終了コードと出力を返す */
function runScript(
  script: string,
  root: string,
  extraEnv: Record<string, string> = {},
  args: string[] = []
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", resolve(script), ...args],
      {
        cwd: resolve("."),
        env: { ...process.env, MELTA_ROOT: root, ...extraEnv },
        encoding: "utf-8",
        timeout: 60000,
      }
    );
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

interface LintViolation {
  ruleId: string;
  severity: string;
  token: string;
}

interface CheckHtmlResult {
  passed: boolean;
  errorCount: number;
  warnCount: number;
  violations: LintViolation[];
  coverage: { automated: string; notAutomated: string };
}

test.describe("外部 DS bundle: MCP 層", () => {
  test("get_token は acme のトークンを返し、melta のトークンには到達しない", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const token = await callJson<{ value: string; tailwind: string }>(client, "get_token", {
          path: "brand.ink",
        });
        expect(token).toEqual({ value: "#101820", tailwind: "text-ink" });

        // melta の代表トークン。解決できたらパッケージ相対 fallback が生きている
        const missing = await callText(client, "get_token", { path: "color.primary.600" });
        expect(missing).toContain("Token not found");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("get_component は acme の契約を返し、class と tailwind を同値で併記する（W3）", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const panel = await callJson<{
          id: string;
          variants: Array<{ name: string; class: string; tailwind: string }>;
        }>(client, "get_component", { id: "panel" });
        expect(panel.id).toBe("panel");
        expect(panel.variants.map((v) => v.name)).toEqual(["flat", "inset"]);
        // 契約側は class（正のキー）だけを宣言しているが、配布面では両キー同値で出る
        for (const variant of panel.variants) {
          expect(variant.class).toBe(variant.tailwind);
        }
        expect(panel.variants[0].class).toBe("bg-sand border border-ink/10");

        // 契約側が legacy の tailwind キーで書いていても同じ扱いになる
        const grid = await callJson<{
          variants: Array<{ name: string; class: string; tailwind: string }>;
        }>(client, "get_component", { id: "data-grid" });
        expect(grid.variants[0].class).toBe("acme-grid w-full text-ink");
        expect(grid.variants[0].tailwind).toBe(grid.variants[0].class);

        // melta の代表 component。見つかったら melta の metadata を読んでいる
        const missing = await callText(client, "get_component", { id: "button" });
        expect(missing).toContain("Component not found");
        expect(missing).toContain("この bundle の component は 2 件");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("search は acme の token と component の両方を引く", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const byToken = await callJson<{ results: Array<{ type: string; path?: string }> }>(
          client,
          "search",
          { query: "sand" }
        );
        expect(byToken.results).toContainEqual(
          expect.objectContaining({ type: "token", path: "brand.sand" })
        );

        const byComponent = await callJson<{ results: Array<{ type: string; id?: string }> }>(
          client,
          "search",
          { query: "grid" }
        );
        expect(byComponent.results).toContainEqual(
          expect.objectContaining({ type: "component", id: "data-grid" })
        );

        // melta の component 名では 1 件も引けない
        const foreign = await callJson<{ results: unknown[] }>(client, "search", {
          query: "sidebar",
        });
        expect(foreign.results).toHaveLength(0);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("get_rules は全 5 件を返し、category / severity / detector で絞り込める", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const all = await callJson<Array<{ id: string }>>(client, "get_rules", {});
        expect(all.map((r) => r.id).sort()).toEqual([
          "ACME_GRID_NEEDS_MARKER",
          "ACME_NO_LOUD_SHADOW",
          "ACME_NO_PURE_BLACK",
          "ACME_TABLE_HEADER_SCOPE",
          "ACME_VOICE_NO_SHOUTING",
        ]);

        // melta に存在しない category 語彙で絞れる（enum が閉じていたら 0 件になる）
        const byCategory = await callJson<Array<{ id: string }>>(client, "get_rules", {
          category: "data-table",
        });
        expect(byCategory.map((r) => r.id).sort()).toEqual([
          "ACME_GRID_NEEDS_MARKER",
          "ACME_TABLE_HEADER_SCOPE",
        ]);

        const bySeverity = await callJson<Array<{ id: string }>>(client, "get_rules", {
          severity: "error",
        });
        expect(bySeverity).toHaveLength(3);

        const byDetector = await callJson<Array<{ id: string }>>(client, "get_rules", {
          detector: "manual",
        });
        expect(byDetector.map((r) => r.id)).toEqual(["ACME_VOICE_NO_SHOUTING"]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("check_rule は acme のクラスを acme の代替案付きで違反にする", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const violations = await callJson<Array<{ ruleId: string; alternative: string }>>(
          client,
          "check_rule",
          { classes: "text-black shadow-2xl p-4" }
        );
        expect(violations.map((v) => v.ruleId).sort()).toEqual([
          "ACME_NO_LOUD_SHADOW",
          "ACME_NO_PURE_BLACK",
        ]);
        expect(violations.map((v) => v.alternative)).toContain("text-ink");

        // melta のルールに引っかかるクラスは acme bundle では素通りする
        const clean = await callText(client, "check_rule", { classes: "bg-gradient-to-r" });
        expect(clean).toBe("No violations found.");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("check_html は class / html-attr / composition の 3 経路で検出し、coverage が bundle の実数と一致する", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const source = readFileSync(join(root, "samples/violations.html"), "utf-8");
        const result = await callJson<CheckHtmlResult>(client, "check_html", { source });

        expect(result.violations.map((v) => v.ruleId).sort()).toEqual([
          "ACME_GRID_NEEDS_MARKER",
          "ACME_NO_LOUD_SHADOW",
          "ACME_NO_PURE_BLACK",
          "ACME_TABLE_HEADER_SCOPE",
        ]);
        expect(result.errorCount).toBe(3);
        expect(result.warnCount).toBe(1);
        expect(result.passed).toBe(false);
        // 5 ルール中、class 2（PURE_BLACK / LOUD_SHADOW）+ html-attr 1 + composition 1 = 4
        expect(result.coverage.automated).toBe(
          "5 ルール中 4 件を自動検査（class: 2 / html-attr: 1 / composition: 1）"
        );

        const clean = await callJson<CheckHtmlResult>(client, "check_html", {
          source: readFileSync(join(root, "samples/clean.html"), "utf-8"),
        });
        expect(clean.violations).toHaveLength(0);
        expect(clean.passed).toBe(true);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sourceType=jsx では composition 検査が走らず coverage もその分だけ減る", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const source = readFileSync(join(root, "samples/violations.html"), "utf-8");
        const result = await callJson<CheckHtmlResult>(client, "check_html", {
          source,
          sourceType: "jsx",
        });
        expect(result.violations.map((v) => v.ruleId)).not.toContain("ACME_GRID_NEEDS_MARKER");
        expect(result.coverage.automated).toBe(
          "5 ルール中 3 件を自動検査（class: 2 / html-attr: 1）"
        );
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resource は doc 非同梱なら 4 本、同梱すれば design-constitution が増える", async () => {
    const root = copyFixture();
    try {
      await withClient(root, async (client) => {
        const listed = (await client.listResources()) as { resources: Array<{ uri: string }> };
        expect(listed.resources.map((r) => r.uri)).toEqual([
          "melta://tokens",
          "melta://components",
          "melta://rules",
          "melta://rules/auto-detectable",
        ]);

        // 列挙された 4 本はすべて read できる（list と read の乖離が無いこと）
        for (const uri of listed.resources.map((r) => r.uri)) {
          const read = (await client.readResource({ uri })) as {
            contents: Array<{ text?: string }>;
          };
          expect(read.contents).toHaveLength(1);
          expect(read.contents[0].text ?? "").not.toBe("");
        }

        const tokens = (await client.readResource({ uri: "melta://tokens" })) as {
          contents: Array<{ text?: string }>;
        };
        expect(JSON.parse(tokens.contents[0].text ?? "{}")).toHaveProperty("brand.ink.value", "#101820");

        const rules = (await client.readResource({ uri: "melta://rules" })) as {
          contents: Array<{ text?: string }>;
        };
        expect(rules.contents[0].text ?? "").toContain("ACME_NO_PURE_BLACK");
      });

      // doc を足した bundle では capability が増える
      writeFileSync(join(root, "DESIGN.md"), "# acme design constitution\n\nacme sentinel\n", "utf-8");
      await withClient(root, async (client) => {
        const listed = (await client.listResources()) as { resources: Array<{ uri: string }> };
        expect(listed.resources.map((r) => r.uri)).toContain("melta://design-constitution");
        const doc = (await client.readResource({ uri: "melta://design-constitution" })) as {
          contents: Array<{ text?: string }>;
        };
        expect(doc.contents[0].text ?? "").toContain("acme sentinel");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("metadata が空の bundle は get_component だけが原因を診断する（search / resource は無言の 0 件）", async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, "metadata/components.json"),
      JSON.stringify({ version: "1.0.0", components: [] }),
      "utf-8"
    );
    try {
      await withClient(root, async (client) => {
        // contract は 2 件あるのに metadata が空 = ビルド未実行。
        // 「Component not found」だけだと原因に辿り着けないので導出物であることを明示する
        const result = (await client.callTool({
          name: "get_component",
          arguments: { id: "panel" },
        })) as { content: Array<{ text?: string }>; isError?: boolean };
        expect(result.isError).toBe(true);
        const message = result.content[0]?.text ?? "";
        expect(message).toContain("metadata/components.json に component が 1 件もありません");
        expect(message).toContain("MCP が読むのは contract ではなくこの導出物です");

        // ⚠️ ここから下は「現状こうである」を固定しているだけで、望ましい姿ではない。
        // search と components resource は「component を持たない DS」と
        // 「ビルド未実行で index が空」を区別できず、どちらも無言の 0 件を返す。
        // engine は contract を読まないため runtime には原理的に判別できず、
        // 解消は S3（resolved-bundle 検証）側の仕事。ここを ok と読み替えないこと
        const results = await callJson<{ results: unknown[] }>(client, "search", { query: "panel" });
        expect(results.results, "search が診断を返すようになったらこのテストを更新する").toHaveLength(0);

        const components = (await client.readResource({ uri: "melta://components" })) as {
          contents: Array<{ text?: string }>;
        };
        expect(JSON.parse(components.contents[0].text ?? "{}").components).toHaveLength(0);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("server 名と URI scheme を差し替えると melta ブランドが応答から消える", async () => {
    // fixture の他のテストは melta:// を前提にしている。engine 側のブランド非依存性は
    // データ差し替えとは別軸なので、ここで 1 本だけ端到端で押さえる
    const root = copyFixture();
    const client = new Client({ name: "external-ds-branding", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/index.ts"), `--melta-root=${root}`],
      cwd: resolve("."),
      env: { ...process.env, MELTA_SERVER_NAME: "acme-ds", MELTA_URI_SCHEME: "acme" } as Record<
        string,
        string
      >,
    });
    try {
      await client.connect(transport);
      const listed = (await client.listResources()) as { resources: Array<{ uri: string }> };
      const uris = listed.resources.map((r) => r.uri);
      expect(uris).toContain("acme://tokens");
      expect(uris.some((u) => u.startsWith("melta://"))).toBe(false);

      const instructions = client.getInstructions() ?? "";
      expect(instructions).toContain("acme://design-constitution");

      const read = (await client.readResource({ uri: "acme://rules" })) as {
        contents: Array<{ text?: string }>;
      };
      expect(read.contents[0].text ?? "").toContain("ACME_NO_PURE_BLACK");

      // resource URI だけ中立でも、tool の説明文に melta が残っていれば
      // 「データは差し替わったが公開面は melta のまま」になる。
      // クライアントが実際に受け取る面（instructions / tool 一覧 / resource 一覧）を
      // まとめて見て melta の不在を測る
      const tools = (await client.listTools()) as { tools: unknown[] };
      // 空の応答を検査して「melta 不在」と言わないための保険
      expect(tools.tools.length).toBeGreaterThan(0);
      expect(instructions.length).toBeGreaterThan(0);
      const surface = JSON.stringify({ instructions, tools, resources: listed });
      const meltaHits = [...surface.matchAll(/melta[\w-]*/gi)].map((m) => m[0]);
      expect(meltaHits, `公開面に melta が残っている: ${[...new Set(meltaHits)].join(", ")}`).toEqual(
        []
      );
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe("外部 DS bundle: lint / 設計検査の層", () => {
  test("lint CLI は外部 root のルールで検体を落とし、clean な検体は通す", () => {
    const root = copyFixture();
    try {
      const bad = runScript("scripts/design/lint-generated.ts", root, {}, [
        join(root, "samples/violations.html"),
      ]);
      expect(bad.status).toBe(1);
      // 報告されたルール ID を実際に抜き出して集合で照合する。
      // 「melta の ID が含まれない」を否定形の部分一致で書くと、書き方次第で
      // どの入力にもマッチしない no-op アサーション（常に緑）になりやすい
      const reported = [...bad.stdout.matchAll(/\[(?:error|warn)\]\s+([A-Z][A-Z0-9_]+):/g)].map(
        (m) => m[1]
      );
      expect([...new Set(reported)].sort()).toEqual([
        "ACME_GRID_NEEDS_MARKER",
        "ACME_NO_LOUD_SHADOW",
        "ACME_NO_PURE_BLACK",
        "ACME_TABLE_HEADER_SCOPE",
      ]);
      expect(bad.stdout).toContain("error 3 / warn 1");

      const good = runScript("scripts/design/lint-generated.ts", root, {}, [
        join(root, "samples/clean.html"),
      ]);
      expect(good.status).toBe(0);

      // 一部の引数だけ解決できないケースを「N 件走査して合格」にしない。
      // 従来は不在パスを黙って捨て、clean.html だけ見て exit 0 になっていた
      const partial = runScript("scripts/design/lint-generated.ts", root, {}, [
        join(root, "samples/clean.html"),
        join(root, "samples/typo-does-not-exist.html"),
      ]);
      expect(partial.status).toBe(2);
      expect(partial.stderr).toContain("指定されたのに見つからない検体があります");
      expect(partial.stderr).toContain("typo-does-not-exist.html");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("design:check は外部 bundle を 0 error で通し、skip した検査を skip と明示する", () => {
    const root = copyFixture();
    try {
      const result = runScript("scripts/design/validate.ts", root, {
        MELTA_VALIDATE_SKIP: "dtcg",
      });
      expect(result.status, result.stdout.slice(-2000)).toBe(0);
      expect(result.stdout).toContain("Errors: 0");
      expect(result.stdout).toContain("✅ PASSED");
      // 走らせていない検査を合格として数えない（skip は skip と出る）
      expect(result.stdout).toContain("⏭️  SKIP");
      expect(result.stdout).toContain("MELTA_VALIDATE_SKIP=dtcg");
      // app capability 非宣言の bundle に appStatus を要求しない（W2）
      expect(result.stdout).toContain("appStatus 宣言なし");
      // 語彙は acme のもので集計される（category enum が閉じていたら error になる）
      expect(result.stdout).toContain("brand-color: 1 件");
      expect(result.stdout).toContain("class 自動検出: 2 件 / spec 駆動検査: 2 件 / 静的検査対象外: 1 件");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dtcg を skip しない外部 bundle は黙って通らず error になる", () => {
    const root = copyFixture();
    try {
      const result = runScript("scripts/design/validate.ts", root);
      expect(result.status).not.toBe(0);
      // error() は stderr 側に出る
      expect(result.stdout + result.stderr).toContain("tokens.dtcg.json が存在しません");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("同梱の metadata / web recipes は契約からの再生成と一致する（fixture の鮮度）", () => {
    const root = copyFixture();
    try {
      const before = {
        components: readFileSync(join(root, "metadata/components.json"), "utf-8"),
        panel: readFileSync(join(root, "design/contracts/recipes/web/panel.recipe.json"), "utf-8"),
        grid: readFileSync(join(root, "design/contracts/recipes/web/data-grid.recipe.json"), "utf-8"),
      };

      expect(runScript("scripts/design/build-legacy.ts", root).status).toBe(0);
      expect(runScript("scripts/design/export-recipes.ts", root).status).toBe(0);

      expect(readFileSync(join(root, "metadata/components.json"), "utf-8")).toBe(before.components);
      expect(
        readFileSync(join(root, "design/contracts/recipes/web/panel.recipe.json"), "utf-8")
      ).toBe(before.panel);
      expect(
        readFileSync(join(root, "design/contracts/recipes/web/data-grid.recipe.json"), "utf-8")
      ).toBe(before.grid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("壊れた ruleset は外部 bundle でも無診断で素通りしない（S0 の端到端確認）", () => {
    const root = copyFixture();
    const rulesPath = join(root, "design/contracts/rules.json");
    const rules = JSON.parse(readFileSync(rulesPath, "utf-8")) as {
      rules: Array<Record<string, unknown>>;
    };
    // engine が実装していない detector。旧挙動では matches=false で
    // 「違反ゼロ・passed=true」になり、ルールが死んでいることに誰も気づけなかった
    rules.rules.push({
      id: "ACME_UNKNOWN_DETECTOR",
      category: "brand-color",
      severity: "error",
      description: "engine v1 が実装していない検出方式",
      detector: "css-in-js",
      pattern: "styled.div",
      alternative: "class で書く",
      contractLint: "skip",
    });
    writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf-8");
    try {
      const result = runScript("scripts/design/lint-generated.ts", root, {}, [
        join(root, "samples/clean.html"),
      ]);
      // 走査不能は 2（違反ありの 1 と区別する。not.toBe(0) だと取り違えても緑）
      expect(result.status).toBe(2);
      const output = result.stdout + result.stderr;
      expect(output).toContain("ACME_UNKNOWN_DETECTOR");
      expect(output).toContain("css-in-js");
      // 原因は ruleset。従来はこの診断が lintFile の catch に飲まれ、
      // 無関係な「HTML の読み込み失敗」に化けていた
      expect(output).toContain("ruleset を読み込めないため検査していません");
      expect(output).not.toContain("読み込み失敗で未走査のファイル");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hook モードは ruleset が壊れていても無言で通さず block を返す", () => {
    const root = copyFixture();
    const rulesPath = join(root, "design/contracts/rules.json");
    const rules = JSON.parse(readFileSync(rulesPath, "utf-8")) as {
      rules: Array<Record<string, unknown>>;
    };
    rules.rules.push({
      id: "ACME_UNKNOWN_DETECTOR",
      category: "brand-color",
      severity: "error",
      description: "engine v1 が実装していない検出方式",
      detector: "css-in-js",
      pattern: "styled.div",
      alternative: "class で書く",
      contractLint: "skip",
    });
    writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf-8");
    try {
      // hook は exit 0 が契約。fail-loud にできる経路は block 出力しかない
      const result = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "samples/clean.html"),
      ]);
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout) as { decision?: string; reason?: string };
      expect(payload.decision).toBe("block");
      expect(payload.reason).toContain("検査ゼロを合格として扱わない");
      expect(payload.reason).toContain("ACME_UNKNOWN_DETECTOR");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("実際の hook wrapper（shell）経由でも未検査が無言にならない", () => {
    // lint-generated.ts --hook を直接叩くテストだけでは足りない。
    // Claude Code が実際に起動するのは .claude/settings.json → hook-check-rule.sh で、
    // この wrapper が TS に到達する前に `[ -f ]` で無言 exit 0 していた
    // （＝ hookMain の未検査通知に永久に到達しない fail-open が wrapper 層に残っていた）
    const root = copyFixture();
    const runHook = (payload: unknown) => {
      try {
        const stdout = execFileSync("bash", [resolve("scripts/design/hook-check-rule.sh")], {
          cwd: resolve("."),
          env: { ...process.env, MELTA_ROOT: root },
          input: JSON.stringify(payload),
          encoding: "utf-8",
          timeout: 60000,
        });
        return { status: 0, stdout };
      } catch (e) {
        const err = e as { status: number | null; stdout?: string };
        return { status: err.status ?? -1, stdout: err.stdout ?? "" };
      }
    };

    try {
      // file_path が取れない（hook の配線ミス）
      const noPath = runHook({});
      expect(noPath.status).toBe(0);
      expect(noPath.stdout).toContain("hook に検体のパスが渡されていません");

      // 対象拡張子なのに実物が無い
      const missing = runHook({ file_path: join(root, "samples/typo-does-not-exist.html") });
      expect(missing.status).toBe(0);
      expect(missing.stdout).toContain("検体を解決できません");

      // 違反ありは従来どおり block（wrapper 経由でも enforcement が生きていること）
      const violating = runHook({ file_path: join(root, "samples/violations.html") });
      expect(violating.status).toBe(0);
      expect(
        (JSON.parse(violating.stdout) as { decision?: string; reason?: string }).decision
      ).toBe("block");
      expect(violating.stdout).toContain("ACME_NO_PURE_BLACK");

      // 対象外拡張子は従来どおり無言（tsx を起動しない足切り）
      const irrelevant = runHook({ file_path: join(root, "package.json") });
      expect(irrelevant.status).toBe(0);
      expect(irrelevant.stdout.trim()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hook モードは健全な bundle では従来どおり違反だけを block する", () => {
    const root = copyFixture();
    try {
      const violating = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "samples/violations.html"),
      ]);
      expect(violating.status).toBe(0);
      const payload = JSON.parse(violating.stdout) as { decision?: string; reason?: string };
      expect(payload.decision).toBe("block");
      expect(payload.reason).toContain("ACME_NO_PURE_BLACK");

      // 違反なしは出力なし（従来の契約を壊していないこと）
      const clean = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "samples/clean.html"),
      ]);
      expect(clean.status).toBe(0);
      expect(clean.stdout.trim()).toBe("");

      // 対象拡張子なのに実物が無い = 検査が走っていない。block はしないが黙りもしない
      const missing = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "samples/typo-does-not-exist.html"),
      ]);
      expect(missing.status).toBe(0);
      const missingPayload = JSON.parse(missing.stdout) as {
        decision?: string;
        hookSpecificOutput?: { additionalContext?: string };
      };
      expect(missingPayload.decision).toBeUndefined();
      expect(missingPayload.hookSpecificOutput?.additionalContext).toContain(
        "この書き込みは未検査です"
      );

      // .html という名前のディレクトリ（read 失敗の block ではなく未検査通知に寄せる）
      mkdirSync(join(root, "samples/as-dir.html"), { recursive: true });
      const dir = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "samples/as-dir.html"),
      ]);
      expect(dir.status).toBe(0);
      const dirPayload = JSON.parse(dir.stdout) as {
        decision?: string;
        hookSpecificOutput?: { additionalContext?: string };
      };
      expect(dirPayload.decision).toBeUndefined();
      expect(dirPayload.hookSpecificOutput?.additionalContext).toContain("検体を解決できません");

      // hook の配線ミス（file_path 未指定）も無言で通さない
      const noArg = runScript("scripts/design/lint-generated.ts", root, {}, ["--hook"]);
      expect(noArg.status).toBe(0);
      const noArgPayload = JSON.parse(noArg.stdout) as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      expect(noArgPayload.hookSpecificOutput?.additionalContext).toContain(
        "hook に検体のパスが渡されていません"
      );

      // 検査対象外の拡張子は従来どおり無言（ここまで喋ると全 Write でノイズになる）
      const irrelevant = runScript("scripts/design/lint-generated.ts", root, {}, [
        "--hook",
        join(root, "package.json"),
      ]);
      expect(irrelevant.status).toBe(0);
      expect(irrelevant.stdout.trim()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
