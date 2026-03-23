/**
 * Writes `src/generated/minecraftBlockIds.ts` from the pinned minecraft-data
 * registry (same source as prismarine-*). Run after upgrading Minecraft:
 *
 *   npm run generate:blocks
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import minecraftData from "minecraft-data";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Match server JAR in env / README (Spigot 1.21.1). */
const MINECRAFT_DATA_VERSION = "1.21.1";

function main(): void {
  const md = minecraftData(MINECRAFT_DATA_VERSION);
  const blockIds = md.blocksArray.map((b) => `minecraft:${b.name}`).sort();

  const lines: string[] = [
    "/**",
    ` * Canonical Minecraft block ids from minecraft-data (${MINECRAFT_DATA_VERSION}).`,
    " * Regenerate: `npm run generate:blocks`",
    " *",
    " * @generated",
    " */",
    "",
    `export const MINECRAFT_DATA_VERSION = ${JSON.stringify(MINECRAFT_DATA_VERSION)} as const;`,
    "",
    "export const MINECRAFT_BLOCK_IDS = [",
  ];

  for (const id of blockIds) {
    lines.push(`  ${JSON.stringify(id)},`);
  }

  lines.push(
    "] as const;",
    "",
    "export const MINECRAFT_BLOCK_ID_SET = new Set<string>(MINECRAFT_BLOCK_IDS as readonly string[]);",
    "",
    "/**",
    " * @returns True when `id` is a known vanilla block for {@link MINECRAFT_DATA_VERSION}.",
    " */",
    "export function isVanillaMinecraftBlockId(id: string): boolean {",
    "  return MINECRAFT_BLOCK_ID_SET.has(id.toLowerCase().trim());",
    "}",
    "",
  );

  const outPath = join(__dirname, "..", "src", "generated", "minecraftBlockIds.ts");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  process.stdout.write(
    `Wrote ${blockIds.length} block ids to ${outPath} (minecraft-data ${MINECRAFT_DATA_VERSION}).\n`,
  );
}

main();
