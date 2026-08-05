/**
 * contract が持つ「クラス文字列」の単一の読み口（Phase 2 / S2 W3）。
 *
 * 背景: component contract は variants / sizes / stateSpecs / anatomy /
 * iconButton / iconTextPadding にクラス文字列を持つが、フィールド名が
 * `tailwind` に固定されていた。値は単なる class token 列なのに、
 * **フィールド名だけが第三者 DS に melta の技術選択を強制していた**。
 *
 * 決定（D3）: `class` を正、`tailwind` を deprecated alias にする。
 * alias は additive なので既存 40 contracts は無変更で通る。
 * 削除は Phase 3 Stage 3（major）。
 *
 * ここを唯一の読み口にする理由: 読み口が散っていると
 * 「class で書いた contract が lint 対象から静かに消える」「生成物に
 * undefined が入る」といった、S0 以降ずっと潰してきた形の穴が再発する。
 */

/** 両方宣言されていて値が違うときのエラー（どちらが正か決められない = 評価不能） */
export class ClassValueConflictError extends Error {
  constructor(path: string, classValue: string, tailwindValue: string) {
    super(
      `[melta-ui] ${path}: class と tailwind の両方が宣言されていますが値が異なります。\n` +
        `  class    = ${JSON.stringify(classValue)}\n` +
        `  tailwind = ${JSON.stringify(tailwindValue)}\n` +
        "  どちらが正か決められないため評価できません。" +
        "tailwind は deprecated alias なので、片方だけにするか同じ値にしてください。"
    );
  }
}

/**
 * クラス文字列を読む。宣言が無ければ undefined。
 *
 * | class | tailwind | 結果 |
 * |---|---|---|
 * | あり | なし | class |
 * | なし | あり | tailwind（alias を受理） |
 * | 同値 | 同値 | class |
 * | 異なる | 異なる | **throw** |
 * | なし | なし | undefined |
 *
 * 比較は文字列の完全一致。空白正規化や token 集合比較で「同じ」とみなすと
 * 正本が 2 つになるため、順序差も不一致として扱う。
 */
export function readClassValue(node: unknown, path: string): string | undefined {
  if (node == null || typeof node !== "object") return undefined;
  const rec = node as Record<string, unknown>;
  const classValue = typeof rec.class === "string" ? rec.class : undefined;
  const tailwindValue = typeof rec.tailwind === "string" ? rec.tailwind : undefined;

  if (classValue != null && tailwindValue != null) {
    if (classValue !== tailwindValue) {
      throw new ClassValueConflictError(path, classValue, tailwindValue);
    }
    return classValue;
  }
  return classValue ?? tailwindValue;
}

/** クラス文字列が必須の箇所で使う。宣言が無ければ診断付きで落とす */
export function requireClassValue(node: unknown, path: string): string {
  const value = readClassValue(node, path);
  if (value == null) {
    throw new Error(
      `[melta-ui] ${path}: クラス文字列がありません（class か、deprecated alias の tailwind が必要）。`
    );
  }
  return value;
}

/**
 * 生成物へ書き出すときの形。
 * `class` を正とし、`tailwind` は互換のため同値で併記する
 * （metadata/components.json は MCP の配布面なので、片方だけにすると
 *   既存消費者を壊すか、公開面に技術強制が残るかのどちらかになる）。
 */
export function emitClassValue(value: string): { class: string; tailwind: string } {
  return { class: value, tailwind: value };
}
