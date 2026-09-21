export const SLOT_COUNT = 12 as const;
export const RING_COUNT = 3 as const;
export const STATE_SPACE = SLOT_COUNT ** RING_COUNT;

export const RULESET_VERSION = "stone-rings-v2" as const;
export const SCHEMA_VERSION = 2 as const;
export const GENERATOR_VERSION = "generator-v2" as const;
export const SOLVER_VERSION = "solver-v2" as const;
export const POOL_VERSION = "pool-v2" as const;
export const SAVE_SCHEMA_VERSION = 2 as const;

export const RING_IDS = ["inner", "middle", "outer"] as const;
export type RingId = (typeof RING_IDS)[number];
export type Difficulty = "easy" | "normal" | "hard";
export type PartKind = "emitter" | "blocker";
export type MoveType = "l" | "r";
export type RotationTuple = [number, number, number];

export type RingPart = {
  kind: PartKind;
  slot: number;
};

export type RingDefinition = {
  id: RingId;
  parts: RingPart[];
};

export type BoardState = {
  rotations: RotationTuple;
};

export type Puzzle = {
  schemaVersion: typeof SCHEMA_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  generatorVersion: string;
  id: string;
  difficulty: Difficulty;
  slotCount: typeof SLOT_COUNT;
  rings: [RingDefinition, RingDefinition, RingDefinition];
  targets: number[];
  initialState: BoardState;
  contentChecksum: string;
};

export type BeamPhase = "in" | "out" | "clear";

export type BeamTrace = {
  sourceRing: number;
  sourceSlot: number;
  oppositeSlot: number;
  reachedRim: boolean;
  blockedRing: number | null;
  blockedSlot: number | null;
  phase: BeamPhase;
  inwardPath: number[];
  outwardPath: number[];
};

export type LightResult = {
  litMask: number;
  litSlots: number[];
  beams: BeamTrace[];
  solved: boolean;
  litRequired: number;
  requiredCount: number;
};

export type HistoryAction = {
  puzzleId: string;
  rulesetVersion: typeof RULESET_VERSION;
  n: number;
  t: number;
  type: MoveType;
  ring: number;
};

export type HistoryFailureCode =
  | "not-array"
  | "missing-field"
  | "wrong-puzzle"
  | "wrong-ruleset"
  | "bad-sequence"
  | "bad-time"
  | "bad-type"
  | "bad-ring"
  | "after-success";

export type HistoryValidation =
  | { ok: true; actions: HistoryAction[] }
  | { ok: false; index: number; code: HistoryFailureCode; message: string };

export type ReplayResult = {
  state: BoardState;
  solved: boolean;
  illegal: boolean;
  acceptedActions: number;
  firstSolvedAt: number | null;
  failure?: {
    index: number;
    code: HistoryFailureCode;
    message: string;
  };
};

export type CoreSession = {
  puzzle: Puzzle;
  state: BoardState;
  history: HistoryAction[];
  status: "playing" | "solved";
  firstSolvedAt: number | null;
};

export type SessionMoveResult =
  | { accepted: true; session: CoreSession; action: HistoryAction; light: LightResult }
  | { accepted: false; session: CoreSession; reason: HistoryFailureCode | "solved" | "invalid-time" };

export type ValidationIssue = {
  path: string;
  message: string;
};
