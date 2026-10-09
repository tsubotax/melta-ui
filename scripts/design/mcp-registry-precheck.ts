/**
 * mcp-registry-precheck.ts — 公式 MCP Registry へ公開してよいかの事前判定
 *
 * 背景: Registry の io.github.tsubotax/melta-ui は 1.3.0（2026-06-13）のまま止まり、npm は 1.8.0 まで
 * 進んでいた。Registry 公開が npm publish と連動しておらず、手元で mcp-publisher を叩く 1 手が
 * 4 か月抜け続けた（2026-10-09 に 1.8.0 を手動公開して解消）。
 *
 * .github/workflows/mcp-registry.yml から 2 つのモードで呼ぶ:
 *   - 公開判定（--version X.Y.Z）: workflow_dispatch の precheck job。結果を GITHUB_OUTPUT の action に書く
 *       skip    … Registry に同じ版が既にある（同じ版の再実行で赤くしない）
 *       publish … 版が揃っていて、npm に同じ版が mcpName 付きで出ている
 *       fail    … 版の食い違い / 待っても npm に出ない / 照会の失敗
 *   - 遅れ検知（--lag-check）: schedule の job。npm の latest が Registry に無ければ fail。公開はしない
 *
 * Registry は npm に同じ版（package.json の mcpName 入り）が無いと公開を拒否する。
 * npm 未公開は「待ってから fail」にする。dispatch は npm publish の直後に打たれるので反映遅れを吸収したい。
 * スキップ（緑）にすると npm publish の押し忘れが見えなくなる。
 *
 * 単独実行:
 *   npm run check:registry -- --version 1.8.0
 *   npm run check:registry -- --lag-check
 *   （--server-json / --package-json で照合する manifest を差し替えられる。陰性対照用）
 */

import { appendFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

export const NPM_REGISTRY = "https://registry.npmjs.org";
export const MCP_REGISTRY = "https://registry.modelcontextprotocol.io";
export const WORKFLOW_FILE = "mcp-registry.yml";

export interface ServerManifest {
  name?: string;
  version?: string;
  packages?: { registryType?: string; identifier?: string; version?: string }[];
}

export interface PackageManifest {
  name?: string;
  version?: string;
  mcpName?: string;
}

/** HTTP 照会の結果。通信そのものの失敗は status 0（error に理由） */
export interface Probe {
  status: number;
  body: unknown;
  error?: string;
}

export type Fetcher = (url: string) => Promise<Probe>;

export interface Decision {
  action: "publish" | "skip" | "fail";
  reasons: string[];
}

export interface LagResult {
  ok: boolean;
  reasons: string[];
}

export function registryVersionUrl(name: string, version: string): string {
  return `${MCP_REGISTRY}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
}

export function npmVersionUrl(pkgName: string, version: string): string {
  return `${NPM_REGISTRY}/${pkgName.replace("/", "%2F")}/${encodeURIComponent(version)}`;
}

function describe(probe: Probe): string {
  return probe.status === 0 ? `通信失敗: ${probe.error ?? "不明"}` : `HTTP ${probe.status}`;
}

/** server.json / package.json / 入力の版が揃っているか。食い違いを全部返す（空 = 一致） */
export function checkManifests(server: ServerManifest, pkg: PackageManifest, expectedVersion: string): string[] {
  const errors: string[] = [];
  if (!expectedVersion) {
    errors.push("公開する版（--version）が指定されていません");
  } else if (server.version !== expectedVersion) {
    errors.push(`入力の版 ${expectedVersion} ≠ server.json の version ${server.version}`);
  }
  if (server.version !== pkg.version) {
    errors.push(`server.json の version ${server.version} ≠ package.json の version ${pkg.version}`);
  }
  if (!server.name) {
    errors.push("server.json に name がありません");
  } else if (server.name !== pkg.mcpName) {
    errors.push(`server.json の name ${server.name} ≠ package.json の mcpName ${pkg.mcpName}`);
  }
  if (!pkg.name) errors.push("package.json に name がありません");
  const npmPackages = (server.packages ?? []).filter((p) => p.registryType === "npm");
  if (npmPackages.length === 0) errors.push("server.json の packages に registryType: npm がありません");
  for (const p of npmPackages) {
    if (p.identifier !== pkg.name) {
      errors.push(`server.json の packages[].identifier ${p.identifier} ≠ package.json の name ${pkg.name}`);
    }
    if (p.version !== pkg.version) {
      errors.push(`server.json の packages[].version ${p.version} ≠ package.json の version ${pkg.version}`);
    }
  }
  return errors;
}

export interface DecideOptions {
  server: ServerManifest;
  pkg: PackageManifest;
  version: string;
  fetcher: Fetcher;
  /** npm に版が出るまで待つ上限と照会間隔（秒） */
  waitSeconds: number;
  intervalSeconds: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export async function decidePublish(opts: DecideOptions): Promise<Decision> {
  const { server, pkg, version, fetcher, waitSeconds, intervalSeconds } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});

  const mismatches = checkManifests(server, pkg, version);
  if (mismatches.length > 0) return { action: "fail", reasons: mismatches };
  const name = server.name as string;
  const pkgName = pkg.name as string;

  // 1. Registry に同じ版が既にあれば何もしない
  const reg = await fetcher(registryVersionUrl(name, version));
  if (reg.status === 200) {
    const got = (reg.body as { server?: { version?: string } } | null)?.server?.version;
    if (got === version) return { action: "skip", reasons: [`Registry に ${name}@${version} は公開済み`] };
    return { action: "fail", reasons: [`Registry の応答の版 ${got} が要求した ${version} と食い違う`] };
  }
  if (reg.status !== 404) {
    return {
      action: "fail",
      reasons: [`Registry の照会に失敗（${describe(reg)}）。公開済みか判断できないので止める`],
    };
  }

  // 2. npm に同じ版が mcpName 付きで出るまで待つ
  const attempts = Math.floor(waitSeconds / intervalSeconds) + 1;
  for (let i = 1; i <= attempts; i++) {
    const res = await fetcher(npmVersionUrl(pkgName, version));
    if (res.status === 200) {
      const mcpName = (res.body as { mcpName?: string } | null)?.mcpName;
      if (mcpName !== name) {
        return {
          action: "fail",
          reasons: [`npm の ${pkgName}@${version} の mcpName が ${mcpName}（server.json は ${name}）。Registry が拒否する`],
        };
      }
      return {
        action: "publish",
        reasons: [`npm に ${pkgName}@${version}（mcpName ${name}）があり、Registry には未公開`],
      };
    }
    const retryable = res.status === 0 || res.status === 404 || res.status === 429 || res.status >= 500;
    if (!retryable) {
      return { action: "fail", reasons: [`npm の照会に失敗（${describe(res)}）`] };
    }
    if (i < attempts) {
      log(`npm に ${pkgName}@${version} がまだ無い（${describe(res)}）。${intervalSeconds} 秒後に再確認（${i}/${attempts}）`);
      await sleep(intervalSeconds * 1000);
    }
  }
  return {
    action: "fail",
    reasons: [
      `npm に ${pkgName}@${version} が ${waitSeconds} 秒待っても出ない。先に npm publish する（Registry は npm に無い版を拒否する）`,
    ],
  };
}

/** npm の latest が Registry に載っているか。公開はしない（押し忘れの検知だけ） */
export async function checkLag(server: ServerManifest, fetcher: Fetcher): Promise<LagResult> {
  const pkgName = server.packages?.find((p) => p.registryType === "npm")?.identifier;
  if (!server.name || !pkgName) {
    return { ok: false, reasons: ["server.json に name か registryType: npm の packages がありません"] };
  }
  const latest = await fetcher(npmVersionUrl(pkgName, "latest"));
  const version = (latest.body as { version?: string } | null)?.version;
  if (latest.status !== 200 || !version) {
    return { ok: false, reasons: [`npm の ${pkgName}@latest を取得できない（${describe(latest)}）`] };
  }
  const reg = await fetcher(registryVersionUrl(server.name, version));
  if (reg.status === 200) {
    return { ok: true, reasons: [`npm の latest ${pkgName}@${version} は Registry（${server.name}）に公開済み`] };
  }
  if (reg.status === 404) {
    return {
      ok: false,
      reasons: [
        `npm の latest ${pkgName}@${version} が Registry（${server.name}）に無い。npm publish 後の Registry 公開が抜けている`,
        `出す: gh workflow run ${WORKFLOW_FILE} -f version=${version}`,
      ],
    };
  }
  return { ok: false, reasons: [`Registry の照会に失敗（${describe(reg)}）`] };
}

export const httpFetcher: Fetcher = async (url) => {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // JSON でない応答（エラーページ等）は文字列のまま返す
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: (e as Error).message };
  }
};

interface CliArgs {
  version: string;
  lagCheck: boolean;
  serverJson: string;
  packageJson: string;
  waitSeconds: number;
  intervalSeconds: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    version: "",
    lagCheck: false,
    serverJson: resolve(root, "server.json"),
    packageJson: resolve(root, "package.json"),
    waitSeconds: 300,
    intervalSeconds: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} に値がありません`);
      return v;
    };
    const seconds = (): number => {
      const n = Number(value());
      if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} は 0 以上の秒数で指定する`);
      return n;
    };
    switch (flag) {
      case "--version":
        args.version = value();
        break;
      case "--lag-check":
        args.lagCheck = true;
        break;
      case "--server-json":
        args.serverJson = resolve(value());
        break;
      case "--package-json":
        args.packageJson = resolve(value());
        break;
      case "--wait-seconds":
        args.waitSeconds = seconds();
        break;
      case "--interval-seconds":
        args.intervalSeconds = seconds();
        if (args.intervalSeconds === 0) throw new Error("--interval-seconds は 1 以上で指定する");
        break;
      default:
        throw new Error(`未知のオプション: ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 2;
  }
  const server = JSON.parse(readFileSync(args.serverJson, "utf-8")) as ServerManifest;

  if (args.lagCheck) {
    const result = await checkLag(server, httpFetcher);
    for (const r of result.reasons) console.log(`  ${result.ok ? "✓" : "✗"} ${r}`);
    return result.ok ? 0 : 1;
  }

  const pkg = JSON.parse(readFileSync(args.packageJson, "utf-8")) as PackageManifest;
  const decision = await decidePublish({
    server,
    pkg,
    version: args.version,
    fetcher: httpFetcher,
    waitSeconds: args.waitSeconds,
    intervalSeconds: args.intervalSeconds,
    log: (line) => console.log(`  … ${line}`),
  });
  const mark = decision.action === "fail" ? "✗" : "✓";
  for (const r of decision.reasons) console.log(`  ${mark} ${r}`);
  console.log(`action=${decision.action}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision.action}\n`);
  return decision.action === "fail" ? 1 : 0;
}

// 単独実行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
