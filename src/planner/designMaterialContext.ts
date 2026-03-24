import { MINECRAFT_BLOCK_IDS, MINECRAFT_DATA_VERSION } from "../generated/minecraftBlockIds.js";
import { SUPPORTED_MATERIAL_HINTS } from "./materialPalette.js";

/**
 * Heuristic filter so the design-phase prompt lists build-relevant vanilla ids
 * without embedding the full registry (thousands of ids).
 */
function isBuildRelevantBlockId(id: string): boolean {
  const s = id.slice("minecraft:".length);
  return (
    /(?:planks|log|wood|stem|hyphae|stairs|slab|fence|wall|brick|stone|cobble|glass|wool|concrete|terracotta|quartz|copper|sand|sandstone|deepslate|granite|andesite|diorite|dirt|grass_block|moss|mud|ice|snow|clay|netherrack|basalt|blackstone|prismarine|purpur|obsidian)$/i.test(
      s,
    ) ||
    /^(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped)_(?:planks|log|wood)/i.test(
      s,
    )
  );
}

/**
 * Comma-separated excerpt of vanilla block ids for the **design phase only**
 * (builder phase does not receive this list).
 */
export function formatDesignPhaseMaterialRegistryExcerpt(): string {
  const picked = MINECRAFT_BLOCK_IDS.filter(isBuildRelevantBlockId).sort();
  return [
    `Pinned data pack: ${MINECRAFT_DATA_VERSION}. Total vanilla block ids: ${MINECRAFT_BLOCK_IDS.length}.`,
    `Excerpt of build-relevant ids (comma-separated):`,
    picked.join(", "),
  ].join("\n");
}

/**
 * System-prompt block: material context for the design step only.
 */
export function buildDesignPhaseMaterialRegistrySection(): string {
  return [
    "=== MATERIALS (design step only) ===",
    "You MUST recommend palette ids from vanilla Minecraft. Use `minecraft:` namespace.",
    `Shortcut hints: ${SUPPORTED_MATERIAL_HINTS}.`,
    "",
    formatDesignPhaseMaterialRegistryExcerpt(),
  ].join("\n");
}
