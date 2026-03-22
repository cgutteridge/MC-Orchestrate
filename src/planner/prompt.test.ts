import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { buildInitialMessages } from "./prompt.js";

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

describe("buildInitialMessages", () => {
  it("includes recent player prompts for clarification follow-ups", () => {
    const messages = buildInitialMessages(request);

    // System message should reference recentMessages in its instructions.
    expect(messages[0]?.content).toContain("recentMessages");
    // System message should list symbolic material slots.
    expect(messages[0]?.content).toContain("material:wall");
    // User message should contain the serialized request including recentMessages.
    expect(messages[1]?.content).toContain("\"recentMessages\"");
    expect(messages[1]?.content).toContain("make me a cottage");
    expect(messages[1]?.content).toContain("actually smaller");
  });

  it("lists fill_cuboid and hollow_cuboid as distinct schema examples", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("\"fill_cuboid\"");
    expect(system).toContain("\"hollow_cuboid\"");
    expect(system).not.toContain("fill_cuboid | hollow_cuboid");
  });

  it("instructs the model to prefer symbolic slots over free-form block names", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("symbolic material slots");
    expect(system).not.toContain("Prefer concrete modern block ids");
  });

  it("explains the agentic loop actions (view_request and build)", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("view_request");
    expect(system).toContain("verifyRegion");
    expect(system).toContain("selfNotes");
    expect(system).toContain("VIEW_REQUEST");
    expect(system).toContain("BUILD");
  });

  it("injects a nearby material context card when structural blocks are present", () => {
    const messages = buildInitialMessages({
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 64, z: 0, type: "minecraft:stone_bricks" },
          { x: 1, y: 64, z: 0, type: "minecraft:stone_bricks" },
          { x: 2, y: 64, z: 0, type: "minecraft:cobblestone" },
          { x: 3, y: 64, z: 0, type: "minecraft:air" },
          { x: 4, y: 64, z: 0, type: "minecraft:grass_block" },
        ],
      },
    });

    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("Nearby materials:");
    expect(userContent).toContain("stone_bricks ×2");
    expect(userContent).toContain("cobblestone ×1");
    // Terrain blocks are excluded from the context card.
    expect(userContent).not.toContain("air ×");
    expect(userContent).not.toContain("grass_block ×");
  });

  it("omits the nearby context card when only terrain blocks are present", () => {
    const messages = buildInitialMessages({
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
      passes: [],
      reply: "Built a tower.",
      needsMoreInfo: false,
    };

    const messages = buildInitialMessages(request, lastPlan as never);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("build_tower");
    expect(userContent).toContain("lastBuiltStructure");
  });

  it("sets lastBuiltStructure to null when no previous plan is provided", () => {
    const messages = buildInitialMessages(request);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("\"lastBuiltStructure\": null");
  });

  it("includes a placement reference card with pre-computed anchor positions", () => {
    // Player at (10, 64, 20) looking south (+z), yaw=0, lookVector=(0,0,1)
    const req: ChatCommandRequest = {
      ...request,
      player: {
        ...request.player,
        position: { x: 10, y: 64, z: 20 },
        lookVector: { x: 0, y: 0, z: 1 },
      },
    };
    const messages = buildInitialMessages(req);
    const userContent = messages[1]?.content ?? "";

    // Card should be present
    expect(userContent).toContain("PLACEMENT REFERENCE");
    // Player feet
    expect(userContent).toContain("x=10 y=64 z=20");
    // 5 blocks in front = (10, 64, 25) since lookVector is (0,0,1)
    expect(userContent).toContain("(10, 64, 25)");
    // 10 blocks in front = (10, 64, 30)
    expect(userContent).toContain("(10, 64, 30)");
    // Cardinal hints
    expect(userContent).toContain("north");
    expect(userContent).toContain("south");
  });

  it("placement card left/right are perpendicular to look direction", () => {
    // Player looking east (+x), lookVector=(1,0,0)
    const req: ChatCommandRequest = {
      ...request,
      player: {
        ...request.player,
        position: { x: 0, y: 64, z: 0 },
        lookVector: { x: 1, y: 0, z: 0 },
      },
    };
    const messages = buildInitialMessages(req);
    const userContent = messages[1]?.content ?? "";

    // 5 blocks in front = (5, 64, 0)
    expect(userContent).toContain("(5, 64, 0)");
    // 5 blocks left (perpendicular: nhx=1,nhz=0 → left = -nhz=0, nhx=1 → (0,64,5))
    expect(userContent).toContain("(0, 64, 5)");
    // 5 blocks right → (0, 64, -5)
    expect(userContent).toContain("(0, 64, -5)");
  });

  it("system prompt explains how to resolve directional phrases", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("PLACEMENT AND OFFSETS");
    expect(system).toContain("in front of me");
    expect(system).toContain("to my left");
    expect(system).toContain("north");
    expect(system).toContain("above me");
    expect(system).toContain("PLACEMENT REFERENCE card");
  });

  it("includes initialScanRegion when present", () => {
    const messages = buildInitialMessages({
      ...request,
      initialScanRegion: { minX: -7, minY: 61, minZ: -7, maxX: 7, maxY: 69, maxZ: 7 },
    });
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("initialScanRegion");
    expect(userContent).toContain("-7");
  });
});
