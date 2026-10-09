/**
 * benchmark-pipeline.spec.ts — ベンチ集計パイプラインの回帰テスト（P1-4 Slice 4）
 *
 * CI は live API を叩かない。代わりに (1) stats 純関数、(2) score（DS 準拠 proxy）の
 * gaming 耐性、(3) buildReport の集約・lift・prompt 等重みを検証し、scorer や集約
 * ロジックの回帰を防ぐ。実数値は anthropic provider の実測でのみ得る。
 *
 * mock provider のスコア順位（cold<designmd≤contracts≤full）は mock が自分でそう
 * 作っている tautology なので「効果の証明」ではなく、tool 切替と集約機構が動く
 * ことの smoke として扱う。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { summarize, computeLift } from "../design/benchmarks/stats.js";
import { scoreHTML } from "../design/benchmarks/score.js";
import { createMockProvider } from "../design/benchmarks/providers/mock.js";
import {
  buildReport,
  aggregateByCondition,
  buildConditionSet,
  extractQuickReference,
  type Cell,
} from "../design/benchmarks/runner.js";
import {
  BENCHMARK_PROTOCOL_VERSION,
  buildProvenance,
  extractGenerationSummary,
  hashBenchmarkTreatment,
  sha256,
  type GitInfo,
  type ProviderInfo,
} from "../design/benchmarks/provenance.js";
import { prompts as benchmarkPrompts } from "../design/benchmarks/prompts.js";
import { MCP_INSTRUCTIONS } from "../src/guidance.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readDesignMd = (): string => readFileSync(resolve(root, "DESIGN.md"), "utf-8");

test.describe("stats: 集計純関数", () => {
  test("summarize は mean/min/max/stdev/ci95/n を返す", () => {
    const s = summarize([80, 82, 85]);
    expect(s.n).toBe(3);
    expect(s.mean).toBeCloseTo(82.33, 1);
    expect(s.min).toBe(80);
    expect(s.max).toBe(85);
    expect(s.stdev).toBeGreaterThan(0);
    expect(s.ci95).toBeGreaterThan(0); // n>=2 で CI が出る
  });

  test("n=1 は stdev=0 / ci95=null（区間を主張しない）", () => {
    const s = summarize([90]);
    expect(s.n).toBe(1);
    expect(s.stdev).toBe(0);
    expect(s.ci95).toBeNull();
  });

  test("空配列はゼロ Summary", () => {
    expect(summarize([])).toEqual({ n: 0, mean: 0, min: 0, max: 0, stdev: 0, ci95: null });
  });

  test("computeLift は絶対差と相対％（base=0 は null）", () => {
    expect(computeLift(50, 80)).toEqual({ abs: 30, pct: 60 });
    expect(computeLift(0, 80)).toEqual({ abs: 80, pct: null });
  });
});

test.describe("score: DS 準拠 proxy の gaming 耐性", () => {
  test("コメントへの primary-500 埋め込みは加点されない", () => {
    const withComment = scoreHTML(
      '<!-- primary-500 rounded-xl shadow-sm aria-label scope="col" --><div class="p-4">x</div>'
    );
    const plain = scoreHTML('<div class="p-4">x</div>');
    expect(withComment.totalScore).toBe(plain.totalScore);
  });

  test("実 class 属性の準拠トークンは加点される", () => {
    const compliant = scoreHTML('<div class="rounded-xl shadow-sm border-slate-200">x</div>');
    const plain = scoreHTML('<div class="p-4">x</div>');
    expect(compliant.totalScore).toBeGreaterThan(plain.totalScore);
  });
});

test.describe("mock provider × scoreHTML: 条件切替の smoke", () => {
  const DESIGNMD = "あなたは melta UI デザインシステムに準拠した UI を生成するエキスパートです。Design Constitution";
  const CONTRACTS = DESIGNMD + "\n## Component Contracts（参考）";
  const FULL = `${MCP_INSTRUCTIONS}\n\n${CONTRACTS}`;
  const COLD = "あなたは UI を生成するエキスパートです。";

  test("cold < designmd ≤ contracts ≤ mcp-raw ≤ full", async () => {
    const p = createMockProvider();
    const cold = scoreHTML((await p.generate(COLD, "x", { useTools: false })).text).totalScore;
    const dm = scoreHTML((await p.generate(DESIGNMD, "x", { useTools: false })).text).totalScore;
    const ct = scoreHTML((await p.generate(CONTRACTS, "x", { useTools: false })).text).totalScore;
    const raw = scoreHTML((await p.generate(CONTRACTS, "x", { useTools: true })).text).totalScore;
    const full = scoreHTML((await p.generate(FULL, "x", { useTools: true })).text).totalScore;
    expect(cold).toBeLessThan(dm);
    expect(dm).toBeLessThanOrEqual(ct);
    expect(ct).toBeLessThanOrEqual(raw);
    expect(raw).toBeLessThanOrEqual(full);
  });

  test("initialize instructions が check_html 自己検証への到達を分離する", async () => {
    const p = createMockProvider();
    const raw = await p.generate(CONTRACTS, "x", { useTools: true });
    const full = await p.generate(FULL, "x", { useTools: true });
    const cold = await p.generate(COLD, "x", { useTools: false });
    expect(raw.toolCalls?.map((call) => call.name)).toEqual(["get_component"]);
    expect(raw.toolCalls?.map((call) => call.name)).not.toContain("check_html");
    expect(full.toolCalls?.map((call) => call.name)).toContain("check_html");
    expect((full.toolCalls ?? []).length).toBeGreaterThan(0);
    expect((cold.toolCalls ?? []).length).toBe(0);
  });
});

test.describe("buildReport: 集約・lift・prompt 等重み", () => {
  // 2 prompt（standard / red-team）× 2 条件の合成 Cell
  function cell(promptId: string, conditionId: "cold" | "mcp-raw" | "full", scores: number[]): Cell {
    return {
      promptId,
      conditionId,
      attempted: scores.length,
      failed: 0,
      refused: 0,
      trials: scores.map((s) => ({
        score: { totalScore: s, ruleViolations: 0, violationDetails: [], prohibitedPatterns: 0, patternDetails: [] },
        toolCalls: conditionId === "full" ? 1 : 0,
        toolNames: conditionId === "full" ? ["check_html"] : [],
        resources: [],
        htmlPath: "",
      })),
      summary: summarize(scores),
    };
  }

  test("aggregateByCondition は prompt 等重み（trial 数の偏りに引っ張られない）", () => {
    // prompt A は full で 10 trial・prompt B は 2 trial。flat 平均なら A に偏るが等重みなら 50:50
    const cells: Cell[] = [
      cell("1", "full", Array(10).fill(100)),
      cell("2", "full", [0, 0]),
    ];
    const agg = aggregateByCondition(cells, "full", ["1", "2"]);
    expect(agg.mean).toBe(50); // (100 + 0) / 2、trial 数に依存しない
  });

  test("standard と red-team を分離し lift を出す", () => {
    const std = benchmarkPrompts.find((p) => !p.isRedTeam)!;
    const red = benchmarkPrompts.find((p) => p.isRedTeam)!;
    const cells: Cell[] = [
      cell(std.id, "cold", [40]),
      cell(std.id, "full", [90]),
      cell(red.id, "cold", [20]),
      cell(red.id, "full", [80]),
    ];
    const { report, groups } = buildReport({
      cells,
      conditions: [
        { id: "cold", label: "cold", context: "", useTools: false },
        { id: "full", label: "full", context: "", useTools: true },
      ],
      prompts: [std, red],
      isoDate: "2026-01-01T00:00:00.000Z",
      providerId: "mock",
      modelName: null,
      trials: 1,
    });
    // 全体: cold=(40+20)/2=30, full=(90+80)/2=85
    expect(groups.all.cold.mean).toBe(30);
    expect(groups.all.full.mean).toBe(85);
    // standard / redteam グループが分かれている
    expect(groups.standard.full.mean).toBe(90);
    expect(groups.redteam.full.mean).toBe(80);
    expect(report).toContain("限界寄与");
    expect(report).toContain("initialize instructions");
    expect(report).toContain("check_html 到達");
    expect(report).toContain("MOCK FIXTURE — NOT EVIDENCE");
    expect(report).toContain("resource が MCP-only 利用者へ情報を届ける効果を測りません");
  });

  test("拒否で prompt が抜けた 2 条件の限界寄与は出さず、拒否数を表に残す", () => {
    const std = benchmarkPrompts.filter((p) => !p.isRedTeam).slice(0, 2);
    // prompt A: 両条件とも採点できた / prompt B: full では拒否されて採点が無い
    const refusedCell: Cell = { ...cell(std[1].id, "full", []), attempted: 1, refused: 1 };
    const cells: Cell[] = [
      cell(std[0].id, "cold", [40]),
      cell(std[1].id, "cold", [20]),
      cell(std[0].id, "full", [90]),
      refusedCell,
    ];
    const { report } = buildReport({
      cells,
      conditions: [
        { id: "cold", label: "cold", context: "", useTools: false },
        { id: "full", label: "full", context: "", useTools: true },
      ],
      prompts: std,
      isoDate: "2026-01-01T00:00:00.000Z",
      providerId: "mock",
      modelName: null,
      trials: 1,
    });
    // 母集団が違う（cold は 2 prompt、full は 1 prompt）ので lift を数字で出さない
    expect(report).toContain("cold→full 比較不能（採点できた prompt が違う: cold 2 / full 1）");
    expect(report).not.toMatch(/cold→full [+-]\d/);
    // 拒否は見出しの集計と条件表と prompt 別内訳の 3 か所に出る
    expect(report).toContain("失敗 0 / 拒否 1");
    expect(report).toMatch(/\*\*full\*\* \(full\) \| [^|]+\| 0 \/ 1 \|/);
    expect(report).toContain("— 拒否1");
  });

  test("採点できた prompt の集合が同じなら限界寄与は従来どおり数字で出る", () => {
    const std = benchmarkPrompts.find((p) => !p.isRedTeam)!;
    const cells: Cell[] = [cell(std.id, "cold", [40]), cell(std.id, "full", [90])];
    const { report } = buildReport({
      cells,
      conditions: [
        { id: "cold", label: "cold", context: "", useTools: false },
        { id: "full", label: "full", context: "", useTools: true },
      ],
      prompts: [std],
      isoDate: "2026-01-01T00:00:00.000Z",
      providerId: "mock",
      modelName: null,
      trials: 1,
    });
    expect(report).toMatch(/cold→full \+50/);
    expect(report).not.toContain("比較不能");
  });
});

test.describe("extractQuickReference: mcp-only の静的 context", () => {
  test("`## Quick Reference` 行から次の `## ` 見出しの直前までを返す", () => {
    const md = "## A\n...\n## Quick Reference\nx\ny\n## B\n...";
    expect(extractQuickReference(md)).toBe("## Quick Reference\nx\ny\n");
  });

  test("見出しが無ければ throw（全文へ fallback しない）", () => {
    expect(() => extractQuickReference("## A\nx\n## B\ny\n")).toThrow(/Quick Reference/);
  });

  test("次の `## ` 見出しが無ければ throw（節の終端が決まらない）", () => {
    expect(() => extractQuickReference("## A\n...\n## Quick Reference\nx\ny\n")).toThrow(
      /次の `## ` 見出し/
    );
  });

  test("実物の DESIGN.md: frontmatter を含まず、全文の 40% 未満に縮む", () => {
    const designMd = readDesignMd();
    const qr = extractQuickReference(designMd);
    expect(qr.startsWith("## Quick Reference\n")).toBe(true);
    // frontmatter は先頭の `---` から次の `---` 行まで。節末尾の `---` は次節との水平線なので許す
    const frontmatterEnd = designMd.indexOf("\n---\n", 4);
    expect(designMd.startsWith("---\n")).toBe(true);
    expect(frontmatterEnd).toBeGreaterThan(0);
    expect(designMd.indexOf(qr)).toBeGreaterThan(frontmatterEnd);
    expect(qr).not.toContain("version: alpha");
    // 全文への fallback（100%）を確実に弾き、入口が膨らんだら気づける閾値。
    // 実測 34.3%（6,273 / 18,292 字、2026-10-09）。frontmatter は 1 行が短く、行数比（約 24%）より大きく出る
    expect(qr.length).toBeLessThan(designMd.length * 0.4);
  });
});

test.describe("buildConditionSet: 条件の組み立て", () => {
  const designMd = readDesignMd();
  const input = { designMd, contractSummary: "### Button Contract (要約)" };

  test("6 条件を返し、mcp-only は最後で Quick Reference + tools + instructions", () => {
    const conditions = buildConditionSet(input, []);
    expect(conditions.map((c) => c.id)).toEqual([
      "cold",
      "designmd",
      "contracts",
      "mcp-raw",
      "full",
      "mcp-only",
    ]);
    const mcpOnly = conditions[conditions.length - 1];
    expect(mcpOnly.id).toBe("mcp-only");
    expect(mcpOnly.useTools && mcpOnly.useInstructions).toBe(true);
    expect(mcpOnly.context).toBe(extractQuickReference(designMd));
    const full = conditions.find((c) => c.id === "full")!;
    expect(mcpOnly.context).not.toBe(full.context);
  });

  test("filter は指定した条件だけを並び順を保って返す", () => {
    expect(buildConditionSet(input, ["mcp-only", "cold"]).map((c) => c.id)).toEqual([
      "cold",
      "mcp-only",
    ]);
  });
});

test.describe("provenance: 計測来歴（施策6A）", () => {
  const GIT: GitInfo = { commit: "a".repeat(40), dirty: true, dirtyFiles: ["DESIGN.md"] };
  const PROVIDER: ProviderInfo = {
    id: "anthropic",
    model: "claude-opus-5-5",
    temperature: null,
    temperatureSource: "provider-default",
    effort: null,
    effortSource: "api-default",
    trials: 3,
  };

  function prov(overrides: Partial<Parameters<typeof buildProvenance>[0]> = {}) {
    return buildProvenance({
      date: "2026-01-01T00:00:00.000Z",
      mode: "generate",
      git: GIT,
      contextHashes: { cold: sha256("") },
      treatmentHashes: { cold: hashBenchmarkTreatment("system", false) },
      fileHashes: { "design/contracts/rules.json": sha256("{}") },
      scoredFilesDigest: null,
      provider: PROVIDER,
      prompts: ["1"],
      conditions: ["cold"],
      cli: ["--prompt", "1"],
      generation: null,
      ...overrides,
    });
  }

  test("BENCHMARK_PROTOCOL_VERSION は 3（mcp-only 追加・既定モデル更新）", () => {
    expect(BENCHMARK_PROTOCOL_VERSION).toBe(3);
  });

  test("buildProvenance は必須キーを揃え、dirty / temperatureSource が伝播する", () => {
    const p = prov();
    expect(p.schemaVersion).toBe(2);
    expect(p.benchmarkProtocolVersion).toBe(BENCHMARK_PROTOCOL_VERSION);
    expect(p.git.dirty).toBe(true);
    expect(p.git.dirtyFiles).toEqual(["DESIGN.md"]);
    expect(p.provider.temperature).toBeNull();
    expect(p.provider.temperatureSource).toBe("provider-default"); // null は「provider 既定」の明示
    expect(p.inputHashes.contextByCondition.cold).toMatch(/^[0-9a-f]{64}$/);
    expect(p.inputHashes.treatmentByCondition.cold).toMatch(/^[0-9a-f]{64}$/);
    expect(p.generation).toBeNull();
  });

  test("treatment hash は instructions と tools 有無を独立変数として捕捉する", () => {
    const raw = hashBenchmarkTreatment("base system", true);
    const withInstructions = hashBenchmarkTreatment(
      `${MCP_INSTRUCTIONS}\n\nbase system`,
      true
    );
    const withoutTools = hashBenchmarkTreatment("base system", false);
    expect(withInstructions).not.toBe(raw);
    expect(withoutTools).not.toBe(raw);
  });

  test("extractGenerationSummary: generate 由来からは git/provider/inputHashes/date を要約", () => {
    const g = extractGenerationSummary(prov());
    expect(g?.date).toBe("2026-01-01T00:00:00.000Z");
    expect(g?.benchmarkProtocolVersion).toBe(BENCHMARK_PROTOCOL_VERSION);
    expect(g?.git.commit).toBe(GIT.commit);
    expect(g?.provider.model).toBe(PROVIDER.model);
  });

  test("extractGenerationSummary: score-dir 由来は generation を引き継ぐ（再帰肥大しない）", () => {
    const original = extractGenerationSummary(prov())!;
    const scoreDirProv = prov({ mode: "score-dir", generation: original });
    const g = extractGenerationSummary(scoreDirProv);
    // score-dir 実行自体の git ではなく、元の生成時来歴が返る。generation の generation は作らない
    expect(g).toEqual(original);
    expect((g as Record<string, unknown>).generation).toBeUndefined();
  });

  test("extractGenerationSummary: 不正・欠落は null（推測で埋めない）", () => {
    expect(extractGenerationSummary(null)).toBeNull();
    expect(extractGenerationSummary("broken")).toBeNull();
    expect(extractGenerationSummary({ mode: "generate" })).toBeNull(); // date/git/provider 欠落
    expect(extractGenerationSummary({ mode: "score-dir" })).toBeNull(); // 生成元不明の score-dir
  });

  test("extractGenerationSummary: 旧 provenance の protocol は推測せず null", () => {
    const legacy = {
      ...prov(),
      schemaVersion: 1,
      benchmarkProtocolVersion: undefined,
    };
    expect(extractGenerationSummary(legacy)?.benchmarkProtocolVersion).toBeNull();
  });

  test("buildReport: provenance 付きで commit 短縮 SHA と生成元不明の注記が出る", () => {
    const std = benchmarkPrompts.find((p) => !p.isRedTeam)!;
    const cells: Cell[] = [];
    const { report } = buildReport({
      cells,
      conditions: [{ id: "cold", label: "cold", context: "", useTools: false }],
      prompts: [std],
      isoDate: "2026-01-01T00:00:00.000Z",
      providerId: "score-dir",
      modelName: null,
      trials: 1,
      provenance: prov({ mode: "score-dir", generation: null }),
    });
    expect(report).toContain("**Commit**: aaaaaaa (dirty: 1 files)");
    expect(report).toContain("provenance 不明"); // 生成元が復元不能なことを隠さない
  });
});
