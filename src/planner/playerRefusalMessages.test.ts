import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import {
  aiPlanFailureMessage,
  orchestratorEmptyPlanMessage,
  orchestratorUnexpectedErrorMessage,
} from "./playerRefusalMessages.js";

const baseRequest: ChatCommandRequest = {
  requestId: "r1",
  player: {
    uuid: "u",
    name: "p",
    world: "world",
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "build a castle",
  recentMessages: [],
  localContext: {
    nearbyBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  },
  serverContext: {
    timestamp: "2026-01-01T00:00:00Z",
    dimension: "minecraft:overworld",
    onlinePlayerCount: 1,
  },
};

describe("aiPlanFailureMessage", () => {
  it("explains repeated assistant output failures without blaming the player", () => {
    const msg = aiPlanFailureMessage("assistant_failed_twice", baseRequest);
    expect(msg).toContain("couldn't lock in a valid build plan");
    expect(msg).toContain("castle");
    expect(msg).toContain("Try again");
  });

  it("explains step budget exhaustion with actionable hints", () => {
    const msg = aiPlanFailureMessage("max_steps", baseRequest);
    expect(msg).toContain("planning steps");
    expect(msg).toContain("smaller ask");
  });
});

describe("orchestratorEmptyPlanMessage", () => {
  it("names missing coordinates and suggests what to add", () => {
    const msg = orchestratorEmptyPlanMessage(baseRequest);
    expect(msg).toContain("placeable blocks");
    expect(msg).toContain("castle");
  });
});

describe("orchestratorUnexpectedErrorMessage", () => {
  it("truncates long error text", () => {
    const long = "x".repeat(300);
    const msg = orchestratorUnexpectedErrorMessage(long);
    expect(msg.length).toBeLessThan(long.length + 80);
    expect(msg).toContain("unexpected");
  });
});
