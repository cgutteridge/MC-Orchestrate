# Completed Tasks

5. Code Review + Vibe-Coding Cleanup Pass (2026-03-21)
   - Subtasks:
     - Fixed `isWoodBlock` incorrectly classifying stone stair variants as wood, corrupting material slot scoring.
     - Tightened cylinder drop guard in `repairPrimitive` from `&&` to a proper `fullySpecified` check, preventing partial-spec cylinder hallucination.
     - Extracted shared `escapeRegex` utility from `aiPlanner.ts` and `materialPalette.ts`.
     - Fixed `{{ wall }}` whitespace trim bug in `parseMaterialSlot`.
     - Added 15 regression tests: alternate slot prefixes, `replace_in_region` symbolic `toBlock`, "higher" keyword, `{{ wall }}` spaces, stone-stair nearby scoring, partial-spec cylinder, prompt schema split, cylinder safety cap, "bigger" without context.
     - Removed vestigial WorldReader disk reads from "no plan" orchestrator path.
     - Removed unused `debug` parameter from `createChatProvider` and `AzureOpenAIChatProvider`.
     - Collapsed `isHeightAdjustableStructurePlan`, `isMaterialAdjustableStructurePlan`, `isFootprintAdjustableStructurePlan` into single `isAdjustableStructurePlan`.
     - Fixed `buildStructureFollowUpClarification` to give context-appropriate reply (not always "taller").
     - Merged near-duplicate `parseHeightDelta`/`parseFootprintDelta` into shared `parseDelta` helper.
     - Removed re-export chain: `normalizeBlockId`/`parseRequestedBlock` now imported directly from `materialPalette.ts`.
     - Fixed `createChatProvider` to take `AppConfig` directly; removed internal `loadConfig()` call.
     - Added primitive block-count check to `validatePlanSafety` so cylinders cannot bypass the 2048-block cap via a small declared `targetRegion`.
     - Split `"fill_cuboid | hollow_cuboid"` in prompt schema guide into two distinct examples.
     - Normalised `fill_cuboid`, `clear_region`, and `replace_in_region` coordinates in compile path (was inconsistent with `hollow_cuboid`).
     - Removed 6 orphan Java imports from `McOrchestratePlugin.java`.
     - Added JsDoc to `parseRequestedBlock`, `normalizeBlockId`, `resolvePlanMaterials`.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build` — 38 → 53 tests, all green.

13. Phase 1 Task 1 — Design Intent Graph v1 (2026-03-21)
    - Subtasks:
      - Added `src/planner/dig.ts` with Zod-validated schema for `DesignIntentGraph`, `DigPart` (stable deterministic part ids: `${passName}:${index}`), `DigMaterialSlot`, and `DigPatch` (set_material, scale_height, scale_footprint).
      - `compilePlanToDig(plan, playerUuid)`: converts a Plan to a DIG, inferring slot ids from pass names, extracting block fields into materialSlots, starting at revision 0.
      - `compileDigToPlan(dig)`: round-trips a DIG back to a Plan, resolving slot ids to current blocks and recomputing the bounding-box targetRegion.
      - `applyDigPatch(dig, patch)`: applies a single patch and increments revision. `set_material` is idempotent (no change if block is already the same value). `scale_height` and `scale_footprint` adjust geometry dimensions.
      - `computeDigDigest(dig)`: sorts parts by partId and slots by slotId before serialising, producing a stable digest for regression comparison.
      - Orchestrator now creates and stores a DIG in `lastDigByPlayer` on each successful structure build, alongside the existing Plan store.
      - 18 tests: schema validation, stable part ids, material slot extraction, round-trip, set_material patch + idempotence + compiled plan, scale_height, digest determinism + ordering stability.
    - Notes:
      - Completed: 2026-03-21
      - Evidence: `npm test`, `npm run build` — 115 → 133 tests, all green.

12. Phase 1 Task 3 — Deterministic Template Compilers: Barn + Gazebo (2026-03-21)
    - Subtasks:
      - Added `BarnParams` + `compileBarnTemplate`: hollow_cuboid walls + A-frame gabled roof. Roof pitch is computed from depth — each layer steps inward by 1 on each Z side. For depth=8: 3 roof fill_cuboid layers; ridge is always the narrowest central slice.
      - Added `GazeboParams` + `compileGazeboTemplate`: hollow cylinder platform ring + 4 vertical `fill_cuboid` posts at N/S/E/W + solid cylinder roof cap. Three passes.
      - Added `parseBarnRequest` (triggers on "barn", "stable", "shed") and `parseGazeboRequest` (triggers on "gazebo", "pavilion", "pergola") with shared complexity blocklist.
      - Both wired into `buildHeuristicPlan` before follow-up dispatch.
      - 10 template unit tests + 2 integration tests. 100 → 115 tests, all green.
    - Notes:
      - Completed: 2026-03-21
      - Evidence: `npm test`, `npm run build`

11. Phase 1 Task 3 — Deterministic Template Compiler: Bridge (2026-03-21)
    - Subtasks:
      - Added `BridgeParams` type and `compileBridgeTemplate` in `templates.ts`.
      - Walkway: single-block-thick `fill_cuboid` slab. Railings: two `fill_cuboid` fence strips one block above the long edges, only emitted when width ≥ 3.
      - `parseBridgeRequest` reads look vector (with yaw fallback) to determine the span axis and direction. Default 3-wide, 8-block span with railings.
      - Triggers on "bridge", "walkway", "catwalk". Complexity blocklist routes spiral/lighthouse/etc. to AI.
      - 8 template unit tests (determinism, intent, pass count, railing placement for both axes, narrow/no-railing edge cases, budget compliance) + 1 integration test.
    - Notes:
      - Completed: 2026-03-21
      - Evidence: `npm test`, `npm run build` — 91 → 100 tests, all green.

10. Phase 1 Task 3 — Deterministic Template Compilers: Tower + Cottage (2026-03-21)
    - Subtasks:
      - Added `src/planner/templates.ts` with typed `TowerParams` / `CottageParams` records and pure `compileTowerTemplate` / `compileCottageTemplate` functions. Geometry and material slots are fully separate.
      - Tower: square footprint (2–8 wide), height (3–16), hollow flag, symbolic or concrete block. Even-width footprints centred correctly.
      - Cottage: 7×7 footprint, 4-block walls, hollow shell pass + flat roof pass. Wall and roof use independent symbolic slots.
      - Added `parseTowerRequest` and `parseCottageRequest` parsers with a complexity blocklist (spiral, lighthouse, pointed, etc.) that routes complex requests to the AI.
      - Wired into `buildHeuristicPlan` before follow-up dispatch; template path only runs when no `previousPlan` is in context.
      - 13 template unit tests (determinism, bounding box, hollow flag, budget compliance) + 5 integration tests in heuristicPlanner.
    - Notes:
      - Completed: 2026-03-21
      - Evidence: `npm test`, `npm run build` — 72 → 91 tests, all green.

9. Phase 1 Task 4 — Pass-Order Semantic Guardrail (2026-03-21)
   - Subtasks:
     - Added `src/planner/semantics.ts` with `validatePlanSemantics`.
     - `detectPassOrderViolation` flags plans where a destructive primitive
       (`clear_region` or `replace_in_region` with `toBlock=air`) encloses or
       equals an earlier build primitive's region. Hollowing (inner clear smaller
       than the fill) is correctly allowed.
     - Wired `validatePlanSemantics` into orchestrator after `validatePlanSafety`
       with `status: "rejected"` response.
     - 7 unit tests covering: normal plan, hollow pattern, same-region clear,
       enclosing clear, replace-with-air, replace-with-non-air (valid restyle),
       empty plan. Plus 1 orchestrator integration test.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build` — 64 → 72 tests, all green.

8. Phase 1 Material KB — Prompt Context Card and Symbolic Slot Preference (2026-03-21)
   - Subtasks:
     - Added `buildNearbyContextSummary`: computes top-5 nearby structural blocks (terrain excluded) and formats as a compact one-line card.
     - Injected context card into the user message so the LLM sees local material hints without a global block catalog.
     - Replaced "Prefer concrete modern block ids" system instruction with "Prefer symbolic slots; only use concrete id when the player explicitly named the material".
     - Added 3 new tests: symbolic slot preference instruction present, context card with structural blocks, context card omitted for terrain-only.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build` — 61 → 64 tests, all green.

7. Phase 1 Material KB — Structural Constraint Pruning (2026-03-21)
   - Subtasks:
     - Added `NON_STRUCTURAL_BLOCKS` (air, water, lava, grass_block, dirt, leaves) and `GRAVITY_BLOCKS` (sand, gravel, all 16 concrete powder variants) to `materialPalette.ts`.
     - `resolveBlockId` now accepts a `structural: boolean` flag; returns unresolved when a non-structural or gravity block is used in a build primitive (`set_block`, `fill_cuboid`, `hollow_cuboid`, `cylinder`).
     - `replace_in_region` correctly exempt — air and water remain valid as operational `fromBlock`/`toBlock` values.
     - Added tests: fluid block in `fill_cuboid` → clarification; fluid block in `replace_in_region` → allowed.
     - Fixed import position in `materialPalette.ts` (import was below constant declarations).
     - Added 5 `taller by N` edge phrasing tests: N > 8 clamp (→ 8), bare-number without "by" keyword, no number (→ default 2).
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build` — 56 → 61 tests, all green.

6. Follow-Up Pattern Expansion (2026-03-21)
   - Subtasks:
     - Expanded `isMaterialFollowUpMessage` to recognise "with", "as", "using" context words and two-word bare material names ("oak planks").
     - Added `isLocationQuery` and `buildStructureLocationReply` for "I can't see it" / "where is it" follow-ups; replies with structure centre coordinates and a `/tp` command.
     - Added 3 new tests: multi-phrasing material restyle, location reply with coords, location with no prior context.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build` — 53 → 56 tests, all green.

1. Generic Material Follow-Up Fallback
   - Subtasks:
     - Added heuristic follow-up handling for material restyles against the last bot-built structure (`oak`, `use oak instead`, similar material follow-ups).
     - Kept behavior generic by applying to prior additive structure primitives, not intent-name allowlists.
     - Added orchestrator fallback coverage when AI planning fails on the follow-up turn.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`
     - Evidence: commit `8922aec`

2. Generic Bigger Follow-Up Fallback
   - Subtasks:
     - Added heuristic follow-up handling for `bigger`/`larger` requests using the last bot-built structure context.
     - Expanded footprint horizontally as deterministic ring fills while preserving prior structure height and primary material.
     - Added orchestrator fallback coverage for AI-provider failure on bigger follow-up turns.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`

3. Follow-Up Structure Context Hardening
   - Subtasks:
     - Prefer extending the last bot-built structure for `taller`/`higher` follow-ups instead of relying on tower keyword heuristics.
     - Preserve previous footprint and primary material when extending.
     - Keep non-structure commands from overwriting the stored structure follow-up context.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`, `npm run plugin:build`
     - Evidence: commit `8b3194d`

4. Material Slot Resolver v1
   - Subtasks:
     - Added symbolic material-slot support in resolver (`material:wall`, `material:roof`, `material:floor`, `material:trim`, `material:detail`, `material:wood`, `material:stone`, `material:glass`, `material:wool`).
     - Added deterministic context-aware slot ranking using nearby block histogram and player material hints.
     - Expanded supported palette aliases for roof variants (`spruce_stairs`, `stone_brick_stairs`, `cobblestone_stairs`).
     - Updated planner prompt guidance to allow symbolic slots.
     - Added regression tests for slot resolution, spruce preference, and unknown-slot clarification.
   - Notes:
     - Completed: 2026-03-21
     - Evidence: `npm test`, `npm run build`
