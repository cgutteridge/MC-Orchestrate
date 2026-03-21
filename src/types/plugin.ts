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

export type ChatCommandRequest = {
  requestId: string;
  player: PlayerSnapshot;
  message: string;
  recentMessages: string[];
  localContext: LocalContext;
  serverContext: ServerContext;
};

export type ChatCommandResponse = {
  status: "executed" | "needs_more_info" | "rejected" | "error";
  reply: string;
  requestId: string;
  intent: string;
  executedActions?: number;
};
