import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scorePlan } from "../../src/benchmark/scorePlan.js";
import type { Plan } from "../../src/planner/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const towerPlan: Plan = {
  intent: "build_tower",
  targetWorld: "world",
  targetRegion: {
    world: "world",
    min: { x: -1, y: 64, z: -1 },
    max: { x: 1, y: 71, z: 1 },
  },
  assumptions: [],
  passes: [
    {
      name: "tower_column",
      goal: "Build tower.",
      layerMap: {
        layers: Array.from({ length: 8 }, () => "SSS\nSSS\nSSS"),
        palette: { S: "minecraft:stone", _: "minecraft:air" },
      },
    },
  ],
  reply: "Built.",
  briefFulfilment: "Tower column fills the requested footprint.",
};

describe("scorePlan", () => {
  it("returns metrics for a valid plan", () => {
    const result = scorePlan(towerPlan);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.metrics.schemaValid).toBe(true);
    expect(result.metrics.passCount).toBe(1);
    expect(result.metrics.paletteDiversity).toBe(2);
    expect(result.metrics.targetRegionVolume).toBe(3 * 8 * 3);
    expect(result.metrics.estimatedBridgeOperations).toBe(3 * 8 * 3);
  });

  it("rejects invalid plans", () => {
    const result = scorePlan({ intent: "x" });
    expect(result.ok).toBe(false);
  });

  it("scores the checked-in tower fixture consistently", async () => {
    const fixturePath = path.join(
      __dirname,
      "..",
      "..",
      "benchmark",
      "scenarios",
      "tower-plan.json",
    );
    const raw = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
    const result = scorePlan(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.metrics.estimatedBridgeOperations).toBe(3 * 8 * 3);
  });
});
