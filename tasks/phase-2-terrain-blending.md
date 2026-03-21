# Phase 2 Terrain Context and Blending

## Goal

Add deterministic terrain-awareness so builds are grounded, biome-aware, and less disruptive to the existing landscape.

## Task 1: TerrainContextCard Generator

- Subtasks:
  - Add plugin-side terrain sampling around intended footprint + buffer ring.
  - Compute compact metrics: height stats, slope stats, top block histogram, water proximity, biome distribution.
  - Keep context payload bounded with strict token-size targets.
  - Provide a deterministic text/card summary for planner prompts.
- Acceptance criteria:
  - Terrain cards are generated consistently and stay under token budget.
  - Sampling failures degrade gracefully to explicit unknown-context defaults.
- Expected tests:
  - Metric correctness tests on synthetic terrain fixtures.
  - Payload size cap tests.
  - Fallback behavior tests.
- Rollback:
  - `terrain_context_enabled=false` falls back to current context model.

## Task 2: Terrain-Adaptive Compile Transforms

- Subtasks:
  - Implement cut-and-fill foundation transform with bounded maximum cut depth.
  - Add retaining-wall transform for high cut-depth edges.
  - Add feathering-ring transform to blend edited terrain into surrounding surface.
  - Add vegetation save/restore strategy in blend ring where safe.
- Acceptance criteria:
  - Terrain artifacts are reduced across benchmark scenarios.
  - All terrain edits remain in bounded allowed region and budgets.
- Expected tests:
  - Max-cut-depth enforcement tests.
  - Region-boundary confinement tests.
  - Regression tests on benchmark terrain scenarios.
- Rollback:
  - `terrain_blend=false` disables transforms while keeping normal build execution.

## Task 3: Placement and Anchoring Mode Expansion

- Subtasks:
  - Extend anchor interpretation to distinguish surface, inset, underground, and elevated modes.
  - Improve no-target-block fallback to sample intended build area ahead of the player.
  - Add interpretation support for directives such as `under here`, `into this hill`, and `beneath my house`.
  - Add stronger tree-removal region targeting for non-oak and irregular canopies.
- Acceptance criteria:
  - Placement mode classification is explicit and testable.
  - No-target fallback reduces floating/misplaced build starts.
- Expected tests:
  - Mode classification tests.
  - Anchor-point regression tests for steep pitch/uneven terrain.
  - Tree-targeting tests across block types.
- Rollback:
  - Fallback to surface mode when mode classification confidence is low.

## Task 4: Primitive Coverage for Terrain-Aware Structures

- Subtasks:
  - Add or harden helper primitives used by terrain-adaptive templates (ramps, tunnels, roof helpers, planes).
  - Ensure primitive semantics are stable under uneven terrain and boundary constraints.
  - Keep compile output deterministic and pass-order safe.
- Acceptance criteria:
  - Terrain-oriented templates compile without invalid geometry.
  - Primitive helpers do not violate safety limits.
- Expected tests:
  - Primitive compile tests with uneven-footprint fixtures.
  - Pass-order and safety validation tests.
- Rollback:
  - Disable individual helpers behind feature flags if required.

## Phase Exit Criteria

- TerrainContextCard is stable, bounded, and used by planner path.
- Terrain blending transforms improve landscape fit in benchmark scenarios.
- Placement mode interpretation avoids common floating/misaligned builds.
- Terrain-related primitives are validated and safe.
