import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorldReader } from "../../src/world/worldReader.js";

describe("WorldReader.readRegionBlocksOutcome", () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it("returns ok:false when the world region directory does not exist", async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mcorch-world-"));
    const reader = new WorldReader(tmpRoot);
    const outcome = await reader.readRegionBlocksOutcome(
      {
        world: "world",
        min: { x: 0, y: 60, z: 0 },
        max: { x: 1, y: 61, z: 1 },
      },
      "world",
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("region");
    }
  });
});

/**
 * When a local Spigot/Paper world exists under `minecraft-server/world`, verify
 * that prismarine-nbt can read at least one chunk from disk (1.18+ palette format).
 */
describe.skipIf(!existsSync(path.join(process.cwd(), "minecraft-server", "world", "region")))(
  "WorldReader local world smoke (minecraft-server/world)",
  () => {
    it("reads spawn-adjacent region without marking the scan unavailable", async () => {
      const reader = new WorldReader(path.join(process.cwd(), "minecraft-server"));
      const outcome = await reader.readRegionBlocksOutcome(
        {
          world: "world",
          min: { x: -32, y: -64, z: -32 },
          max: { x: 32, y: 320, z: 32 },
        },
        "world",
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(Array.isArray(outcome.blocks)).toBe(true);
      }
    });
  },
);
