import { describe, expect, it } from "vitest";
import {
  coerceAssistantLayerMapToLoosePlanCandidate,
  compileLayerMapToBridgeCommands,
  deriveLayerMapLocalBounds,
  estimateLayerMapBlockCount,
  normalizeLayerMap,
  tryExtractLayerMapData,
  validateLayerMapShape,
} from "./layerMap.js";

describe("layer map", () => {
  it("parses bottom-to-top layers and compiles each non–no-op cell", () => {
    const layerMap = {
      layers: [
        "#", // bottom (lowest Y)
        "#", // top (highest Y)
      ],
      palette: { "#": "minecraft:stone" },
    };
    expect(validateLayerMapShape(layerMap)).toBeUndefined();
    expect(deriveLayerMapLocalBounds(layerMap).max).toEqual({ x: 0, y: 1, z: 0 });
    expect(estimateLayerMapBlockCount(layerMap)).toBe(2);

    const cmds = compileLayerMapToBridgeCommands(layerMap, { x: 10, y: 64, z: 7 });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.kind).toBe("batchSet");
    if (cmds[0]?.kind === "batchSet") {
      const keys = new Set(cmds[0].blocks.map((b) => `${b.x},${b.y},${b.z},${b.type}`));
      expect(keys.has("10,64,7,minecraft:stone")).toBe(true);
      expect(keys.has("10,65,7,minecraft:stone")).toBe(true);
    }
  });

  it("normalizes ragged rows into a rectangle", () => {
    const raw = {
      layers: ["##", "#"],
      palette: { "#": "minecraft:stone" },
    };
    const n = normalizeLayerMap(raw);
    expect(n.layers[1]).toBe("# ");
    expect(validateLayerMapShape(raw)).toBeUndefined();
  });

  it("clips to design-step footprint when clip is provided", () => {
    const raw = {
      layers: ["##", "#"],
      palette: { "#": "minecraft:stone" },
    };
    const n = normalizeLayerMap(raw, { width: 4, depth: 2, height: 2 });
    expect(n.layers).toHaveLength(2);
    const rows0 = n.layers[0]!.split("\n");
    expect(rows0).toHaveLength(2);
    expect([...rows0[0]!]).toHaveLength(4);
    expect([...rows0[1]!]).toHaveLength(4);
    expect(validateLayerMapShape(n)).toBeUndefined();
  });

  it("treats space as no-op (no batchSet for that cell)", () => {
    const layerMap = {
      layers: ["# #"],
      palette: { "#": "minecraft:stone" },
    };
    expect(validateLayerMapShape(layerMap)).toBeUndefined();
    expect(estimateLayerMapBlockCount(layerMap)).toBe(2);
    const cmds = compileLayerMapToBridgeCommands(layerMap, { x: 0, y: 0, z: 0 });
    expect(cmds).toHaveLength(1);
    if (cmds[0]?.kind === "batchSet") {
      expect(cmds[0].blocks).toHaveLength(2);
    }
  });

  it("compiles underscore to minecraft:air by default", () => {
    const layerMap = {
      layers: ["_"],
      palette: {},
    };
    expect(validateLayerMapShape(layerMap)).toBeUndefined();
    const cmds = compileLayerMapToBridgeCommands(layerMap, { x: 5, y: 10, z: 3 });
    expect(cmds).toHaveLength(1);
    if (cmds[0]?.kind === "batchSet") {
      expect(cmds[0].blocks[0]).toEqual({
        x: 5,
        y: 10,
        z: 3,
        type: "minecraft:air",
      });
    }
  });

  it("drops a space palette key and still validates", () => {
    const raw = {
      layers: ["S"],
      palette: { " ": "minecraft:air", S: "minecraft:stone" },
    };
    const n = normalizeLayerMap(raw);
    expect(n.palette[" "]).toBeUndefined();
    expect(validateLayerMapShape(raw)).toBeUndefined();
  });
});

describe("assistant layer-map coercion", () => {
  it("coerceAssistantLayerMapToLoosePlanCandidate wraps bare layers/palette in one pass", () => {
    const out = coerceAssistantLayerMapToLoosePlanCandidate({
      layers: ["A"],
      palette: { A: "minecraft:stone" },
    });
    expect(out.passes).toHaveLength(1);
    expect((out.passes as { layerMap: { layers: string[] } }[])[0]?.layerMap.layers).toEqual(["A"]);
  });

  it("tryExtractLayerMapData reads bare JSON and legacy build+plan+passes", () => {
    expect(
      tryExtractLayerMapData({
        layers: ["X"],
        palette: { X: "minecraft:glass" },
      })?.palette.X,
    ).toBe("minecraft:glass");

    expect(
      tryExtractLayerMapData({
        action: "build",
        plan: {
          passes: [{ name: "p", goal: "g", layerMap: { layers: ["Y"], palette: { Y: "minecraft:stone" } } }],
        },
      })?.layers,
    ).toEqual(["Y"]);
  });
});
