import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Human-readable, append-only log for {@link runDesignLoop} progress (one line per event).
 * Complements structured `ai-planner.jsonl` entries.
 */
export class DesignLoopLogger {
  /**
   * @param path Filesystem path for the log (e.g. `logs/design-loop.log`).
   */
  constructor(private readonly path: string) {}

  /**
   * Appends a single line: ISO timestamp, request id, turn fraction, event label, optional detail.
   *
   * @param requestId Correlates with plugin / orchestrator request.
   * @param turnIndex Zero-based turn index (displayed as `turnIndex + 1`). Use `-1` to omit the turn fraction (session-level lines).
   * @param maxTurns Maximum turns configured for this loop.
   * @param event Short machine-readable event name (e.g. `turn_start`, `exit`).
   * @param detail Optional human-readable suffix (kept short; not a full payload dump).
   */
  async line(
    requestId: string,
    turnIndex: number,
    maxTurns: number,
    event: string,
    detail?: string,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const suffix = detail !== undefined && detail !== "" ? ` — ${detail}` : "";
    const turnPart =
      turnIndex < 0 ? "" : ` turn ${turnIndex + 1}/${maxTurns} —`;
    await appendFile(
      this.path,
      `${new Date().toISOString()} [${requestId}]${turnPart} ${event}${suffix}\n`,
      "utf8",
    );
  }
}
