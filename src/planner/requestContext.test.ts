import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import {
  anchorPoint,
  defaultRegion,
  normalizeCuboid,
  normalizeRegion,
  parseRequestedBlock,
  parseRequestedHeight,
} from "./requestContext.js";

const request: ChatCommandRequest = {
  requestId: "req-1",
  player: {
    uuid: "u1",
    name: "cjg",
    world: "world",
    position: { x: -51.2, y: 113.1, z: -19.4 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "",
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

describe("requestContext", () => {
  it("parses requested build hints from the user message", () => {
    expect(parseRequestedHeight("make a 12 block tower")).toBe(12);
    expect(parseRequestedBlock("build a glass tower")).toBe("minecraft:glass");
  });

  it("derives anchor points and default regions from player position", () => {
    expect(anchorPoint(request, 2)).toEqual({ x: -51, y: 113, z: -17 });
    expect(defaultRegion(request)).toEqual({
      world: "world",
      min: { x: -51, y: 113, z: -19 },
      max: { x: -51, y: 113, z: -19 },
    });
  });

  it("normalizes cuboids and regions with reversed coordinates", () => {
    expect(
      normalizeCuboid({ x: 5, y: 10, z: -2 }, { x: 1, y: 7, z: 4 }),
    ).toEqual({
      from: { x: 1, y: 7, z: -2 },
      to: { x: 5, y: 10, z: 4 },
    });

    expect(
      normalizeRegion({
        world: "world",
        min: { x: 5, y: 10, z: -2 },
        max: { x: 1, y: 7, z: 4 },
      }),
    ).toEqual({
      world: "world",
      min: { x: 1, y: 7, z: -2 },
      max: { x: 5, y: 10, z: 4 },
    });
  });
});
