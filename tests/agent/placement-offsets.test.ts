/**
 * Agent tests for Task 27 — positional offset resolution.
 *
 * These tests verify that the AI correctly uses the PLACEMENT REFERENCE card
 * injected into its context to resolve directional phrases into sensible build
 * coordinates. Assertions are intentionally range-based; exact coordinates are
 * not checked because the AI is non-deterministic.
 *
 * Player context for all tests: position (0, 64, 0), looking south (+z).
 * PLACEMENT REFERENCE card values for this setup:
 *   5 blocks in front  →  (0, 64,  5)
 *   10 blocks in front →  (0, 64, 10)
 *   5 blocks left       →  (5, 64,  0)   (east, perpendicular to south)
 *   5 blocks right      → (-5, 64,  0)   (west)
 *   north               →  z decreases
 *   above               →  y > 64
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
  // ---------------------------------------------------------------------------

  it("places structure in front of the player by default (not at player feet)", async () => {
    /**
     * Scenario: plain build request with no directional qualifier.
     * Expected: all primitive coordinates have z > 2 (clearly in front of the
     * player at z=0, not on or behind the player).
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

    // Structure should not be sitting on the player (z must be at least 1 block
    // in front) and should not be behind (z > -1).
    const notOnPlayer = allCoords(coords, (c) => !(c.y === 64 && c.z === 0));
    expect(notOnPlayer).toBe(true);

    // At least some coordinates should be in front (z > 0).
    expect(someCoord(coords, (c) => c.z > 0)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // "in front of me"
  // ---------------------------------------------------------------------------

  it("places structure in the +z direction when player says 'in front of me'", async () => {
    /**
     * Player is at (0, 64, 0) looking south (+z).
     * "in front of me" → z should be positive.
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
    // Median z should clearly be positive (in front = south = +z).
    const zValues = coords.map((c) => c.z);
    const medianZ = zValues.sort((a, b) => a - b)[Math.floor(zValues.length / 2)]!;
    expect(medianZ).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // "above me"
  // ---------------------------------------------------------------------------

  it("places structure above player when asked to build above", async () => {
    /**
     * "above me" → y should be clearly above player feet (y=64).
     * Expect structure center y > 66 (at least 2 blocks overhead).
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
    // At least one coordinate must be above the player's head.
    expect(someCoord(coords, (c) => c.y > 66)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Cardinal — "north of me"
  // ---------------------------------------------------------------------------

  it("places structure in the −z direction when player says 'north'", async () => {
    /**
     * North = −z in Minecraft. Player at (0,64,0).
     * Expect the structure to have negative z coordinates.
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
    // At least one coordinate must be north (z < 0).
    expect(someCoord(coords, (c) => c.z < 0)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // "to my left"
  // ---------------------------------------------------------------------------

  it("places structure to the east when player looks south and says 'to my left'", async () => {
    /**
     * Facing south (+z), left = east (+x).
     * Placement card: 5 blocks left = (5, 64, 0).
     * Expect positive x coordinates.
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
    // At least one coordinate should be east of the player (x > 0).
    expect(someCoord(coords, (c) => c.x > 0)).toBe(true);
  });
});
