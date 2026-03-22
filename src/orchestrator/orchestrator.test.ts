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

class FakeBridge {
  public readonly commands: BridgeCommand[] = [];
  public failOnCallNumber?: number;
  private callCount = 0;

  async executeCommand(command: BridgeCommand): Promise<void> {
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
} as unknown as WorldReader;

// ---------------------------------------------------------------------------
// Helper to build a standard Orchestrator with fakes
// ---------------------------------------------------------------------------

function makeOrchestrator(provider: ChatProvider): { orchestrator: Orchestrator; bridge: FakeBridge } {
  const bridge = new FakeBridge();
  const orchestrator = new Orchestrator(bridge as never, fakeWorldReader, provider);
  return { orchestrator, bridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  it("returns needs_more_info immediately when no AI provider is configured", async () => {
    const bridge = new FakeBridge();
    const orchestrator = new Orchestrator(bridge as never, fakeWorldReader);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("needs_more_info");
    expect(response.reply).toContain("AI service is not configured");
    // No bridge commands except none (the Thinking... say fires but FakeBridge
    // records all commands — it should be empty here since no provider fires it).
    expect(bridge.commands).toEqual([]);
  });

  it("sends a Thinking message before running the AI loop", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
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
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 4, y: 68, z: 4 },
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Built a house.",
          needsMoreInfo: false,
        });
      },
    };

    const { orchestrator, bridge } = makeOrchestrator(provider);
    await orchestrator.handleChatCommand(request);

    const sayCommands = bridge.commands.filter((c) => c.kind === "say");
    expect(sayCommands.length).toBeGreaterThanOrEqual(1);
    const thinkingMessage = sayCommands.find((c) =>
      c.kind === "say" && c.message.includes("Thinking"),
    );
    expect(thinkingMessage).toBeDefined();
  });

  it("returns needs_more_info when the AI plan loses all executable primitives", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return buildStep({
          intent: "unknown",
          passes: [
            {
              name: "cottage",
              goal: "Build a cottage.",
              primitives: [{ type: "fill_cuboid" }],
            },
          ],
          reply: "Your cottage is being built!",
          needsMoreInfo: false,
        });
      },
    };
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("needs_more_info");
    expect(response.reply).toContain("more concrete");
    const fillCommands = bridge.commands.filter((c) => c.kind === "fill");
    expect(fillCommands).toEqual([]);
  });

  it("returns needs_more_info when plan materials cannot be resolved safely", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return buildStep({
          intent: "build_tower",
          passes: [
            {
              name: "mystery",
              goal: "Build something.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 0, y: 65, z: 0 },
                  block: "sheep fluff",
                },
              ],
            },
          ],
          reply: "Building it.",
          needsMoreInfo: false,
        });
      },
    };
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build something fluffy",
      recentMessages: ["make me a tower"],
    });

    // "sheep fluff" is either rejected by material resolution or dropped by
    // repair (leaving empty passes). Either way status must be needs_more_info.
    expect(response.status).toBe("needs_more_info");
    const fillCommands = bridge.commands.filter((c) => c.kind === "fill");
    expect(fillCommands).toEqual([]);
  });

  it("rejects a plan that would undo its own earlier build steps", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return buildStep({
          intent: "build_house",
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: 0, y: 64, z: 0 },
            max: { x: 6, y: 70, z: 6 },
          },
          assumptions: [],
          passes: [
            {
              name: "build",
              goal: "Build walls.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 6, y: 70, z: 6 },
                  block: "minecraft:stone",
                },
              ],
            },
            {
              name: "undo",
              goal: "Clear the same region.",
              primitives: [
                {
                  type: "clear_region",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 6, y: 70, z: 6 },
                },
              ],
            },
          ],
          reply: "Done.",
          needsMoreInfo: false,
        });
      },
    };
    const { orchestrator, bridge } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("rejected");
    expect(response.reply).toContain("undo");
    const fillCommands = bridge.commands.filter((c) => c.kind === "fill");
    expect(fillCommands).toEqual([]);
  });

  it("reports the failed execution step back to Minecraft instead of masking it", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return buildStep({
          intent: "build_house",
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
              primitives: [
                { type: "set_block", x: 1, y: 64, z: 1, block: "minecraft:stone" },
              ],
            },
            {
              name: "step_2",
              goal: "Lay second block.",
              primitives: [
                { type: "set_block", x: 2, y: 64, z: 1, block: "minecraft:stone" },
              ],
            },
          ],
          reply: "Done building.",
          needsMoreInfo: false,
        });
      },
    };
    const bridge = new FakeBridge();
    // Call 1 = Thinking say, call 2 = setBlock (step_1) success,
    // call 3 = setBlock (step_2) — fails.
    bridge.failOnCallNumber = 3;
    const orchestrator = new Orchestrator(bridge as never, fakeWorldReader, provider);

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build a tiny wall",
      recentMessages: ["make me a house"],
    });

    expect(response.status).toBe("error");
    expect(response.reply).toContain("Step 2 of 2 failed");
    const sayCommands = bridge.commands.filter((c) => c.kind === "say");
    const errorSay = sayCommands.find(
      (c) => c.kind === "say" && c.message.includes("Step 2 of 2 failed"),
    );
    expect(errorSay).toBeDefined();
  });

  it("keeps the last built structure context across non-structure commands", async () => {
    // arrange — provider returns different plans based on the current message field.
    let towerBuilt = false;
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        // Check only the `message` field in the first user message to avoid
        // false matches against recentMessages history.
        const userContent = messages.find((m) => m.role === "user")?.content ?? "";
        const currentMessageMatch = /"message"\s*:\s*"([^"]*)"/.exec(userContent);
        const currentMessage = currentMessageMatch?.[1] ?? "";

        if (currentMessage.includes("delete this tree")) {
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
                goal: "Remove logs.",
                primitives: [
                  {
                    type: "replace_in_region",
                    from: { x: 0, y: 64, z: 0 },
                    to: { x: 2, y: 72, z: 2 },
                    fromBlock: "minecraft:oak_log",
                    toBlock: "minecraft:air",
                  },
                ],
              },
            ],
            reply: "Removing that tree.",
            needsMoreInfo: false,
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
                primitives: [
                  {
                    type: "fill_cuboid",
                    from: { x: 0, y: 69, z: 0 },
                    to: { x: 0, y: 70, z: 0 },
                    block: "minecraft:white_wool",
                  },
                ],
              },
            ],
            reply: "Extended by 2 blocks.",
            needsMoreInfo: false,
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
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 0, y: 68, z: 0 },
                  block: "minecraft:white_wool",
                },
              ],
            },
          ],
          reply: "Building a 5-block tower.",
          needsMoreInfo: false,
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

    const fillCommands = bridge.commands.filter((c) => c.kind === "fill");
    expect(fillCommands.length).toBeGreaterThanOrEqual(2);
  });

  it("returns needs_more_info when the loop budget is exhausted (no valid JSON)", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return "not json at all";
      },
    };
    const { orchestrator } = makeOrchestrator(provider);

    const response = await orchestrator.handleChatCommand(request);

    expect(response.status).toBe("needs_more_info");
  });

  it("uses orchestrator-side recent history on subsequent requests", async () => {
    let seenUserContent = "";
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        // Capture the full user content so we can check for remembered messages.
        seenUserContent = messages.find((m) => m.role === "user")?.content ?? "";
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
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 4, y: 68, z: 4 },
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Built.",
          needsMoreInfo: false,
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
