import { RequestEventLogger } from "../logging/requestEventLogger.js";
import type { BridgeCommand } from "./types.js";

export type ActionLogEntry = {
  requestId: string;
  playerUuid: string;
  playerName: string;
  command: BridgeCommand;
  timestamp: string;
};

/**
 * Compatibility wrapper that emits bridge execution events to the shared
 * request trace log.
 */
export class ActionLogger {
  constructor(private readonly requestEventLogger: RequestEventLogger) {}

  /**
   * Appends a single action entry to the configured log file.
   */
  async log(entry: ActionLogEntry): Promise<void> {
    await this.requestEventLogger.log({
      timestamp: entry.timestamp,
      requestId: entry.requestId,
      phase: "execution",
      event: "bridge_command",
      payload: {
        playerUuid: entry.playerUuid,
        playerName: entry.playerName,
        command: entry.command,
      },
    });
  }
}
