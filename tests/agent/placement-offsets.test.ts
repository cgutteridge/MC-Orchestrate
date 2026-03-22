/**
 * Agent tests for placement intent (task 30).
 *
 * The AI now returns a semantic `placement` field ({ anchor, forward, right,
 * up, north, … }) instead of absolute world coordinates. The code resolves
 * this to world space. These tests assert the AI's INTENT, not computed
 * coordinates, making them far more robust and token-efficient.
 *
 * All tests use the base fixture: player at (0, 64, 0) with facing set
 * explicitly on each call.
 */

import { describe, it, expect } from "vitest";
import { runDesignLoop } from "../../src/planner/aiPlanner.js";
import type { Placement } from "../../src/planner/schema.js";
import {
  assertProviderPresent,
  makeRequest,
  provider,
  worldReader,
} from "./_fixtures.js";

assertProviderPresent();

// ---------------------------------------------------------------------------
// Helper — extract placement from a successful loop result
// ---------------------------------------------------------------------------

async function getPlacement(
  message: string,
  facing: Parameters<typeof makeRequest>[1],
): Promise<Placement | undefined> {
  const result = await runDesignLoop(
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
  // ---------------------------------------------------------------------------
  // Default — no directional phrase
  // ---------------------------------------------------------------------------

  it("default build uses player_feet anchor with forward offset", async () => {
    const placement = await getPlacement("build me a small stone tower", "south");

    expect(placement).toBeDefined();
    expect(placement!.anchor).toBe("player_feet");
    // Should be in front of the player, not at their feet.
    expect(placement!.forward).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // "in front of me" — anchor should be player_feet, forward > 0
  // The facing direction only affects code-side math; the AI just says "forward".
  // ---------------------------------------------------------------------------

  it("'in front of me' → player_feet anchor, positive forward", async () => {
    const placement = await getPlacement("build a small house in front of me", "south");

    expect(placement).toBeDefined();
    expect(placement!.anchor).toBe("player_feet");
    expect(placement!.forward).toBeGreaterThan(0);
  });

  it("facing east: 'in front of me' → same intent (forward), not a cardinal", async () => {
    // The AI should use forward regardless of which way the player faces.
    // The code translates forward into +x or +z etc.
    const placement = await getPlacement("build a small house in front of me", "east");

    expect(placement).toBeDefined();
    expect(placement!.anchor).toBe("player_feet");
    expect(placement!.forward).toBeGreaterThan(0);
    // Should NOT use cardinal offsets to express "in front"
    expect(placement!.east ?? 0).toBe(0);
    expect(placement!.south ?? 0).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // "above me" — anchor player_feet, positive up
  // ---------------------------------------------------------------------------

  it("'above me' → player_feet anchor, positive up", async () => {
    const placement = await getPlacement("build a small platform above me", "south");

    expect(placement).toBeDefined();
    expect(placement!.anchor).toBe("player_feet");
    expect(placement!.up).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Cardinal directions — expressed as north/south/east/west offsets
  // ---------------------------------------------------------------------------

  it("'10 blocks to the north' → north offset > 0", async () => {
    const placement = await getPlacement("build a small pillar 10 blocks to the north", "south");

    expect(placement).toBeDefined();
    expect(placement!.north).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // "to my left" — right < 0 (left = negative right)
  // ---------------------------------------------------------------------------

  it("'to my left' → negative right (regardless of facing)", async () => {
    const placement = await getPlacement("build a small marker to my left", "south");

    expect(placement).toBeDefined();
    // To the left = right < 0 in the placement schema.
    expect(placement!.right).toBeLessThan(0);
  });

  // ---------------------------------------------------------------------------
  // "here" / "on this block" — anchor should be player_look_target
  // ---------------------------------------------------------------------------

  it("'here' → player_look_target anchor", async () => {
    const placement = await getPlacement("build a small marker here", "south");

    expect(placement).toBeDefined();
    expect(placement!.anchor).toBe("player_look_target");
  });
});
