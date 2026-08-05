import { loadTokens, loadComponents } from "../utils/loader.js";
import { readClassValue } from "../utils/class-value.js";

interface SearchResult {
  type: "token" | "component";
  path?: string;
  id?: string;
  name?: string;
  data: unknown;
}

/** 1 回の検索で返す最大件数（コンテキスト圧迫防止。超過分は truncated で通知） */
const MAX_RESULTS = 20;

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  /** total > MAX_RESULTS のとき true。クエリを絞ることを促す */
  truncated: boolean;
}

/**
 * Search tokens and components by query string.
 * Matches against keys, names, descriptions, and tailwind values.
 */
export function search(query: string): SearchResponse {
  const q = query.trim().toLowerCase();
  // 空クエリは全件マッチして 100+ 件返ってしまうため reject する
  if (q.length === 0) {
    return { results: [], total: 0, truncated: false };
  }
  const results: SearchResult[] = [];

  // Search tokens
  const tokens = loadTokens();
  searchTokenObject(tokens, "", q, results);

  // Search components
  const components = loadComponents();
  for (const comp of components.components) {
    // anatomy / stateSpecs（P2-1）も索引する。anatomy は string[] か part→AnatomyPart の object、
    // stateSpecs は state→StateSpec の object。description を拾って discoverability を上げる。
    const anatomyText = Array.isArray(comp.anatomy)
      ? comp.anatomy.join(" ")
      : Object.entries(comp.anatomy ?? {})
          .map(([part, p]) => `${part} ${p.description ?? ""} ${readClassValue(p, part) ?? ""}`)
          .join(" ");
    // variant は `name + tailwind` を索引しているので、stateSpec / anatomy の差分クラスも
    // tailwind まで索引してパリティを取る（"cursor-not-allowed" 等のクラスで該当コンポーネントを引ける）
    const stateSpecText = Object.entries(comp.stateSpecs ?? {})
      .map(([state, s]) => `${state} ${s.description ?? ""} ${readClassValue(s, state) ?? ""}`)
      .join(" ");
    const searchable = [
      comp.id,
      comp.name,
      comp.description,
      comp.category,
      ...comp.variants.map((v) => `${v.name} ${readClassValue(v, v.name) ?? ""}`),
      ...(comp.states ?? []),
      stateSpecText,
      anatomyText,
    ]
      .join(" ")
      .toLowerCase();

    if (searchable.includes(q)) {
      results.push({
        type: "component",
        id: comp.id,
        name: comp.name,
        data: comp,
      });
    }
  }

  return {
    results: results.slice(0, MAX_RESULTS),
    total: results.length,
    truncated: results.length > MAX_RESULTS,
  };
}

function searchTokenObject(
  obj: unknown,
  path: string,
  query: string,
  results: SearchResult[]
): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== "object") return;

  // Skip version field
  if (path === "" && "version" in (obj as Record<string, unknown>)) {
    const { version: _, ...rest } = obj as Record<string, unknown>;
    obj = rest;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Check if this is a leaf token (has "value" or "tailwind")
    if (
      value &&
      typeof value === "object" &&
      ("value" in value || "tailwind" in value)
    ) {
      const searchable = [
        currentPath,
        String((value as Record<string, unknown>).value ?? ""),
        String(readClassValue(value, "token") ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      if (searchable.includes(query)) {
        results.push({
          type: "token",
          path: currentPath,
          data: value,
        });
      }
    } else if (typeof value === "object") {
      // Recurse into nested objects
      searchTokenObject(value, currentPath, query, results);
    }
  }
}
