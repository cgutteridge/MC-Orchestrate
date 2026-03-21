import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeCommand } from "./types.js";

export type ActionLogEntry = {
  requestId: string;
  playerUuid: string;
  playerName: string;
  command: BridgeCommand;
  timestamp: string;
};

/**
 * Persists executed bridge commands as newline-delimited JSON for audit/debug use.
 */
export class ActionLogger {
  constructor(private readonly path: string) {}

  /**
   * Appends a single action entry to the configured log file.
   */
  async log(entry: ActionLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
