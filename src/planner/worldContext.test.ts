import { describe, expect, it } from "vitest";
import {
  computeTargetRegionFromPlacement,
  expandRegion,
  serializeRegionBlocksToLayerMap,
} from "./worldContext.js";

describe("worldContext helpers", () => {
  it("computes an on-ground target region from placement and desired size", () => {
    const region = computeTargetRegionFromPlacement(
      { x: 10, y: 64, z: 20 },
      {
        ref: "player",
        frame: "player",
        offset: { F: 0, R: 0, N: 0, E: 0, UP: 0 },
        desiredSize: { width: 5, depth: 7, height: 4 },
        verticalReference: "on_ground",
      },
      "world",
    );

    expect(region).toEqual({
      world: "world",
      min: { x: 8, y: 64, z: 17 },
      max: { x: 12, y: 67, z: 23 },
    });
  });

  it("expands a region uniformly by a fixed margin", () => {
    expect(
      expandRegion(
        {
          world: "world",
          min: { x: 1, y: 2, z: 3 },
          max: { x: 4, y: 5, z: 6 },
        },
        2,
      ),
    ).toEqual({
      world: "world",
      min: { x: -1, y: 0, z: 1 },
      max: { x: 6, y: 7, z: 8 },
    });
  });

  it("serializes region blocks into layers and palette with air filled in", () => {
    const layerMap = serializeRegionBlocksToLayerMap(
      {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 1, y: 65, z: 1 },
      },
      [
        { x: 0, y: 64, z: 0, type: "minecraft:stone" },
        { x: 1, y: 64, z: 0, type: "minecraft:dirt" },
        { x: 0, y: 65, z: 1, type: "minecraft:oak_planks" },
      ],
    );

    expect(layerMap.layers).toHaveLength(2);
    expect(layerMap.layers[0]).toContain("_");
    expect(Object.values(layerMap.palette)).toContain("minecraft:air");
    expect(Object.values(layerMap.palette)).toContain("minecraft:stone");
    expect(Object.values(layerMap.palette)).toContain("minecraft:dirt");
    expect(Object.values(layerMap.palette)).toContain("minecraft:oak_planks");
  });
});
