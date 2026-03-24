import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { Orchestrator } from "../orchestrator/orchestrator.js";

const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const BlockSampleSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  type: z.string(),
});

const PlayerSummarySchema = z.object({
  uuid: z.string(),
  name: z.string(),
  world: z.string(),
  position: Vec3Schema,
});

const RequestSchema = z.object({
  requestId: z.string(),
  player: PlayerSummarySchema.extend({
    yaw: z.number(),
    pitch: z.number(),
    lookVector: Vec3Schema,
  }),
  message: z.string(),
  localContext: z.object({
    targetBlock: BlockSampleSchema.optional(),
    nearbyBlocks: z.array(BlockSampleSchema),
    nearbyEntities: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        position: Vec3Schema,
      }),
    ),
    nearbyPlayers: z.array(PlayerSummarySchema),
  }),
  serverContext: z.object({
    timestamp: z.string(),
    dimension: z.string(),
    onlinePlayerCount: z.number(),
    motd: z.string().optional(),
  }),
});

const MAX_REQUEST_BYTES = 512 * 1024;

/**
 * Starts the localhost HTTP API used by the Spigot plugin to submit requests.
 */
export function createHttpServer(
  orchestrator: Orchestrator,
  host: string,
  port: number,
): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/requests/chat-command") {
      await handleChatCommand(req, res, orchestrator);
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      respondJson(res, 200, { status: "ok" });
      return;
    }

    respondJson(res, 404, { error: "Not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      process.stdout.write(`HTTP Orchestrator is running on http://${host}:${port}\n`);
      resolve(server);
    });
  });
}

async function handleChatCommand(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: Orchestrator,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const request = RequestSchema.parse(body);
    const ac = new AbortController();
    const onClose = () => {
      ac.abort();
    };
    req.once("close", onClose);
    try {
      const response = await orchestrator.handleChatCommand(request, {
        signal: ac.signal,
      });
      respondJson(res, 200, response);
    } finally {
      req.off("close", onClose);
    }
  } catch (error) {
    respondJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : {};
}

function respondJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
