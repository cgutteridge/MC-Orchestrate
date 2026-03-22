import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesignLoop } from "../../src/planner/aiPlanner.js";
import {
  createReplayChatProvider,
  parseReplayFixture,
} from "../../src/services/ai/replayChatProvider.js";
import type { ChatCommandRequest } from "../../src/types/plugin.js";
import type { WorldReader } from "../../src/world/worldReader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fakeWorldReader: WorldReader = {
  readLevelMetadata: async () => undefined,
  readPlayerMetadata: async () => undefined,
  listRegionFiles: async () => [],
  readRegionBlocks: async () => undefined,
  readRegionBlocksOutcome: async () => ({
    ok: false,
    reason: "World region directory is missing or not readable.",
  }),
} as unknown as WorldReader;

const baselineRequest: ChatCommandRequest = {
  requestId: "azure-baseline-replay-1",
  player: {
    uuid: "u-baseline",
    name: "baseline",
    world: "world",
    position: { x: -51, y: 113, z: -19 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "make me a hollow glass cylinder here",
  recentMessages: [],
  localContext: {
    targetBlock: {
      x: -51,
      y: 113,
      z: -17,
      type: "minecraft:grass_block",
    },
    nearbyBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  },
  serverContext: {
    timestamp: "2026-03-22T12:00:00Z",
    dimension: "minecraft:overworld",
    onlinePlayerCount: 1,
  },
};

describe("Azure baseline replay fixtures", () => {
  it("replays v1 single-turn build and returns a validated plan", async () => {
    const raw = JSON.parse(
      await readFile(
        path.join(
          __dirname,
          "..",
          "..",
          "benchmark",
          "fixtures",
          "azure-baseline",
          "v1-single-turn-build.json",
        ),
        "utf8",
      ),
    );
    const fixture = parseReplayFixture(raw);
    const provider = createReplayChatProvider(fixture.assistantTurns);

    const result = await runDesignLoop(
      provider,
      baselineRequest,
      fakeWorldReader,
      undefined,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("build_cylinder");
    expect(result.placement.ref).toBe("player_view");
    expect(result.placement.forward).toBe(8);
    expect(result.plan.passes[0]?.primitives[0]).toMatchObject({
      type: "cylinder",
      block: "minecraft:glass",
      hollow: true,
    });
  });
});
