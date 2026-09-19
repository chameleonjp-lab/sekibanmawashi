import { RING_COUNT, SLOT_COUNT } from "./config.ts";
import { applyMove, encodeState, evaluate, STATE_SPACE } from "./engine.ts";
import type { BoardState, MoveType, Puzzle } from "./types.ts";

export type SolveResult = {
  shortestMoves: number;
  shortestSolutionCount: number;
  requiredRingIndexes: number[];
  requiredToggleCount: number;
  visitedStateCount: number;
  path: { type: MoveType; ring: number }[] | null;
};

export type SolveOptions = {
  allowToggle?: boolean;
  frozenRings?: number[];
};

function moveList(options?: SolveOptions): { type: MoveType; ring: number }[] {
  const allowToggle = options?.allowToggle !== false;
  const frozen = new Set(options?.frozenRings ?? []);
  const moves: { type: MoveType; ring: number }[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    if (frozen.has(ring)) continue;
    moves.push({ type: "l", ring }, { type: "r", ring });
    if (allowToggle) moves.push({ type: "t", ring });
  }
  return moves;
}

export function solve(
  puzzle: Puzzle,
  start?: BoardState,
  options?: SolveOptions,
): SolveResult {
  const origin = start ?? puzzle.initialState;
  const moves = moveList(options);
  if (evaluate(puzzle, origin).solved) {
    return {
      shortestMoves: 0,
      shortestSolutionCount: 1,
      requiredRingIndexes: [],
      requiredToggleCount: 0,
      visitedStateCount: 1,
      path: [],
    };
  }

  const startCode = encodeState(origin);
  const dist = new Int16Array(STATE_SPACE);
  dist.fill(-1);
  const parent = new Int32Array(STATE_SPACE);
  parent.fill(-1);
  const via = new Uint8Array(STATE_SPACE);
  const queue = new Int32Array(STATE_SPACE);
  let qh = 0;
  let qt = 0;
  queue[qt++] = startCode;
  dist[startCode] = 0;

  let best = -1;
  let goalCount = 0;
  let firstGoal = -1;

  while (qh < qt) {
    const code = queue[qh++];
    const d = dist[code];
    if (best !== -1 && d > best) break;
    const state = decodeFast(code);
    if (evaluate(puzzle, state).solved) {
      if (best === -1) {
        best = d;
        firstGoal = code;
      }
      if (d === best) goalCount += 1;
      continue;
    }
    if (best !== -1 && d === best) continue;
    for (let m = 0; m < moves.length; m += 1) {
      const next = applyMove(state, moves[m].type, moves[m].ring);
      const ncode = encodeState(next);
      if (dist[ncode] !== -1) continue;
      dist[ncode] = d + 1;
      parent[ncode] = code;
      via[ncode] = m;
      queue[qt++] = ncode;
    }
  }

  if (best === -1 || firstGoal === -1) {
    return {
      shortestMoves: -1,
      shortestSolutionCount: 0,
      requiredRingIndexes: [],
      requiredToggleCount: 0,
      visitedStateCount: qt,
      path: null,
    };
  }

  const path: { type: MoveType; ring: number }[] = [];
  const used = new Set<number>();
  let toggles = 0;
  for (let c = firstGoal; c !== startCode; c = parent[c]) {
    const move = moves[via[c]];
    path.push(move);
    used.add(move.ring);
    if (move.type === "t") toggles += 1;
  }
  path.reverse();

  return {
    shortestMoves: best,
    shortestSolutionCount: goalCount,
    requiredRingIndexes: [...used].sort((a, b) => a - b),
    requiredToggleCount: toggles,
    visitedStateCount: qt,
    path,
  };
}

export function analyzePuzzle(puzzle: Puzzle): SolveResult {
  const full = solve(puzzle);
  if (full.shortestMoves < 0) return full;
  const noToggle = solve(puzzle, undefined, { allowToggle: false });
  const toggleRequired =
    noToggle.shortestMoves < 0 || noToggle.shortestMoves > full.shortestMoves;
  const requiredRings: number[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    const frozen = solve(puzzle, undefined, { frozenRings: [ring] });
    if (frozen.shortestMoves < 0 || frozen.shortestMoves > full.shortestMoves) {
      requiredRings.push(ring);
    }
  }
  return {
    ...full,
    requiredRingIndexes: requiredRings,
    requiredToggleCount: toggleRequired ? Math.max(1, full.requiredToggleCount) : 0,
  };
}

function decodeFast(code: number): BoardState {
  const emit = code % 8;
  let rot = (code / 8) | 0;
  const r2 = rot % SLOT_COUNT;
  rot = (rot / SLOT_COUNT) | 0;
  const r1 = rot % SLOT_COUNT;
  const r0 = (rot / SLOT_COUNT) | 0;
  return {
    rotations: [r0, r1, r2],
    emissionEnabled: [(emit & 1) !== 0, (emit & 2) !== 0, (emit & 4) !== 0],
  };
}

export function calibrationScore(result: SolveResult): number {
  if (result.shortestMoves < 0) return 0;
  return (
    result.shortestMoves * 100 +
    result.requiredToggleCount * 80 +
    result.requiredRingIndexes.length * 40 +
    Math.max(0, 4 - result.shortestSolutionCount) * 25
  );
}
