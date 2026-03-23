import { describe, expect, it } from "vitest";
import type { BridgeCommand } from "../bridge/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { WorldReader } from "../world/worldReader.js";
import { Orchestrator } from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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
  message: "make me a cottage here",
  recentMessages: [],
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

/**
 * Wraps a bare Plan JSON in the `build` DesignStep wrapper.
 */
function buildStep(plan: Record<string, unknown>): string {
  return JSON.stringify({ action: "build", plan });
}

/** Design loop step 1 — matches production `buildPlacementPhaseMessages` system prompt. */
function placementChoiceStep(): string {
  return JSON.stringify({
    action: "placement_choice",
    placement: {
      ref: "player_view",
      forward: 8,
      back: 0,
      left: 0,
      right: 0,
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      up: 0,
      down: 0,
      desiredSize: { width: 16, depth: 16, height: 12 },
      verticalReference: "middle",
    },
  });
}

/** True when the system prompt is placement phase (full or minimal prompt mode). */
function isPlacementPhaseSystem(sys: string): boolean {
  return sys.includes("Step 1 of 2") || sys.toLowerCase().includes("step 1/2");
}

/**
 * Provider that answers placement phase then returns the given plan (two AI turns per request).
 */
function twoTurnProvider(plan: Record<string, unknown>): ChatProvider {
  return {
    name: "test",
    async chat(messages) {
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      if (isPlacementPhaseSystem(sys)) {
        return placementChoiceStep();
      }
      return buildStep(plan);
    },
  };
}

class FakeBridge {
  public readonly commands: BridgeCommand[] = [];
  public failOnCallNumber?: number;
  private callCount = 0;

  async executeCommand(command: BridgeCommand, _context?: unknown): Promise<void> {
    this.callCount += 1;
    if (this.failOnCallNumber === this.callCount) {
      throw new Error("bridge write failed");
    }
    this.commands.push(command);
  }

  getPlacedBlocks(): ReadonlyMap<string, string> {
    return new Map();
  }
}

/** A WorldReader that never performs real I/O. */
const fakeWorldReader: WorldReader = {
  readLevelMetadata: async () => undefined,
  readPlayerMetadata: async () => undefined,
  listRegionFiles: async () => [],
  readRegionBlocks: async () => undefined,
  readRegionBlocksOutcome: async () => ({
    ok: false,
    reason: "World region directory is missing or not readable.",
  }),
} as unknown as WorldReader;

// ---------------------------------------------------------------------------
// Helper to build a standard Orchestrator with fakes
// ---------------------------------------------------------------------------

function makeOrchestrator(provider: ChatProvider): {
  orchestrator: Orchestrator;
  bridge: FakeBridge;
} {
  const bridge = new FakeBridge();
  const orchestrator = new Orchestrator(bridge as never, fakeWorldReader, provider);
  return { orchestrator, bridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  it("returns rejected immediately when no AI provider is configured", async () => {
    const bridge = new FakeBridge();
    const orchestrator = new Orchestrator(bridge as never, fakeWorldReader);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("rejected");
    expect(response.reply).toContain("No AI builder is configured");
    // No bridge commands except none (the Thinking... say fires but FakeBridge
    // records all commands — it should be empty here since no provider fires it).
    expect(bridge.commands).toEqual([]);
  });

  it("sends a Thinking message before running the AI loop", async () => {
    const layer5 = "SSSSS\nSSSSS\nSSSSS\nSSSSS\nSSSSS";
    const provider = twoTurnProvider({
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 4, y: 68, z: 4 },
      },
      assumptions: [],
      passes: [
        {
          name: "walls",
          goal: "Build it.",
          primitives: [],
          layerMap: {
            layers: Array.from({ length: 5 }, () => layer5),
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Built a house.",
    });

    const { orchestrator, bridge } = makeOrchestrator(provider);
    await orchestrator.handleChatCommand(request);

    const sayCommands = bridge.commands.filter((c) => c.kind === "say");
    expect(sayCommands.length).toBeGreaterThanOrEqual(1);
    const thinkingMessage = sayCommands.find(
      (c) => c.kind === "say" && c.message.includes("Thinking"),
    );
    expect(thinkingMessage).toBeDefined();
  });

  it("returns rejected when the AI plan never validates (no executable layer maps after repair)", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return buildStep({
          intent: "unknown",
          passes: [
            {
              name: "cottage",
              goal: "Build a cottage.",
              primitives: [],
            },
          ],
          reply: "Your cottage is being built!",
        });
      },
    };
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("rejected");
    expect(response.reply).toContain("ran out of planning steps");
    const batchSets = bridge.commands.filter((c) => c.kind === "batchSet");
    expect(batchSets).toEqual([]);
  });

  it("replaces invalid block ids with stone, notifies the player, and still executes", async () => {
    const provider = twoTurnProvider({
      intent: "build_wall",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 0, y: 65, z: 0 },
      },
      assumptions: [],
      passes: [
        {
          name: "mystery",
          goal: "Build something.",
          primitives: [],
          layerMap: {
            layers: ["F", "F"],
            palette: { F: "sheep fluff", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building it.",
    });
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build something fluffy",
      recentMessages: ["make me a wall"],
    });

    expect(response.status).toBe("executed");
    const batchSets = bridge.commands.filter((c) => c.kind === "batchSet");
    expect(batchSets.some((c) => c.blocks.some((b) => b.type === "minecraft:stone"))).toBe(true);
    const says = bridge.commands.filter((c) => c.kind === "say").map((c) => c.message);
    expect(says.some((m) => m.includes("Invalid block id") && m.includes("stone"))).toBe(true);
  });

  it("rejects plans with more than two layer-map passes (semantics)", async () => {
    const layer3 = "SSS\nSSS\nSSS";
    const provider = twoTurnProvider({
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 66, z: 2 },
      },
      assumptions: [],
      passes: [
        {
          name: "a",
          goal: "First slice.",
          primitives: [],
          layerMap: {
            layers: [layer3],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
        {
          name: "b",
          goal: "Second slice.",
          primitives: [],
          layerMap: {
            layers: [layer3],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
        {
          name: "c",
          goal: "Third slice.",
          primitives: [],
          layerMap: {
            layers: [layer3],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Done.",
    });
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("rejected");
    expect(response.reply).toContain("more than two layer-map passes");
    const batchSets = bridge.commands.filter((c) => c.kind === "batchSet");
    expect(batchSets).toEqual([]);
  });

  it("reports the failed execution step back to Minecraft instead of masking it", async () => {
    const oneStone = {
      layers: ["S"],
      palette: { S: "minecraft:stone", _: "minecraft:air" },
    };
    const provider = twoTurnProvider({
      intent: "wall_patch",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 1, y: 64, z: 1 },
        max: { x: 2, y: 64, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "step_1",
          goal: "Lay first block.",
          primitives: [],
          layerMap: oneStone,
        },
        {
          name: "step_2",
          goal: "Lay second block.",
          primitives: [],
          layerMap: oneStone,
        },
      ],
      reply: "Done building.",
    });
    const bridge = new FakeBridge();
    // 1 Thinking, 2 Placement, 3 Building… (2 ops), 4 batchSet 1, 5 batchSet 2 fails.
    bridge.failOnCallNumber = 5;
    const orchestrator = new Orchestrator(bridge as never, fakeWorldReader, provider);

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build a tiny wall",
      recentMessages: ["make me a house"],
    });

    expect(response.status).toBe("error");
    expect(response.reply).toContain("Execution stopped");
    expect(response.reply).toContain("step 2 of 2");
    expect(response.reply).toMatch(/batch_set 1 block\(s\)/);
    expect(response.executedActions).toBe(1);
    expect(response.failedCommandSummary).toMatch(/batch_set 1 block\(s\)/);
    const sayCommands = bridge.commands.filter((c) => c.kind === "say");
    const errorSay = sayCommands.find(
      (c) => c.kind === "say" && c.message.includes("Execution stopped"),
    );
    expect(errorSay).toBeDefined();
  });

  it("announces bridge operation count before execution", async () => {
    const oneStone = {
      layers: ["S"],
      palette: { S: "minecraft:stone", _: "minecraft:air" },
    };
    const provider = twoTurnProvider({
      intent: "wall_patch",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 1, y: 64, z: 1 },
        max: { x: 2, y: 64, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "wall",
          goal: "Tiny wall.",
          primitives: [],
          layerMap: oneStone,
        },
        {
          name: "wall_b",
          goal: "Second block.",
          primitives: [],
          layerMap: oneStone,
        },
      ],
      reply: "Done building.",
    });
    const { orchestrator, bridge } = makeOrchestrator(provider);
    await orchestrator.handleChatCommand(request);

    const buildingSay = bridge.commands.find(
      (c) =>
        c.kind === "say" && c.message.includes("Building") && c.message.includes("2 operations"),
    );
    expect(buildingSay).toBeDefined();
  });

  it("returns cancelled when the abort signal is already set", async () => {
    const provider = twoTurnProvider({
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 1, y: 64, z: 0 },
      },
      assumptions: [],
      passes: [
        {
          name: "a",
          goal: "Block.",
          primitives: [],
          layerMap: {
            layers: ["S"],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Done.",
    });
    const { orchestrator } = makeOrchestrator(provider);
    const ac = new AbortController();
    ac.abort();

    const response = await orchestrator.handleChatCommand(request, { signal: ac.signal });

    expect(response.status).toBe("error");
    expect(response.reply).toContain("cancelled");
    expect(response.cancelled).toBe(true);
  });

  it("keeps the last built structure context across non-structure commands", async () => {
    // arrange — provider returns different plans based on the current message field.
    let towerBuilt = false;
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        const sys = messages.find((m) => m.role === "system")?.content ?? "";
        if (isPlacementPhaseSystem(sys)) {
          return placementChoiceStep();
        }
        // Placement phase embeds `message` in JSON; plan phase uses `Build request:`.
        const userContent = messages.find((m) => m.role === "user")?.content ?? "";
        const buildRequestMatch = /Build request:\s*([^\n]+)/.exec(userContent);
        const jsonMessageMatch = /"message"\s*:\s*"([^"]*)"/.exec(userContent);
        const currentMessage = (buildRequestMatch?.[1] ?? jsonMessageMatch?.[1] ?? "").trim();

        if (currentMessage.includes("delete this tree")) {
          const air3 = "___\n___\n___";
          return buildStep({
            intent: "remove_tree",
            targetWorld: "world",
            targetRegion: {
              world: "world",
              min: { x: 0, y: 64, z: 0 },
              max: { x: 2, y: 72, z: 2 },
            },
            assumptions: [],
            passes: [
              {
                name: "remove_logs",
                goal: "Clear volume to air.",
                primitives: [],
                layerMap: {
                  layers: Array.from({ length: 9 }, () => air3),
                  palette: { _: "minecraft:air" },
                },
              },
            ],
            reply: "Removing that tree.",
          });
        }
        if (currentMessage.includes("taller") && towerBuilt) {
          return buildStep({
            intent: "extend_tower",
            targetWorld: "world",
            targetRegion: {
              world: "world",
              min: { x: 0, y: 69, z: 0 },
              max: { x: 0, y: 70, z: 0 },
            },
            assumptions: [],
            passes: [
              {
                name: "extension",
                goal: "Extend tower upward.",
                primitives: [],
                layerMap: {
                  layers: ["W", "W"],
                  palette: { W: "minecraft:white_wool", _: "minecraft:air" },
                },
              },
            ],
            reply: "Extended by 2 blocks.",
          });
        }
        towerBuilt = true;
        return buildStep({
          intent: "build_tower",
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: 0, y: 64, z: 0 },
            max: { x: 0, y: 68, z: 0 },
          },
          assumptions: [],
          passes: [
            {
              name: "tower_column",
              goal: "Build the tower shaft.",
              primitives: [],
              layerMap: {
                layers: Array.from({ length: 5 }, () => "W"),
                palette: { W: "minecraft:white_wool", _: "minecraft:air" },
              },
            },
          ],
          reply: "Building a 5-block tower.",
        });
      },
    };
    const { orchestrator, bridge } = makeOrchestrator(provider);

    await orchestrator.handleChatCommand({
      ...request,
      message: "make me a wool tower here",
      recentMessages: [],
    });

    const removeTree = await orchestrator.handleChatCommand({
      ...request,
      message: "delete this tree",
      localContext: {
        ...request.localContext,
        targetBlock: { x: 2, y: 64, z: 2, type: "minecraft:oak_log" },
      },
      recentMessages: [],
    });

    const taller = await orchestrator.handleChatCommand({
      ...request,
      message: "make it taller by 2",
      recentMessages: [],
    });

    expect(removeTree.status).toBe("executed");
    expect(removeTree.intent).toBe("remove_tree");
    expect(taller.status).toBe("executed");
    expect(taller.reply).toContain("2 blocks");

    const batchSets = bridge.commands.filter((c) => c.kind === "batchSet");
    expect(batchSets.length).toBeGreaterThanOrEqual(2);
  });

  it("returns rejected when the assistant never returns usable JSON", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return "not json at all";
      },
    };
    const { orchestrator } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("rejected");
  });

  it("uses orchestrator-side recent history on subsequent requests", async () => {
    let seenUserContent = "";
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        const sys = messages.find((m) => m.role === "system")?.content ?? "";
        if (isPlacementPhaseSystem(sys)) {
          return placementChoiceStep();
        }
        // Capture the full user content so we can check for remembered messages.
        seenUserContent = messages.find((m) => m.role === "user")?.content ?? "";
        const layer5 = "SSSSS\nSSSSS\nSSSSS\nSSSSS\nSSSSS";
        return buildStep({
          intent: "build_house",
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: 0, y: 64, z: 0 },
            max: { x: 4, y: 68, z: 4 },
          },
          assumptions: [],
          passes: [
            {
              name: "walls",
              goal: "Build it.",
              primitives: [],
              layerMap: {
                layers: Array.from({ length: 5 }, () => layer5),
                palette: { S: "minecraft:stone", _: "minecraft:air" },
              },
            },
          ],
          reply: "Built.",
        });
      },
    };
    const { orchestrator } = makeOrchestrator(provider);

    await orchestrator.handleChatCommand({
      ...request,
      message: "build me a tower",
      recentMessages: [],
    });

    await orchestrator.handleChatCommand({
      ...request,
      message: "make it bigger",
      recentMessages: [],
    });

    // The second call's user content should contain "build me a tower" in the
    // recentMessages section, even though the plugin sent an empty list.
    expect(seenUserContent).toContain("build me a tower");
  });
});
