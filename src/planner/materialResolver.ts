import type { ChatCommandRequest } from "../types/plugin.js";
import { PlanSchema, type Plan, type Primitive } from "./schema.js";
import {
  MATERIAL_ALIASES,
  SUPPORTED_BLOCK_IDS,
  SUPPORTED_MATERIAL_HINTS,
} from "./materialPalette.js";

export function resolvePlanMaterials(
  plan: Plan,
  request: ChatCommandRequest,
): Plan {
  const unresolved = new Set<string>();

  const passes = plan.passes.map((pass) => ({
    ...pass,
    primitives: pass.primitives.map((primitive) =>
      resolvePrimitiveMaterials(primitive, unresolved),
    ),
  }));

  if (unresolved.size > 0) {
    const materials = Array.from(unresolved).sort().join(", ");
    return PlanSchema.parse({
      ...plan,
      intent: "unknown",
      passes: [],
      needsMoreInfo: true,
      reply: "I need clearer material choices before I can build that.",
      clarification:
        `I couldn't safely map these materials: ${materials}. ` +
        `Try a specific block such as ${SUPPORTED_MATERIAL_HINTS}.`,
      targetWorld: request.player.world,
    });
  }

  return PlanSchema.parse({
    ...plan,
    passes,
  });
}

function resolvePrimitiveMaterials(
  primitive: Primitive,
  unresolved: Set<string>,
): Primitive {
  switch (primitive.type) {
    case "set_block":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved),
      };
    case "fill_cuboid":
    case "hollow_cuboid":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved),
      };
    case "replace_in_region":
      return {
        ...primitive,
        fromBlock: resolveBlockId(primitive.fromBlock, unresolved),
        toBlock: resolveBlockId(primitive.toBlock, unresolved),
      };
    case "cylinder":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved),
      };
    case "clear_region":
      return primitive;
  }
}

function resolveBlockId(block: string, unresolved: Set<string>): string {
  const normalized = block.toLowerCase().trim();
  const mapped = MATERIAL_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }

  if (SUPPORTED_BLOCK_IDS.has(normalized)) {
    return normalized;
  }

  unresolved.add(block);
  return block;
}
