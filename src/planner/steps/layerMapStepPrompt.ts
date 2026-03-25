import type { ChatCommandRequest } from "../../types/plugin.js";
import type { DesignChoiceStep, Placement } from "../schema.js";
import type { StepChatPrompt } from "./stepPromptTypes.js";

/**
 * Worked example object for the layer-map (cottage); kept separate for readable diffs.
 */
function cottageLayerMapWorkedExample(): {
  briefFulfilment: string;
  layers: string[];
  palette: Record<string, string>;
} {
  return {
    briefFulfilment:
      "Cottage footprint: floor slab, cobble walls with door gap and glass on the street face, oak roof cap — matches a small enclosed structure.",
    layers: [
      ["PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP"].join("\n"),
      ["CCC_CCC", "C_____C", "C_____C", "C_____C", "C_____C", "CCCCCCC"].join("\n"),
      ["CCC_CCC", "C_____C", "G_____G", "G_____G", "C_____C", "CCGGGCC"].join("\n"),
      ["CCCCCCC", "C_____C", "G_____G", "G_____G", "C_____C", "CCGGGCC"].join("\n"),
      ["CCCCCCC", "C_____C", "C_____C", "C_____C", "C_____C", "CCCCCCC"].join("\n"),
      ["PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP"].join("\n"),
      ["       ", " PPPPP ", " PPPPP ", " PPPPP ", " PPPPP ", "       "].join("\n"),
      ["       ", "       ", "  PPP  ", "  PPP  ", "       ", "       "].join("\n"),
    ],
    palette: {
      P: "minecraft:oak_planks",
      C: "minecraft:cobblestone",
      G: "minecraft:glass",
      _: "minecraft:air",
    },
  };
}

function layerMapJsonContract(): string {
  return "Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.";
}

function layerMapRoleAndRules(): string {
  return `You are an expert Minecraft architect. Think in 3D first, then output JSON. The layer map serializes the 3D shape you already decided.

Make your design fit snugly within the given width×depth×height volume. \`layers\`: bottom→top Y (first string = lowest Y). Within each string, rows = +Z, characters = +X. \`palette\`: one character → one \`minecraft:\` id. Space = leave unchanged; \`_\` = air.

Include \`briefFulfilment\`: a short prose explanation (one to four sentences) of how this layer diagram and palette implement the design.`;
}

function layerMapWorkedExampleSection(): string {
  const cottageLayerMap = cottageLayerMapWorkedExample();
  return `=== WORKED EXAMPLE (layer map → cottage-shaped volume) ===
Illustrative only — adapt to the design step. 7×6 footprint, 7 Y slices. Rows = +Z, chars = +X.
Palette: P=oak_planks, C=cobblestone, G=glass, _=air. space=leave cell unchanged.

${JSON.stringify(cottageLayerMap, null, 2)}

Use vanilla \`minecraft:\` ids in palettes; prefer the design step's recommendedMaterials.`;
}

/**
 * **Step 3 (layer-map turn):** full system prompt — JSON-only reply, grid rules, worked example.
 *
 * @returns Concatenated system message for the layer-map model call.
 */
export function getLayerMapStepSystemPrompt(): string {
  return [
    layerMapJsonContract(),
    "",
    layerMapRoleAndRules(),
    "",
    layerMapWorkedExampleSection(),
  ].join("\n");
}

/**
 * **Step 3 (layer-map turn):** user message (volume + design prose; no world coordinates).
 *
 * @param mergedPlacement Locked placement with `desiredSize` from the design step.
 * @param design Validated design_choice.
 */
export function getLayerMapStepUserContent(
  mergedPlacement: Placement,
  design: DesignChoiceStep,
): string {
  const ds = mergedPlacement.desiredSize;
  if (ds === undefined) {
    throw new Error("getLayerMapStepUserContent requires placement.desiredSize");
  }

  const lines: string[] = [
    `Turn this design into a layer map (JSON): ${design.designSummary}`,
    "",
    `The voxel grid should fill the volume: ${ds.width} wide × ${ds.depth} deep × ${ds.height} tall (cells). Cells are about 1x1x1m`,
    "",
    design.builderGuide,
    "",
    "Recommended materials (you may use other/extra vanilla minecraft blocks if you want):",
    design.recommendedMaterials.join(", "),
    "",
  ];

  return lines.join("\n");
}

/**
 * **Step 3 (layer-map turn):** system + user prompts together.
 *
 * @param _request Reserved for API symmetry with other step composers.
 * @param mergedPlacement Placement from step 1 plus `desiredSize` from step 2.
 * @param design Validated design_choice from step 2.
 * @returns Messages content for one layer-map model call.
 */
export function composeLayerMapStepPrompt(
  _request: ChatCommandRequest,
  mergedPlacement: Placement,
  design: DesignChoiceStep,
): StepChatPrompt {
  return {
    system: getLayerMapStepSystemPrompt(),
    user: getLayerMapStepUserContent(mergedPlacement, design),
  };
}
