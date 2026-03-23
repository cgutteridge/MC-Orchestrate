/**
 * Shared fixtures and helpers for AI agent integration tests.
 * Import from this file in each test suite — do not duplicate setup logic.
 */
import { loadConfig } from "../../src/config/env.js";
import { createChatProvider } from "../../src/services/ai/provider.js";
import type { ChatProvider } from "../../src/services/ai/types.js";
import type { ChatCommandRequest, BlockSample } from "../../src/types/plugin.js";
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
export const worldReader = new WorldReader(config.minecraft.minecraftDir);

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------

/**
 * All 8 compass-point facing directions. Each maps to the correct Minecraft
 * yaw and a normalised horizontal look vector so tests never have to derive
 * them manually.
 *
 * Minecraft yaw convention (pitch = 0):
 *   lookVector.x = −sin(yaw°)
 *   lookVector.z =  cos(yaw°)
 *
 *   0°  = south     (+z)
 *   45° = southwest (−x, +z)
 *   90° = west      (−x)
 *   135°= northwest (−x, −z)
 *   180°= north     (−z)
 *   225°= northeast (+x, −z)
 *   270°= east      (+x)
 *   315°= southeast (+x, +z)
 */
export type Facing =
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest";

const D = Math.SQRT1_2; // 1/√2 ≈ 0.707 — diagonal component

const FACING: Record<Facing, { yaw: number; lookVector: { x: number; y: number; z: number } }> = {
  south: { yaw: 0, lookVector: { x: 0, y: 0, z: 1 } },
  southwest: { yaw: 45, lookVector: { x: -D, y: 0, z: D } },
  west: { yaw: 90, lookVector: { x: -1, y: 0, z: 0 } },
  northwest: { yaw: 135, lookVector: { x: -D, y: 0, z: -D } },
  north: { yaw: 180, lookVector: { x: 0, y: 0, z: -1 } },
  northeast: { yaw: 225, lookVector: { x: D, y: 0, z: -D } },
  east: { yaw: 270, lookVector: { x: 1, y: 0, z: 0 } },
  southeast: { yaw: 315, lookVector: { x: D, y: 0, z: D } },
};

/** Baseline player position — origin at y=64. */
const BASE_POSITION = { x: 0, y: 64, z: 0 };

/**
 * Builds a `ChatCommandRequest` for agent tests.
 *
 * `facing` is required so every test explicitly declares which way the player
 * is looking — the most important spatial input and the one most likely to
 * cause a confusing failure if left implicit.
 *
 * The fixture automatically provides:
 *   - Ground blocks (grass) at y-1 beneath the player
 *   - A targetBlock 5 blocks ahead on the ground surface, derived from the
 *     facing direction, so the AI has an anchor point to work with
 *
 * Pass `overrides` only for fields that genuinely differ from the baseline
 * (e.g. a specific `targetBlock`, custom `nearbyBlocks`, or `recentMessages`).
 */
export function makeRequest(
  message: string,
  facing: Facing,
  overrides: Partial<Omit<ChatCommandRequest, "player" | "message">> & {
    position?: { x: number; y: number; z: number };
  } = {},
): ChatCommandRequest {
  const { position = BASE_POSITION, localContext, ...rest } = overrides;
  const { yaw, lookVector } = FACING[facing];

  // Ground level is one block below player feet.
  const groundY = position.y - 1;

  // A minimal ground surface so the AI knows the player is standing on solid
  // terrain rather than floating in void. No targetBlock by default — if the
  // test involves a specific looked-at block, pass it via localContext override.
  // Including a default targetBlock would cause the AI to anchor there and
  // ignore directional phrases like "north" or "to my left".
  const groundBlocks: BlockSample[] = [
    { x: position.x, y: groundY, z: position.z, type: "minecraft:grass_block" },
    { x: position.x + 1, y: groundY, z: position.z, type: "minecraft:grass_block" },
    { x: position.x - 1, y: groundY, z: position.z, type: "minecraft:grass_block" },
    { x: position.x, y: groundY, z: position.z + 1, type: "minecraft:grass_block" },
    { x: position.x, y: groundY, z: position.z - 1, type: "minecraft:grass_block" },
  ];

  return {
    requestId: `agent-test-${Date.now()}`,
    message,
    player: {
      uuid: "agent-test-uuid",
      name: "TestPlayer",
      world: "world",
      position,
      yaw,
      pitch: 0,
      lookVector,
    },
    recentMessages: [],
    localContext: {
      nearbyBlocks: groundBlocks,
      nearbyEntities: [],
      nearbyPlayers: [],
      ...localContext,
    },
    serverContext: {
      timestamp: new Date().toISOString(),
      dimension: "NORMAL",
      onlinePlayerCount: 1,
    },
    initialScanRegion: {
      minX: position.x - 7,
      minY: position.y - 3,
      minZ: position.z - 7,
      maxX: position.x + 7,
      maxY: position.y + 5,
      maxZ: position.z + 7,
    },
    ...rest,
  };
}
