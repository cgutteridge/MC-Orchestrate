# Completed Tasks

1. Generic Material Follow-Up Fallback
   - Subtasks:
     - Added heuristic follow-up handling for material restyles against the last bot-built structure (`oak`, `use oak instead`, similar material follow-ups).
     - Kept behavior generic by applying to prior additive structure primitives, not intent-name allowlists.
     - Added orchestrator fallback coverage when AI planning fails on the follow-up turn.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`
     - Evidence: commit `8922aec`

2. Follow-Up Structure Context Hardening
   - Subtasks:
     - Prefer extending the last bot-built structure for `taller`/`higher` follow-ups instead of relying on tower keyword heuristics.
     - Preserve previous footprint and primary material when extending.
     - Keep non-structure commands from overwriting the stored structure follow-up context.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`, `npm run plugin:build`
     - Evidence: commit `8b3194d`

3. Material Slot Resolver v1
   - Subtasks:
     - Added symbolic material-slot support in resolver (`material:wall`, `material:roof`, `material:floor`, `material:trim`, `material:detail`, `material:wood`, `material:stone`, `material:glass`, `material:wool`).
     - Added deterministic context-aware slot ranking using nearby block histogram and player material hints.
     - Expanded supported palette aliases for roof variants (`spruce_stairs`, `stone_brick_stairs`, `cobblestone_stairs`).
     - Updated planner prompt guidance to allow symbolic slots.
     - Added regression tests for slot resolution, spruce preference, and unknown-slot clarification.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`
