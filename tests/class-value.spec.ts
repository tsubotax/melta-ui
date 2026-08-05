/**
 * クラス文字列の読み口（class 正 / tailwind alias）の characterization test。
 * Phase 2 / S2 W3。実装を差し替える前に挙動を固定するために書いた。
 */

import { test, expect } from "@playwright/test";
import {
  ClassValueConflictError,
  emitClassValue,
  readClassValue,
  requireClassValue,
} from "../src/utils/class-value.js";

test.describe("readClassValue の真理値表", () => {
  test("class のみ → class を返す", () => {
    expect(readClassValue({ class: "bg-sand" }, "x")).toBe("bg-sand");
  });

  test("tailwind のみ → alias を受理する（既存 40 contracts の経路）", () => {
    expect(readClassValue({ tailwind: "bg-white" }, "x")).toBe("bg-white");
  });

  test("両方が同値 → 受理して class を返す（移行期の併記を許す）", () => {
    expect(readClassValue({ class: "p-4", tailwind: "p-4" }, "x")).toBe("p-4");
  });

  test("両方が異なる値 → 落ちる（どちらが正か決められない）", () => {
    let thrown: Error | null = null;
    try {
      readClassValue({ class: "p-4", tailwind: "p-6" }, "card.variants.basic");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown, "衝突が黙って片方採用されている").not.toBeNull();
    expect(thrown).toBeInstanceOf(ClassValueConflictError);
    expect(thrown!.message).toContain("card.variants.basic");
    expect(thrown!.message).toContain('"p-4"');
    expect(thrown!.message).toContain('"p-6"');
  });

  test("順序違いは「同じ」とみなさない（正本が 2 つになるため）", () => {
    expect(() => readClassValue({ class: "a b", tailwind: "b a" }, "x")).toThrow(
      /値が異なります/
    );
  });

  test("どちらも無い → undefined", () => {
    expect(readClassValue({ description: "x" }, "x")).toBeUndefined();
    expect(readClassValue(null, "x")).toBeUndefined();
    expect(readClassValue("string", "x")).toBeUndefined();
  });

  test("文字列でない値は宣言とみなさない", () => {
    expect(readClassValue({ class: 42 }, "x")).toBeUndefined();
    expect(readClassValue({ class: 42, tailwind: "p-4" }, "x")).toBe("p-4");
  });
});

test.describe("requireClassValue", () => {
  test("必須箇所で宣言が無ければ診断付きで落ちる", () => {
    expect(() => requireClassValue({ description: "x" }, "card.sizes.md")).toThrow(
      /card\.sizes\.md[\s\S]*class/
    );
  });

  test("alias だけでも満たす", () => {
    expect(requireClassValue({ tailwind: "h-10" }, "x")).toBe("h-10");
  });
});

test.describe("emitClassValue", () => {
  test("生成物には class と tailwind を同値で併記する", () => {
    expect(emitClassValue("inline-flex h-10")).toEqual({
      class: "inline-flex h-10",
      tailwind: "inline-flex h-10",
    });
  });
});
