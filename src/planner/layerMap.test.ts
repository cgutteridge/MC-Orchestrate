import { describe, expect, it } from "vitest";
import {
  compileLayerMapToBridgeCommands,
  deriveLayerMapLocalBounds,
  estimateLayerMapBlockCount,
  validateLayerMapShape,
} from "./layerMap.js";

describe("layer map", () => {
  it("parses top-to-bottom layers and compiles non-air voxels", () => {
    const layerMap = {
      layers: [
        "#", // top (highest Y)
        "#", // bottom (lowest Y)
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

  it("rejects ragged rows", () => {
    const err = validateLayerMapShape({
      layers: ["##", "#"],
      palette: { "#": "minecraft:stone" },
    });
    expect(err).toContain("same row width");
  });
});
