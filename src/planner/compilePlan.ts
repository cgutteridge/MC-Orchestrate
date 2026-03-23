import type { BridgeCommand } from "../bridge/types.js";
import { compileLayerMapToBridgeCommands } from "./layerMap.js";
import type { Plan } from "./schema.js";

/**
 * Compiles a validated multi-pass plan into concrete bridge commands.
 */
export function compilePlanToBridgeCommands(plan: Plan): BridgeCommand[] {
  return plan.passes.flatMap((pass) =>
    compileLayerMapToBridgeCommands(pass.layerMap, plan.targetRegion.min),
  );
}
