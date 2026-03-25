/**
 * Agent tests for placement intent (task 30).
 *
 * The AI returns {@link Placement}: `ref` (`player` | `focus`), `frame`
 * (`player` | `world`), and signed offsets (`F`/`R`/`UP` or `N`/`E`/`UP`).
 * These tests assert intent, not computed world coordinates.
 *
 * All tests use the base fixture: player at (0, 64, 0) with facing set
 * explicitly on each call.
 */

import { describe, it, expect } from "vitest";
import { runPlacementThenBuild } from "../../src/planner/aiPlanner.js";
import type { Placement } from "../../src/planner/schema.js";
import { assertProviderPresent, makeRequest, provider } from "./_fixtures.js";

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
  const result = await runPlacementThenBuild(provider!, makeRequest(message, facing), undefined);
  if (result.outcome !== "plan") {
    return undefined;
  }
  return result.placement;
}

describe.skipIf(!provider)("Agent: placement intent", () => {
  it("default build uses player frame with forward offset", async () => {
    const placement = await getPlacement("build me a small stone tower", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("player");
    expect(placement!.offset.F).toBeGreaterThan(0);
  });

  it("'in front of me' → player frame, positive F", async () => {
    const placement = await getPlacement("build a small house in front of me", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("player");
    expect(placement!.offset.F).toBeGreaterThan(0);
  });

  it("facing east: 'in front of me' → player frame + F, not world cardinal offsets", async () => {
    const placement = await getPlacement("build a small house in front of me", "east");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("player");
    expect(placement!.offset.F).toBeGreaterThan(0);
    expect(placement!.offset.E).toBe(0);
    expect(placement!.offset.N).toBe(0);
  });

  it("'above me' → player frame, positive UP", async () => {
    const placement = await getPlacement("build a small platform above me", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("player");
    expect(placement!.offset.UP).toBeGreaterThan(0);
  });

  it("'10 blocks to the north' → world frame with north offset", async () => {
    const placement = await getPlacement("build a small pillar 10 blocks to the north", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("world");
    expect(placement!.offset.N).toBeGreaterThan(0);
  });

  it("'to my left' → player frame with positive R (right-hand axis)", async () => {
    const placement = await getPlacement("build a small marker to my left", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("player");
    expect(placement!.frame).toBe("player");
    expect(placement!.offset.R).not.toBe(0);
  });

  it("'here' → focus ref", async () => {
    const placement = await getPlacement("build a small marker here", "south");

    expect(placement).toBeDefined();
    expect(placement!.ref).toBe("focus");
  });
});
