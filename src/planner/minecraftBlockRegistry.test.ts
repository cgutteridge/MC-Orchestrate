import { describe, expect, it } from "vitest";
import {
  MINECRAFT_BLOCK_IDS,
  MINECRAFT_DATA_VERSION,
  isVanillaMinecraftBlockId,
} from "./minecraftBlockRegistry.js";

describe("minecraftBlockRegistry", () => {
  it("pins a minecraft-data version and exposes many vanilla block ids", () => {
    expect(MINECRAFT_DATA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MINECRAFT_BLOCK_IDS.length).toBeGreaterThan(1000);
  });

  it("isVanillaMinecraftBlockId matches known blocks", () => {
    expect(isVanillaMinecraftBlockId("minecraft:stone")).toBe(true);
    expect(isVanillaMinecraftBlockId("minecraft:water")).toBe(true);
    expect(isVanillaMinecraftBlockId("not_a_namespace:id")).toBe(false);
  });
});
