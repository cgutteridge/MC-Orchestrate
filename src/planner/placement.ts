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
 * | `player_view`    | player position     | forward/back/left/right    |
 * | `player_absolute`| player position     | north/south/east/west      |
 * | `focus`          | targetBlock surface | north/south/east/west      |
 * | `last_build`     | last build centre   | north/south/east/west      |
 *
 * ## Y axis
 *
 * Y is always independent of horizontal offsets. The vertical zero reference
 * depends on `placement.ref`:
 *
 * - **`player_view` / `player_absolute`**: `up: 0` is **player head height**
 *   (`round(player.position.y) + 1`). The player is two blocks tall; feet are
 *   at `y`, the head/eye band is at `y+1`, so aerial builds do not clip the
 *   body. `up: N` adds N blocks above that. `down: N` subtracts N (pits,
 *   basements).
 * - **`focus`**: `up: 0` is the **top surface** of the looked-at block
 *   (`round(targetBlock.y) + 1`). Without a target block, falls back to head
 *   height.
 * - **`last_build`**: `up: 0` is the **last structure centre Y** from the
 *   prior plan. If unknown, falls back to head height.
 *
 * ## Player-view rotation
 *
 * For `player_view`, the horizontal look direction is derived from the
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
  lastBuildCenter?: Point,
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

  switch (placement.ref) {
    case "player_view": {
      // Forward and backward along look vector; left/right perpendicular.
      // Right direction: clockwise 90° from (nhx, nhz) → (−nhz, nhx) in XZ.
      const fx =
        nhx * (placement.forward - placement.back) - nhz * (placement.right - placement.left);
      const fz =
        nhz * (placement.forward - placement.back) + nhx * (placement.right - placement.left);
      baseX = Math.round(pos.x + fx);
      baseZ = Math.round(pos.z + fz);
      break;
    }

    case "focus": {
      const tb = request.localContext.targetBlock;
      // E/W → X axis; N/S → Z axis (Minecraft convention: east=+x, north=-z)
      const originX = tb ? tb.x : Math.round(pos.x);
      const originZ = tb ? tb.z : Math.round(pos.z);
      baseX = originX + (placement.east - placement.west);
      baseZ = originZ + (placement.south - placement.north);
      break;
    }

    case "last_build": {
      const lb = lastBuildCenter ?? { x: Math.round(pos.x), z: Math.round(pos.z) };
      baseX = lb.x + (placement.east - placement.west);
      baseZ = lb.z + (placement.south - placement.north);
      break;
    }

    default: // "player_absolute"
      baseX = Math.round(pos.x) + (placement.east - placement.west);
      baseZ = Math.round(pos.z) + (placement.south - placement.north);
  }

  // ── Resolve Y (independent of horizontal) ────────────────────────────
  const tb = request.localContext.targetBlock;
  let verticalBaseY: number;
  switch (placement.ref) {
    case "player_view":
    case "player_absolute":
      verticalBaseY = headY;
      break;
    case "focus":
      verticalBaseY = tb ? Math.round(tb.y) + 1 : headY;
      break;
    case "last_build":
      verticalBaseY = lastBuildCenter !== undefined ? Math.round(lastBuildCenter.y) : headY;
      break;
    default:
      verticalBaseY = headY;
  }

  const resolvedY = verticalBaseY + placement.up - placement.down;

  return { x: baseX, y: resolvedY, z: baseZ };
}

/**
 * Computes the point on the plan's `targetRegion` box that should align with
 * the semantic anchor from {@link resolvePlacement}. Horizontal XZ uses the
 * region centre; Y uses {@link Placement.verticalReference} so in-ground
 * builds (anchor at surface) vs on-ground builds (anchor at floor) align.
 *
 * @param plan Validated plan with `targetRegion`.
 * @param placement Semantic placement including `verticalReference` (`flying` aligns like `middle`).
 */
export function computePlacementAlignmentPoint(plan: Plan, placement: Placement): Point {
  const { min, max } = plan.targetRegion;
  const cx = Math.round((min.x + max.x) / 2);
  const cz = Math.round((min.z + max.z) / 2);
  const v = placement.verticalReference;
  // `flying` uses the same Y as `middle` (vertical centre); semantics differ in prompts only.
  const cy = v === "top" ? max.y : v === "bottom" ? min.y : Math.round((min.y + max.y) / 2);
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
  return {
    ...pass,
    primitives: [],
  };
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
