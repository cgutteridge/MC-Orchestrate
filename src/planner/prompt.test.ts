import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { DesignChoiceStep } from "./schema.js";
import {
  composeLayerMapPhaseSystemContent,
  composeLayerMapPhaseUserContent,
  composePlacementPhaseMessages,
  hasSolidGroundBelowResolvedAnchor,
  summarizeLastBuiltPlan,
} from "./prompt.js";

const designFixture: DesignChoiceStep = {
  action: "design_choice",
  designSummary: "Test hut",
  builderGuide: "Small hut per request.",
  desiredSize: { width: 8, depth: 8, height: 6 },
  verticalReference: "on_ground",
  recommendedMaterials: ["minecraft:stone", "minecraft:oak_planks", "minecraft:air"],
};

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

describe("composePlacementPhaseMessages (step 1)", () => {
  it("uses the raw player message as placement user text (history lives on request.recentMessages only)", () => {
    const messages = composePlacementPhaseMessages(request);

    expect(messages[1]?.content).toBe("five by five");
    const planSystem = composeLayerMapPhaseSystemContent(request);
    expect(planSystem).toContain("minecraft:oak_planks");
    expect(planSystem).not.toContain("=== MATERIALS (design step only) ===");
  });

  it("does not inject nearby materials in placement (design phase owns material context)", () => {
    const messages = composePlacementPhaseMessages({
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 64, z: 0, type: "minecraft:stone_bricks" },
          { x: 1, y: 64, z: 0, type: "minecraft:stone_bricks" },
          { x: 2, y: 64, z: 0, type: "minecraft:cobblestone" },
        ],
      },
    });

    const userContent = messages[1]?.content ?? "";
    expect(userContent).not.toContain("Nearby materials:");
  });

  it("omits the nearby context card when only terrain blocks are present", () => {
    const messages = composePlacementPhaseMessages({
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 64, z: 0, type: "minecraft:air" },
          { x: 1, y: 64, z: 0, type: "minecraft:grass_block" },
          { x: 2, y: 64, z: 0, type: "minecraft:dirt" },
        ],
      },
    });

    expect(messages[1]?.content).not.toContain("Nearby materials:");
  });

  it("placement user text is unchanged when lastPlan is provided (lastPlan ignored for user string)", () => {
    const lastPlan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 72, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "main",
          goal: "Tower column.",
          layerMap: {
            layers: ["SSS", "SSS", "SSS"],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Built a tower.",
      briefFulfilment: "Tower column per prior build.",
    };

    const messages = composePlacementPhaseMessages(request, lastPlan as never);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toBe("five by five");
  });

  it("does not embed recentMessages in placement user text", () => {
    const messages = composePlacementPhaseMessages({
      ...request,
      message: "make it taller",
      recentMessages: ["build a stone cottage"],
    });
    const userContent = messages[1]?.content ?? "";
    expect(userContent).toBe("make it taller");
  });

  it("summarizeLastBuiltPlan describes intent, footprint, and pass goals", () => {
    const line = summarizeLastBuiltPlan({
      intent: "build_wall",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 9, y: 70, z: 0 },
      },
      assumptions: [],
      passes: [
        {
          name: "walls",
          goal: "Raise the east wall using stone bricks.",
          layerMap: {
            layers: ["BBBBBBBBBB"],
            palette: { B: "minecraft:stone_bricks", _: "minecraft:air" },
          },
        },
      ],
      reply: "Done.",
      briefFulfilment: "Stone-brick wall layer matches span and height requested.",
    });
    expect(line).toContain("intent=build_wall");
    expect(line).toContain("size=10×7×1");
    expect(line).toContain("passes=[walls]");
    expect(line).toContain("walls:");
  });

  it("system prompt contains placement ref enum and offset vocabulary", () => {
    const messages = composePlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("ref: player | focus");
    expect(system).toContain("focus");
    expect(system).toContain("frame");
    expect(system).toContain("F");
    expect(system).toContain("UP");
    expect(system).toContain("N");
  });

  it("placement system prompt describes anchor JSON and directional hints", () => {
    const messages = composePlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("Infer placement intent");
    expect(system).toContain("ref: player | focus");
  });

  it("system prompt maps common directional phrases to placement fields", () => {
    const messages = composePlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("in front of me");
    expect(system).toContain("Up in the sky");
    expect(system).toContain("to my left");
    expect(system).toContain("NE");
    expect(system).toContain("Signed axis meanings");
  });

  it("does not embed initialScanRegion in placement user text", () => {
    const messages = composePlacementPhaseMessages({
      ...request,
      initialScanRegion: { minX: -7, minY: 61, minZ: -7, maxX: 7, maxY: 69, maxZ: 7 },
    });
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toBe("five by five");
  });
});

describe("composeLayerMapPhaseSystemContent (step 3)", () => {
  it("lists layers, palette, and briefFulfilment for the model", () => {
    const system = composeLayerMapPhaseSystemContent(request);

    expect(system).toContain('"layers"');
    expect(system).toContain('"palette"');
    expect(system).toContain("briefFulfilment");
    expect(system).toContain("serializes");
    expect(system).toContain("expert Minecraft architect");
    expect(system).toContain("WORKED EXAMPLE");
    expect(system).toContain("CCGGGCC");
    expect(system).not.toContain('"fill_cuboid"');
    expect(system).not.toContain('"action"');
  });

  it("instructs the model to use concrete minecraft ids in the worked example palette", () => {
    const system = composeLayerMapPhaseSystemContent(request);

    expect(system).toContain("minecraft:");
    expect(system).toContain("minecraft:cobblestone");
  });

  it("asks how the diagram fulfils the design (briefFulfilment) without an action key", () => {
    const system = composeLayerMapPhaseSystemContent(request);

    expect(system).toContain("implement the design");
    expect(system).not.toContain('"action"');
    expect(system).toContain("larger than the requested build volume by 2 blocks");
    expect(system).toContain("modify or replace existing ground blocks");
  });

  it("does not ask the model for targetWorld or targetRegion in the plan schema guide", () => {
    const system = composeLayerMapPhaseSystemContent(request);

    expect(system).not.toContain('"targetWorld"');
    expect(system).not.toContain('"targetRegion"');
  });
});

describe("composeLayerMapPhaseUserContent (step 3)", () => {
  it("hasSolidGroundBelowResolvedAnchor is true when solid exists within 6 blocks below anchor", () => {
    const r = {
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [{ x: 0, y: 63, z: 0, type: "minecraft:grass_block" }],
      },
    };
    expect(hasSolidGroundBelowResolvedAnchor(r, { x: 0, y: 65, z: 0 })).toBe(true);
  });

  it("hasSolidGroundBelowResolvedAnchor is false when only air below anchor in sample", () => {
    const r = {
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 63, z: 0, type: "minecraft:air" },
          { x: 0, y: 62, z: 0, type: "minecraft:air" },
        ],
      },
    };
    expect(hasSolidGroundBelowResolvedAnchor(r, { x: 0, y: 65, z: 0 })).toBe(false);
  });

  it("composeLayerMapPhaseUserContent includes design summary and volume line (no terrain suffix in user text)", () => {
    const placement = {
      ref: "player" as const,
      frame: "player" as const,
      offset: { F: 0, R: 0, N: 0, E: 0, UP: 20 },
      verticalReference: "on_ground" as const,
      desiredSize: { width: 8, depth: 8, height: 6 },
    };
    const text = composeLayerMapPhaseUserContent(placement, designFixture);
    expect(text).toContain("voxel grid should fill the volume");
    expect(text).toContain(designFixture.designSummary);
    expect(text).not.toContain("Terrain:");
  });

  it("includes oversized existing-world context instructions and serialized layer map when provided", () => {
    const placement = {
      ref: "player" as const,
      frame: "player" as const,
      offset: { F: 0, R: 0, N: 0, E: 0, UP: 20 },
      verticalReference: "on_ground" as const,
      desiredSize: { width: 8, depth: 8, height: 6 },
    };
    const text = composeLayerMapPhaseUserContent(placement, designFixture, {
      layers: ["AB\n__"],
      palette: { A: "minecraft:stone", B: "minecraft:dirt", _: "minecraft:air" },
    });
    expect(text).toContain("EXISTING_WORLD_CONTEXT");
    expect(text).toContain("2 blocks larger");
    expect(text).toContain('"layers":["AB\\n__"]');
    expect(text).toContain("Output only the target build volume");
  });
});
