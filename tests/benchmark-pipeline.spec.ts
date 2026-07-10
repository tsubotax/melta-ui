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

import { test, expect } from "@playwright/test";
import { summarize, computeLift } from "../design/benchmarks/stats.js";
import { scoreHTML } from "../design/benchmarks/score.js";
import { createMockProvider } from "../design/benchmarks/providers/mock.js";
import {
  buildReport,
  aggregateByCondition,
  type Cell,
} from "../design/benchmarks/runner.js";
import {
  buildProvenance,
  extractGenerationSummary,
  sha256,
  type GitInfo,
  type ProviderInfo,
} from "../design/benchmarks/provenance.js";
import { prompts as benchmarkPrompts } from "../design/benchmarks/prompts.js";

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
  const COLD = "あなたは UI を生成するエキスパートです。";

  test("cold < designmd ≤ contracts ≤ full", async () => {
    const p = createMockProvider();
    const cold = scoreHTML((await p.generate(COLD, "x", { useTools: false })).text).totalScore;
    const dm = scoreHTML((await p.generate(DESIGNMD, "x", { useTools: false })).text).totalScore;
    const ct = scoreHTML((await p.generate(CONTRACTS, "x", { useTools: false })).text).totalScore;
    const full = scoreHTML((await p.generate(CONTRACTS, "x", { useTools: true })).text).totalScore;
    expect(cold).toBeLessThan(dm);
    expect(dm).toBeLessThanOrEqual(ct);
    expect(ct).toBeLessThanOrEqual(full);
  });

  test("full は tools 使用・cold は不使用（useTools 切替が効く）", async () => {
    const p = createMockProvider();
    const full = await p.generate(CONTRACTS, "x", { useTools: true });
    const cold = await p.generate(COLD, "x", { useTools: false });
    expect((full.toolCalls ?? []).length).toBeGreaterThan(0);
    expect((cold.toolCalls ?? []).length).toBe(0);
  });
});

test.describe("buildReport: 集約・lift・prompt 等重み", () => {
  // 2 prompt（standard / red-team）× 2 条件の合成 Cell
  function cell(promptId: string, conditionId: "cold" | "full", scores: number[]): Cell {
    return {
      promptId,
      conditionId,
      attempted: scores.length,
      failed: 0,
      trials: scores.map((s) => ({
        score: { totalScore: s, ruleViolations: 0, violationDetails: [], prohibitedPatterns: 0, patternDetails: [] },
        toolCalls: conditionId === "full" ? 1 : 0,
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
    expect(report).toContain("自己検証"); // contracts→full の交絡注記が出る
  });
});

test.describe("provenance: 計測来歴（施策6A）", () => {
  const GIT: GitInfo = { commit: "a".repeat(40), dirty: true, dirtyFiles: ["DESIGN.md"] };
  const PROVIDER: ProviderInfo = {
    id: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: null,
    temperatureSource: "provider-default",
    trials: 3,
  };

  function prov(overrides: Partial<Parameters<typeof buildProvenance>[0]> = {}) {
    return buildProvenance({
      date: "2026-01-01T00:00:00.000Z",
      mode: "generate",
      git: GIT,
      contextHashes: { cold: sha256("") },
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

  test("buildProvenance は必須キーを揃え、dirty / temperatureSource が伝播する", () => {
    const p = prov();
    expect(p.schemaVersion).toBe(1);
    expect(p.git.dirty).toBe(true);
    expect(p.git.dirtyFiles).toEqual(["DESIGN.md"]);
    expect(p.provider.temperature).toBeNull();
    expect(p.provider.temperatureSource).toBe("provider-default"); // null は「provider 既定」の明示
    expect(p.inputHashes.contextByCondition.cold).toMatch(/^[0-9a-f]{64}$/);
    expect(p.generation).toBeNull();
  });

  test("extractGenerationSummary: generate 由来からは git/provider/inputHashes/date を要約", () => {
    const g = extractGenerationSummary(prov());
    expect(g?.date).toBe("2026-01-01T00:00:00.000Z");
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
