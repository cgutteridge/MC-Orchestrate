# Phase 3 Retrieval, Refinement, and Undo

## Goal

Increase design quality and controllable variety while preserving deterministic execution, bounded cost, and recoverability.

## Task 1: Retrieval Library and Bounded Injection

- Subtasks:
  - Define blueprint/style document format (`doc_id`, tags, compact recipe summary, allowed params).
  - Build curated starter library for common structures and style variants.
  - Implement retrieval with hard filters first (biome/scale/style) then top-k ranking.
  - Inject only bounded summaries and ids into prompts; never full documents.
- Acceptance criteria:
  - Retrieval output stays within token budget.
  - Retrieval has deterministic fallback when no matches are found.
- Expected tests:
  - Retrieval filter/ranking tests.
  - Prompt token-cap tests.
  - Empty-result fallback tests.
- Rollback:
  - `retrieval_enabled=false` falls back to template-only planning.

## Task 2: Bounded Refinement Loop

- Subtasks:
  - Implement critique input based on compiler feedback metrics (collisions, monotony, floating-risk indicators, budget pressure).
  - Add DIG patch revision flow with stable part ids.
  - Enforce hard stop after <=2 refinement passes per request unless safety fails.
  - Support revision formats as full-area replacement or sparse block/part deltas.
- Acceptance criteria:
  - Loop terminates deterministically within configured pass limit.
  - Revisions change only allowed DIG fields.
  - Refinement improves acceptance metrics without budget blowups.
- Expected tests:
  - Loop termination tests.
  - DIG patch constraints tests.
  - Regression tests for sparse and full-area revision paths.
- Rollback:
  - `refinement_enabled=false` keeps single-pass planning.

## Task 3: Transaction Log and Undo Buffer

- Subtasks:
  - Wrap executions in transaction ids with per-request change tracking.
  - Implement undo buffer semantics where original execution + refinements are one logical undo unit.
  - Add `undo(tx_id)` execution path with safety checks.
  - Validate large fill/batch behavior for transaction storage and replay.
- Acceptance criteria:
  - Undo restores world state for tracked edits in integration tests.
  - Refinement chain is reversible as one unit.
  - Transaction logging overhead remains within acceptable latency budget.
- Expected tests:
  - Undo correctness tests.
  - Large-change transaction stress tests.
  - Refinement-chain undo tests.
- Rollback:
  - `undo_enabled=false` keeps current no-undo behavior.

## Task 4: Execution UX and Job Control

- Subtasks:
  - Add progress feedback for multi-pass execution and refinement loops.
  - Surface per-step failures with actionable reasons.
  - Add cancellation/interruption support for long-running jobs.
  - Keep player-facing messages concise and tied to request id context.
- Acceptance criteria:
  - Long jobs provide visible progress and can be cancelled safely.
  - Failure messaging reflects actual failed step and reason.
- Expected tests:
  - Progress event sequencing tests.
  - Cancellation tests for active jobs.
  - Error propagation tests from bridge execution path.
- Rollback:
  - Keep existing response path as fallback when job-control is disabled.

## Task 5: Material Variety Quality Controls

- Subtasks:
  - Add palette diversity and repetition scoring before final execution.
  - Enforce minimum variety thresholds by structure/style class.
  - Keep style coherence checks so variety does not become random noise.
  - Feed monotony and coherence metrics into refinement loop.
- Acceptance criteria:
  - Monotony score improves against baseline scenarios.
  - Style-coherence regressions are detected by tests/metrics.
- Expected tests:
  - Diversity metric tests.
  - Coherence threshold tests.
  - Baseline-vs-new comparison tests.
- Rollback:
  - `material_quality_gates=false` if early thresholds are too strict.

## Phase Exit Criteria

- Retrieval improves specificity while staying token-bounded.
- Refinement loop is bounded, stable, and produces valid DIG patches.
- Undo works for single-pass and multi-revision change units.
- Execution UX supports progress and cancellation without hiding failures.
