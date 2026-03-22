import type { BridgeBatchBlock, BridgeCommand } from "../bridge/types.js";
import { compileLayerMapToBridgeCommands } from "./layerMap.js";
import { normalizeCuboid } from "./requestContext.js";
import type { BuildPass, Plan, Point, Primitive } from "./schema.js";

/**
 * Compiles a validated multi-pass plan into concrete bridge commands.
 */
export function compilePlanToBridgeCommands(plan: Plan): BridgeCommand[] {
  return plan.passes.flatMap((pass) => compilePass(pass, plan));
}

function compilePass(pass: BuildPass, plan: Plan): BridgeCommand[] {
  if (pass.layerMap) {
    return compileLayerMapToBridgeCommands(pass.layerMap, plan.targetRegion.min);
  }
  return pass.primitives.flatMap((primitive) => compilePrimitive(primitive));
}

function compilePrimitive(primitive: Primitive): BridgeCommand[] {
  switch (primitive.type) {
    case "set_block":
      return [
        {
          kind: "setBlock",
          x: primitive.x,
          y: primitive.y,
          z: primitive.z,
          block: primitive.block,
        },
      ];
    case "fill_cuboid": {
      const fill = normalizeCuboid(primitive.from, primitive.to);
      return [{ kind: "fill", from: fill.from, to: fill.to, block: primitive.block }];
    }
    case "clear_region": {
      const clear = normalizeCuboid(primitive.from, primitive.to);
      return [{ kind: "fill", from: clear.from, to: clear.to, block: "minecraft:air" }];
    }
    case "replace_in_region": {
      const replace = normalizeCuboid(primitive.from, primitive.to);
      return [
        {
          kind: "replace",
          from: replace.from,
          to: replace.to,
          fromBlock: primitive.fromBlock,
          toBlock: primitive.toBlock,
        },
      ];
    }
    case "hollow_cuboid":
      return compileHollowCuboid(primitive.from, primitive.to, primitive.block);
    case "cylinder":
      return [
        {
          kind: "batchSet",
          blocks: compileCylinderBlocks(
            primitive.center,
            primitive.radius,
            primitive.height,
            primitive.block,
            primitive.hollow,
            primitive.axis,
          ),
        },
      ];
  }
}

function compileHollowCuboid(from: Point, to: Point, block: string): BridgeCommand[] {
  const cuboid = normalizeCuboid(from, to);
  const widthX = cuboid.to.x - cuboid.from.x + 1;
  const widthY = cuboid.to.y - cuboid.from.y + 1;
  const widthZ = cuboid.to.z - cuboid.from.z + 1;

  if (widthX <= 2 || widthY <= 2 || widthZ <= 2) {
    return [{ kind: "fill", from: cuboid.from, to: cuboid.to, block }];
  }

  return [
    { kind: "fill", from: cuboid.from, to: cuboid.to, block },
    {
      kind: "fill",
      from: {
        x: cuboid.from.x + 1,
        y: cuboid.from.y + 1,
        z: cuboid.from.z + 1,
      },
      to: {
        x: cuboid.to.x - 1,
        y: cuboid.to.y - 1,
        z: cuboid.to.z - 1,
      },
      block: "minecraft:air",
    },
  ];
}

function compileCylinderBlocks(
  center: Point,
  radius: number,
  height: number,
  block: string,
  hollow: boolean,
  axis: "x" | "y" | "z",
): BridgeBatchBlock[] {
  const blocks: BridgeBatchBlock[] = [];
  const radiusSquared = radius * radius;
  const innerSquared = (radius - 1) * (radius - 1);

  for (let a = -radius; a <= radius; a++) {
    for (let b = -radius; b <= radius; b++) {
      const distanceSquared = a * a + b * b;
      if (distanceSquared > radiusSquared) {
        continue;
      }
      if (hollow && distanceSquared < innerSquared) {
        continue;
      }

      for (let h = 0; h < height; h++) {
        const point =
          axis === "y"
            ? { x: center.x + a, y: center.y + h, z: center.z + b }
            : axis === "x"
              ? { x: center.x + h, y: center.y + a, z: center.z + b }
              : { x: center.x + a, y: center.y + b, z: center.z + h };
        blocks.push({ ...point, type: block });
      }
    }
  }

  return blocks;
}
