# MC-Orchestrate

Minecraft bridge, AI orchestrator, and Spigot plugin integration for in-game builder commands.

## What runs where

- `npm start` runs the local TCP bridge on `127.0.0.1:7070`
- `npm start` also runs the local HTTP orchestrator on `127.0.0.1:7071`
- the Spigot plugin listens for chat messages starting with `bot:`
- the plugin sends live player/world context to the HTTP orchestrator
- the orchestrator plans actions and sends bounded world edits back through the bridge

## Current v1 behavior

- `bot: make me a 5 block stone tower here`
- `bot: delete this tree`

The current implementation is multiplayer-aware, player-anchored, and keeps world mutation on the bridge side only.

If either direct OpenAI or Azure OpenAI is configured, the orchestrator can use it for planning. If neither is configured, the built-in heuristic planner still handles the supported v1 building commands above.

## Setup

1. Install Java 21 or newer.
2. Keep the local Spigot jar in `minecraft-server/spigot-1.21.1.jar`.
3. Accept the Minecraft EULA in `minecraft-server/eula.txt`.
4. Install Node dependencies with `npm install`.
5. Copy `.env.example` to `.env` and add either direct OpenAI or Azure values when you want AI planning enabled.
6. Build and copy the plugin with `npm run plugin:install`.
7. Start the stack with `npm start`.

## AI provider env

Direct OpenAI:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL` (optional, defaults to `https://api.openai.com/v1`)
- `OPENAI_CHAT_TIMEOUT_MS` (optional)

Azure OpenAI:

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_POLICY_ID` (optional)
- `AZURE_OPENAI_CHAT_TIMEOUT_MS` (optional)
- `MCORCH_AI_LOG` (optional planner JSONL log path)
- `MCORCH_AI_PROVIDER_LOG` (optional raw provider log path)

If both env sets are present, direct OpenAI is selected first. Comment one set out to switch back and forth.

Planner and provider diagnostics default to:

- `logs/ai-planner.jsonl`
- `logs/ai-provider.log`

## Plugin

The plugin jar is built at:

- `spigot-plugin/target/mc-orchestrate-plugin-1.0.0.jar`

The plugin is copied to:

- `minecraft-server/plugins/`

Its config file is:

- `minecraft-server/plugins/MCOrchestrate/config.yml`

Default orchestrator URL:

- `http://127.0.0.1:7071/requests/chat-command`

## Validation

- `npm run build`
- `npm test`
- `npm run plugin:build`

## Engineering Practice

- Run regular code reviews on the orchestrator, planner, bridge, and plugin paths.
- Fix small defects and structural issues incrementally rather than waiting for a large cleanup phase.
- Add concrete follow-up items to [TASKS.md](/Users/cjg/Projects/MC-Orchestrate/TASKS.md) when reviews uncover real issues or deferred work.
