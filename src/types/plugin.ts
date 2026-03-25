export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type BlockSample = {
  x: number;
  y: number;
  z: number;
  type: string;
};

export type NearbyEntity = {
  name: string;
  type: string;
  position: Vec3;
};

export type PlayerSummary = {
  uuid: string;
  name: string;
  world: string;
  position: Vec3;
};

export type PlayerSnapshot = PlayerSummary & {
  yaw: number;
  pitch: number;
  lookVector: Vec3;
};

export type LocalContext = {
  targetBlock?: BlockSample;
  nearbyBlocks: BlockSample[];
  nearbyEntities: NearbyEntity[];
  nearbyPlayers: PlayerSummary[];
};

export type ServerContext = {
  timestamp: string;
  dimension: string;
  onlinePlayerCount: number;
  motd?: string;
};

/**
 * Bounding box of the initial block scan sent with every plugin request.
 * Allows the AI to know the spatial extent of the world data it received.
 */
export type InitialScanRegion = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type ChatCommandRequest = {
  requestId: string;
  player: PlayerSnapshot;
  message: string;
  localContext: LocalContext;
  serverContext: ServerContext;
  /** Bounding box of the expanded block scan included in `localContext.nearbyBlocks`. */
  initialScanRegion?: InitialScanRegion;
};

export type ChatCommandResponse = {
  status: "executed" | "rejected" | "error";
  reply: string;
  requestId: string;
  intent: string;
  /**
   * When present (successful builds from the AI planner), short rationale for how the
   * layer diagram fulfils the design step and player brief.
   */
  briefFulfilment?: string;
  /**
   * Successful runs: total bridge operations executed for the primary plan.
   * Error runs: bridge operations completed before failure or cancellation
   * (partial progress).
   */
  executedActions?: number;
  /** Present when execution failed on a specific bridge operation. */
  failedCommandSummary?: string;
  /** True when the HTTP client disconnected and execution was aborted. */
  cancelled?: boolean;
};
