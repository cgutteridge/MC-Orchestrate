import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Human-readable, append-only log for {@link runPlacementThenBuild} (one line per event).
 * Complements structured `ai-planner.jsonl` entries.
 */
export class PlacementBuildLogger {
  /**
   * @param path Filesystem path for the log (e.g. `logs/ai-plan.log`).
   */
  constructor(private readonly path: string) {}

  /**
   * Appends a single line: ISO timestamp, request id, step fraction, event label, optional detail.
   *
   * @param requestId Correlates with plugin / orchestrator request.
   * @param stepIndex Zero-based step index (displayed as `stepIndex + 1`). Use `-1` to omit the step fraction (session-level lines).
   * @param maxSteps Maximum AI calls configured for this request (placement → layer-map step plus any correction retries).
   * @param event Short machine-readable event name (e.g. `call_start`, `exit`).
   * @param detail Optional human-readable suffix (kept short; not a full payload dump).
   */
  async line(
    requestId: string,
    stepIndex: number,
    maxSteps: number,
    event: string,
    detail?: string,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const suffix = detail !== undefined && detail !== "" ? ` — ${detail}` : "";
    const stepPart = stepIndex < 0 ? "" : ` step ${stepIndex + 1}/${maxSteps} —`;
    await appendFile(
      this.path,
      `${new Date().toISOString()} [${requestId}]${stepPart} ${event}${suffix}\n`,
      "utf8",
    );
  }
}
