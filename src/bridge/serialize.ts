import type { BridgeBatchBlock, BridgeCommand } from "./types.js";

export function serializeBridgeCommand(command: BridgeCommand): string[] {
  switch (command.kind) {
    case "say":
      return [`say ${command.message}`];
    case "setBlock":
      return [
        `setBlock ${command.x} ${command.y} ${command.z} ${command.block}`,
      ];
    case "fill":
      return [
        `fill ${command.from.x} ${command.from.y} ${command.from.z} ${command.to.x} ${command.to.y} ${command.to.z} ${command.block}`,
      ];
    case "replace":
      return [
        `replace ${command.from.x} ${command.from.y} ${command.from.z} ${command.to.x} ${command.to.y} ${command.to.z} ${command.fromBlock} ${command.toBlock}`,
      ];
    case "batchSet":
      return [`batchSet ${JSON.stringify(command.blocks)}`];
  }
}

export function normalizeBatchBlocks(blocks: BridgeBatchBlock[]): BridgeBatchBlock[] {
  return blocks.map((block) => ({
    x: Math.trunc(block.x),
    y: Math.trunc(block.y),
    z: Math.trunc(block.z),
    type: block.type,
  }));
}
