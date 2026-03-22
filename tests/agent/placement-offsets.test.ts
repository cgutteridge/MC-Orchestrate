/**
 * Agent tests for Task 27 — positional offset resolution.
 *
 * These tests verify that the AI correctly uses the PLACEMENT REFERENCE card
 * injected into its context to resolve directional phrases into sensible build
 * coordinates. Assertions are intentionally range-based; exact coordinates are
 * not checked because the AI is non-deterministic.
 *
 * "In front of me" means the direction the player is LOOKING, which is an
 * explicit `facing` parameter on every test — never an implicit default.
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
  // Default placement — no offset phrase.
  // Facing south so the placement card puts 5-in-front at (0,64,5).
  // ---------------------------------------------------------------------------

  it("facing south: no offset phrase → structure in front, not on player", async () => {
    const result = await runDesignLoop(
      provider!,
      makeRequest("build me a small stone tower", "south"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    // Must not land on the player's body.
    expect(allCoords(coords, (c) => !(c.y === 64 && c.z === 0))).toBe(true);
    // Some coords should be in the look direction (+z).
    expect(someCoord(coords, (c) => c.z > 0)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // "in front of me" — two perpendicular facings prove the AI uses the look
  // vector, not a hardcoded cardinal axis.
  //
  // Facing south: 5-in-front = (0,64,5)  → dominant axis is z
  // Facing east:  5-in-front = (5,64,0)  → dominant axis is x
  //
  // The east-facing test would fail if the AI always defaulted to south (+z).
  // ---------------------------------------------------------------------------

  it("facing south: 'in front of me' → structure along +z (look direction)", async () => {
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small house in front of me", "south"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    const zValues = coords.map((c) => c.z).sort((a, b) => a - b);
    expect(zValues[Math.floor(zValues.length / 2)]!).toBeGreaterThan(0);
  });

  it("facing east: 'in front of me' → structure along +x (look direction), not +z", async () => {
    /**
     * This is the critical test. If the AI ignored the look vector and always
     * built southward, median x would be ≈0 and this would fail.
     */
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small house in front of me", "east"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    const xValues = coords.map((c) => c.x).sort((a, b) => a - b);
    expect(xValues[Math.floor(xValues.length / 2)]!).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // "above me" — vertical offset, independent of facing.
  // ---------------------------------------------------------------------------

  it("facing south: 'above me' → structure at y > 66 (above player head)", async () => {
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small platform above me", "south"),
      worldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") return;

    const coords = allPrimitiveCoords(result.plan);
    expect(coords.length).toBeGreaterThan(0);
    // Player feet = y=64. "Above me" must be strictly higher than ground level.
    // The placement card now supplies y+5 and y+10 as reference points.
    expect(someCoord(coords, (c) => c.y > 64)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Cardinal directions — absolute axes, independent of where the player faces.
  // "North" is always −z regardless of facing.
  // ---------------------------------------------------------------------------

  it("facing south: '10 blocks north' → structure at z < 0 (−z cardinal)", async () => {
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small pillar 10 blocks to the north", "south"),
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
  // "to my left" — relative to look direction.
  // Facing south (+z): left = east (+x). Placement card: 5-left = (5,64,0).
  // ---------------------------------------------------------------------------

  it("facing south: 'to my left' → structure at x > 0 (east, perpendicular to look)", async () => {
    const result = await runDesignLoop(
      provider!,
      makeRequest("build a small marker to my left", "south"),
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
