# Azure planner baseline (task 16)

This folder describes how we validate the **Azure OpenAI → placement-then-build** path and keep **offline regression** fixtures when credentials are unavailable (CI, forks).

## What is checked in

- `benchmark/fixtures/azure-baseline/*.json` — **replay fixtures** (`version`, `description`, `assistantTurns`).
- `src/services/ai/replayChatProvider.ts` — `createReplayChatProvider()` + `parseReplayFixture()`.
- `tests/benchmark/azureBaselineReplay.test.ts` — runs `runPlacementThenBuild` against the fixture (no network).

## Live baseline (with Azure)

1. Set `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT` (see `.env.example`).
2. Optionally set `MCORCH_AI_PROVIDER_LOG` (defaults to `logs/ai-provider.log`) so each request/response is appended by `AzureOpenAIChatProvider`.
3. Run a representative flow (e.g. in-game command through the orchestrator, or `npm run test:agent` with agent tests).
4. Open the provider log. Each entry ends with the assistant `content` (often JSON). Copy the **exact** assistant string for each `chat()` turn you want to freeze.
5. Update or add a file under `benchmark/fixtures/azure-baseline/`:
   - `assistantTurns`: array of those strings in order (one entry per model round-trip).
6. Run `npm test` to ensure replay still yields a valid plan.

## When to refresh fixtures

- Prompt (`src/planner/prompt.ts`) or schema (`src/planner/schema.ts`) changes that alter acceptable model output.
- After upgrading the Azure deployment / model: run a live capture and replace `assistantTurns` if tests fail.

## CI

`npm test` uses **replay only**; it does **not** call Azure. Live Azure validation remains a manual or separate gated job.
