/**
 * Shared fixtures and helpers for AI agent integration tests.
 * Import from this file in each test suite — do not duplicate setup logic.
 */
import { loadConfig } from "../../src/config/env.js";
import { createChatProvider } from "../../src/services/ai/provider.js";
import type { ChatProvider } from "../../src/services/ai/types.js";
import type { ChatCommandRequest } from "../../src/types/plugin.js";
import type { Plan } from "../../src/planner/schema.js";
import { WorldReader } from "../../src/world/worldReader.js";

// ---------------------------------------------------------------------------
// Provider — created once for the whole process
// ---------------------------------------------------------------------------

const config = loadConfig();

/**
 * The real AI chat provider loaded from environment variables, or `undefined`
 * when no credentials are configured. Tests should gate on this value via
 * `describe.skipIf(!provider)(...)`.
 */
export const provider: ChatProvider | undefined = createChatProvider(config);

/**
 * When `MCORCH_AGENT_TESTS=1` is set the suite asserts the provider must be
 * present. Useful for CI jobs that have credentials and want to catch
 * accidentally-skipped tests.
 */
export function assertProviderPresent(): void {
  if (process.env.MCORCH_AGENT_TESTS === "1" && !provider) {
    throw new Error(
      "MCORCH_AGENT_TESTS=1 but no AI provider is configured. " +
        "Set the AZURE_OPENAI_* environment variables.",
    );
  }
}

// ---------------------------------------------------------------------------
// WorldReader — points at the local server directory
// ---------------------------------------------------------------------------

/**
 * WorldReader backed by the local Minecraft server directory.
 * Disk reads return `undefined` gracefully when the world is not present.
 */
export const worldReader = new WorldReader(
  config.minecraft.minecraftDir,
);

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------

/** Baseline player snapshot — at the world origin, looking south (+z). */
const BASE_REQUEST: ChatCommandRequest = {
  requestId: "agent-test",
  player: {
    uuid: "agent-test-uuid",
    name: "TestPlayer",
    world: "world",
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,       // south
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 }, // south (+z)
  },
  message: "",
  recentMessages: [],
  localContext: {
    nearbyBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  },
  serverContext: {
    timestamp: new Date().toISOString(),
    dimension: "NORMAL",
    onlinePlayerCount: 1,
  },
  initialScanRegion: {
    minX: -7, minY: 61, minZ: -7,
    maxX: 7,  maxY: 69, maxZ: 7,
  },
};

/**
 * Builds a `ChatCommandRequest` for agent tests. Deep-merges `overrides` so
 * callers only need to specify what differs from the baseline.
 */
export function makeRequest(
  message: string,
  overrides: Partial<ChatCommandRequest> = {},
): ChatCommandRequest {
  return {
    ...BASE_REQUEST,
    ...overrides,
    requestId: `agent-test-${Date.now()}`,
    message,
    player: {
      ...BASE_REQUEST.player,
      ...(overrides.player ?? {}),
    },
    localContext: {
      ...BASE_REQUEST.localContext,
      ...(overrides.localContext ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Spatial assertion helpers
// ---------------------------------------------------------------------------

/**
 * Extracts every world coordinate mentioned in any primitive across all passes
 * of a plan. Used by spatial assertions.
 */
export function allPrimitiveCoords(
  plan: Plan,
): Array<{ x: number; y: number; z: number }> {
  const coords: Array<{ x: number; y: number; z: number }> = [];
  for (const pass of plan.passes) {
    for (const p of pass.primitives) {
      switch (p.type) {
        case "set_block":
          coords.push({ x: p.x, y: p.y, z: p.z });
          break;
        case "fill_cuboid":
        case "hollow_cuboid":
        case "clear_region":
          coords.push(p.from, p.to);
          break;
        case "replace_in_region":
          coords.push(p.from, p.to);
          break;
        case "cylinder":
          coords.push(p.center);
          break;
      }
    }
  }
  return coords;
}

/**
 * Returns true when every coordinate in `coords` satisfies `predicate`.
 * Useful for loose spatial assertions.
 */
export function allCoords(
  coords: Array<{ x: number; y: number; z: number }>,
  predicate: (c: { x: number; y: number; z: number }) => boolean,
): boolean {
  return coords.length > 0 && coords.every(predicate);
}

/**
 * Returns true when at least one coordinate satisfies `predicate`.
 */
export function someCoord(
  coords: Array<{ x: number; y: number; z: number }>,
  predicate: (c: { x: number; y: number; z: number }) => boolean,
): boolean {
  return coords.some(predicate);
}
