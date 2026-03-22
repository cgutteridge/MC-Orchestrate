# Benchmark scenarios

JSON files here are **golden plans** (valid `Plan` objects) used for regression and cost estimates.

- Run `npm run benchmark -- benchmark/scenarios/tower-plan.json` to print metrics from `src/benchmark/scorePlan.ts` (`scorePlan()`).

- **Azure planner replay fixtures** live under `benchmark/fixtures/azure-baseline/`; see **`benchmark/azure-baseline.md`**.

Metrics are structural (schema validity, estimated bridge-operation weight, palette diversity, target region volume). They do not replace live-game validation; Azure baseline replay is covered separately.
