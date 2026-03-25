import type { BlockSample } from "../types/plugin.js";
import type { LayerMapData } from "./layerMap.js";
import type { Placement, Region } from "./schema.js";

const CONTEXT_AIR_CHAR = "_" as const;
const CONTEXT_CHAR_POOL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^{|}~";

/**
 * Computes a world-space target region from a resolved anchor point and locked
 * build size using the same alignment rules as final plan placement.
 */
export function computeTargetRegionFromPlacement(
  anchor: { x: number; y: number; z: number },
  placement: Placement,
  world: string,
): Region {
  if (!placement.desiredSize) {
    throw new Error("computeTargetRegionFromPlacement requires placement.desiredSize");
  }

  const { width, depth, height } = placement.desiredSize;
  const minX = anchor.x - Math.round((width - 1) / 2);
  const minZ = anchor.z - Math.round((depth - 1) / 2);

  const minY =
    placement.verticalReference === "on_ground"
      ? anchor.y
      : placement.verticalReference === "under_ground"
        ? anchor.y - (height - 1)
        : anchor.y - Math.round((height - 1) / 2);

  return {
    world,
    min: { x: minX, y: minY, z: minZ },
    max: {
      x: minX + width - 1,
      y: minY + height - 1,
      z: minZ + depth - 1,
    },
  };
}

export function expandRegion(region: Region, margin: number): Region {
  return {
    world: region.world,
    min: {
      x: region.min.x - margin,
      y: region.min.y - margin,
      z: region.min.z - margin,
    },
    max: {
      x: region.max.x + margin,
      y: region.max.y + margin,
      z: region.max.z + margin,
    },
  };
}

/**
 * Serializes a scanned world region into the same layer-map shape used by the
 * builder prompt: bottom-to-top `layers` plus single-character `palette`.
 */
export function serializeRegionBlocksToLayerMap(
  region: Region,
  blocks: BlockSample[],
): LayerMapData {
  const blockByCoord = new Map<string, string>();
  for (const block of blocks) {
    blockByCoord.set(`${block.x},${block.y},${block.z}`, block.type);
  }

  const palette = new Map<string, string>([["minecraft:air", CONTEXT_AIR_CHAR]]);
  let nextCharIndex = 0;

  const charForBlock = (blockType: string): string => {
    const existing = palette.get(blockType);
    if (existing) {
      return existing;
    }
    const next = CONTEXT_CHAR_POOL[nextCharIndex];
    if (!next) {
      throw new Error("World context palette exhausted single-character space");
    }
    nextCharIndex += 1;
    palette.set(blockType, next);
    return next;
  };

  const layers: string[] = [];
  for (let y = region.min.y; y <= region.max.y; y++) {
    const rows: string[] = [];
    for (let z = region.min.z; z <= region.max.z; z++) {
      let row = "";
      for (let x = region.min.x; x <= region.max.x; x++) {
        const blockType = blockByCoord.get(`${x},${y},${z}`) ?? "minecraft:air";
        row += charForBlock(blockType);
      }
      rows.push(row);
    }
    layers.push(rows.join("\n"));
  }

  return {
    layers,
    palette: Object.fromEntries(Array.from(palette.entries()).map(([blockType, char]) => [char, blockType])),
  };
}
