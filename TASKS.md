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

1. Phase 1 Foundations Execution
   - Subtasks:
     - Execute `tasks/phase-1-foundations.md` in this order:
       - Material Knowledge Base + palette resolver
       - DIG schema/persistence + revision patching
       - Deterministic compiler for core templates
       - Planner contract and semantic safety checks
     - Keep deterministic outputs and bounded token behavior as hard requirements.
     - Wire acceptance tests and feature flags before broad rollout.
   - Notes:
     - This is the highest-value lane and should stay active until phase exit criteria pass.
     - Keep prompts free of global material catalogs.

2. Follow-Up Context Reliability and Diagnostics
   - Subtasks:
     - Finish carry-over tests for follow-ups (`bigger`, `oak`, `I can't see it`, `taller by N`).
     - Keep request-id correlation stable across planner/provider/bridge logs.
     - Preserve last-built-structure context behavior under non-structure commands.
   - Notes:
     - This directly affects user trust and test velocity.

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

## Next

1. Phase 2 Terrain Context and Blending
   - Subtasks:
     - Execute `tasks/phase-2-terrain-blending.md`:
       - TerrainContextCard generator
       - Terrain-adaptive compile transforms
       - Placement mode expansion
       - Terrain-oriented primitive hardening
   - Notes:
     - Start once Phase 1 foundations are stable enough for terrain integration.

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
