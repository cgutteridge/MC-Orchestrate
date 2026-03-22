import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import { appendViewRequestFulfillment, buildInitialMessages, summarizeLastBuiltPlan } from "./prompt.js";
import type { Region } from "./schema.js";

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

  it("lists layerMap (not primitive ops) in the plan schema guide", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("\"layerMap\"");
    expect(system).toContain("\"layers\"");
    expect(system).toContain("LAYER MAPS ONLY");
    expect(system).not.toContain("\"fill_cuboid\"");
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

    expect(userContent).toContain("LAST BUILD SUMMARY");
    expect(userContent).toContain("intent=build_tower");
    expect(userContent).toContain("lastBuiltStructureSummary");
    expect(userContent).toContain("lastBuiltStructure");
  });

  it("includes a conversation history block when recentMessages is non-empty", () => {
    const messages = buildInitialMessages({
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
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 9, y: 70, z: 0 },
              block: "minecraft:stone_bricks",
            },
          ],
        },
      ],
      reply: "Done.",
      needsMoreInfo: false,
    });
    expect(line).toContain("intent=build_wall");
    expect(line).toContain("size=10×7×1");
    expect(line).toContain("passes=[walls]");
    expect(line).toContain("walls:");
  });

  it("sets lastBuiltStructure and lastBuiltStructureSummary to null when no previous plan is provided", () => {
    const messages = buildInitialMessages(request);
    const userContent = messages[1]?.content ?? "";

    expect(userContent).toContain("\"lastBuiltStructure\": null");
    expect(userContent).toContain("\"lastBuiltStructureSummary\": null");
  });

  it("system prompt contains placement ref enum and offset vocabulary", () => {
    const messages = buildInitialMessages(request);
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
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("CONVERSATION AND FOLLOW-UPS");
    expect(system).toContain("lastBuiltStructureSummary");
  });

  it("system prompt maps common directional phrases to placement fields", () => {
    const messages = buildInitialMessages(request);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("in front of me");
    expect(system).toContain("above me");
    expect(system).toContain("to my left");
    expect(system).toContain("a pit under me");
    expect(system).toContain("feet Y + 1");
  });

  it("user message contains a pre-computed placement reference card", () => {
    const messages = buildInitialMessages(request);
    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("PLACEMENT REFERENCE");
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

describe("appendViewRequestFulfillment", () => {
  const region: Region = {
    world: "world",
    min: { x: 0, y: 60, z: 0 },
    max: { x: 1, y: 61, z: 1 },
  };

  it("explains scan-unavailable when on-disk read cannot be used", () => {
    const messages: ChatMessage[] = [];
    appendViewRequestFulfillment(
      messages,
      '{"action":"view_request"}',
      "notes",
      region,
      undefined,
      {
        scanUnavailable: true,
        reason: "World region directory is missing or not readable.",
      },
    );
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("On-disk world scan is unavailable");
    expect(user).toContain("World region directory is missing");
  });
});
