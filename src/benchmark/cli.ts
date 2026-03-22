/**
 * CLI entry: score a golden plan JSON file for local benchmarking.
 *
 * Usage: `npm run benchmark -- benchmark/scenarios/tower-plan.json`
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { scorePlan } from "./scorePlan.js";

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run benchmark -- <path-to-plan.json>");
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(filePath);
  const raw = JSON.parse(await readFile(resolved, "utf8")) as unknown;
  const result = scorePlan(raw);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result.metrics, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
