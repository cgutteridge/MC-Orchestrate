import { describe, expect, it } from "vitest";
import { isValidMinecraftBlockId } from "./materialPalette.js";

describe("isValidMinecraftBlockId", () => {
  it("accepts vanilla and mod-style namespace:path ids", () => {
    expect(isValidMinecraftBlockId("minecraft:stone")).toBe(true);
    expect(isValidMinecraftBlockId("minecraft:deepslate")).toBe(true);
    expect(isValidMinecraftBlockId("my_mod:custom_block")).toBe(true);
  });

  it("rejects block state syntax and malformed ids", () => {
    expect(isValidMinecraftBlockId("minecraft:oak_stairs[facing=north]")).toBe(false);
    expect(isValidMinecraftBlockId("stone")).toBe(false);
    expect(isValidMinecraftBlockId("minecraft:")).toBe(false);
    expect(isValidMinecraftBlockId("")).toBe(false);
  });
});
