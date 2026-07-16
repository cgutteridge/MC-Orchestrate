import { RequestEventLogger } from "../logging/requestEventLogger.js";

export type PlannerLogEntry = {
  timestamp: string;
  requestId: string;
  stage: string;
  payload: unknown;
};

/**
 * Compatibility wrapper that emits planning diagnostics to the shared request
 * trace log.
 */
export class PlannerLogger {
  constructor(private readonly requestEventLoggers: RequestEventLogger[]) {}

  /**
   * Appends a planner diagnostic entry to the configured log file.
   */
  async log(entry: PlannerLogEntry): Promise<void> {
    const event = {
      timestamp: entry.timestamp,
      requestId: entry.requestId,
      phase: "planning",
      event: entry.stage,
      payload: entry.payload,
    };
    await Promise.all(this.requestEventLoggers.map((logger) => logger.log(event)));
  }
}
