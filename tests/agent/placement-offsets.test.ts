/**
 * Agent tests for placement intent (task 30).
 *
 * The AI returns a semantic `placement` field (`ref`, forward/left/right, up,
 * north, …). The code resolves it to world space. These tests assert the AI's
 * INTENT, not computed coordinates.
 *
 * All tests use the base fixture: player at (0, 64, 0) with facing set
 * explicitly on each call.
 */

import { describe, it, expect } from "vitest";
import { runPlacementThenBuild } from "../../src/planner/aiPlanner.js";
import type { Placement } from "../../src/planner/schema.js";
import { assertProviderPresent, makeRequest, provider, worldReader } from "./_fixtures.js";

assertProviderPresent();

/**
 * Runs placement-then-build planning and returns placement when a plan is produced.
 *
 * @param message - Player chat text.
 * @param facing - Horizontal facing for the synthetic request.
 * @returns Parsed placement, or `undefined` if the loop did not return a plan.
 */
async function getPlacement(
  message: string,
  facing: Parameters<typeof makeRequest>[1],
): Promise<Placement | undefined> {
  const result = await runPlacementThenBuild(
    provider!,
    makeRequest(message, facing),
    worldReader,
    undefined,
  );
  if (result.outcome !== "plan") {
    return undefined;
  }
  return result.placement;
}

describe.skipIf(!provider)("Agent: placement intent", () => {
  it("default build uses player_view with forward offset", async () => {
    const placement = await getPlacement("build me a small stone tower", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_view");
    expect(placement!.forward).toBeGreaterThan(0);
  });

  it("'in front of me' → player_view, positive forward", async () => {
    const placement = await getPlacement("build a small house in front of me", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_view");
    expect(placement!.forward).toBeGreaterThan(0);
  });

  it("facing east: 'in front of me' → player_view + forward, not cardinal", async () => {
    const placement = await getPlacement("build a small house in front of me", "east");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_view");
    expect(placement!.forward).toBeGreaterThan(0);
    expect(placement!.east ?? 0).toBe(0);
    expect(placement!.south ?? 0).toBe(0);
  });

  it("'above me' → player_view, positive up", async () => {
    const placement = await getPlacement("build a small platform above me", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_view");
    expect(placement!.up).toBeGreaterThan(0);
  });

  it("'10 blocks to the north' → player_absolute with north offset", async () => {
    const placement = await getPlacement("build a small pillar 10 blocks to the north", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_absolute");
    expect(placement!.north).toBeGreaterThan(0);
  });

  it("'to my left' → player_view with positive left", async () => {
    const placement = await getPlacement("build a small marker to my left", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player_view");
    expect(placement!.left).toBeGreaterThan(0);
  });

  it("'here' → focus ref", async () => {
    const placement = await getPlacement("build a small marker here", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("focus");
  });
});
