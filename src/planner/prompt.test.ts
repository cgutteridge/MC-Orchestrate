import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { DesignChoiceStep } from "./schema.js";
import {
  buildPlacementPhaseMessages,
  buildPlanPhaseSystemContent,
  buildPlanPhaseUserContent,
  hasSolidGroundBelowResolvedAnchor,
  summarizeLastBuiltPlan,
} from "./prompt.js";

const designFixture: DesignChoiceStep = {
  action: "design_choice",
  designSummary: "Test hut",
  builderGuide: "Small hut per request.",
  desiredSize: { width: 8, depth: 8, height: 6 },
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

describe("buildPlacementPhaseMessages (step 1)", () => {
  it("includes recent player prompts for clarification follow-ups", () => {
    const messages = buildPlacementPhaseMessages(request);

    expect(messages[0]?.content).toContain("lastBuiltStructureSummary");
    const planSystem = buildPlanPhaseSystemContent(request);
    expect(planSystem).toContain("minecraft:stone");
    expect(planSystem).not.toContain("=== MATERIALS (design step only) ===");
    expect(messages[1]?.content).toContain('"recentMessages"');
    expect(messages[1]?.content).toContain("make me a cottage");
    expect(messages[1]?.content).toContain("actually smaller");
  });

  it("does not inject nearby materials in placement (design phase owns material context)", () => {
    const messages = buildPlacementPhaseMessages({
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
    const messages = buildPlacementPhaseMessages({
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

  it("includes last built structure plan when provided", () => {
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
    };

    const messages = buildPlacementPhaseMessages(request, lastPlan as never);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("LAST BUILD SUMMARY");
    expect(userContent).toContain("intent=build_tower");
    expect(userContent).toContain("lastBuiltStructureSummary");
    expect(userContent).toContain("lastBuiltStructure");
  });

  it("includes a conversation history block when recentMessages is non-empty", () => {
    const messages = buildPlacementPhaseMessages({
      ...request,
      message: "make it taller",
      recentMessages: ["build a stone cottage"],
    });
    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("CONVERSATION HISTORY");
    expect(userContent).toContain("build a stone cottage");
    expect(userContent).toContain("make it taller");
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
    });
    expect(line).toContain("intent=build_wall");
    expect(line).toContain("size=10×7×1");
    expect(line).toContain("passes=[walls]");
    expect(line).toContain("walls:");
  });

  it("sets lastBuiltStructure and lastBuiltStructureSummary to null when no previous plan is provided", () => {
    const messages = buildPlacementPhaseMessages(request);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain('"lastBuiltStructure": null');
    expect(userContent).toContain('"lastBuiltStructureSummary": null');
  });

  it("system prompt contains placement ref enum and offset vocabulary", () => {
    const messages = buildPlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("player_view");
    expect(system).toContain("player_absolute");
    expect(system).toContain("focus");
    expect(system).toContain("last_build");
    expect(system).toContain("forward");
    expect(system).toContain("up");
    expect(system).toContain("north");
  });

  it("system prompt instructs the model to treat recentMessages as conversation context", () => {
    const messages = buildPlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("CONVERSATION AND FOLLOW-UPS");
    expect(system).toContain("lastBuiltStructureSummary");
  });

  it("system prompt maps common directional phrases to placement fields", () => {
    const messages = buildPlacementPhaseMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("in front of me");
    expect(system).toContain("above me");
    expect(system).toContain("to my left");
    expect(system).toContain("a pit under me");
    expect(system).toContain("feet Y + 1");
  });

  it("user message contains a pre-computed placement reference card", () => {
    const messages = buildPlacementPhaseMessages(request);
    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("PLACEMENT REFERENCE");
  });

  it("includes initialScanRegion when present", () => {
    const messages = buildPlacementPhaseMessages({
      ...request,
      initialScanRegion: { minX: -7, minY: 61, minZ: -7, maxX: 7, maxY: 69, maxZ: 7 },
    });
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("initialScanRegion");
    expect(userContent).toContain("-7");
  });
});

describe("buildPlanPhaseSystemContent (step 2)", () => {
  it("lists layerMap in the plan schema guide", () => {
    const system = buildPlanPhaseSystemContent(request);

    expect(system).toContain('"layerMap"');
    expect(system).toContain('"layers"');
    expect(system).toContain("LAYER MAPS ONLY");
    expect(system).not.toContain('"fill_cuboid"');
  });

  it("instructs the model to use concrete minecraft ids and mentions stone fallback", () => {
    const system = buildPlanPhaseSystemContent(request);

    expect(system).toContain("minecraft:");
    expect(system).toContain("minecraft:stone");
  });

  it("describes the build step and verifyRegion", () => {
    const system = buildPlanPhaseSystemContent(request);

    expect(system).toContain("verifyRegion");
    expect(system).toContain("Step 3 of 3");
    expect(system).toContain('"action":"build"');
  });
});

describe("plan phase user content (step 2)", () => {
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

  it("buildPlanPhaseUserContent omits terrain line when in air", () => {
    const text = buildPlanPhaseUserContent(
      { ...request, message: "a hut" },
      {
        ref: "player_view",
        forward: 0,
        back: 0,
        left: 0,
        right: 0,
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        up: 20,
        down: 0,
        verticalReference: "bottom",
        desiredSize: { width: 8, depth: 8, height: 6 },
      },
      designFixture,
      false,
    );
    expect(text).toContain("Volume:");
    expect(text).toContain("a hut");
    expect(text).not.toContain("Terrain:");
  });

  it("buildPlanPhaseUserContent includes terrain line when solid is below anchor", () => {
    const text = buildPlanPhaseUserContent(
      {
        ...request,
        message: "a hut",
        localContext: {
          ...request.localContext,
          nearbyBlocks: [{ x: 0, y: 63, z: 0, type: "minecraft:grass_block" }],
        },
      },
      {
        ref: "player_view",
        forward: 0,
        back: 0,
        left: 0,
        right: 0,
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        up: 0,
        down: 0,
        verticalReference: "bottom",
        desiredSize: { width: 8, depth: 8, height: 6 },
      },
      designFixture,
      true,
    );
    expect(text).toContain("Terrain:");
  });
});
