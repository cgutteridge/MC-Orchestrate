import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { buildPlannerMessages } from "./prompt.js";

const request: ChatCommandRequest = {
  requestId: "req-1",
  player: {
    uuid: "u1",
    name: "cjg",
    world: "world",
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "five by five",
  recentMessages: ["make me a cottage", "use oak", "actually smaller"],
  localContext: {
    nearbyBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  },
  serverContext: {
    timestamp: "2026-03-21T18:00:00Z",
    dimension: "minecraft:overworld",
    onlinePlayerCount: 1,
  },
};

describe("buildPlannerMessages", () => {
  it("includes recent player prompts for clarification follow-ups", () => {
    const messages = buildPlannerMessages(request);

    expect(messages[0]?.content).toContain("recentMessages");
    expect(messages[0]?.content).toContain("material:wall");
    expect(messages[1]?.content).toContain("\"recentMessages\"");
    expect(messages[1]?.content).toContain("make me a cottage");
    expect(messages[1]?.content).toContain("actually smaller");
  });
});
