import { describe, expect, it } from "vitest";
import { validateLayerMapShape } from "./layerMap.js";
import {
  applyPrimitiveToVoxelMap,
  formatPrimitivesAsLayerMapJson,
  primitivesToLayerMapData,
} from "./primitivesToLayerMap.js";
import type { Primitive } from "./schema.js";

describe("primitivesToLayerMapData", () => {
  it("encodes a single fill_cuboid as layers + palette", () => {
    const primitives: Primitive[] = [
      {
        type: "fill_cuboid",
        from: { x: 0, y: 64, z: 0 },
        to: { x: 1, y: 64, z: 0 },
        block: "minecraft:stone",
      },
    ];

    const result = primitivesToLayerMapData(primitives);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(validateLayerMapShape(result.layerMap)).toBeUndefined();
    expect(result.layerMap.layers).toHaveLength(1);
    expect(Object.values(result.layerMap.palette)).toContain("minecraft:stone");
    // Tight 2×1 footprint is fully filled — no air cells in the layer string.
    expect(result.layerMap.layers[0]).toMatch(/^[^\s]+$/);
  });

  it("matches hollow_cuboid shell + inner air semantics", () => {
    const primitives: Primitive[] = [
      {
        type: "hollow_cuboid",
        from: { x: 0, y: 0, z: 0 },
        to: { x: 2, y: 2, z: 2 },
        block: "minecraft:stone_bricks",
      },
    ];

    const result = primitivesToLayerMapData(primitives);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { layers, palette } = result.layerMap;
    const stone = Object.entries(palette).find(([, id]) => id === "minecraft:stone_bricks")?.[0];
    expect(stone).toBeDefined();
    const air = "_";
    for (const layer of layers) {
      const rows = layer.split("\n");
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect([...row].length).toBe(3);
      }
    }
    const midRow = layers[1]!.split("\n")[1]!;
    expect(midRow).toContain(air);
    expect(midRow).toContain(stone!);
  });

  it("respects options.origin when within bounds", () => {
    const primitives: Primitive[] = [
      {
        type: "set_block",
        x: 5,
        y: 10,
        z: 3,
        block: "minecraft:glass",
      },
    ];

    const result = primitivesToLayerMapData(primitives, {
      origin: { x: 5, y: 10, z: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.layerMap.layers).toHaveLength(1);
    expect(result.layerMap.layers[0]?.trim().length).toBe(1);
  });

  it("returns error when origin is above voxel min", () => {
    const primitives: Primitive[] = [
      {
        type: "set_block",
        x: 0,
        y: 0,
        z: 0,
        block: "minecraft:dirt",
      },
    ];

    const result = primitivesToLayerMapData(primitives, {
      origin: { x: 1, y: 0, z: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("below options.origin");
  });

  it("formatPrimitivesAsLayerMapJson returns pretty JSON on success", () => {
    const primitives: Primitive[] = [
      {
        type: "set_block",
        x: 0,
        y: 0,
        z: 0,
        block: "minecraft:oak_planks",
      },
    ];
    const s = formatPrimitivesAsLayerMapJson(primitives);
    expect(s.startsWith("{")).toBe(true);
    expect(s).toContain('"layers"');
    expect(s).toContain('"palette"');
  });
});

describe("applyPrimitiveToVoxelMap", () => {
  it("overwrites earlier fills at the same coordinate", () => {
    const map = new Map<string, string>();
    const first: Primitive = {
      type: "fill_cuboid",
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
      block: "minecraft:stone",
    };
    const second: Primitive = {
      type: "set_block",
      x: 0,
      y: 0,
      z: 0,
      block: "minecraft:gold_block",
    };
    applyPrimitiveToVoxelMap(map, first);
    applyPrimitiveToVoxelMap(map, second);
    expect(map.get("0,0,0")).toBe("minecraft:gold_block");
  });
});
