import { RING_COUNT, SLOT_COUNT } from "./config.ts";
import type {
  Action,
  BoardState,
  BeamTrace,
  LightResult,
  MoveType,
  Puzzle,
} from "./types.ts";

export function modSlot(n: number): number {
  return ((n % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
}

export function worldSlot(localSlot: number, rotation: number): number {
  return modSlot(localSlot + rotation);
}

export function oppositeSlot(slot: number): number {
  return modSlot(slot + SLOT_COUNT / 2);
}

export function cloneState(state: BoardState): BoardState {
  return {
    rotations: [...state.rotations] as BoardState["rotations"],
    emissionEnabled: [...state.emissionEnabled] as BoardState["emissionEnabled"],
  };
}

export function statesEqual(a: BoardState, b: BoardState): boolean {
  return (
    a.rotations[0] === b.rotations[0] &&
    a.rotations[1] === b.rotations[1] &&
    a.rotations[2] === b.rotations[2] &&
    a.emissionEnabled[0] === b.emissionEnabled[0] &&
    a.emissionEnabled[1] === b.emissionEnabled[1] &&
    a.emissionEnabled[2] === b.emissionEnabled[2]
  );
}

export function encodeState(state: BoardState): number {
  const rot =
    (state.rotations[0] * SLOT_COUNT + state.rotations[1]) * SLOT_COUNT +
    state.rotations[2];
  const emit =
    (state.emissionEnabled[0] ? 1 : 0) |
    (state.emissionEnabled[1] ? 2 : 0) |
    (state.emissionEnabled[2] ? 4 : 0);
  return rot * 8 + emit;
}

export function decodeState(code: number): BoardState {
  const emit = code % 8;
  let rot = Math.floor(code / 8);
  const r2 = rot % SLOT_COUNT;
  rot = Math.floor(rot / SLOT_COUNT);
  const r1 = rot % SLOT_COUNT;
  const r0 = Math.floor(rot / SLOT_COUNT);
  return {
    rotations: [r0, r1, r2],
    emissionEnabled: [(emit & 1) !== 0, (emit & 2) !== 0, (emit & 4) !== 0],
  };
}

export const STATE_SPACE = SLOT_COUNT ** RING_COUNT * 2 ** RING_COUNT;

type Cell = 0 | 1 | 2;
const EMPTY: Cell = 0;
const EMITTER: Cell = 1;
const BLOCKER: Cell = 2;

function occupancy(puzzle: Puzzle, rotations: BoardState["rotations"]): Cell[][] {
  const occ: Cell[][] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  for (let r = 0; r < RING_COUNT; r += 1) {
    for (const part of puzzle.rings[r].parts) {
      const slot = worldSlot(part.slot, rotations[r]);
      occ[r][slot] = part.kind === "emitter" ? EMITTER : BLOCKER;
    }
  }
  return occ;
}

function targetMaskOf(targets: number[]): number {
  let mask = 0;
  for (const slot of targets) mask |= 1 << slot;
  return mask;
}

export function evaluate(puzzle: Puzzle, state: BoardState): LightResult {
  const occ = occupancy(puzzle, state.rotations);
  const beams: BeamTrace[] = [];
  let litMask = 0;

  for (let r = 0; r < RING_COUNT; r += 1) {
    if (!state.emissionEnabled[r]) continue;
    for (const part of puzzle.rings[r].parts) {
      if (part.kind !== "emitter") continue;
      const sourceSlot = worldSlot(part.slot, state.rotations[r]);
      const opp = oppositeSlot(sourceSlot);
      const beam = traceBeam(occ, r, sourceSlot, opp);
      beams.push(beam);
      if (beam.reachedRim) litMask |= 1 << opp;
    }
  }

  const targetMask = targetMaskOf(puzzle.targets);
  const solved = (litMask & targetMask) === targetMask;
  const litSlots: number[] = [];
  for (let s = 0; s < SLOT_COUNT; s += 1) {
    if (litMask & (1 << s)) litSlots.push(s);
  }
  let litRequired = 0;
  for (const slot of puzzle.targets) {
    if (litMask & (1 << slot)) litRequired += 1;
  }

  return {
    litMask,
    litSlots,
    beams,
    solved,
    litRequired,
    requiredCount: puzzle.targets.length,
  };
}

function traceBeam(
  occ: Cell[][],
  srcRing: number,
  sourceSlot: number,
  opp: number,
): BeamTrace {
  for (let r = srcRing - 1; r >= 0; r -= 1) {
    if (occ[r][sourceSlot] !== EMPTY) {
      return {
        sourceRing: srcRing,
        sourceSlot,
        oppositeSlot: opp,
        reachedRim: false,
        blockedRing: r,
        blockedSlot: sourceSlot,
        phase: "in",
      };
    }
  }
  for (let r = 0; r < RING_COUNT; r += 1) {
    if (occ[r][opp] === EMPTY) continue;
    const isSource = r === srcRing && opp === sourceSlot;
    if (isSource) continue;
    return {
      sourceRing: srcRing,
      sourceSlot,
      oppositeSlot: opp,
      reachedRim: false,
      blockedRing: r,
      blockedSlot: opp,
      phase: "out",
    };
  }
  return {
    sourceRing: srcRing,
    sourceSlot,
    oppositeSlot: opp,
    reachedRim: true,
    blockedRing: null,
    blockedSlot: null,
    phase: "clear",
  };
}

export function applyMove(
  state: BoardState,
  type: MoveType,
  ring: number,
): BoardState {
  const next = cloneState(state);
  if (ring < 0 || ring >= RING_COUNT) return next;
  if (type === "l") next.rotations[ring] = modSlot(next.rotations[ring] - 1);
  else if (type === "r") next.rotations[ring] = modSlot(next.rotations[ring] + 1);
  else next.emissionEnabled[ring] = !next.emissionEnabled[ring];
  return next;
}

export function replay(
  puzzle: Puzzle,
  actions: Pick<Action, "type" | "ring">[],
): { state: BoardState; solved: boolean; illegal: boolean } {
  let state = cloneState(puzzle.initialState);
  for (const action of actions) {
    if (action.ring < 0 || action.ring >= RING_COUNT) {
      return { state, solved: false, illegal: true };
    }
    if (action.type !== "l" && action.type !== "r" && action.type !== "t") {
      return { state, solved: false, illegal: true };
    }
    state = applyMove(state, action.type, action.ring);
  }
  return { state, solved: evaluate(puzzle, state).solved, illegal: false };
}

export function isSolvedAtStart(puzzle: Puzzle): boolean {
  return evaluate(puzzle, puzzle.initialState).solved;
}

export function partWorldSlots(
  puzzle: Puzzle,
  state: BoardState,
): { ring: number; kind: "emitter" | "blocker"; slot: number; emitting: boolean }[] {
  const out: {
    ring: number;
    kind: "emitter" | "blocker";
    slot: number;
    emitting: boolean;
  }[] = [];
  for (let r = 0; r < RING_COUNT; r += 1) {
    for (const part of puzzle.rings[r].parts) {
      out.push({
        ring: r,
        kind: part.kind,
        slot: worldSlot(part.slot, state.rotations[r]),
        emitting: part.kind === "emitter" && state.emissionEnabled[r],
      });
    }
  }
  return out;
}
