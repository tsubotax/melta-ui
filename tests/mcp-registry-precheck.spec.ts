/**
 * mcp-registry-precheck（MCP Registry 公開前の判定）の単体テスト。
 *
 * ネットワークには出ない。npm / Registry の応答は URL ごとに差し替える。
 * 「止まるべき状態で止まる」（版の食い違い・npm 未公開・mcpName 不一致・照会失敗）と
 * 「普通のリリースが通る」（npm 公開済み → publish、反映遅れを待って publish、公開済み → skip）を両方置く。
 */

import { test, expect } from "@playwright/test";
import {
  checkLag,
  checkManifests,
  decidePublish,
  npmVersionUrl,
  parseArgs,
  registryVersionUrl,
  type Fetcher,
  type PackageManifest,
  type Probe,
  type ServerManifest,
} from "../scripts/design/mcp-registry-precheck.js";

const NAME = "io.github.tsubotax/melta-ui";
const PKG = "melta-ds-mcp";

function manifests(v = "1.9.0"): { server: ServerManifest; pkg: PackageManifest } {
  return {
    server: { name: NAME, version: v, packages: [{ registryType: "npm", identifier: PKG, version: v }] },
    pkg: { name: PKG, version: v, mcpName: NAME },
  };
}

/** URL → 応答の列。同じ URL を複数回叩くと列を順に返し、最後の応答を繰り返す */
function fakeFetcher(routes: Record<string, Probe[]>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const seq = routes[url];
    if (!seq) throw new Error(`想定外の URL: ${url}`);
    const n = calls.filter((u) => u === url).length;
    return seq[Math.min(n, seq.length) - 1];
  }) as Fetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}

const NOT_FOUND: Probe = { status: 404, body: { detail: "not found" } };
const npmOk = (v: string, mcpName = NAME): Probe => ({ status: 200, body: { version: v, mcpName } });
const regOk = (v: string): Probe => ({ status: 200, body: { server: { name: NAME, version: v } } });

const noWait = { waitSeconds: 300, intervalSeconds: 20, sleep: async () => {} };

test.describe("checkManifests: 版の食い違いを全部挙げる", () => {
  test("揃っていれば空", () => {
    const { server, pkg } = manifests();
    expect(checkManifests(server, pkg, "1.9.0")).toEqual([]);
  });

  test("入力の版と server.json が違う", () => {
    const { server, pkg } = manifests();
    expect(checkManifests(server, pkg, "1.9.1")).toEqual(["入力の版 1.9.1 ≠ server.json の version 1.9.0"]);
  });

  test("入力の版が空", () => {
    const { server, pkg } = manifests();
    expect(checkManifests(server, pkg, "")).toEqual(["公開する版（--version）が指定されていません"]);
  });

  test("server.json と package.json の version が違う", () => {
    const { server, pkg } = manifests();
    pkg.version = "1.9.1";
    const errors = checkManifests(server, pkg, "1.9.0");
    expect(errors).toContain("server.json の version 1.9.0 ≠ package.json の version 1.9.1");
    expect(errors).toContain("server.json の packages[].version 1.9.0 ≠ package.json の version 1.9.1");
  });

  test("packages[].version だけ上げ忘れ", () => {
    const { server, pkg } = manifests();
    server.packages![0].version = "1.8.0";
    expect(checkManifests(server, pkg, "1.9.0")).toEqual([
      "server.json の packages[].version 1.8.0 ≠ package.json の version 1.9.0",
    ]);
  });

  test("mcpName と name の不一致 / identifier の不一致", () => {
    const { server, pkg } = manifests();
    pkg.mcpName = "io.github.someone/else";
    server.packages![0].identifier = "melta-contracts";
    const errors = checkManifests(server, pkg, "1.9.0");
    expect(errors).toContain(`server.json の name ${NAME} ≠ package.json の mcpName io.github.someone/else`);
    expect(errors).toContain("server.json の packages[].identifier melta-contracts ≠ package.json の name melta-ds-mcp");
  });

  test("name が両方とも無い（undefined 同士の一致で素通りしない）", () => {
    const { server, pkg } = manifests();
    delete server.name;
    delete pkg.mcpName;
    expect(checkManifests(server, pkg, "1.9.0")).toEqual(["server.json に name がありません"]);
  });

  test("npm の packages が無い", () => {
    const { server, pkg } = manifests();
    server.packages = [];
    expect(checkManifests(server, pkg, "1.9.0")).toEqual(["server.json の packages に registryType: npm がありません"]);
  });
});

test.describe("decidePublish", () => {
  test("npm にあり Registry に無い → publish", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
      [npmVersionUrl(PKG, "1.9.0")]: [npmOk("1.9.0")],
    });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d.action).toBe("publish");
  });

  test("Registry に公開済み → skip（npm は見に行かない）", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({ [registryVersionUrl(NAME, "1.9.0")]: [regOk("1.9.0")] });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d).toEqual({ action: "skip", reasons: [`Registry に ${NAME}@1.9.0 は公開済み`] });
    expect(fetcher.calls).toHaveLength(1);
  });

  test("版の食い違いはネットワークに出る前に fail", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({});
    const d = await decidePublish({ server, pkg, version: "1.9.1", fetcher, ...noWait });
    expect(d.action).toBe("fail");
    expect(fetcher.calls).toEqual([]);
  });

  test("npm にまだ無い → 待ってから fail（待った回数 = 300/20 + 1）", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
      [npmVersionUrl(PKG, "1.9.0")]: [NOT_FOUND],
    });
    const sleeps: number[] = [];
    const d = await decidePublish({
      server,
      pkg,
      version: "1.9.0",
      fetcher,
      waitSeconds: 300,
      intervalSeconds: 20,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(d.action).toBe("fail");
    expect(d.reasons[0]).toContain("300 秒待っても出ない");
    expect(fetcher.calls.filter((u) => u === npmVersionUrl(PKG, "1.9.0"))).toHaveLength(16);
    expect(sleeps).toEqual(Array(15).fill(20_000));
  });

  test("npm の反映遅れ（404 → 通信失敗 → 200）は待って publish", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
      [npmVersionUrl(PKG, "1.9.0")]: [NOT_FOUND, { status: 0, body: null, error: "ETIMEDOUT" }, npmOk("1.9.0")],
    });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d.action).toBe("publish");
  });

  test("npm の版に mcpName が無い → fail（Registry が拒否するので出さない）", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
      [npmVersionUrl(PKG, "1.9.0")]: [{ status: 200, body: { version: "1.9.0" } }],
    });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d.action).toBe("fail");
    expect(d.reasons[0]).toContain("mcpName が undefined");
  });

  test("Registry の照会が 500 → skip ではなく fail", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({ [registryVersionUrl(NAME, "1.9.0")]: [{ status: 500, body: "oops" }] });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d.action).toBe("fail");
  });

  test("npm の照会が 403 → 待たずに fail", async () => {
    const { server, pkg } = manifests();
    const fetcher = fakeFetcher({
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
      [npmVersionUrl(PKG, "1.9.0")]: [{ status: 403, body: "forbidden" }],
    });
    const d = await decidePublish({ server, pkg, version: "1.9.0", fetcher, ...noWait });
    expect(d).toEqual({ action: "fail", reasons: ["npm の照会に失敗（HTTP 403）"] });
  });
});

test.describe("checkLag: npm の latest が Registry にあるか", () => {
  const { server } = manifests();

  test("載っていれば ok", async () => {
    const fetcher = fakeFetcher({
      [npmVersionUrl(PKG, "latest")]: [npmOk("1.9.0")],
      [registryVersionUrl(NAME, "1.9.0")]: [regOk("1.9.0")],
    });
    expect((await checkLag(server, fetcher)).ok).toBe(true);
  });

  test("載っていなければ fail + 打つべき 1 行を出す", async () => {
    const fetcher = fakeFetcher({
      [npmVersionUrl(PKG, "latest")]: [npmOk("1.9.0")],
      [registryVersionUrl(NAME, "1.9.0")]: [NOT_FOUND],
    });
    const r = await checkLag(server, fetcher);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("出す: gh workflow run mcp-registry.yml -f version=1.9.0");
  });

  test("npm の latest が取れない → fail", async () => {
    const fetcher = fakeFetcher({ [npmVersionUrl(PKG, "latest")]: [{ status: 0, body: null, error: "ENOTFOUND" }] });
    expect((await checkLag(server, fetcher)).ok).toBe(false);
  });
});

test.describe("URL と引数", () => {
  test("Registry の server 名は / を %2F にする", () => {
    expect(registryVersionUrl(NAME, "1.8.0")).toBe(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.tsubotax%2Fmelta-ui/versions/1.8.0",
    );
    expect(npmVersionUrl(PKG, "1.8.0")).toBe("https://registry.npmjs.org/melta-ds-mcp/1.8.0");
  });

  test("未知のオプションと値の欠落は止める", () => {
    expect(() => parseArgs(["--versoin", "1.8.0"])).toThrow("未知のオプション");
    expect(() => parseArgs(["--version"])).toThrow("値がありません");
    expect(() => parseArgs(["--interval-seconds", "0"])).toThrow("1 以上");
  });
});
