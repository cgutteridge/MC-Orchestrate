/**
 * Agent tests for Task 27 — positional offset resolution.
 *
 * These tests verify that the AI correctly uses the PLACEMENT REFERENCE card
 * injected into its context to resolve directional phrases into sensible build
 * coordinates. Assertions are intentionally range-based; exact coordinates are
 * not checked because the AI is non-deterministic.
 *
 * "In front of me" means the direction the player is LOOKING, not any fixed
 * cardinal axis. The placement card pre-computes the correct coordinates from
 * the look vector, so the AI never has to derive them itself.
 */

import { describe, it, expect } from "vitest";
import { runDesignLoop } from "../../src/planner/aiPlanner.js";
import {
  assertProviderPresent,
  allCoords,
  allPrimitiveCoords,
  makeRequest,
  provider,
  someCoord,
  worldReader,
} from "./_fixtures.js";

assertProviderPresent();

describe.skipIf(!provider)("Agent: placement offset resolution", () => {
  // ---------------------------------------------------------------------------
  // Default placement — no offset phrase
  // Player at (0,64,0) looking south. Placement card: 5-in-front = (0,64,5).
  // ---------------------------------------------------------------------------

  it("places structure in front of the player by default (not at player feet)", async () => {
    /**
     * Plain build request with no directional qualifier.
     * The default should be somewhere in front — not sitting on the player.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build me a small stone tower"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);

    // Must not be on the player's body blocks.
    const notOnPlayer = allCoords(coords, (c) => !(c.y === 64 && c.z === 0));
    expect(notOnPlayer).toBe(true);

    // At least some coordinates in the look direction (south = +z for this fixture).
    expect(someCoord(coords, (c) => c.z > 0)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // "in front of me" — verified across two perpendicular look directions.
  // This proves the AI uses the look vector, not a hardcoded cardinal axis.
  // ---------------------------------------------------------------------------

  it("facing south: 'in front of me' → structure appears in +z (look direction)", async () => {
    /**
     * Player at (0,64,0) looking SOUTH (lookVector = 0,0,+1).
     * Placement card: 5-in-front = (0,64,5), 10-in-front = (0,64,10).
     * In-front means z increases for this look direction.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small house in front of me"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    const zValues = coords.map((c) => c.z).sort((a, b) => a - b);
    const medianZ = zValues[Math.floor(zValues.length / 2)]!;
    expect(medianZ).toBeGreaterThan(0);
  });

  it("facing east: 'in front of me' → structure appears in +x (look direction), NOT +z", async () => {
    /**
     * Player at (0,64,0) looking EAST (lookVector = +1,0,0).
     * Placement card: 5-in-front = (5,64,0), 10-in-front = (10,64,0).
     * In-front means x increases — z should NOT be the dominant axis.
     * This test would fail if the AI defaulted to always building south (+z).
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small house in front of me", {
        player: {
          uuid: "agent-test-uuid",
          name: "TestPlayer",
          world: "world",
          position: { x: 0, y: 64, z: 0 },
          yaw: 270,
          pitch: 0,
          lookVector: { x: 1, y: 0, z: 0 },
        },
        initialScanRegion: { minX: -7, minY: 61, minZ: -7, maxX: 7, maxY: 69, maxZ: 7 },
      }),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    const xValues = coords.map((c) => c.x).sort((a, b) => a - b);
    const medianX = xValues[Math.floor(xValues.length / 2)]!;
    // Structure must be in the +x direction (east = look direction).
    expect(medianX).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // "above me"
  // Player at (0,64,0). Placement card: above = y+D.
  // ---------------------------------------------------------------------------

  it("places structure above player when asked to build above", async () => {
    /**
     * "above me" → y should be clearly above player feet (y=64).
     * At least 2 blocks overhead.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small platform above me"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    expect(someCoord(coords, (c) => c.y > 66)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Cardinal directions — independent of look vector.
  // Player at (0,64,0) looking south. North = −z regardless of facing.
  // ---------------------------------------------------------------------------

  it("places structure in the −z direction when player says 'north'", async () => {
    /**
     * North = −z in Minecraft regardless of which way the player faces.
     * Placement card cardinal formula: north z = player.z − D.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small pillar 10 blocks to the north"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    expect(someCoord(coords, (c) => c.z < 0)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // "to my left" — perpendicular to look direction, not a fixed axis.
  // Player at (0,64,0) looking south (+z). Left of south = east (+x).
  // Placement card: 5-left = (5,64,0).
  // ---------------------------------------------------------------------------

  it("facing south: 'to my left' → structure appears in +x (east, perpendicular to look)", async () => {
    /**
     * Facing south (+z), left is east (+x).
     * This is computed from the look vector, not a fixed direction.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small marker to my left"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    expect(someCoord(coords, (c) => c.x > 0)).toBe(true);
  });
});
