# Benchmark scenarios

JSON files here are **golden plans** (valid `Plan` objects) used for regression and cost estimates.

- Run `npm run benchmark -- benchmark/scenarios/tower-plan.json` to print metrics from `src/benchmark/scorePlan.ts` (`scorePlan()`).

Metrics are structural (schema validity, estimated bridge-operation weight, palette diversity, target region volume). They do not replace live-game or Azure baseline runs (see `tasks/index.json` task 16).
