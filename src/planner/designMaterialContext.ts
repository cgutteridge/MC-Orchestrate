import { MINECRAFT_DATA_VERSION } from "../generated/minecraftBlockIds.js";

/**
 * System-prompt block: material context for the design step only.
 * Uses template notation to compactly express hundreds of block variants.
 */
export function composeDesignPhaseMaterialRegistrySection(): string {
  return [
    "=== MATERIAL TEMPLATES ===",
    `Data pack: ${MINECRAFT_DATA_VERSION}. All blocks use minecraft: namespace.`,
    "",
    "C=white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black",
    "W=oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped",
    "S=stone|cobblestone|mossy_cobblestone|granite|diorite|andesite|deepslate|blackstone|sandstone|red_sandstone",
    "",
    "Colored blocks: <C>_wool, <C>_concrete, <C>_concrete_powder, <C>_terracotta, <C>_glazed_terracotta, <C>_stained_glass, <C>_stained_glass_pane, <C>_carpet, <C>_bed, <C>_candle, <C>_banner, <C>_shulker_box",
    "",
    "Wood blocks: <W>_planks, <W>_log, <W>_wood, stripped_<W>_log, stripped_<W>_wood, <W>_stairs, <W>_slab, <W>_fence, <W>_fence_gate, <W>_door, <W>_trapdoor, <W>_button, <W>_pressure_plate, <W>_sign, <W>_hanging_sign",
    "",
    "Stone variants: <S>_stairs, <S>_slab, <S>_wall, <S>_button, <S>_pressure_plate",
    "",
    "Other common blocks: {bricks, brick_stairs, brick_slab, brick_wall, nether_bricks, nether_brick_stairs, nether_brick_slab, quartz_block, quartz_stairs, quartz_slab, prismarine, prismarine_bricks, prismarine_stairs, prismarine_slab, purpur_block, purpur_pillar, purpur_stairs, purpur_slab, obsidian, crying_obsidian, glowstone, sea_lantern, glass, glass_pane, iron_bars, chain, iron_block, gold_block, diamond_block, emerald_block, netherite_block, copper_block, exposed_copper, weathered_copper, oxidized_copper, cut_copper, waxed_copper_block, moss_block, moss_carpet, dirt, grass_block, podzol, mycelium, mud, mud_bricks, packed_mud, snow_block, ice, packed_ice, blue_ice, clay, terracotta, basalt, smooth_basalt, calcite, tuff, dripstone_block, amethyst_block, coal_block, redstone_block, lapis_block, bone_block, hay_block, dried_kelp_block, sponge, wet_sponge, slime_block, honey_block, melon, pumpkin, carved_pumpkin, jack_o_lantern, mushroom_stem, red_mushroom_block, brown_mushroom_block, shroomlight, target, tnt, bookshelf, ladder, torch, soul_torch, redstone_torch, lantern, soul_lantern, campfire, soul_campfire, barrel, chest, trapped_chest, crafting_table, furnace, blast_furnace, smoker, respawn_anchor, lectern, composter, beehive, bee_nest, flower_pot, air}",
  ].join("\n");
}
