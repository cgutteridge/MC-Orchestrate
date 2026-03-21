# Tasks

## Now

- Run regular code reviews on the active TypeScript/plugin paths and fix small issues before they accumulate.
- Add newly discovered defects, cleanup work, and design follow-ups to this backlog as they are found.
- Add terrain snapshot generation in the Spigot plugin.
- Extend plugin payloads with surface height, top blocks, obstacles, and a bounded occupancy summary.
- Teach the planner to use terrain data for site preparation before building.
- Add more build primitives: plane, dome, ramp, tunnel, and roof helpers.
- Improve heuristic plans so `build_house` adapts to uneven terrain instead of assuming flat ground.
- Exercise the Azure planner path with a real `.env` and validate structured JSON responses against the pass-based schema.

## Next

- Add iterative build execution with `observe -> replan -> continue` for multi-pass jobs.
- Add richer build specs for house, basement, bridge, tunnel, and dome.
- Support above-ground and below-ground target interpretation such as `under here`, `into this hill`, and `beneath my house`.
- Add better tree removal targeting for non-oak trees and irregular canopies.
- Add execution progress replies and clearer error/clarification messages in game.
- Add cancellation or job interruption support for long-running builds.

## Later

- Add decorative/detail passes using palettes and style presets.
- Add support for preserving nearby player builds by detecting likely man-made structures.
- Add terrain-aware support structures, retaining walls, and foundations automatically.
- Add repair mode so the bot can inspect an incomplete build and finish or fix it.
- Add build templates or saved specs that the planner can reuse.

## Risks and Unknowns

- The current local terrain snapshot is still too shallow for reliable large builds.
- Complex underground work will need stronger solid/air/cave detection than the current context model provides.
- Azure planner prompts may need iteration to keep responses strictly within the pass-based schema.
- Large `batchSet` payloads may need chunking if builds get much more ambitious.

## Working Practice

- Treat code review as recurring engineering work, not a one-off phase near release.
- Prefer fixing small structural issues when found instead of letting them accumulate into broad cleanup passes.
- Record follow-up issues here when they are real and actionable, even if they are not part of the current coding task.
