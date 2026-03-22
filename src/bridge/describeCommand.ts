import type { BridgeCommand } from "./types.js";

/**
 * Returns a short, player-facing summary of a bridge command for logs and
 * execution failure messages.
 *
 * @param command A validated bridge command produced by the plan compiler.
 * @returns Human-readable description (no newlines).
 */
export function describeBridgeCommand(command: BridgeCommand): string {
  switch (command.kind) {
    case "say":
      return "say";
    case "setBlock":
      return `set_block at (${command.x}, ${command.y}, ${command.z}) ${command.block}`;
    case "fill":
      return `fill ${command.block} (${command.from.x},${command.from.y},${command.from.z})→(${command.to.x},${command.to.y},${command.to.z})`;
    case "replace":
      return `replace ${command.fromBlock}→${command.toBlock} in region (${command.from.x},${command.from.y},${command.from.z})→(${command.to.x},${command.to.y},${command.to.z})`;
    case "batchSet":
      return `batch_set ${command.blocks.length} block(s)`;
  }
}
