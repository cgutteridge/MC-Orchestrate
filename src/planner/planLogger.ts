import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type PlannerLogEntry = {
  timestamp: string;
  requestId: string;
  stage: string;
  payload: unknown;
};

/**
 * Writes planner-stage diagnostics as newline-delimited JSON.
 */
export class PlannerLogger {
  constructor(private readonly path: string) {}

  /**
   * Appends a planner diagnostic entry to the configured log file.
   */
  async log(entry: PlannerLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
