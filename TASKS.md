# Tasks

## Tracking Protocol

- Status sections are lifecycle buckets:
  - `Now`: active implementation work.
  - `Next`: queued after active work.
  - `Later`: valid backlog items not scheduled yet.
  - `Done`: tracked in `tasks/done.md` as completed and verified work only.
- Every task in `Now`/`Next`/`Later` should include:
  - Title line
  - `Subtasks` list
  - `Notes` list
- Completion rule:
  - Move completed work into `tasks/done.md`; do not leave completed items mixed into active queues.
  - Add completion date (`YYYY-MM-DD`) and evidence (tests, logs, commit id).
  - If only part of a task is complete, keep it in place and note completed slices explicitly.
- Detail policy:
  - Keep this file concise for daily execution.
  - Store detailed specs, acceptance criteria, and rollback plans in the `tasks/` folder.

## Backlog Layout

- Backlog index: `tasks/README.md`
- Phase 1 foundations: `tasks/phase-1-foundations.md`
- Phase 2 terrain and blending: `tasks/phase-2-terrain-blending.md`
- Phase 3 retrieval/refinement/undo: `tasks/phase-3-retrieval-refinement-undo.md`
- World mutation path investigation: `tasks/world-mutation-path.md`
- Open questions and risks: `tasks/open-questions.md`
- Completed work log: `tasks/done.md`

## Now

Research-informed execution lane based on `deep-research-report.md`.

1. Phase 1 Foundations — COMPLETE (pending Azure live-run)
   - Subtasks: all done. See `tasks/done.md` entries 5–14 for evidence.
   - Notes:
     - Safety envelope raised: region 32×48×32, 8192 blocks, 32-block player
       distance. Template caps updated to match.
     - Degenerate structure check added: rejects fill-type plans with bounding
       box volume < 4 for structure intents; set_block-only plans exempt.
     - DIG follow-up wiring (route taller/bigger/material through DIG patches)
       deferred to Phase 2 — current heuristic already produces correct output.
     - Indexed candidate selection deferred to Phase 2.
     - Azure baseline requires live server; not blocking Phase 2 start.

2. Follow-Up Context Reliability and Diagnostics
   - Subtasks:
     - Keep request-id correlation stable across planner/provider/bridge logs.
     - Preserve last-built-structure context behavior under non-structure commands.
   - Notes:
     - This directly affects user trust and test velocity.
     - All heuristic follow-ups implemented and tested: `oak`, `bigger`, `taller`,
       `higher`, `use X instead`, `with X`, `as X`, `I can't see it`, `where is it`,
       `taller by N` edge phrasing (N > 8 clamp, bare-number, no-number default).
     - `buildStructureMaterialFollowUpFromPreviousPlan` replaces ALL primitive
       blocks with the new material. Revisit when style-lock policy is decided.

3. Azure Planner Path Baseline Validation
   - Subtasks:
     - Run real Azure path with representative prompts and collect provider traces.
     - Replay traces against schema and semantic checks.
     - Record fixtures for regression use after each major planner change.
   - Notes:
     - Keep local heuristic fallback behavior unchanged when Azure path is unavailable.

4. World Mutation Path Decision Prep
   - Subtasks:
     - Maintain current-path documentation (`tasks/world-mutation-path.md`).
     - Define acceptance criteria for any plugin-API migration path.
     - Produce a decision record comparing command-path vs plugin-API vs hybrid execution.
   - Notes:
     - Do not begin risky migration work until decision criteria are agreed.

5. Open Questions Resolution
   - Subtasks:
     - Resolve decision-blocking items in `tasks/open-questions.md`:
       - server target scope
       - mutation backend direction
       - interiors scope now vs later
       - hard safety envelope
       - style-lock policy across refinements
     - Track each resolution in backlog notes before dependent implementation starts.
   - Notes:
     - Unresolved questions should block only the dependent tasks, not all work.

6. Backlog and Code Review Hygiene
   - Subtasks:
     - Run periodic review passes on planner/orchestrator/plugin paths.
     - Add concrete defects and follow-up actions to this backlog immediately.
     - Move completed work to `Done` with evidence.
   - Notes:
     - Keep this as continuous support work.
     - Review pass 2026-03-21 (behavioral): fixed `isWoodBlock` stone-stairs
       misclassification, tightened cylinder drop guard, extracted shared
       `escapeRegex`, fixed `{{ wall }}` trim bug. 38 → 50 tests.
     - Vibe-coding pass 2026-03-21: removed vestigial worldReader disk reads,
       removed dead `debug` flag, collapsed 3 duplicate plan-guard predicates,
       fixed hardcoded "taller" clarification reply, normalised fill/clear cuboid
       compile path, cylinder safety cap added, re-export chain cleaned,
       `createChatProvider` config ownership fixed, Java orphan imports removed,
       prompt schema guide split. 50 → 53 tests.

## Next

1. Phase 2 Terrain Context and Blending — ACTIVE
   - Subtasks:
     - Execute `tasks/phase-2-terrain-blending.md`:
       - TerrainContextCard generator
       - Terrain-adaptive compile transforms
       - Placement mode expansion
       - Terrain-oriented primitive hardening
   - Notes:
     - Phase 1 foundations are stable. Terrain integration can begin.

2. Execution UX and Job Control
   - Subtasks:
     - Add progress/status messaging and explicit per-step failure surfacing.
     - Add cancellation/interruption semantics for long-running jobs.
     - Keep messaging tied to request-id and transaction context.
   - Notes:
     - Coordinate this with refinement-loop and undo design to avoid duplicate control paths.

3. Benchmark and Evaluation Harness
   - Subtasks:
     - Build repeatable scenario fixtures for terrain and structure quality checks.
     - Add automatic scoring for structural validity, terrain intrusion, palette diversity, and budget compliance.
     - Add baseline-vs-new comparisons before enabling each major phase by default.
   - Notes:
     - Needed to validate deep-research recommendations objectively.

## Known Bugs (confirmed from live test 2026-03-22)

Each entry states: what should happen / what actually happened / log evidence / suspected cause.

**BUG-1: Template parsers never fire if server not restarted after code change**
- Should: "bot: build me a tower here" → heuristic tower template → 3×3×8 fill_cuboid, no AI call.
- Actual: Every request today (07:27–07:38) appears in `ai-planner.jsonl` under `plan_validated`, confirming all went through the AI path. No fill_cuboid from a template was observed.
- Evidence: req=786314fe "build_tower", req=9010f839 "build_gazebo", req=39a3eba6 "build_barn" all in AI planner log.
- Cause: `tsx` compiles once at process startup. Running server must be restarted after code commits for templates to take effect.
- Fix: Operational — always `npm start` (restart) after code changes. Add a startup banner that prints the git commit hash so the running version is visible.

**BUG-2: Tower anchor uses footprint min-corner instead of centre — tower displaced by 1 block**
- Should: Tower centred on the looked-at block.
- Actual: `parseTowerRequest` calls `structureFootprintOrigin(request, width, width)` which returns the min corner, then passes it to `compileTowerTemplate` as `anchor` (documented as "bottom-centre"). The tower is shifted one block left and forward relative to the target.
- Evidence: Code inspection — `structureFootprintOrigin` returns `{ x: centre.x - floor(w/2), z: centre.z - floor(w/2) }`. `compileTowerTemplate` then does `fromX = anchor.x - floor(w/2)`, further displacing the tower.
- Fix: Change `parseTowerRequest` to pass the true centre: `const footprintMin = structureFootprintOrigin(request, width, width); const anchor = { x: footprintMin.x + Math.floor(width/2), y: footprintMin.y, z: footprintMin.z + Math.floor(width/2) };`

**BUG-3: Second build request in same session bypasses templates and goes to AI**
- Should: "bot: build me a barn here" → barn template every time.
- Actual: Template parsers are gated on `!previousPlan`. After the first successful build sets `lastBuiltStructurePlanByPlayer`, every subsequent build request (even completely new structures) skips the template check and goes straight to AI.
- Evidence: `buildHeuristicPlan` dispatch block has `if (!previousPlan) { ... templates ... }`. After any successful build, `previousPlan` is non-null for the rest of the session.
- Fix: Template parsers should only be skipped for FOLLOW-UP phrasing (taller, bigger, material, location), not for fresh build requests. Restructure dispatch: check if the message is a follow-up first; if not, always try templates regardless of `previousPlan`.

**BUG-4: AI produces 2-block-wide structures for house/barn/cottage instead of template dimensions**
- Should: "bot: build me a house here" → cottage template → 7×7 hollow shell + roof.
- Actual (AI path): req=bbb0463e "build_house" → 2×3×5 hollow_cuboid walls + flat roof (2 blocks wide). req=39a3eba6 "build_barn" → 5×4×5 box. req=c9f6a9da "build_cottage" → 3×3×5 box. req=681b91d4 "build_cottage" → 4×3×4 box.
- Evidence: bridge-actions.jsonl: fill 2x3x5 stone_bricks, fill 2x1x5 (roof); fill 5x4x5, etc.
- Cause: BUG-3 (templates bypassed after first build) + AI does not respect minimum footprint dimensions and generates coordinates within 2 blocks of the player position.
- Fix: Fix BUG-3. For AI fallback, the degenerate structure check (volume < 4) catches the worst cases, but the AI generating 2-wide structures still passes.

**BUG-5: AI generates cylinder primitive for "tower" instead of fill_cuboid column**
- Should: Tower template produces a fill_cuboid (solid) or hollow_cuboid (hollow) column.
- Actual (AI path): req=786314fe — fill 9×1×5 (stone_bricks base) + batchSet blocks=580 (cylinder, r≈4, h≈20) + fill 9×1×5 (oak_stairs roof). User reported: "only 5 blocks high, made a 2×7×3 stone blocks structure."
- Evidence: bridge-actions.jsonl: batchSet blocks=580 for tower request.
- Cause: BUG-1 (wrong server version) + AI interprets "tower" as cylindrical and uses the cylinder primitive.
- Fix: Fix BUG-1 and BUG-3. Template towers never use cylinders.

**BUG-6: AI gazebo is a rectangular box, not a cylinder ring + posts + cap**
- Should: Gazebo template → hollow cylinder ring (ground) + 4 vertical posts + solid cylinder roof cap.
- Actual (AI path): req=9010f839 "build_gazebo" → fill 4×1×9 (floor, material:floor) + hollow_cuboid 4×2×9 (walls, material:wall) + fill 4×1×9 (roof, material:roof). User reported: "filled stone cube with wood on bottom, wood steps on top, 4×9".
- Evidence: bridge-actions.jsonl: fill 4x1x9 oak_planks + hollow + fill oak_stairs.
- Cause: BUG-1 and BUG-3. AI does not know the gazebo template shape.
- Fix: Fix BUG-1 and BUG-3. Gazebo template always produces cylinders.

**BUG-7: Bridge template route — AI produces 2-wide flat span without proper railings**
- Should: Bridge template → 3-wide walkway oriented along look direction + fill_cuboid fence railings.
- Actual (AI path): req=a2c3d21f "build_bridge" → fill 2×1×5 stone_bricks + 4 set_block (roof material used as railing — incorrect slot). User reported: "still 2 wide, 2×5".
- Evidence: bridge-actions.jsonl: fill 2x1x5 stone_bricks + setBlock oak_stairs (4 times).
- Cause: BUG-1 and BUG-3. AI produces a narrow flat span; the `material:roof` slot is used for railings (wrong — should be `material:detail`).
- Fix: Fix BUG-1 and BUG-3. Bridge template uses `material:detail` (fence-family) for railings, oriented by look vector.

**BUG-8: Nearby material resolver correctly picks up environment (PASS with caveat)**
- Should: Material slots resolve to blocks that match the player's surroundings.
- Actual: User confirmed "worked — picked up on spruce deck and made it spruce." Material resolver correctly scored spruce_planks higher due to nearby blocks. No fix needed. Caveat: only works when the AI path is also used; template path resolves materials via `resolvePlanMaterials` after template compilation, which should also work.

## Known Small Defects (fix when touched)

- `parseRequestedBlock` returns only the first matched `minecraft:` id in a
  message; multi-block messages silently ignore later ids. Acceptable for now;
  document before expanding material resolution.
- `structureAnchorPoint` in `requestContext.ts` is a trivial forwarding alias
  for `structureCenterPoint`. Remove one or add a doc comment explaining the
  distinction before the next requestContext refactor.
- `isBuiltStructurePlan` (orchestrator) and `isAdjustableStructurePlan`
  (heuristicPlanner) share overlapping additive-primitive walk logic. Consolidate
  when the structure-context shape changes (e.g. DIG integration).
- `WorldReader.readPlayerMetadata` is a dead public method — no callers. Remove
  or use it when terrain context / DIG integration begins.
- `managedBlocks` in `BridgeServer` is an unbounded dedup cache that never
  evicts. Fine for a dev-session server; add a max-size cap or session-scoped
  reset if the server runs long-term.
- Plugin `serverContextJson` sends `world.getEnvironment().name()` → `"NORMAL"` /
  `"NETHER"` / `"THE_END"`. TypeScript code doesn't validate this field but test
  fixtures use `"minecraft:overworld"`. Align formats if dimension ever becomes
  meaningful on the TS side.

## Later

1. Phase 3 Retrieval, Refinement, and Undo
   - Subtasks:
     - Execute `tasks/phase-3-retrieval-refinement-undo.md`:
       - Retrieval library and bounded prompt injection
       - Bounded refinement loop with DIG patches
       - Transaction log and undo buffer
       - Material variety quality gates
   - Notes:
     - Keep rollout gated behind benchmark and safety outcomes.

2. Decorative and Biome Style Expansion
   - Subtasks:
     - Add richer decorative/detail passes and style presets.
     - Expand biome-aware material/style preferences.
     - Add repair mode and reusable build templates/specs.
   - Notes:
     - Keep this separate from core correctness and safety milestones.

3. Nearby Build Preservation
   - Subtasks:
     - Add detection for likely player-made nearby structures.
     - Add avoidance/protection policies during planning and execution.
   - Notes:
     - Requires stable terrain/context and safety metadata.

## Done

- Completed work is tracked in `tasks/done.md`.

## Risks and Unknowns

- Detailed risk register and unresolved decisions are tracked in `tasks/open-questions.md`.
- Keep this section as a short pointer; maintain detailed risk notes in the dedicated file.

## Working Practice

- Treat code review as recurring engineering work, not a one-off phase near release.
- Prefer fixing small structural issues early instead of letting them accumulate.
- Keep this file concise; push deep execution detail into the phase docs.
