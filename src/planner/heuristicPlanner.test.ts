import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { buildHeuristicPlan } from "./heuristicPlanner.js";

const baseRequest: ChatCommandRequest = {
  requestId: "req-1",
  player: {
    uuid: "u1",
    name: "cjg",
    world: "world",
    position: { x: -51, y: 113, z: -19 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "",
  localContext: {
    targetBlock: {
      x: -51,
      y: 113,
      z: -17,
      type: "minecraft:oak_log",
    },
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

describe("buildHeuristicPlan", () => {
  it("builds a tower plan from a direct request", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "make me a 5 block stone tower here",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("build_tower");
    expect(plan?.passes).toHaveLength(1);
    expect(plan?.reply).toContain("5-block tower");
  });

  it("builds a remove tree plan when the player is looking at a tree", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "delete this tree",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("remove_tree");
    expect(plan?.passes.length).toBeGreaterThan(0);
  });

  it("builds a multi-pass house plan", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "make me a house here",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("build_house");
    expect(plan?.passes.map((pass) => pass.name)).toEqual([
      "site_prep",
      "foundation",
      "walls",
      "openings",
      "roof",
    ]);
  });

  it("returns undefined for unsupported requests", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "write me a poem",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan).toBeUndefined();
  });
});
