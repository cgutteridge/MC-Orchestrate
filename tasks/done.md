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
