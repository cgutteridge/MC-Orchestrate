# Agent Integration Tests

Tests in this directory make **real AI provider calls** and consume tokens.
They are intentionally excluded from the normal `npm test` suite.

## Running

```bash
# Run all agent tests
npm run test:agent

# Run a single file
npm run test:agent -- tests/agent/placement-offsets.test.ts

# Watch mode (re-runs on file save)
npm run test:agent:watch
```

## Prerequisites

One provider env set must be configured (see `.env`):

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

or

```bash
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=
```

When the provider is not configured every test in the suite is skipped
automatically — no error, no token spend.

## Writing agent tests

1. Import helpers from `./_fixtures.ts`.
2. Use `describe.skipIf(!provider)(...)` so the whole describe block skips
   cleanly when no provider is available.
3. Keep assertions **behavioural and range-based** — the AI is non-deterministic,
   so test that coordinates are in the right rough region, not exact values.
4. Add a short `scenario` comment explaining the player context and expected
   spatial outcome so a future reader understands what the test is verifying.
5. Prefer one assertion per test, and keep tests short. A failed agent test is
   expensive to re-run.

## Cost and CI

These tests are **not run in CI by default**. To enable them in a CI job that
has credentials, set `MCORCH_AGENT_TESTS=1` — the fixture helper will then
assert that the provider is present rather than silently skipping.
