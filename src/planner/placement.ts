import type { ChatCommandRequest } from "../types/plugin.js";
import type { Plan, Placement, Point, BuildPass } from "./schema.js";

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a semantic {@link Placement} to a concrete world-space anchor point.
 *
 * ## Reference system
 *
 * | ref              | Origin              | Horizontal offsets         |
 * |------------------|---------------------|----------------------------|
 * | `player`         | player position     | frame-selected signed axes |
 * | `focus`          | targetBlock surface | frame-selected signed axes |
 *
 * ## Y axis
 *
 * Y is always independent of horizontal offsets. The vertical zero reference
 * depends on `placement.ref`:
 *
 * - **`player`**: `offset.UP: 0` is **player head height**
 *   (`round(player.position.y) + 1`). The player is two blocks tall; feet are
 *   at `y`, the head/eye band is at `y+1`.
 * - **`focus`**: `offset.UP: 0` is the **top surface** of the looked-at block
 *   (`round(targetBlock.y) + 1`). Without a target block, falls back to head
 *   height.
 *
 * ## Player-view rotation
 *
 * For `frame="player"`, the horizontal look direction is derived from the
 * player's look vector (pitch ignored). Right = clockwise 90° from forward
 * in the XZ plane: rightX = −nhz, rightZ = nhx.
 *
 * @param placement  Semantic placement from the AI.
 * @param request    Current player context (position, look vector, targetBlock).
 * @param lastBuildCenter  Centre of the last built structure (for `last_build`).
 * @returns Resolved world-space anchor point.
 */
export function resolvePlacement(
  placement: Placement,
  request: ChatCommandRequest,
  _lastBuildCenter?: Point,
): Point {
  const pos = request.player.position;

  const headY = Math.round(pos.y) + 1;

  // ── Horizontal look direction (pitch ignored) ─────────────────────────
  const lx = request.player.lookVector.x;
  const lz = request.player.lookVector.z;
  const hLen = Math.sqrt(lx * lx + lz * lz);
  const nhx = hLen > 0.01 ? lx / hLen : 0;
  const nhz = hLen > 0.01 ? lz / hLen : 1;

  // ── Resolve XZ origin ────────────────────────────────────────────────
  let baseX: number;
  let baseZ: number;

  const originX =
    placement.ref === "focus" && request.localContext.targetBlock
      ? request.localContext.targetBlock.x
      : Math.round(pos.x);
  const originZ =
    placement.ref === "focus" && request.localContext.targetBlock
      ? request.localContext.targetBlock.z
      : Math.round(pos.z);

  if (placement.frame === "player") {
    // World-space from signed player-relative axes: +F forward, +R right.
    const fx = nhx * placement.offset.F - nhz * placement.offset.R;
    const fz = nhz * placement.offset.F + nhx * placement.offset.R;
    baseX = Math.round(originX + fx);
    baseZ = Math.round(originZ + fz);
  } else {
    // World-space cardinal axes: +E east (+x), +N north (-z).
    baseX = originX + placement.offset.E;
    baseZ = originZ - placement.offset.N;
  }

  // ── Resolve Y (independent of horizontal) ────────────────────────────
  const tb = request.localContext.targetBlock;
  const verticalBaseY = placement.ref === "focus" ? (tb ? Math.round(tb.y) + 1 : headY) : headY;
  const resolvedY = verticalBaseY + placement.offset.UP;

  return { x: baseX, y: resolvedY, z: baseZ };
}

/**
 * Computes the point on the plan's `targetRegion` box that should align with
 * the semantic anchor from {@link resolvePlacement}. Horizontal XZ uses the
 * region centre; Y uses {@link Placement.verticalReference} so in-ground
 * builds (anchor at surface) vs on-ground builds (anchor at floor) align.
 *
 * @param plan Validated plan with `targetRegion`.
 * @param placement Semantic placement including `verticalReference`.
 */
export function computePlacementAlignmentPoint(plan: Plan, placement: Placement): Point {
  const { min, max } = plan.targetRegion;
  const cx = Math.round((min.x + max.x) / 2);
  const cz = Math.round((min.z + max.z) / 2);
  const v = placement.verticalReference;
  const cy =
    v === "on_ground" ? min.y : v === "under_ground" ? max.y : Math.round((min.y + max.y) / 2);
  return { x: cx, y: cy, z: cz };
}

// ---------------------------------------------------------------------------
// Plan coordinate shifting
// ---------------------------------------------------------------------------

/**
 * Returns a new Plan with `targetRegion` shifted by `offset`.
 *
 * Layer-map content stays in local space; the region anchor moves with the
 * resolved placement.
 */
export function shiftPlan(plan: Plan, offset: Point): Plan {
  return {
    ...plan,
    targetRegion: {
      ...plan.targetRegion,
      min: addPoint(plan.targetRegion.min, offset),
      max: addPoint(plan.targetRegion.max, offset),
    },
    passes: plan.passes.map((pass) => shiftPass(pass, offset)),
  };
}

function shiftPass(pass: BuildPass, _offset: Point): BuildPass {
  return { ...pass };
}

function addPoint(p: Point, offset: Point): Point {
  return { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
}

// ---------------------------------------------------------------------------
// Plan centre extraction
// ---------------------------------------------------------------------------

/**
 * Returns the centre of a plan's targetRegion, used as the anchor for
 * `last_build` placement references on the next request and for legacy
 * centre-to-centre alignment when not using {@link computePlacementAlignmentPoint}.
 */
export function computePlanCenter(plan: Plan): Point {
  const { min, max } = plan.targetRegion;
  return {
    x: Math.round((min.x + max.x) / 2),
    y: Math.round((min.y + max.y) / 2),
    z: Math.round((min.z + max.z) / 2),
  };
}
