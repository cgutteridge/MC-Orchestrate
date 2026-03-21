import type { ChatCommandRequest } from "../types/plugin.js";
import { parseRequestedBlock } from "./materialPalette.js";
import {
  asBlock,
  normalizeRegion,
  parseRequestedHeight,
  structureFootprintOrigin,
} from "./requestContext.js";
import type { Plan } from "./schema.js";
import { PlanSchema } from "./schema.js";
import {
  type BarnParams,
  type BridgeParams,
  type CottageParams,
  type GazeboParams,
  type TowerParams,
  compileBarnTemplate,
  compileBridgeTemplate,
  compileCottageTemplate,
  compileGazeboTemplate,
  compileTowerTemplate,
} from "./templates.js";

/**
 * Words that suggest a complex variation the AI should handle rather than a
 * deterministic template compiler.
 */
const TEMPLATE_COMPLEXITY_BLOCKLIST =
  /\b(spiral|lighthouse|pointed|staircase|circular|octagon|round|floating|underwater|upside)\b/;

/**
 * Attempts to parse a simple tower request into typed template parameters.
 * Returns `undefined` when the request is too complex or ambiguous for the
 * deterministic compiler.
 */
function parseTowerRequest(
  request: ChatCommandRequest,
): TowerParams | undefined {
  const message = request.message.toLowerCase().trim();
  if (!message.includes("tower")) {
    return undefined;
  }
  if (TEMPLATE_COMPLEXITY_BLOCKLIST.test(message)) {
    return undefined;
  }

  const height = Math.max(3, Math.min(16, parseRequestedHeight(request.message) ?? 8));
  const hollow = message.includes("hollow");

  const widthMatch = message.match(/(\d+)\s*(?:wide|by\s*\d+|block\s*wide)/);
  const width = widthMatch
    ? Math.max(2, Math.min(8, Number.parseInt(widthMatch[1], 10)))
    : 3;

  const block = parseRequestedBlock(request.message) ?? "material:wall";
  const anchor = structureFootprintOrigin(request, width, width);

  return {
    world: request.player.world,
    anchor,
    height,
    width,
    hollow,
    block,
  };
}

/**
 * Attempts to parse a simple barn request into typed template parameters.
 * Returns `undefined` when the request is too complex or ambiguous.
 */
function parseBarnRequest(
  request: ChatCommandRequest,
): BarnParams | undefined {
  const message = request.message.toLowerCase().trim();
  if (!message.includes("barn") && !message.includes("stable") && !message.includes("shed")) {
    return undefined;
  }
  if (TEMPLATE_COMPLEXITY_BLOCKLIST.test(message)) {
    return undefined;
  }

  const wallBlock = parseRequestedBlock(request.message) ?? "material:wall";
  const roofBlock = "material:roof";
  const width = 12;
  const depth = 8;
  const wallHeight = 4;

  const origin = structureFootprintOrigin(request, width, depth);

  return {
    world: request.player.world,
    origin,
    width,
    depth,
    wallHeight,
    wallBlock,
    roofBlock,
  };
}

/**
 * Attempts to parse a simple gazebo request into typed template parameters.
 * Returns `undefined` when the request is too complex or ambiguous.
 */
function parseGazeboRequest(
  request: ChatCommandRequest,
): GazeboParams | undefined {
  const message = request.message.toLowerCase().trim();
  if (
    !message.includes("gazebo") &&
    !message.includes("pavilion") &&
    !message.includes("pergola")
  ) {
    return undefined;
  }
  if (TEMPLATE_COMPLEXITY_BLOCKLIST.test(message)) {
    return undefined;
  }

  const platformBlock = parseRequestedBlock(request.message) ?? "material:wood";
  const postBlock = "material:trim";
  const roofBlock = "material:roof";
  const radius = 4;
  const postHeight = 4;

  // structureFootprintOrigin gives the min corner; offset by radius to get centre.
  const footprintMin = structureFootprintOrigin(request, radius * 2 + 1, radius * 2 + 1);
  const gazeboCenter = {
    x: footprintMin.x + radius,
    y: footprintMin.y,
    z: footprintMin.z + radius,
  };

  return {
    world: request.player.world,
    center: gazeboCenter,
    radius,
    postHeight,
    platformBlock,
    postBlock,
    roofBlock,
  };
}

/**
 * Attempts to parse a simple bridge request into typed template parameters.
 * Returns `undefined` when the request is too complex or ambiguous.
 */
function parseBridgeRequest(
  request: ChatCommandRequest,
): BridgeParams | undefined {
  const message = request.message.toLowerCase().trim();
  if (
    !message.includes("bridge") &&
    !message.includes("walkway") &&
    !message.includes("catwalk")
  ) {
    return undefined;
  }
  if (TEMPLATE_COMPLEXITY_BLOCKLIST.test(message)) {
    return undefined;
  }

  const length = Math.max(4, Math.min(16, parseRequestedHeight(request.message) ?? 8));
  const railings = !/(no\s+rail|no\s+fence)/.test(message);
  const walkBlock = parseRequestedBlock(request.message) ?? "material:floor";
  const railBlock = "material:detail";
  const halfWidth = 1; // default 3 wide: half = 1

  // Determine bridge axis and direction from horizontal look vector.
  const { x: lx, z: lz } = request.player.lookVector;
  const magnitude = Math.hypot(lx, lz);
  let axis: "x" | "z";
  let sign: number;
  if (magnitude >= 0.25) {
    axis = Math.abs(lx) >= Math.abs(lz) ? "x" : "z";
    sign = axis === "x" ? Math.sign(lx) : Math.sign(lz);
  } else {
    const yawRad = ((request.player.yaw + 90) * Math.PI) / 180;
    const cx = Math.cos(yawRad);
    const cz = Math.sin(yawRad);
    axis = Math.abs(cx) >= Math.abs(cz) ? "x" : "z";
    sign = axis === "x" ? Math.sign(cx) : Math.sign(cz);
  }
  sign = sign || 1;

  const anchor = asBlock(request.player.position);
  let walkwayFrom: ReturnType<typeof asBlock>;
  let walkwayTo: ReturnType<typeof asBlock>;

  if (axis === "x") {
    const startX = sign > 0 ? anchor.x : anchor.x - length + 1;
    walkwayFrom = { x: startX, y: anchor.y, z: anchor.z - halfWidth };
    walkwayTo = { x: startX + length - 1, y: anchor.y, z: anchor.z + halfWidth };
  } else {
    const startZ = sign > 0 ? anchor.z : anchor.z - length + 1;
    walkwayFrom = { x: anchor.x - halfWidth, y: anchor.y, z: startZ };
    walkwayTo = { x: anchor.x + halfWidth, y: anchor.y, z: startZ + length - 1 };
  }

  return {
    world: request.player.world,
    walkwayFrom,
    walkwayTo,
    axis,
    railings,
    walkBlock,
    railBlock,
  };
}

/**
 * Attempts to parse a simple cottage request into typed template parameters.
 * Returns `undefined` when the request is too complex or ambiguous.
 */
function parseCottageRequest(
  request: ChatCommandRequest,
): CottageParams | undefined {
  const message = request.message.toLowerCase().trim();
  if (!message.includes("cottage") && !message.includes("house") && !message.includes("hut")) {
    return undefined;
  }
  if (TEMPLATE_COMPLEXITY_BLOCKLIST.test(message)) {
    return undefined;
  }
  // Let the AI handle explicit size specifications — keep the template for
  // generic unqualified requests only.
  if (/\d+\s*(by|\×|x)\s*\d+/.test(message)) {
    return undefined;
  }

  const wallBlock = parseRequestedBlock(request.message) ?? "material:wall";
  const roofBlock = "material:roof";
  const width = 7;
  const depth = 7;
  const wallHeight = 4;

  const origin = structureFootprintOrigin(request, width, depth);

  return {
    world: request.player.world,
    origin,
    width,
    depth,
    wallHeight,
    wallBlock,
    roofBlock,
  };
}

/**
 * Returns a deterministic fallback plan for the small set of built-in v1 commands.
 */
export function buildHeuristicPlan(
  request: ChatCommandRequest,
  previousPlan?: Plan,
): Plan | undefined {
  const message = request.message.toLowerCase().trim();

  // Template compilers — only run when there is no prior plan context to
  // follow up on, so explicit follow-up phrases always take priority.
  if (!previousPlan) {
    const towerParams = parseTowerRequest(request);
    if (towerParams) {
      return PlanSchema.parse(compileTowerTemplate(towerParams));
    }

    const bridgeParams = parseBridgeRequest(request);
    if (bridgeParams) {
      return PlanSchema.parse(compileBridgeTemplate(bridgeParams));
    }

    const cottageParams = parseCottageRequest(request);
    if (cottageParams) {
      return PlanSchema.parse(compileCottageTemplate(cottageParams));
    }

    const barnParams = parseBarnRequest(request);
    if (barnParams) {
      return PlanSchema.parse(compileBarnTemplate(barnParams));
    }

    const gazeboParams = parseGazeboRequest(request);
    if (gazeboParams) {
      return PlanSchema.parse(compileGazeboTemplate(gazeboParams));
    }
  }

  const requestedBlock = parseRequestedBlock(message);
  if (requestedBlock && isMaterialFollowUpMessage(message)) {
    if (isAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureMaterialFollowUpFromPreviousPlan(previousPlan, requestedBlock),
      );
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request, "material"));
  }

  if (message.includes("taller") || message.includes("higher")) {
    if (isAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureFollowUpFromPreviousPlan(request, previousPlan),
      );
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request, "height"));
  }

  if (message.includes("bigger") || message.includes("larger")) {
    if (isAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureFootprintFollowUpFromPreviousPlan(request, previousPlan),
      );
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request, "footprint"));
  }

  if (isLocationQuery(message)) {
    if (previousPlan) {
      return PlanSchema.parse(buildStructureLocationReply(request, previousPlan));
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request, "location"));
  }

  return undefined;
}

function buildStructureFollowUpFromPreviousPlan(
  request: ChatCommandRequest,
  previousPlan: Plan,
): Plan {
  const increaseBy = parseHeightDelta(request.message) ?? 2;
  const previousRegion = normalizeRegion(previousPlan.targetRegion);
  const block = extractPrimaryBuildBlock(previousPlan) ?? "minecraft:stone";
  const from = {
    x: previousRegion.min.x,
    y: previousRegion.max.y + 1,
    z: previousRegion.min.z,
  };
  const to = {
    x: previousRegion.max.x,
    y: previousRegion.max.y + increaseBy,
    z: previousRegion.max.z,
  };

  return {
    intent: previousPlan.intent,
    targetWorld: previousPlan.targetWorld,
    targetRegion: {
      world: previousRegion.world,
      min: previousRegion.min,
      max: {
        x: previousRegion.max.x,
        y: previousRegion.max.y + increaseBy,
        z: previousRegion.max.z,
      },
    },
    assumptions: [
      `Extending the previously built structure by ${increaseBy} blocks using ${block}.`,
    ],
    passes: [
      {
        name: "structure_extension",
        goal: "Increase structure height by extending the existing footprint.",
        primitives: [
          {
            type: "fill_cuboid",
            from,
            to,
            block,
          },
        ],
      },
    ],
    reply: `Making it ${increaseBy} blocks taller.`,
    needsMoreInfo: false,
  };
}

function buildStructureMaterialFollowUpFromPreviousPlan(
  previousPlan: Plan,
  block: string,
): Plan {
  const previousRegion = normalizeRegion(previousPlan.targetRegion);
  return {
    intent: previousPlan.intent,
    targetWorld: previousPlan.targetWorld,
    targetRegion: previousRegion,
    assumptions: [
      `Restyling the previously built structure in ${block}.`,
    ],
    passes: previousPlan.passes.map((pass) => ({
      ...pass,
      primitives: pass.primitives.map((primitive) => {
        switch (primitive.type) {
          case "set_block":
          case "fill_cuboid":
          case "hollow_cuboid":
          case "cylinder":
            return {
              ...primitive,
              block,
            };
          case "replace_in_region":
          case "clear_region":
            return primitive;
        }
      }),
    })),
    reply: `Restyling it in ${block}.`,
    needsMoreInfo: false,
  };
}

function buildStructureFootprintFollowUpFromPreviousPlan(
  request: ChatCommandRequest,
  previousPlan: Plan,
): Plan {
  const increaseBy = parseFootprintDelta(request.message) ?? 1;
  const previousRegion = normalizeRegion(previousPlan.targetRegion);
  const block = extractPrimaryBuildBlock(previousPlan) ?? "minecraft:stone";
  const minX = previousRegion.min.x - increaseBy;
  const maxX = previousRegion.max.x + increaseBy;
  const minZ = previousRegion.min.z - increaseBy;
  const maxZ = previousRegion.max.z + increaseBy;
  const minY = previousRegion.min.y;
  const maxY = previousRegion.max.y;

  return {
    intent: previousPlan.intent,
    targetWorld: previousPlan.targetWorld,
    targetRegion: {
      world: previousRegion.world,
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    assumptions: [
      `Expanding the previous structure footprint by ${increaseBy} blocks on each horizontal side using ${block}.`,
    ],
    passes: [
      {
        name: "structure_footprint_expand",
        goal: "Increase structure footprint while preserving existing height.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: minX, y: minY, z: minZ },
            to: { x: maxX, y: maxY, z: previousRegion.min.z - 1 },
            block,
          },
          {
            type: "fill_cuboid",
            from: { x: minX, y: minY, z: previousRegion.max.z + 1 },
            to: { x: maxX, y: maxY, z: maxZ },
            block,
          },
          {
            type: "fill_cuboid",
            from: { x: minX, y: minY, z: previousRegion.min.z },
            to: { x: previousRegion.min.x - 1, y: maxY, z: previousRegion.max.z },
            block,
          },
          {
            type: "fill_cuboid",
            from: { x: previousRegion.max.x + 1, y: minY, z: previousRegion.min.z },
            to: { x: maxX, y: maxY, z: previousRegion.max.z },
            block,
          },
        ],
      },
    ],
    reply: `Making it ${increaseBy} blocks bigger.`,
    needsMoreInfo: false,
  };
}

const CLARIFICATION_REPLY: Record<
  "height" | "footprint" | "material" | "location",
  string
> = {
  height: "Tell me which structure to make taller.",
  footprint: "Tell me which structure to make bigger.",
  material: "Tell me which structure to restyle.",
  location: "I don't have a recent structure to locate.",
};

function buildStructureFollowUpClarification(
  request: ChatCommandRequest,
  kind: "height" | "footprint" | "material" | "location",
): Plan {
  const point = asBlock(request.player.position);
  return {
    intent: "unknown",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min: point,
      max: point,
    },
    assumptions: [],
    passes: [],
    reply: CLARIFICATION_REPLY[kind],
    needsMoreInfo: true,
    clarification:
      "I need structure context. Try looking at the structure and asking again.",
  };
}

const LOCATION_QUERY_PATTERN =
  /\b(can'?t see|cannot see|can'?t find|where is it|where did it go|where'?s it|lost it)\b/;

function isLocationQuery(message: string): boolean {
  return LOCATION_QUERY_PATTERN.test(message);
}

function buildStructureLocationReply(
  request: ChatCommandRequest,
  previousPlan: Plan,
): Plan {
  const region = normalizeRegion(previousPlan.targetRegion);
  const cx = Math.round((region.min.x + region.max.x) / 2);
  const cy = region.min.y;
  const cz = Math.round((region.min.z + region.max.z) / 2);
  const reply = `It's around (${cx}, ${cy}, ${cz}).`;
  const point = asBlock(request.player.position);
  return {
    intent: "unknown",
    targetWorld: request.player.world,
    targetRegion: { world: request.player.world, min: point, max: point },
    assumptions: [],
    passes: [],
    reply,
    needsMoreInfo: true,
    clarification:
      `Last structure center: (${cx}, ${cy}, ${cz}). ` +
      `Use '/tp @s ${cx} ${cy} ${cz}' to teleport to it.`,
  };
}

function parseHeightDelta(message: string): number | undefined {
  const lowered = message.toLowerCase();
  if (!lowered.includes("taller") && !lowered.includes("higher")) {
    return undefined;
  }
  return parseDelta(lowered, 1, 8);
}

function parseFootprintDelta(message: string): number | undefined {
  const lowered = message.toLowerCase();
  if (!lowered.includes("bigger") && !lowered.includes("larger")) {
    return undefined;
  }
  return parseDelta(lowered, 1, 4);
}

function parseDelta(lowered: string, min: number, max: number): number | undefined {
  const byMatch = lowered.match(/(?:by|add)\s+(\d+)/);
  if (byMatch) {
    const delta = Number.parseInt(byMatch[1], 10);
    return Number.isFinite(delta) ? Math.max(min, Math.min(max, delta)) : undefined;
  }

  const fallbackMatch = lowered.match(/\b(\d+)\b/);
  if (!fallbackMatch) {
    return undefined;
  }

  const fallback = Number.parseInt(fallbackMatch[1], 10);
  return Number.isFinite(fallback) ? Math.max(min, Math.min(max, fallback)) : undefined;
}

const MATERIAL_FOLLOW_UP_ACTION_BLOCKLIST =
  /\b(build|create|construct|make|place|remove|delete|destroy|clear)\b/;

const MATERIAL_FOLLOW_UP_CONTEXT_WORDS =
  /\b(it|that|same|instead|swap|change|use|in|with|as|using)\b/;

function isMaterialFollowUpMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  // Reject clear new-build or removal commands so they fall through to the AI.
  if (MATERIAL_FOLLOW_UP_ACTION_BLOCKLIST.test(trimmed)) {
    return false;
  }
  // Accept if the player used a follow-up context word ("use X instead",
  // "in oak", "with stone", "change it to glass", etc.).
  if (MATERIAL_FOLLOW_UP_CONTEXT_WORDS.test(trimmed)) {
    return true;
  }
  // Accept bare single- or two-word material names ("oak", "oak planks",
  // "white wool") without any explicit context word.
  return trimmed.split(/\s+/).length <= 2;
}

function extractPrimaryBuildBlock(plan: Plan): string | undefined {
  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      switch (primitive.type) {
        case "set_block":
        case "fill_cuboid":
        case "hollow_cuboid":
        case "cylinder":
          return primitive.block;
        case "replace_in_region":
        case "clear_region":
          break;
      }
    }
  }
  return undefined;
}

function isAdjustableStructurePlan(plan?: Plan): plan is Plan {
  if (!plan || plan.needsMoreInfo || plan.passes.length === 0) {
    return false;
  }
  return hasAdditiveStructurePrimitive(plan);
}

function hasAdditiveStructurePrimitive(plan: Plan): boolean {
  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      if (
        primitive.type === "set_block" ||
        primitive.type === "fill_cuboid" ||
        primitive.type === "hollow_cuboid" ||
        primitive.type === "cylinder"
      ) {
        return true;
      }
    }
  }
  return false;
}
