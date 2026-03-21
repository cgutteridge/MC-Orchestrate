import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "prismarine-nbt";

type NbtSummary = Record<string, unknown>;

export class WorldReader {
  constructor(private readonly minecraftDir: string) {}

  async readLevelMetadata(worldName = "world"): Promise<NbtSummary | undefined> {
    const filePath = path.join(this.minecraftDir, worldName, "level.dat");
    return readNbtSummary(filePath);
  }

  async readPlayerMetadata(playerUuid: string, worldName = "world"): Promise<NbtSummary | undefined> {
    const filePath = path.join(
      this.minecraftDir,
      worldName,
      "playerdata",
      `${playerUuid}.dat`,
    );
    return readNbtSummary(filePath);
  }

  async listRegionFiles(worldName = "world"): Promise<string[]> {
    const regionDir = path.join(this.minecraftDir, worldName, "region");
    try {
      const files = await readdir(regionDir);
      return files.filter((file) => file.endsWith(".mca")).sort();
    } catch {
      return [];
    }
  }
}

async function readNbtSummary(filePath: string): Promise<NbtSummary | undefined> {
  try {
    const file = await readFile(filePath);
    const parsed = await parse(file);
    return summarizeValue(parsed.parsed.value as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

function summarizeValue(value: Record<string, unknown>): NbtSummary {
  const summary: NbtSummary = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    summary[key] = simplify(entry);
  }
  return summary;
}

function simplify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => simplify(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 5);
    return Object.fromEntries(entries.map(([key, item]) => [key, simplify(item)]));
  }
  return value;
}
