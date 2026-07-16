import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type RequestEventLogEntry = {
  timestamp: string;
  requestId: string;
  phase: string;
  event: string;
  payload: unknown;
};

/**
 * Primary structured request trace log. One JSON object per line.
 */
export class RequestEventLogger {
  constructor(
    private readonly path: string,
    private readonly options?: { pretty?: boolean },
  ) {}

  async log(entry: RequestEventLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const formatted = this.options?.pretty
      ? `${JSON.stringify(entry, null, 2)}\n`
      : `${JSON.stringify(entry)}\n`;
    await appendFile(this.path, formatted, "utf8");
  }
}
