import { PlanSchema, type Plan } from "./schema.js";
import { normalizeBlockId } from "./materialPalette.js";
import { isVanillaMinecraftBlockId } from "./minecraftBlockRegistry.js";

/** Block used when the model supplies a non-vanilla or malformed id. */
export const MATERIAL_FALLBACK_BLOCK = "minecraft:stone" as const;

export type SanitizePlanMaterialsResult = {
  /** Plan with palette block ids canonicalized or replaced. */
  plan: Plan;
  /** Distinct raw ids that were replaced with {@link MATERIAL_FALLBACK_BLOCK}. */
  replacedIds: string[];
};

/**
 * Validates every block id in the plan against the pinned vanilla registry
 * ({@link isVanillaMinecraftBlockId}). Applies {@link normalizeBlockId} first
 * so common aliases become `minecraft:` ids when possible.
 *
 * Does not block execution: invalid values become {@link MATERIAL_FALLBACK_BLOCK}.
 * Symbolic slots (`material:…`) are not resolved — they are treated as invalid.
 *
 * @param plan Validated plan from the layer-map (step 3) model output.
 */
export function sanitizePlanMaterials(plan: Plan): SanitizePlanMaterialsResult {
  const replaced = new Set<string>();

  const passes = plan.passes.map((pass) => ({
    ...pass,
    layerMap: {
      ...pass.layerMap,
      palette: sanitizePalette(pass.layerMap.palette, replaced),
    },
  }));

  return {
    plan: PlanSchema.parse({ ...plan, passes }),
    replacedIds: [...replaced].sort(),
  };
}

function sanitizePalette(
  palette: Record<string, string>,
  replaced: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ch, block] of Object.entries(palette)) {
    if (ch === " ") {
      continue;
    }
    out[ch] = sanitizeOneBlockId(block, replaced);
  }
  return out;
}

function sanitizeOneBlockId(raw: string, replaced: Set<string>): string {
  const canonical = normalizeBlockId(raw).toLowerCase().trim();
  if (isVanillaMinecraftBlockId(canonical)) {
    return canonical;
  }
  replaced.add(raw.trim());
  return MATERIAL_FALLBACK_BLOCK;
}
