# Phase 1 Foundations

## Goal

Establish the stable architecture baseline from the deep-research report:

- LLM outputs compact design intent, not raw block catalogs.
- Deterministic code compiles intent into geometry/material/bridge actions.
- Safety, material validity, and follow-up reliability are enforced by tests.

## Task 1: Design Intent Graph (DIG) Persistence and Revisioning

- Subtasks:
  - Define versioned DIG schema with stable `part_id`s and separated geometry/material slots.
  - Store DIG per player/session in orchestrator state.
  - Add DIG patch application flow for iterative revision without full regeneration.
  - Add deterministic render digest summaries for change review and regression tests.
- Acceptance criteria:
  - Same request + same seed produces the same DIG.
  - DIG patch application is idempotent for unchanged fields.
  - DIG schema validation failures fail closed with clarification.
- Expected tests:
  - Schema validation tests.
  - Patch idempotence tests.
  - Digest determinism tests.
- Rollback:
  - Feature flag `dig_enabled=false` to use existing direct plan flow.

## Task 2: Material Knowledge Base and Palette Resolver

- Subtasks:
  - Enumerate valid `Material` values and expose deterministic metadata (`isBlock`, `isSolid`, gravity-sensitive, flammability/hardness where available).
  - Build tag-aware candidate generation for slot categories (wall/roof/floor/trim/detail).
  - Anchor candidates to local context first, then expand via curated/tag groupings.
  - Prune by constraints (for example no gravity blocks for structural walls by default).
  - Keep candidate list caps strict (for example <=12 per slot, <=40 total).
  - Require planner to choose by candidate index or symbolic slot, not free-form global ids.
- Acceptance criteria:
  - Resolver never emits non-block materials for structural slots.
  - Candidate ordering is deterministic.
  - Prompts do not include global block catalogs.
- Expected tests:
  - Candidate cap tests.
  - Constraint-pruning tests.
  - Deterministic ordering tests.
  - Fallback behavior tests when tags or categories are missing.
- Rollback:
  - Fixed fallback palette (`stone`, `oak_planks`, `cobblestone`, `white_wool`) when resolver fails.

## Task 3: Deterministic Geometry Compiler for Core Templates

- Subtasks:
  - Implement deterministic compilers for top templates: cottage, tower, bridge, barn, gazebo.
  - Keep template geometry and material slots separate so palettes can be swapped without geometry rewrite.
  - Emit ordered bridge primitives with explicit region/budget metadata.
  - Add primitive helpers needed by templates (roof helpers, planes, ramps, tunnels) where deterministic and tested.
- Acceptance criteria:
  - Generated regions stay in safety budgets.
  - No schema-valid but degenerate micro-builds.
  - Same template input yields identical primitive sequence.
- Expected tests:
  - Bounding box and footprint sanity tests.
  - Primitive order semantic tests.
  - Budget compliance tests.
- Rollback:
  - Per-template feature flags to disable problematic compilers.

## Task 4: Planner Contract and Safety Semantic Guardrails

- Subtasks:
  - Keep prompt schema and executor schema aligned exactly.
  - Reject coercion of unsupported intents into nearest supported build intent.
  - Reject clarification responses that include invented executable geometry.
  - Add semantic pass-order checks so finish passes cannot be undone by later destructive steps.
  - Add minimum viable dimensions/shape sanity checks per structure type.
- Acceptance criteria:
  - Ambiguous requests consistently return clarification.
  - Invalid pass order is rejected before compile.
  - Degenerate structures fail validation.
- Expected tests:
  - Unsupported intent clarification tests.
  - Clarification-with-geometry rejection tests.
  - Pass-order rejection tests.
  - Footprint sanity tests.
- Rollback:
  - Keep checks behind explicit guardrail flags if incremental rollout is needed.

## Task 5: Follow-Up Context Reliability and Diagnostics

- Subtasks:
  - Ensure plugin and orchestrator recent-message history remains available in live runs.
  - Keep last-built-structure context for follow-up transformations (`taller`, `higher`, revisions).
  - Add request-id correlation guarantees across `ai-planner`, provider, and bridge logs.
  - Add regression tests for follow-ups such as `bigger`, `oak`, and `I can't see it`.
- Acceptance criteria:
  - Follow-up prompts resolve the intended prior structure context in tests and live traces.
  - Logs are sufficient to diagnose wrong builds from one request id.
- Expected tests:
  - Orchestrator context continuity tests.
  - Follow-up intent resolution tests.
  - Log field consistency tests.
- Rollback:
  - Retain heuristic-only fallback for known follow-up phrases.

## Task 6: Azure Planner Baseline Validation

- Subtasks:
  - Run real Azure-backed planner path with representative prompts.
  - Capture and store provider traces for regression.
  - Validate structured outputs against current schema and semantic guardrails.
  - Verify failure modes return clear clarification, not unsafe execution.
- Acceptance criteria:
  - Azure path passes the same safety and schema checks as local test providers.
  - Trace fixtures are available for future regression comparisons.
- Expected tests:
  - Integration tests with captured provider responses.
  - Schema/guardrail replay tests.
- Rollback:
  - Provider-disabled mode falls back cleanly to heuristics.

## Phase Exit Criteria

- DIG flow and material resolver are deterministic and tested.
- Core templates compile safely with sane footprint checks.
- Follow-up reliability and diagnostics are stable in both tests and live runs.
- Azure baseline traces are captured and reusable.
