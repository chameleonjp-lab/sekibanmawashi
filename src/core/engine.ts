import { CoreValidationError, assertValidBoardState, assertValidPuzzle, validateHistory } from "./validation.ts";
import {
  RING_COUNT,
  RULESET_VERSION,
  SLOT_COUNT,
  STATE_SPACE,
  type BeamTrace,
  type BoardState,
  type CoreSession,
  type HistoryAction,
  type HistoryFailureCode,
  type LightResult,
  type MoveType,
  type Puzzle,
  type ReplayResult,
  type SessionMoveResult,
} from "./types.ts";

type Cell = 0 | 1 | 2;
const EMPTY: Cell = 0;
const OCCUPIED: Cell = 1;

export function modSlot(value: number): number {
  if (!Number.isInteger(value)) throw new CoreValidationError("slot arithmetic requires an integer");
  return ((value % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
}

export function worldSlot(localSlot: number, rotation: number): number {
  return modSlot(localSlot + rotation);
}

export function oppositeSlot(slot: number): number {
  return modSlot(slot + SLOT_COUNT / 2);
}

export function cloneState(state: BoardState): BoardState {
  assertValidBoardState(state);
  return { rotations: [...state.rotations] as BoardState["rotations"] };
}

export function statesEqual(left: BoardState, right: BoardState): boolean {
  assertValidBoardState(left);
  assertValidBoardState(right);
  return left.rotations.every((rotation, index) => rotation === right.rotations[index]);
}

export function encodeState(state: BoardState): number {
  assertValidBoardState(state);
  return (state.rotations[0] * SLOT_COUNT + state.rotations[1]) * SLOT_COUNT + state.rotations[2];
}

export function decodeState(code: number): BoardState {
  if (!Number.isInteger(code) || code < 0 || code >= STATE_SPACE) {
    throw new CoreValidationError("state code must be an integer from 0 through 1727");
  }
  let rest = code;
  const outer = rest % SLOT_COUNT;
  rest = Math.floor(rest / SLOT_COUNT);
  const middle = rest % SLOT_COUNT;
  rest = Math.floor(rest / SLOT_COUNT);
  const inner = rest;
  return { rotations: [inner, middle, outer] };
}

function occupancy(puzzle: Puzzle, rotations: BoardState["rotations"]): Cell[][] {
  const cells: Cell[][] = Array.from({ length: RING_COUNT }, () =>
    Array.from({ length: SLOT_COUNT }, () => EMPTY),
  );
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    for (const part of puzzle.rings[ring].parts) {
      const slot = worldSlot(part.slot, rotations[ring]);
      cells[ring][slot] = OCCUPIED;
    }
  }
  return cells;
}

function targetMaskOf(targets: readonly number[]): number {
  return targets.reduce((mask, slot) => mask | (1 << slot), 0);
}

export function traceBeam(
  cells: Cell[][],
  sourceRing: number,
  sourceSlot: number,
  destinationSlot: number,
): BeamTrace {
  const inwardPath: number[] = [];
  const outwardPath: number[] = [];
  for (let ring = sourceRing - 1; ring >= 0; ring -= 1) {
    inwardPath.push(ring);
    if (cells[ring][sourceSlot] !== EMPTY) {
      return {
        sourceRing,
        sourceSlot,
        oppositeSlot: destinationSlot,
        reachedRim: false,
        blockedRing: ring,
        blockedSlot: sourceSlot,
        phase: "in",
        inwardPath,
        outwardPath,
      };
    }
  }
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    outwardPath.push(ring);
    if (cells[ring][destinationSlot] !== EMPTY) {
      return {
        sourceRing,
        sourceSlot,
        oppositeSlot: destinationSlot,
        reachedRim: false,
        blockedRing: ring,
        blockedSlot: destinationSlot,
        phase: "out",
        inwardPath,
        outwardPath,
      };
    }
  }
  return {
    sourceRing,
    sourceSlot,
    oppositeSlot: destinationSlot,
    reachedRim: true,
    blockedRing: null,
    blockedSlot: null,
    phase: "clear",
    inwardPath,
    outwardPath,
  };
}

export function evaluate(inputPuzzle: Puzzle, inputState: BoardState): LightResult {
  const puzzle = assertValidPuzzle(inputPuzzle);
  const state = assertValidBoardState(inputState);
  const cells = occupancy(puzzle, state.rotations);
  const beams: BeamTrace[] = [];
  let litMask = 0;

  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    for (const part of puzzle.rings[ring].parts) {
      if (part.kind !== "emitter") continue;
      const sourceSlot = worldSlot(part.slot, state.rotations[ring]);
      const destinationSlot = oppositeSlot(sourceSlot);
      const beam = traceBeam(cells, ring, sourceSlot, destinationSlot);
      beams.push(beam);
      if (beam.reachedRim) litMask |= 1 << destinationSlot;
    }
  }

  const litSlots: number[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    if ((litMask & (1 << slot)) !== 0) litSlots.push(slot);
  }
  const targetMask = targetMaskOf(puzzle.targets);
  const litRequired = puzzle.targets.filter((slot) => (litMask & (1 << slot)) !== 0).length;
  return {
    litMask,
    litSlots,
    beams,
    solved: (litMask & targetMask) === targetMask,
    litRequired,
    requiredCount: puzzle.targets.length,
  };
}

export function applyRotation(state: BoardState, type: MoveType, ring: number): BoardState {
  const current = assertValidBoardState(state);
  if (type !== "l" && type !== "r") throw new CoreValidationError("move type must be l or r");
  if (!Number.isInteger(ring) || ring < 0 || ring >= RING_COUNT) {
    throw new CoreValidationError("ring must be an integer from 0 through 2");
  }
  const rotations = [...current.rotations] as BoardState["rotations"];
  rotations[ring] = modSlot(rotations[ring] + (type === "r" ? 1 : -1));
  return { rotations };
}

export const applyMove = applyRotation;

export function selectRing(currentRing: number, nextRing: number): number {
  if (!Number.isInteger(currentRing) || currentRing < 0 || currentRing >= RING_COUNT) {
    throw new CoreValidationError("current ring must be an integer from 0 through 2");
  }
  if (!Number.isInteger(nextRing) || nextRing < 0 || nextRing >= RING_COUNT) {
    throw new CoreValidationError("next ring must be an integer from 0 through 2");
  }
  return nextRing;
}

function replayFailure(state: BoardState, solved: boolean, acceptedActions: number, firstSolvedAt: number | null, index: number, code: HistoryFailureCode, message: string): ReplayResult {
  return {
    state,
    solved,
    illegal: true,
    acceptedActions,
    firstSolvedAt,
    failure: { index, code, message },
  };
}

export function replay(inputPuzzle: Puzzle, inputActions: unknown): ReplayResult {
  const puzzle = assertValidPuzzle(inputPuzzle);
  const state = cloneState(puzzle.initialState);
  const initialSolved = evaluate(puzzle, state).solved;
  const checked = validateHistory(inputActions, puzzle);
  if (!checked.ok) {
    return replayFailure(state, initialSolved, 0, initialSolved ? 0 : null, checked.index, checked.code, checked.message);
  }
  let current = state;
  let solved = initialSolved;
  let firstSolvedAt: number | null = solved ? 0 : null;
  for (let index = 0; index < checked.actions.length; index += 1) {
    if (solved) {
      return replayFailure(current, true, index, firstSolvedAt, index, "after-success", "actions after the first success are not accepted");
    }
    const action = checked.actions[index];
    current = applyRotation(current, action.type, action.ring);
    solved = evaluate(puzzle, current).solved;
    if (solved && firstSolvedAt === null) firstSolvedAt = action.n;
  }
  return { state: current, solved, illegal: false, acceptedActions: checked.actions.length, firstSolvedAt };
}

export function replayMoves(
  inputPuzzle: Puzzle,
  moves: readonly Pick<HistoryAction, "type" | "ring">[],
): { state: BoardState; solved: boolean; illegal: boolean; acceptedMoves: number } {
  const puzzle = assertValidPuzzle(inputPuzzle);
  let state = cloneState(puzzle.initialState);
  let solved = evaluate(puzzle, state).solved;
  for (let index = 0; index < moves.length; index += 1) {
    if (solved) return { state, solved: true, illegal: true, acceptedMoves: index };
    const move = moves[index];
    if (move.type !== "l" && move.type !== "r") return { state, solved: false, illegal: true, acceptedMoves: index };
    if (!Number.isInteger(move.ring) || move.ring < 0 || move.ring >= RING_COUNT) {
      return { state, solved: false, illegal: true, acceptedMoves: index };
    }
    state = applyRotation(state, move.type, move.ring);
    solved = evaluate(puzzle, state).solved;
  }
  return { state, solved, illegal: false, acceptedMoves: moves.length };
}

export function isSolvedAtStart(inputPuzzle: Puzzle): boolean {
  const puzzle = assertValidPuzzle(inputPuzzle);
  return evaluate(puzzle, puzzle.initialState).solved;
}

export function createSession(inputPuzzle: Puzzle): CoreSession {
  const puzzle = assertValidPuzzle(inputPuzzle);
  const state = cloneState(puzzle.initialState);
  const solved = evaluate(puzzle, state).solved;
  return {
    puzzle,
    state,
    history: [],
    status: solved ? "solved" : "playing",
    firstSolvedAt: solved ? 0 : null,
  };
}

export function acceptRotation(session: CoreSession, type: MoveType, ring: number, timeMs: number): SessionMoveResult {
  if (session.status === "solved") return { accepted: false, session, reason: "solved" };
  if (!Number.isInteger(timeMs) || !Number.isSafeInteger(timeMs) || timeMs < 0 || (session.history.at(-1)?.t ?? 0) > timeMs) {
    return { accepted: false, session, reason: "invalid-time" };
  }
  if (type !== "l" && type !== "r") return { accepted: false, session, reason: "bad-type" };
  if (!Number.isInteger(ring) || ring < 0 || ring >= RING_COUNT) {
    return { accepted: false, session, reason: "bad-ring" };
  }
  const action: HistoryAction = {
    puzzleId: session.puzzle.id,
    rulesetVersion: RULESET_VERSION,
    n: session.history.length + 1,
    t: timeMs,
    type,
    ring,
  };
  const state = applyRotation(session.state, type, ring);
  const light = evaluate(session.puzzle, state);
  const solved = light.solved;
  const next: CoreSession = {
    puzzle: session.puzzle,
    state,
    history: [...session.history, action],
    status: solved ? "solved" : "playing",
    firstSolvedAt: solved ? action.n : null,
  };
  return { accepted: true, session: next, action, light };
}

export function partWorldSlots(
  inputPuzzle: Puzzle,
  inputState: BoardState,
): { ring: number; kind: "emitter" | "blocker"; slot: number; emitting: boolean }[] {
  const puzzle = assertValidPuzzle(inputPuzzle);
  const state = assertValidBoardState(inputState);
  const output: { ring: number; kind: "emitter" | "blocker"; slot: number; emitting: boolean }[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    for (const part of puzzle.rings[ring].parts) {
      output.push({
        ring,
        kind: part.kind,
        slot: worldSlot(part.slot, state.rotations[ring]),
        emitting: part.kind === "emitter",
      });
    }
  }
  return output;
}
