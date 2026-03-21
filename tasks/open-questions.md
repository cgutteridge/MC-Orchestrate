# Open Questions and Risks

## Architecture Questions (Decision-Blocking)

1. Server target scope
- Which server variants and versions must be supported (Spigot only, Paper, Folia)?
- Tag/material availability and behavior differences affect material KB and palette generation.

2. World mutation backend target
- Keep bridge console-command path, migrate to plugin API execution, or run hybrid?
- What is the timeline for this choice relative to undo/refinement implementation?

3. Interior scope now vs later
- Are interiors part of near-term scope or only exteriors?
- This changes template complexity and constraint-solving requirements.

4. Safety envelope specifics
- Final limits for max blocks, max radius, max height deltas, and forbidden materials.
- Required handling for protected regions and player-owned build preservation.

5. Refinement strictness
- Should style/palette lock after first pass or allow controlled drift across revisions?
- How aggressive should automatic revisions be before asking player confirmation?

## Operational Risks

1. Terrain context quality
- Weak terrain cards will produce poor grounding decisions even with better compilers.

2. Material drift and version drift
- Material names, tags, and behavior may drift across versions and datapacks.

3. Semantic validity gaps
- Schema-valid plans can still be low quality (degenerate dimensions, self-cancelling pass order).

4. Token budget creep
- Retrieval and refinement can expand prompt payload if not tightly bounded.

5. Transaction overhead
- Undo-ready change logging can add latency and storage pressure for large edits.

## Mitigation Defaults

- Keep hard candidate caps and context-card size caps.
- Keep deterministic safety/semantic checks before world mutation.
- Add feature flags for each phase component.
- Record representative trace fixtures and replay tests before major migrations.
