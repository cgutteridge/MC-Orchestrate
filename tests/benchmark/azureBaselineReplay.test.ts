import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPlacementThenBuild } from "../../src/planner/aiPlanner.js";
import {
  createReplayChatProvider,
  parseReplayFixture,
} from "../../src/services/ai/replayChatProvider.js";
import type { ChatCommandRequest } from "../../src/types/plugin.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  it("replays v1 three-turn placement, design, then build and returns a validated plan", async () => {
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

    const result = await runPlacementThenBuild(provider, baselineRequest, undefined, undefined);

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("unknown");
    expect(result.placement.ref).toBe("player");
    expect(result.placement.frame).toBe("player");
    expect(result.placement.offset.F).toBe(8);
    expect(result.plan.passes[0]?.layerMap.palette.G).toBe("minecraft:glass");
  });
});
