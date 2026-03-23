import { readFile, readdir, stat } from "node:fs/promises";
import { inflateSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { parse } from "prismarine-nbt";
import type { Region } from "../planner/schema.js";
import type { BlockSample } from "../types/plugin.js";

type NbtSummary = Record<string, unknown>;

/**
 * Result of reading block samples from on-disk region files. When `ok` is
 * false the caller should treat the scan as unavailable (not as an empty
 * region).
 */
export type RegionBlocksOutcome =
  | { ok: true; blocks: BlockSample[] }
  | { ok: false; reason: string };

/** Maximum number of blocks returned by a single region scan. */
const MAX_SCAN_BLOCKS = 4096;

/** Block names treated as empty space in scan results. */
const AIR_BLOCKS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

/**
 * Provides read-only access to world metadata, region listings, and block data
 * from the local Minecraft server directory.
 */
export class WorldReader {
  constructor(private readonly minecraftDir: string) {}

  /**
   * Reads a summarized view of the world's `level.dat` file when available.
   */
  async readLevelMetadata(worldName = "world"): Promise<NbtSummary | undefined> {
    const filePath = path.join(this.minecraftDir, worldName, "level.dat");
    return readNbtSummary(filePath);
  }

  /**
   * Reads a summarized view of a player's NBT metadata file when available.
   */
  async readPlayerMetadata(
    playerUuid: string,
    worldName = "world",
  ): Promise<NbtSummary | undefined> {
    const filePath = path.join(this.minecraftDir, worldName, "playerdata", `${playerUuid}.dat`);
    return readNbtSummary(filePath);
  }

  /**
   * Lists region files for the given world directory in sorted order.
   */
  async listRegionFiles(worldName = "world"): Promise<string[]> {
    const regionDir = path.join(this.minecraftDir, worldName, "region");
    try {
      const files = await readdir(regionDir);
      return files.filter((file) => file.endsWith(".mca")).sort();
    } catch {
      return [];
    }
  }

  /**
   * Reads non-air blocks within the given region from Minecraft world files on
   * disk. Parses `.mca` Anvil region files using the 1.18+ chunk NBT format
   * (palette-based block states). Returns `undefined` on any I/O or parse
   * error so callers can fail gracefully without disrupting AI planning.
   *
   * COMPATIBILITY: Designed for Minecraft 1.18+. The 1.21.x chunk NBT layout
   * uses the same palette format. If parsing fails for any reason the method
   * returns `undefined` rather than throwing.
   */
  async readRegionBlocks(region: Region, worldName = "world"): Promise<BlockSample[] | undefined> {
    const outcome = await this.readRegionBlocksOutcome(region, worldName);
    return outcome.ok ? outcome.blocks : undefined;
  }

  /**
   * Reads non-air blocks from `.mca` files and distinguishes an empty-but-valid
   * scan from a failed scan (missing world, unreadable chunks, unsupported
   * compression). Use when the region is outside any in-memory block map and
   * you need authoritative terrain from disk.
   */
  async readRegionBlocksOutcome(region: Region, worldName = "world"): Promise<RegionBlocksOutcome> {
    try {
      return await readBlocksFromRegion(path.join(this.minecraftDir, worldName, "region"), region);
    } catch {
      return {
        ok: false,
        reason: "Unexpected error while reading region files.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Region file (Anvil .mca) parsing
// ---------------------------------------------------------------------------

/**
 * Returns all non-air BlockSamples within `region` by reading the relevant
 * `.mca` region files. Distinguishes a successful empty read from a failed
 * read (missing directory, or chunk data present but not parseable).
 */
async function readBlocksFromRegion(
  regionDir: string,
  region: Region,
): Promise<RegionBlocksOutcome> {
  try {
    const st = await stat(regionDir);
    if (!st.isDirectory()) {
      return {
        ok: false,
        reason: "World region path exists but is not a directory.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "World region directory is missing or not readable.",
    };
  }

  const { min, max } = region;

  // Determine which 16-block-wide chunk columns intersect the region.
  const chunkMinX = Math.floor(min.x / 16);
  const chunkMinZ = Math.floor(min.z / 16);
  const chunkMaxX = Math.floor(max.x / 16);
  const chunkMaxZ = Math.floor(max.z / 16);

  // Group chunk columns by the .mca file that contains them (32×32 chunks).
  type ChunkCoord = { cx: number; cz: number };
  const regionChunks = new Map<string, ChunkCoord[]>();

  for (let cx = chunkMinX; cx <= chunkMaxX; cx++) {
    for (let cz = chunkMinZ; cz <= chunkMaxZ; cz++) {
      const rx = Math.floor(cx / 32);
      const rz = Math.floor(cz / 32);
      const filename = `r.${rx}.${rz}.mca`;
      const coords = regionChunks.get(filename) ?? [];
      coords.push({ cx, cz });
      regionChunks.set(filename, coords);
    }
  }

  const results: BlockSample[] = [];
  let anyChunkOk = false;
  let anyChunkFailed = false;

  for (const [filename, chunks] of regionChunks) {
    if (results.length >= MAX_SCAN_BLOCKS) {
      break;
    }

    let regionData: Buffer;
    try {
      regionData = await readFile(path.join(regionDir, filename));
    } catch {
      // Region file doesn't exist yet (ungenerated area) — skip silently.
      continue;
    }

    for (const { cx, cz } of chunks) {
      if (results.length >= MAX_SCAN_BLOCKS) {
        break;
      }
      const { status, blocks } = await extractChunkBlocks(regionData, cx, cz, region);
      if (status === "ok") {
        anyChunkOk = true;
        results.push(...blocks);
      } else if (status === "failed") {
        anyChunkFailed = true;
      }
    }
  }

  if (anyChunkOk) {
    return { ok: true, blocks: results.slice(0, MAX_SCAN_BLOCKS) };
  }
  if (anyChunkFailed) {
    return {
      ok: false,
      reason:
        "At least one chunk in this region could not be read (unsupported compression, corrupt data, or incompatible format). On-disk scan is unavailable for this region.",
    };
  }
  return { ok: true, blocks: [] };
}

type ChunkExtractStatus = "ungenerated" | "ok" | "failed";

/**
 * Reads one chunk column from a loaded region buffer and returns its
 * non-air BlockSamples within the given region bounds.
 */
async function extractChunkBlocks(
  regionData: Buffer,
  cx: number,
  cz: number,
  region: Region,
): Promise<{ status: ChunkExtractStatus; blocks: BlockSample[] }> {
  try {
    // Anvil header: 1024 entries of 4 bytes each.
    // Entry layout: 3-byte sector offset (big-endian) + 1-byte sector count.
    const localCx = ((cx % 32) + 32) % 32;
    const localCz = ((cz % 32) + 32) % 32;
    const headerOffset = (localCx + localCz * 32) * 4;

    if (headerOffset + 4 > regionData.length) {
      return { status: "failed", blocks: [] };
    }

    const sectorOffset =
      (regionData[headerOffset]! << 16) |
      (regionData[headerOffset + 1]! << 8) |
      regionData[headerOffset + 2]!;

    if (sectorOffset === 0) {
      // Chunk has not been generated.
      return { status: "ungenerated", blocks: [] };
    }

    const dataStart = sectorOffset * 4096;
    if (dataStart + 5 > regionData.length) {
      return { status: "failed", blocks: [] };
    }

    // Chunk data: 4-byte length (big-endian) + 1-byte compression type.
    const dataLength = regionData.readUInt32BE(dataStart);
    const compressionType = regionData[dataStart + 4]!;
    const compressedData = regionData.subarray(dataStart + 5, dataStart + 4 + dataLength);

    let rawNbt: Buffer;
    if (compressionType === 1) {
      rawNbt = gunzipSync(compressedData);
    } else if (compressionType === 2) {
      rawNbt = inflateSync(compressedData);
    } else if (compressionType === 3) {
      rawNbt = Buffer.from(compressedData);
    } else {
      // Unsupported compression format (e.g. LZ4 = type 4).
      return { status: "failed", blocks: [] };
    }

    const blocks = await parseChunkNbtAndExtract(rawNbt, cx, cz, region);
    return { status: "ok", blocks };
  } catch {
    return { status: "failed", blocks: [] };
  }
}

/**
 * Parses raw (already decompressed) chunk NBT bytes and extracts BlockSamples
 * within the region bounds. Supports the 1.18+ `sections[].block_states`
 * format with palette and packed long-array block data.
 */
async function parseChunkNbtAndExtract(
  rawNbt: Buffer,
  cx: number,
  cz: number,
  region: Region,
): Promise<BlockSample[]> {
  const parsed = await parse(rawNbt);

  // prismarine-nbt wraps the root compound under an empty-string key.
  const rawRoot = parsed.parsed.value as Record<string, unknown>;
  const root = isRecord(rawRoot[""]) ? (rawRoot[""] as Record<string, unknown>) : rawRoot;

  // 1.18+ format: `sections` is at the top level.
  // Pre-1.18 format: data lives under a `Level` key.
  const chunkData = Array.isArray(root["sections"])
    ? root
    : isRecord(root["Level"])
      ? (root["Level"] as Record<string, unknown>)
      : root;

  const sections: unknown[] = Array.isArray(chunkData["sections"])
    ? chunkData["sections"]
    : Array.isArray(chunkData["Sections"])
      ? chunkData["Sections"]
      : [];

  const chunkWorldX = cx * 16;
  const chunkWorldZ = cz * 16;
  const { min, max } = region;
  const results: BlockSample[] = [];

  for (const section of sections) {
    if (!isRecord(section)) {
      continue;
    }

    // Section Y index: each section covers 16 blocks vertically.
    const sectionY = extractNbtInt(section["Y"] ?? section["y"]);
    if (sectionY === undefined) {
      continue;
    }
    const sectionMinY = sectionY * 16;
    const sectionMaxY = sectionMinY + 15;

    if (sectionMaxY < min.y || sectionMinY > max.y) {
      continue;
    }

    // Block states container — either `block_states` (1.18+) or at section root (pre-1.18).
    const blockStates: Record<string, unknown> = isRecord(section["block_states"])
      ? (section["block_states"] as Record<string, unknown>)
      : section;

    const rawPalette: unknown[] = Array.isArray(blockStates["palette"])
      ? blockStates["palette"]
      : Array.isArray(blockStates["Palette"])
        ? blockStates["Palette"]
        : [];

    const palette: string[] = rawPalette.map((entry) => {
      if (!isRecord(entry)) {
        return "minecraft:air";
      }
      const name = entry["Name"] ?? entry["name"];
      return typeof name === "string" ? name : "minecraft:air";
    });

    if (palette.length === 0) {
      continue;
    }

    // Single-entry palette: every block in this section is the same type.
    if (palette.length === 1) {
      const blockName = palette[0]!;
      if (!AIR_BLOCKS.has(blockName)) {
        emitSectionBlocks(blockName, chunkWorldX, sectionMinY, chunkWorldZ, min, max, results);
      }
      continue;
    }

    // Multi-entry palette: decode the packed long array.
    const rawLongs = extractLongArray(blockStates["data"]);
    if (!rawLongs || rawLongs.length === 0) {
      continue;
    }

    const bitsPerEntry = Math.max(4, Math.ceil(Math.log2(palette.length)));
    const indices = unpackLongArray(rawLongs, bitsPerEntry, 4096);

    for (let localY = 0; localY < 16; localY++) {
      const worldY = sectionMinY + localY;
      if (worldY < min.y || worldY > max.y) {
        continue;
      }
      for (let localZ = 0; localZ < 16; localZ++) {
        const worldZ = chunkWorldZ + localZ;
        if (worldZ < min.z || worldZ > max.z) {
          continue;
        }
        for (let localX = 0; localX < 16; localX++) {
          const worldX = chunkWorldX + localX;
          if (worldX < min.x || worldX > max.x) {
            continue;
          }
          // 1.18+ index ordering: Y*256 + Z*16 + X
          const blockIndex = localY * 256 + localZ * 16 + localX;
          const paletteIndex = indices[blockIndex] ?? 0;
          const blockName = palette[paletteIndex] ?? "minecraft:air";
          if (!AIR_BLOCKS.has(blockName)) {
            results.push({ x: worldX, y: worldY, z: worldZ, type: blockName });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Emits a BlockSample for every position in a 16×16×16 section that falls
 * within the region bounds. Used when the palette has only one entry.
 */
function emitSectionBlocks(
  blockName: string,
  chunkWorldX: number,
  sectionMinY: number,
  chunkWorldZ: number,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  results: BlockSample[],
): void {
  for (let localY = 0; localY < 16; localY++) {
    const worldY = sectionMinY + localY;
    if (worldY < min.y || worldY > max.y) {
      continue;
    }
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldZ = chunkWorldZ + localZ;
      if (worldZ < min.z || worldZ > max.z) {
        continue;
      }
      for (let localX = 0; localX < 16; localX++) {
        const worldX = chunkWorldX + localX;
        if (worldX < min.x || worldX > max.x) {
          continue;
        }
        results.push({ x: worldX, y: worldY, z: worldZ, type: blockName });
      }
    }
  }
}

/**
 * Unpacks a packed big-endian long array into palette indices. Uses the
 * 1.16+ "no-spanning" format where entries never straddle long boundaries.
 */
function unpackLongArray(longs: bigint[], bitsPerEntry: number, count: number): number[] {
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  const entriesPerLong = Math.floor(64 / bitsPerEntry);
  const indices: number[] = new Array<number>(count).fill(0);

  for (let i = 0; i < count; i++) {
    const longIndex = Math.floor(i / entriesPerLong);
    const bitOffset = BigInt((i % entriesPerLong) * bitsPerEntry);
    if (longIndex < longs.length) {
      indices[i] = Number((longs[longIndex]! >> bitOffset) & mask);
    }
  }

  return indices;
}

/**
 * Extracts a BigInt array from an NBT long-array value.
 * prismarine-nbt represents `longArray` as `{ type: "longArray", value: ... }`.
 */
function extractLongArray(value: unknown): bigint[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const inner = value["value"];
  if (!Array.isArray(inner)) {
    return undefined;
  }
  try {
    return (inner as (number | bigint)[]).map((v) => BigInt(v));
  } catch {
    return undefined;
  }
}

/**
 * Extracts an integer from an NBT numeric value.
 * prismarine-nbt wraps primitive values as `{ type, value }` objects.
 */
function extractNbtInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (isRecord(value)) {
    const inner = value["value"];
    if (typeof inner === "number") {
      return Math.trunc(inner);
    }
    if (typeof inner === "bigint") {
      return Number(inner);
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Shared NBT summary helpers (existing functionality)
// ---------------------------------------------------------------------------

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
