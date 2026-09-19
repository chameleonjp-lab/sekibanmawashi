import type { RING_IDS } from "./config.ts";

export type Difficulty = "easy" | "normal" | "hard";
export type RingId = (typeof RING_IDS)[number];
export type PartKind = "emitter" | "blocker";
export type MoveType = "l" | "r" | "t";

export type RingPart = {
  kind: PartKind;
  slot: number;
};

export type RingDef = {
  id: RingId;
  parts: RingPart[];
};

export type BoardState = {
  rotations: [number, number, number];
  emissionEnabled: [boolean, boolean, boolean];
};

export type Puzzle = {
  schemaVersion: 1;
  rulesetVersion: string;
  generatorVersion: string;
  id: string;
  difficulty: Difficulty;
  slotCount: 12;
  rings: [RingDef, RingDef, RingDef];
  targets: number[];
  initialState: BoardState;
  contentChecksum: string;
  shortestMoves: number;
  shortestSolutionCount: number;
  requiredRingIndexes: number[];
  requiredToggleCount: number;
  calibrationScore: number;
};

export type Action = {
  n: number;
  t: number;
  type: MoveType;
  ring: number;
};

export type BeamTrace = {
  sourceRing: number;
  sourceSlot: number;
  oppositeSlot: number;
  reachedRim: boolean;
  blockedRing: number | null;
  blockedSlot: number | null;
  phase: "in" | "out" | "clear";
};

export type LightResult = {
  litMask: number;
  litSlots: number[];
  beams: BeamTrace[];
  solved: boolean;
  litRequired: number;
  requiredCount: number;
};

export type Screen =
  | "home"
  | "howToPlay"
  | "leaderboard"
  | "countdown"
  | "playing"
  | "stageSolved"
  | "runResult";

export type RunMode = "challenge" | "practice";

export type StageRecord = {
  puzzleId: string;
  puzzleChecksum: string;
  timeMs: number;
  moveCount: number;
  actions: Action[];
};

export type LeaderboardRow = {
  playerTag: string;
  totalTimeMs: number;
  totalMoves: number;
  submittedAt: string;
};
