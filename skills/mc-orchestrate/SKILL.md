---
name: mc-orchestrate
description: Use when working in the MC-Orchestrate repository to build, debug, review, or extend the Minecraft plugin, HTTP orchestrator, AI design loop, bridge, and live local server workflow. Covers design loop turn flow, world reader, bridge-only world mutation, runtime restart procedure, log inspection, and backlog/skill updates when concrete new repo-specific issues are confirmed.
---

# MC-Orchestrate

Use this skill for coding and debugging work in `/Users/cjg/Projects/MC-Orchestrate`.

## Core Rules

- World mutation happens only through the bridge. Do not add direct world writes in the plugin or planner.
- Treat the stack as: Spigot plugin -> HTTP orchestrator -> AI design loop -> bridge -> Minecraft server.
- The heuristic planner and templates are deleted. The AI owns all build decisions.
- If no AI provider is configured the orchestrator returns `needs_more_info` immediately.
- Prefer fixing concrete behavioral defects over broad refactors.
- Keep `tasks/index.json` (via the task-index-manager skill) aligned with newly confirmed issues.
- If you are certain a repo-specific failure mode, workflow, or guardrail is missing from this skill, update this skill in the same change rather than leaving the knowledge only in chat.

## Main Files

- Plugin: `/Users/cjg/Projects/MC-Orchestrate/spigot-plugin/src/main/java/uk/ac/soton/ras/mcorchestrate/McOrchestratePlugin.java`
- Plugin payload builder: `/Users/cjg/Projects/MC-Orchestrate/spigot-plugin/src/main/java/uk/ac/soton/ras/mcorchestrate/JsonPayloadBuilder.java`
- App entry: `/Users/cjg/Projects/MC-Orchestrate/src/index.ts`
- Orchestrator: `/Users/cjg/Projects/MC-Orchestrate/src/orchestrator/orchestrator.ts`
- Design loop: `/Users/cjg/Projects/MC-Orchestrate/src/planner/aiPlanner.ts`
- Prompt: `/Users/cjg/Projects/MC-Orchestrate/src/planner/prompt.ts`
- Planner schema: `/Users/cjg/Projects/MC-Orchestrate/src/planner/schema.ts`
- Bridge: `/Users/cjg/Projects/MC-Orchestrate/src/bridge/bridgeServer.ts`
- World reader: `/Users/cjg/Projects/MC-Orchestrate/src/world/worldReader.ts`
- Active tasks: `/Users/cjg/Projects/MC-Orchestrate/tasks/index.json`
- Completed tasks: `/Users/cjg/Projects/MC-Orchestrate/tasks/done.json`

## AI Design Loop

The orchestrator runs `runDesignLoop()` for every chat request. The loop runs up to 5 turns:

1. Sends initial context to the AI (player position, look vector, target block, 15×8×15 world scan, last built plan, conversation history).
2. AI returns either `{ action: "view_request", region, selfNotes }` or a build plan (wrapped or bare).
3. For `view_request`: orchestrator fulfils the scan (from initial plugin payload slice or `WorldReader.readRegionBlocks`) and appends the result as the next user message.
4. For `build` / bare Plan: orchestrator repairs the plan (`repairLoosePlanCandidate`), validates it via `PlanSchema`, then returns it.
5. After execution, the orchestrator can optionally run `runVerifyPass()` to give the AI a polish pass.

### Fail-safes

- Consecutive parse failures (2 in a row): abort, return `needs_more_info`.
- Max turns reached: return `needs_more_info`.
- All AI responses are validated by `validatePlanSafety` and `validatePlanSemantics` before execution.

## Plugin Payload

The plugin sends a 15×8×15 block scan centered on the player with air filtered out (cap 300 blocks). It also sends `initialScanRegion` bounding box so the AI knows what world data it received without requesting a disk read.

## World Reader

`WorldReader.readRegionBlocks(region)` parses Minecraft `.mca` Anvil region files using `prismarine-nbt` and returns `BlockSample[]`. Returns `undefined` on any error — never throws. Designed for Minecraft 1.18+ chunk NBT format; tested with 1.21.1.

For post-build verification, the orchestrator prefers `bridge.getPlacedBlocks()` (in-memory, zero I/O) over disk reads.

## Validation

Run these after TypeScript or planner changes:

- `npm run build`
- `npm test`

Run this after plugin changes:

- `npm run plugin:build`

## Live Server Workflow

- The running stack uses `npm start`.
- The bridge listens on `127.0.0.1:7070`.
- The HTTP orchestrator listens on `127.0.0.1:7071`.
- Restarting often requires stopping both the Node process and the Java server process because the world lock can remain held.
- If restart fails with `session.lock`, inspect `/Users/cjg/Projects/MC-Orchestrate/minecraft-server/world/session.lock` with `lsof` and stop the stale Java process before retrying.

## Logging And Debugging

Inspect these first when bot behavior is wrong:

- Bridge actions: `/Users/cjg/Projects/MC-Orchestrate/logs/bridge-actions.jsonl`
- Design loop stages: `/Users/cjg/Projects/MC-Orchestrate/logs/ai-planner.jsonl`
- Raw provider trace: `/Users/cjg/Projects/MC-Orchestrate/logs/ai-provider.log`

Use them to answer:

- What action did the AI return on each turn (view_request or build)?
- What world scan data was fulfilled for each view_request?
- Did JSON extraction or repair change the meaning?
- Did the final validated plan still match the player request?
- What bridge commands were actually executed?

Before asking the user to run a fresh live test, rotate or clear the existing log files first so the next inspection only contains entries from that test pass.

## Planner Guardrails

- Keep the prompt schema and executor schema exactly aligned (`DesignStepSchema` / `PlanSchema`).
- Do not let unsupported requests get coerced into the nearest supported intent.
- Under-specified AI geometry should fail closed and produce clarification, not fabricated default shapes.
- Clarification-only replies should not carry invented target regions that look executable.
- Prefer `needsMoreInfo` over "creative guessing" when intent or geometry is unclear.

## Anchoring Rules

- Structures should anchor to the looked-at block when available.
- Otherwise anchor horizontally in front of the player, not on the player's body block.
- Be careful with steep pitch angles; do not trust raw look-vector Y for placement.

## Working Practice

- Review diffs before committing, focusing on behavioral regressions and test gaps.
- Add small regression tests when fixing planner, bridge, or anchoring bugs.
- Update `tasks/index.json` when new confirmed issues appear (use task-index-manager skill).
- Update this skill only when the new guidance is specific to this repo and likely to matter again.
