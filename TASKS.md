# Tasks

## Now

1. Planner Contract Hardening
   - Subtasks:
     - Align AI planner prompt and executor schema exactly so primitives use matching field names and shapes end to end.
     - Stop coercing unrelated requests into `build_house` or other nearest-match intents.
     - Strip or reject invented target regions and coordinates when the model is only asking for clarification.
     - Review `logs/ai-planner.jsonl` and `logs/ai-provider.log` after each planner change until false positives are removed.
   - Notes:
     - This task is complete only when unsupported/ambiguous requests consistently fail closed to clarification.

2. Material Resolution Pipeline
   - Subtasks:
     - Keep a dedicated material-resolution stage between planning and execution.
     - Normalize both heuristic and AI plans through one material pipeline before compiling bridge commands.
     - Keep and evolve a small approved starter palette (e.g., `wool`, `wood`, `stone bricks` -> valid ids).
     - Add a token-efficient block-selection system so plans can use a broad real Minecraft block set without pasting huge block lists into prompts.
     - Reject or clarify under-specified decorative/material requests instead of inventing invalid/obsolete block ids.
     - Teach planner prompts to emit either concrete block ids or symbolic material slots that the resolver can map safely.
   - Notes:
     - Resolution failures should return clarification, never silent fallback to risky block ids.
     - Block variety should improve while prompt size remains bounded.

3. Terrain Snapshot and Site Context
   - Subtasks:
     - Add terrain snapshot generation in the Spigot plugin.
     - Extend plugin payloads with surface height, top blocks, obstacles, and bounded occupancy summary.
     - Teach the planner to use terrain data for site preparation before building.
   - Notes:
     - Keep payload size bounded and useful for near-field planning.

4. Build Primitive and Heuristic Coverage
   - Subtasks:
     - Add primitives: plane, dome, ramp, tunnel, and roof helpers.
     - Improve heuristic `build_house` so it adapts to uneven terrain instead of assuming flat ground.
   - Notes:
     - Add focused regression tests for each new primitive and anchoring case.

5. Azure Planner Path Validation
   - Subtasks:
     - Exercise the Azure planner path with a real `.env`.
     - Validate structured JSON responses against the pass-based schema.
   - Notes:
     - Capture representative provider traces for regression checks.

6. Backlog and Code Review Hygiene
   - Subtasks:
     - Run regular code reviews on active TypeScript/plugin paths and fix small issues early.
     - Add newly discovered defects, cleanup work, and design follow-ups to this backlog as they are confirmed.
   - Notes:
     - Treat this as continuous work that supports all tasks above.

## Next

- Expand the material resolver from a tiny starter palette to structured palettes for `stone`, `wood`, `glass`, `wool`, roofing, and detail blocks.
- Extend the starter material palette to cover common AI outputs such as `fence`, `grass_block`, logs, planks, leaves, and other valid everyday blocks so the resolver does not over-clarify obviously buildable requests.
- Build a compact block taxonomy/index (tags + constraints + style metadata) and use retrieval/ranking to present only top-N valid candidates to the model per material slot.
- Add material-aware build specs so shapes and palettes are planned separately and can be swapped without regenerating geometry.
- Fix live clarification carry-over so follow-up prompts such as `bigger`, `oak`, or `I can't see it` actually arrive with recent prompt history instead of showing `recentMessages: []` in provider logs.
- Add iterative build execution with `observe -> replan -> continue` for multi-pass jobs.
- Add a post-execution refinement loop where the planner receives the altered zone snapshot and can either approve the result or return a revision.
- Support refinement revisions as either full-area replacement plans or sparse per-block delta edits, then compile both through the same safety/material pipeline.
- Add richer build specs for house, basement, bridge, tunnel, and dome.
- Add footprint sanity checks and minimum viable dimensions so requests like cottages, pens, and statues do not validate as tiny 2xN slivers or other obviously degenerate shapes.
- Add pass ordering and semantic validation so destructive/site-prep steps happen before finish steps, preventing plans like `fill water` followed by `clear air` from undoing themselves.
- Change plugin/site context capture so when there is no hit block the request includes a forward build-site sample and surface probe ahead of the player, instead of only sampling the tiny air cube around the player's body.
- Support above-ground and below-ground target interpretation such as `under here`, `into this hill`, and `beneath my house`.
- Distinguish surface, inset, underground, and elevated placement modes so anchors do not always snap builds to surface level.
- Add better tree removal targeting for non-oak trees and irregular canopies.
- Add execution progress replies and clearer error/clarification messages in game.
- Surface per-step execution failures to the Minecraft player immediately instead of hiding them behind generic success/error replies.
- Add cancellation or job interruption support for long-running builds.
- Store an undo buffer for the last prompted AI change, treating the original plan plus all refinement-loop revisions as one undo unit.

## Later

- Add decorative/detail passes using palettes and style presets.
- Add biome-aware and locally available material preferences so builds can adapt away from hard-coded global defaults.
- Add support for preserving nearby player builds by detecting likely man-made structures.
- Add terrain-aware support structures, retaining walls, and foundations automatically.
- Add repair mode so the bot can inspect an incomplete build and finish or fix it.
- Add build templates or saved specs that the planner can reuse.

## Risks and Unknowns

- The current local terrain snapshot is still too shallow for reliable large builds.
- Complex underground work will need stronger solid/air/cave detection than the current context model provides.
- Azure planner prompts may need iteration to keep responses strictly within the pass-based schema.
- The current intent vocabulary is too narrow, which encourages the model to misclassify unrelated requests into the nearest supported build type.
- Material names from user text and model output are currently much fuzzier than geometry, so block-id drift will keep causing execution failures until resolution is treated as a first-class planning step.
- The current anchoring helpers still bias toward surface-adjacent placement, which will be wrong for requests that should be inset into terrain, underground, or suspended in the air.
- The planner still accepts geometrically valid but semantically poor micro-builds, so schema validation alone is not enough to stop low-quality cottages, pens, and other tiny structures from executing.
- Even when primitives validate individually, pass order can still be semantically wrong and lead to self-cancelling builds or cleared finished work.
- When `targetBlock` is absent, the current payload still overrepresents the space around the player rather than the intended build area ahead, which biases the planner toward tiny floating or misplaced builds.
- Large `batchSet` payloads may need chunking if builds get much more ambitious.

## Working Practice

- Treat code review as recurring engineering work, not a one-off phase near release.
- Prefer fixing small structural issues when found instead of letting them accumulate into broad cleanup passes.
- Record follow-up issues here when they are real and actionable, even if they are not part of the current coding task.
