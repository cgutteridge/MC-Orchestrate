import { describe, expect, it } from "vitest";
import type { BridgeCommand } from "../bridge/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import { Orchestrator } from "./orchestrator.js";

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
}

describe("Orchestrator", () => {
  it("falls back to heuristic follow-up planning when AI provider fails", async () => {
    let callCount = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        callCount += 1;
        if (callCount === 1) {
          return JSON.stringify({
            intent: "build_structure",
            targetWorld: "world",
            targetRegion: {
              world: "world",
              min: { x: 0, y: 64, z: 0 },
              max: { x: 0, y: 68, z: 0 },
            },
            assumptions: [],
            passes: [
              {
                name: "base",
                goal: "Build structure.",
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
            reply: "Built.",
            needsMoreInfo: false,
          });
        }
        return "not json";
      },
    };

    const bridge = new FakeBridge();
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    await orchestrator.handleChatCommand({
      ...request,
      message: "build me a column",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    const second = await orchestrator.handleChatCommand({
      ...request,
      message: "make it taller by 2",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    expect(second.status).toBe("executed");
    expect(second.reply).toContain("2 blocks taller");
    const fillCommands = bridge.commands.filter((command) => command.kind === "fill");
    expect(fillCommands).toHaveLength(2);
    expect(fillCommands[1]).toEqual({
      kind: "fill",
      from: { x: 0, y: 69, z: 0 },
      to: { x: 0, y: 70, z: 0 },
      block: "minecraft:white_wool",
    });
  });

  it("uses orchestrator-side recent history when plugin recentMessages are empty", async () => {
    const bridge = new FakeBridge();
    let callCount = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        callCount += 1;
        if (callCount > 1) {
          throw new Error("provider unavailable");
        }
        return JSON.stringify({
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
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    await orchestrator.handleChatCommand({
      ...request,
      message: "make me a wool tower here",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    const second = await orchestrator.handleChatCommand({
      ...request,
      message: "make it taller by 2",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    expect(second.status).toBe("executed");
    expect(second.reply).toContain("2 blocks taller");

    const fillCommands = bridge.commands.filter((command) => command.kind === "fill");
    expect(fillCommands).toHaveLength(2);
    expect(fillCommands[1]).toEqual({
      kind: "fill",
      from: { x: 0, y: 69, z: 0 },
      to: { x: 0, y: 70, z: 0 },
      block: "minecraft:white_wool",
    });
  });

  it("keeps the last built structure context across non-structure commands", async () => {
    const bridge = new FakeBridge();
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        const userPrompt = messages.find((message) => message.role === "user")?.content ?? "";
        const isTallerFollowUp = userPrompt.includes("\"message\": \"make it taller by 2\"");
        if (isTallerFollowUp) {
          throw new Error("provider unavailable");
        }
        const isTree = userPrompt.includes("\"message\": \"delete this tree\"");
        if (isTree) {
          return JSON.stringify({
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

        return JSON.stringify({
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
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    await orchestrator.handleChatCommand({
      ...request,
      message: "make me a wool tower here",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    const removeTree = await orchestrator.handleChatCommand({
      ...request,
      message: "delete this tree",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 2,
          y: 64,
          z: 2,
          type: "minecraft:oak_log",
        },
      },
      recentMessages: [],
    });

    const taller = await orchestrator.handleChatCommand({
      ...request,
      message: "make it taller by 2",
      localContext: {
        ...request.localContext,
        targetBlock: {
          x: 0,
          y: 64,
          z: 0,
          type: "minecraft:short_grass",
        },
      },
      recentMessages: [],
    });

    expect(removeTree.status).toBe("executed");
    expect(removeTree.intent).toBe("remove_tree");
    expect(taller.status).toBe("executed");
    expect(taller.reply).toContain("2 blocks taller");

    const fillCommands = bridge.commands.filter((command) => command.kind === "fill");
    expect(fillCommands).toHaveLength(2);
    expect(fillCommands[1]).toEqual({
      kind: "fill",
      from: { x: 0, y: 69, z: 0 },
      to: { x: 0, y: 70, z: 0 },
      block: "minecraft:white_wool",
    });
  });

  it("returns needs_more_info when the AI plan loses all executable primitives", async () => {
    // arrange
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
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
    const bridge = new FakeBridge();
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    // act
    const response = await orchestrator.handleChatCommand(request);

    // assert
    expect(response.status).toBe("needs_more_info");
    expect(response.reply).toContain("more concrete");
    expect(bridge.commands).toEqual([]);
  });

  it("returns needs_more_info when plan materials cannot be resolved safely", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
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
    const bridge = new FakeBridge();
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build something fluffy",
      recentMessages: ["make me a tower"],
    });

    expect(response.status).toBe("needs_more_info");
    expect(response.reply).toContain("materials");
    expect(bridge.commands).toEqual([]);
  });

  it("reports the failed execution step back to Minecraft instead of masking it", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "build_house",
          passes: [
            {
              name: "step_1",
              goal: "Lay first block.",
              primitives: [
                {
                  type: "set_block",
                  x: 1,
                  y: 64,
                  z: 1,
                  block: "minecraft:stone",
                },
              ],
            },
            {
              name: "step_2",
              goal: "Lay second block.",
              primitives: [
                {
                  type: "set_block",
                  x: 2,
                  y: 64,
                  z: 1,
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Done building.",
          needsMoreInfo: false,
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: 1, y: 64, z: 1 },
            max: { x: 2, y: 64, z: 1 },
          },
          assumptions: [],
        });
      },
    };
    const bridge = new FakeBridge();
    bridge.failOnCallNumber = 2;
    const orchestrator = new Orchestrator(
      bridge as never,
      "/Users/cjg/Projects/MC-Orchestrate/minecraft-server",
      provider,
    );

    const response = await orchestrator.handleChatCommand({
      ...request,
      message: "build a tiny wall",
      recentMessages: ["make me a house"],
    });

    expect(response.status).toBe("error");
    expect(response.reply).toContain("Step 2 of 2 failed");
    expect(bridge.commands).toHaveLength(2);
    expect(bridge.commands[0]).toMatchObject({ kind: "setBlock" });
    expect(bridge.commands[1]).toEqual({
      kind: "say",
      message: "[Bot] cjg: Step 2 of 2 failed: bridge write failed",
    });
  });
});
