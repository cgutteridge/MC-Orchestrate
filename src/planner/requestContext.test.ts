import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { normalizeBlockId, parseRequestedBlock } from "./materialPalette.js";
import {
  anchorPoint,
  defaultRegion,
  normalizeCuboid,
  normalizeRegion,
  parseRequestedHeight,
  structureAnchorPoint,
  structureCenterPoint,
  structureFootprintOrigin,
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
    timestamp: "2026-03-21T18:00:00Z",
    dimension: "minecraft:overworld",
    onlinePlayerCount: 1,
  },
};

describe("requestContext", () => {
  it("parses requested build hints from the user message", () => {
    expect(parseRequestedHeight("make a 12 block tower")).toBe(12);
    expect(parseRequestedBlock("build a glass tower")).toBe("minecraft:glass");
    expect(parseRequestedBlock("build a sheep statue from wool")).toBe("minecraft:white_wool");
    expect(normalizeBlockId("minecraft:wool")).toBe("minecraft:white_wool");
  });

  it("derives anchor points and default regions from player position", () => {
    expect(anchorPoint(request, 2)).toEqual({ x: -51, y: 113, z: -17 });
    expect(defaultRegion(request)).toEqual({
      world: "world",
      min: { x: -51, y: 113, z: -19 },
      max: { x: -51, y: 113, z: -19 },
    });
    expect(structureAnchorPoint(request, 4)).toEqual({
      x: -51,
      y: 114,
      z: -17,
    });
    expect(structureCenterPoint(request, 4)).toEqual({
      x: -51,
      y: 114,
      z: -17,
    });
    expect(structureFootprintOrigin(request, 7, 7, 2)).toEqual({
      x: -54,
      y: 114,
      z: -20,
    });
  });

  it("normalizes cuboids and regions with reversed coordinates", () => {
    expect(normalizeCuboid({ x: 5, y: 10, z: -2 }, { x: 1, y: 7, z: 4 })).toEqual({
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

  it("falls back to player yaw when the player is looking straight down", () => {
    const downwardRequest: ChatCommandRequest = {
      ...request,
      player: {
        ...request.player,
        yaw: 90,
        pitch: 90,
        lookVector: { x: 0.01, y: -1, z: 0.01 },
      },
      localContext: {
        ...request.localContext,
        targetBlock: undefined,
      },
    };

    expect(anchorPoint(downwardRequest, 4)).toEqual({
      x: -55,
      y: 113,
      z: -19,
    });
    expect(structureAnchorPoint(downwardRequest, 4)).toEqual({
      x: -55,
      y: 113,
      z: -19,
    });
    expect(structureFootprintOrigin(downwardRequest, 7, 7, 2)).toEqual({
      x: -60,
      y: 113,
      z: -22,
    });
  });

  it("anchors on replaceable target blocks instead of floating one block above them", () => {
    const grassTargetRequest: ChatCommandRequest = {
      ...request,
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: -51,
          y: 113,
          z: -17,
          type: "minecraft:short_grass",
        },
      },
    };

    expect(structureAnchorPoint(grassTargetRequest, 4)).toEqual({
      x: -51,
      y: 113,
      z: -17,
    });
  });
});
