# World Mutation Path

## Current State

- The Node bridge currently writes console commands (`setblock`, `fill`, `replace`) to the Minecraft server process stdin.
- The Spigot plugin currently gathers context and forwards chat requests to the orchestrator; it does not execute world edits via Bukkit/Paper world APIs.

## Why This Matters

- Console command execution works but does not use the normal plugin world mutation API path.
- Future goals (undo, richer telemetry, tighter thread-safety guarantees, and advanced terrain operations) may benefit from plugin-side execution primitives.

## Investigation Tasks

- Subtasks:
  - Keep current-path documentation synchronized with code changes.
  - Define migration acceptance criteria:
    - Main-thread world mutation guarantees.
    - Safety parity or improvement.
    - Equivalent logging/traceability by request id and tx id.
    - Equivalent or better performance for large fills/batches.
  - Compare options:
    - Option A: Keep console-command bridge path and harden around it.
    - Option B: Move mutation execution into plugin API endpoints.
    - Option C: Hybrid path (plugin API for fine-grained operations, command path for bounded bulk ops).
  - Produce a decision record with rationale and migration sequence.

## Migration Guardrails

- Keep world mutation bounded behind existing safety checks regardless of execution backend.
- Preserve rollback/undo compatibility across backend choice.
- Keep bridge/orchestrator contract stable during incremental rollout.

## Validation Checklist

- Safety tests pass with selected backend.
- Execution traces remain request-id correlated end-to-end.
- Large operation latency remains within agreed budget.
- Error paths surface the failing step to players.
