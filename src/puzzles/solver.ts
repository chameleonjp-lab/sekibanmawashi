import {
  decodeState,
  encodeState,
} from "../core/engine.ts";
import { assertValidPuzzle } from "../core/validation.ts";
import {
  RING_COUNT,
  SLOT_COUNT,
  STATE_SPACE,
  type BoardState,
  type MoveType,
  type Puzzle,
} from "../core/types.ts";

/** A move in the deterministic order used by every breadth first search. */
export type SolverMove = { type: MoveType; ring: number };

/**
 * The inspection-only values associated with one public puzzle.
 *
 * These values deliberately live outside the public puzzle JSON.  In
 * particular, a representative solution is useful to the generator and to
 * tests, but must never be shipped as part of a puzzle shown to players.
 */
export type PuzzleAnalysis = {
  shortestMoves: number | null;
  shortestGoalStateCount: number;
  shortestPathCount: string;
  minOperatedRingCount: number;
  requiredRingIndexes: number[];
  representativeSolution: SolverMove[];
  visitedStates: number;
  truncated: boolean;
  effectiveRingIndexes: number[];
  calibrationScore: number | null;
};

export type AnalyzeOptions = {
  /** Optional guard for callers that want a deliberately truncated search. */
  maxVisitedStates?: number;
};

export const BFS_MOVE_ORDER: readonly SolverMove[] = Object.freeze([
  { type: "l", ring: 0 },
  { type: "r", ring: 0 },
  { type: "l", ring: 1 },
  { type: "r", ring: 1 },
  { type: "l", ring: 2 },
  { type: "r", ring: 2 },
]);

type CompiledPuzzle = {
  targetMask: number;
  emitterSlots: readonly (readonly number[])[];
  occupiedMasks: readonly (readonly number[])[];
};

type FastResult = {
  litMask: number;
  solved: boolean;
};

function bit(slot: number): number {
  return 1 << slot;
}

function worldSlot(localSlot: number, rotation: number): number {
  return (localSlot + rotation) % SLOT_COUNT;
}

function targetMask(targets: readonly number[]): number {
  let mask = 0;
  for (const slot of targets) mask |= bit(slot);
  return mask;
}

function compilePuzzle(puzzle: Puzzle): CompiledPuzzle {
  const occupiedMasks: number[][] = [];
  const emitterSlots: number[][] = [];
  for (const ring of puzzle.rings) {
    const baseMask = ring.parts.reduce((mask, part) => mask | bit(part.slot), 0);
    const emitters = ring.parts.filter((part) => part.kind === "emitter").map((part) => part.slot);
    const masks: number[] = [];
    for (let rotation = 0; rotation < SLOT_COUNT; rotation += 1) {
      let mask = 0;
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        if ((baseMask & bit(slot)) !== 0) mask |= bit(worldSlot(slot, rotation));
      }
      masks.push(mask);
    }
    occupiedMasks.push(masks);
    emitterSlots.push(emitters);
  }
  return {
    targetMask: targetMask(puzzle.targets),
    emitterSlots,
    occupiedMasks,
  };
}

/**
 * Evaluate a state using precompiled bit masks.  This intentionally does not
 * call the public core evaluator: the latter performs a checksum and full
 * format validation on every call, which makes a 1,728-state BFS needlessly
 * expensive.  The algorithm mirrors core/engine.ts exactly.
 */
export function evaluateStateFast(
  compiledOrPuzzle: CompiledPuzzle | Puzzle,
  state: BoardState,
): FastResult {
  const compiled = "targetMask" in compiledOrPuzzle
    ? compiledOrPuzzle
    : compilePuzzle(compiledOrPuzzle);
  const rotations = state.rotations;
  const occupied = [
    compiled.occupiedMasks[0][rotations[0]],
    compiled.occupiedMasks[1][rotations[1]],
    compiled.occupiedMasks[2][rotations[2]],
  ];
  let litMask = 0;
  for (let sourceRing = 0; sourceRing < RING_COUNT; sourceRing += 1) {
    for (const localSource of compiled.emitterSlots[sourceRing]) {
      const sourceSlot = worldSlot(localSource, rotations[sourceRing]);
      const destinationSlot = (sourceSlot + SLOT_COUNT / 2) % SLOT_COUNT;
      let blocked = false;
      for (let ring = sourceRing - 1; ring >= 0; ring -= 1) {
        if ((occupied[ring] & bit(sourceSlot)) !== 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (let ring = 0; ring < RING_COUNT; ring += 1) {
        if ((occupied[ring] & bit(destinationSlot)) !== 0) {
          blocked = true;
          break;
        }
      }
      if (!blocked) litMask |= bit(destinationSlot);
    }
  }
  return { litMask, solved: (litMask & compiled.targetMask) === compiled.targetMask };
}

/** Exported for the independent R2 oracle and for focused solver tests. */
export function enumerateFastLitMasks(puzzle: Puzzle): number[] {
  const checked = assertValidPuzzle(puzzle);
  const compiled = compilePuzzle(checked);
  const masks = new Array<number>(STATE_SPACE);
  for (let code = 0; code < STATE_SPACE; code += 1) {
    masks[code] = evaluateStateFast(compiled, decodeState(code)).litMask;
  }
  return masks;
}

function bitCount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest !== 0) {
    rest &= rest - 1;
    count += 1;
  }
  return count;
}

function makeEffectiveRings(compiled: CompiledPuzzle): number[] {
  const effective: number[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    let changes = false;
    for (let code = 0; code < STATE_SPACE && !changes; code += 1) {
      const state = decodeState(code);
      // Compare a one-step rotation while retaining the other two rotations.
      const before = evaluateStateFast(compiled, state).litMask;
      const shifted: BoardState = {
        rotations: [...state.rotations] as BoardState["rotations"],
      };
      shifted.rotations[ring] = (shifted.rotations[ring] + 1) % SLOT_COUNT;
      changes = before !== evaluateStateFast(compiled, shifted).litMask;
    }
    if (changes) effective.push(ring);
  }
  return effective;
}

function emptyAnalysis(effectiveRingIndexes: number[], truncated: boolean, visitedStates: number): PuzzleAnalysis {
  return {
    shortestMoves: null,
    shortestGoalStateCount: 0,
    shortestPathCount: "0",
    minOperatedRingCount: 0,
    requiredRingIndexes: [],
    representativeSolution: [],
    visitedStates,
    truncated,
    effectiveRingIndexes,
    calibrationScore: null,
  };
}

/**
 * Analyze one puzzle with a six-edge BFS over the 1,728 rotation states.
 *
 * `shortestGoalStateCount` counts distinct goal states at the first solution
 * distance. `shortestPathCount` counts operation sequences, so two orders of
 * independent rotations count as two even when they end at one state.
 */
export function analyzePuzzle(puzzle: Puzzle, options?: AnalyzeOptions): PuzzleAnalysis {
  const checked = assertValidPuzzle(puzzle);
  const compiled = compilePuzzle(checked);
  const effectiveRingIndexes = makeEffectiveRings(compiled);
  const maxVisitedStates = options?.maxVisitedStates;
  if (maxVisitedStates !== undefined &&
      (!Number.isInteger(maxVisitedStates) || maxVisitedStates < 1)) {
    throw new Error("maxVisitedStates must be a positive integer");
  }
  const visitLimit = Math.min(STATE_SPACE, maxVisitedStates ?? STATE_SPACE);
  const startCode = encodeState(checked.initialState);
  const startFast = evaluateStateFast(compiled, checked.initialState);
  if (startFast.solved) {
    return {
      shortestMoves: 0,
      shortestGoalStateCount: 1,
      shortestPathCount: "1",
      minOperatedRingCount: 0,
      requiredRingIndexes: [],
      representativeSolution: [],
      visitedStates: 1,
      truncated: false,
      effectiveRingIndexes,
      calibrationScore: 25 * 3,
    };
  }

  const distances = new Int16Array(STATE_SPACE);
  distances.fill(-1);
  const parent = new Int32Array(STATE_SPACE);
  parent.fill(-1);
  const parentMove = new Int8Array(STATE_SPACE);
  parentMove.fill(-1);
  const pathCounts = new Array<bigint>(STATE_SPACE).fill(0n);
  // Each bit in ringMasks[state] denotes one exact set of rings used by a
  // shortest path to that state. There are only eight possible sets.
  const ringMasks = new Uint16Array(STATE_SPACE);
  const queue = new Int32Array(STATE_SPACE);
  let head = 0;
  let tail = 0;
  queue[tail++] = startCode;
  distances[startCode] = 0;
  pathCounts[startCode] = 1n;
  ringMasks[startCode] = 1; // bit 0: the empty ring set

  let bestDistance = -1;
  let truncated = false;
  let visitedStates = 1;
  const goalCodes: number[] = [];

  while (head < tail) {
    const code = queue[head++];
    const distance = distances[code];
    if (bestDistance !== -1 && distance > bestDistance) break;
    const state = decodeState(code);
    const result = evaluateStateFast(compiled, state);
    if (result.solved) {
      if (bestDistance === -1) bestDistance = distance;
      if (distance === bestDistance) goalCodes.push(code);
      continue;
    }
    if (bestDistance !== -1 && distance >= bestDistance) continue;
    for (let moveIndex = 0; moveIndex < BFS_MOVE_ORDER.length; moveIndex += 1) {
      const move = BFS_MOVE_ORDER[moveIndex];
      const next = { rotations: [...state.rotations] as BoardState["rotations"] };
      next.rotations[move.ring] = (next.rotations[move.ring] + (move.type === "r" ? 1 : -1) + SLOT_COUNT) % SLOT_COUNT;
      const nextCode = encodeState(next);
      const nextDistance = distance + 1;
      if (distances[nextCode] === -1) {
        if (visitedStates >= visitLimit) {
          truncated = true;
          break;
        }
        distances[nextCode] = nextDistance;
        parent[nextCode] = code;
        parentMove[nextCode] = moveIndex;
        pathCounts[nextCode] = pathCounts[code];
        let masks = 0;
        const sourceMasks = ringMasks[code];
        for (let mask = 0; mask < 8; mask += 1) {
          if ((sourceMasks & (1 << mask)) !== 0) masks |= 1 << (mask | (1 << move.ring));
        }
        ringMasks[nextCode] = masks;
        queue[tail++] = nextCode;
        visitedStates += 1;
      } else if (distances[nextCode] === nextDistance) {
        pathCounts[nextCode] += pathCounts[code];
        let masks = ringMasks[nextCode];
        const sourceMasks = ringMasks[code];
        for (let mask = 0; mask < 8; mask += 1) {
          if ((sourceMasks & (1 << mask)) !== 0) masks |= 1 << (mask | (1 << move.ring));
        }
        ringMasks[nextCode] = masks;
      }
    }
    if (truncated) break;
  }

  if (truncated || bestDistance === -1 || goalCodes.length === 0) {
    return emptyAnalysis(effectiveRingIndexes, truncated, visitedStates);
  }

  let shortestPathCount = 0n;
  let minOperatedRingCount: number = RING_COUNT;
  let allRequiredMask: number = (1 << RING_COUNT) - 1;
  let allGoalMasks = 0;
  for (const goalCode of goalCodes) {
    shortestPathCount += pathCounts[goalCode];
    const possibilities = ringMasks[goalCode];
    allGoalMasks |= possibilities;
    for (let mask = 0; mask < 8; mask += 1) {
      if ((possibilities & (1 << mask)) !== 0) {
        minOperatedRingCount = Math.min(minOperatedRingCount, bitCount(mask));
        allRequiredMask &= mask;
      }
    }
  }

  const representativeSolution: SolverMove[] = [];
  let cursor = goalCodes[0];
  while (cursor !== startCode) {
    const moveIndex = parentMove[cursor];
    if (moveIndex < 0) break;
    representativeSolution.push(BFS_MOVE_ORDER[moveIndex]);
    cursor = parent[cursor];
  }
  representativeSolution.reverse();

  const requiredRingIndexes: number[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    if ((allRequiredMask & (1 << ring)) !== 0) requiredRingIndexes.push(ring);
  }
  // A non-empty mask is guaranteed once a goal has been found. Keep the
  // variable explicit so an accidental future change cannot hide this fact.
  void allGoalMasks;
  const calibrationScore =
    bestDistance * 100 +
    minOperatedRingCount * 40 +
    Math.max(0, 4 - goalCodes.length) * 25;
  return {
    shortestMoves: bestDistance,
    shortestGoalStateCount: goalCodes.length,
    shortestPathCount: shortestPathCount.toString(10),
    minOperatedRingCount,
    requiredRingIndexes,
    representativeSolution,
    visitedStates,
    truncated: false,
    effectiveRingIndexes,
    calibrationScore,
  };
}
