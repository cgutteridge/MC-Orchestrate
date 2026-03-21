export type BridgeBatchBlock = {
  x: number;
  y: number;
  z: number;
  type: string;
};

export type BridgeCommand =
  | { kind: "say"; message: string }
  | { kind: "setBlock"; x: number; y: number; z: number; block: string }
  | {
      kind: "fill";
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      block: string;
    }
  | {
      kind: "replace";
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      fromBlock: string;
      toBlock: string;
    }
  | { kind: "batchSet"; blocks: BridgeBatchBlock[] };
