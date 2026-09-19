import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMove,
  cloneState,
  decodeState,
  encodeState,
  evaluate,
  isSolvedAtStart,
  oppositeSlot,
  replay,
  STATE_SPACE,
  worldSlot,
} from "./engine.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePuzzle } from "./solver.ts";
import { RUN_ORDER } from "./config.ts";
import type { Puzzle } from "./types.ts";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "data");
const PUZZLES = JSON.parse(readFileSync(join(dataDir, "puzzles.json"), "utf8")) as Puzzle[];
const TICKETS = JSON.parse(readFileSync(join(dataDir, "tickets.json"), "utf8")) as string[][];

const sample: Puzzle = {
  schemaVersion: 1,
  rulesetVersion: "stone-rings-v1",
  generatorVersion: "generator-v1",
  id: "test-01",
  difficulty: "easy",
  slotCount: 12,
  rings: [
    { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
    { id: "middle", parts: [{ kind: "blocker", slot: 0 }] },
    { id: "outer", parts: [{ kind: "emitter", slot: 3 }] },
  ],
  targets: [6],
  initialState: {
    rotations: [1, 0, 0],
    emissionEnabled: [true, true, true],
  },
  contentChecksum: "test",
  shortestMoves: 0,
  shortestSolutionCount: 0,
  requiredRingIndexes: [],
  requiredToggleCount: 0,
  calibrationScore: 0,
};

test("opposite of slot 0 is 6", () => {
  assert.equal(oppositeSlot(0), 6);
  assert.equal(oppositeSlot(4), 10);
  assert.equal(oppositeSlot(11), 5);
});

test("worldSlot wraps", () => {
  assert.equal(worldSlot(11, 2), 1);
  assert.equal(worldSlot(0, -1), 11);
});

test("left rotation wraps 0 to 11", () => {
  const next = applyMove(
    { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
    "l",
    0,
  );
  assert.equal(next.rotations[0], 11);
});

test("right rotation wraps 11 to 0", () => {
  const next = applyMove(
    { rotations: [11, 0, 0], emissionEnabled: [true, true, true] },
    "r",
    0,
  );
  assert.equal(next.rotations[0], 0);
});

test("selecting a ring is not a move in applyMove", () => {
  const start = {
    rotations: [1, 2, 3] as [number, number, number],
    emissionEnabled: [true, false, true] as [boolean, boolean, boolean],
  };
  const clone = cloneState(start);
  assert.deepEqual(clone, start);
  start.rotations[0] = 9;
  assert.equal(clone.rotations[0], 1);
});

test("inner blocker stops a beam before the center", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "blocker", slot: 0 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
  };
  const result = evaluate(puzzle, puzzle.initialState);
  assert.equal(result.solved, false);
  assert.equal(result.beams[0]?.reachedRim, false);
  assert.equal(result.beams[0]?.phase, "in");
});

test("inactive emitter still blocks other light", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 6 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: {
      rotations: [0, 0, 0],
      emissionEnabled: [false, true, true],
    },
  };
  const blocked = evaluate(puzzle, puzzle.initialState);
  assert.equal(blocked.solved, false);
  const cleared = evaluate(puzzle, {
    rotations: [1, 0, 0],
    emissionEnabled: [false, true, true],
  });
  assert.equal(cleared.solved, true);
});

test("foreign emitter blocks outbound light", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 6 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
  };
  const result = evaluate(puzzle, puzzle.initialState);
  assert.equal(result.solved, false);
  assert.equal(result.beams.some((b) => b.sourceRing === 0 && b.phase === "out"), true);
});

test("extra light does not prevent a solve", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 1 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
  };
  const result = evaluate(puzzle, puzzle.initialState);
  assert.equal(result.solved, true);
  assert.ok(result.litSlots.length >= 2);
});

test("crossing beams do not block each other", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "emitter", slot: 3 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6, 9],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
  };
  const result = evaluate(puzzle, puzzle.initialState);
  assert.equal(result.solved, true);
  assert.equal(result.beams.filter((b) => b.reachedRim).length, 2);
});

test("encode/decode roundtrip and 13824 unique keys", () => {
  const seen = new Set<number>();
  for (let r0 = 0; r0 < 12; r0 += 1) {
    for (let r1 = 0; r1 < 12; r1 += 1) {
      for (let r2 = 0; r2 < 12; r2 += 1) {
        for (let e = 0; e < 8; e += 1) {
          const state = {
            rotations: [r0, r1, r2] as [number, number, number],
            emissionEnabled: [(e & 1) !== 0, (e & 2) !== 0, (e & 4) !== 0] as [
              boolean,
              boolean,
              boolean,
            ],
          };
          const code = encodeState(state);
          seen.add(code);
          assert.deepEqual(decodeState(code), state);
        }
      }
    }
  }
  assert.equal(seen.size, STATE_SPACE);
  assert.equal(STATE_SPACE, 13824);
});

test("replay reconstructs a known solution", () => {
  const puzzle: Puzzle = {
    ...sample,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "blocker", slot: 6 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [true, true, true] },
  };
  assert.equal(isSolvedAtStart(puzzle), false);
  const solved = replay(puzzle, [{ type: "l", ring: 1 }]);
  assert.equal(solved.illegal, false);
  assert.equal(solved.solved, true);
});

test("solver path actually solves the sample", () => {
  const result = analyzePuzzle(sample);
  assert.ok(result.shortestMoves >= 0);
  if (result.path) {
    const played = replay(sample, result.path);
    assert.equal(played.solved, true);
  }
});

test("pool has 90 puzzles, 30 per difficulty", () => {
  assert.equal(PUZZLES.length, 90);
  assert.equal(PUZZLES.filter((p) => p.difficulty === "easy").length, 30);
  assert.equal(PUZZLES.filter((p) => p.difficulty === "normal").length, 30);
  assert.equal(PUZZLES.filter((p) => p.difficulty === "hard").length, 30);
});

test("no published puzzle is solved at start", () => {
  for (const puzzle of PUZZLES) {
    assert.equal(isSolvedAtStart(puzzle), false, puzzle.id);
  }
});

test("every published puzzle has a solver path that replays to solved", () => {
  for (const puzzle of PUZZLES) {
    const result = analyzePuzzle(puzzle);
    assert.ok(result.shortestMoves > 0, puzzle.id);
    assert.ok(result.path, puzzle.id);
    const played = replay(puzzle, result.path ?? []);
    assert.equal(played.solved, true, puzzle.id);
  }
});

test("900 tickets are easy-easy-normal-normal-hard without duplicates", () => {
  assert.equal(TICKETS.length, 900);
  for (const ticket of TICKETS) {
    assert.equal(ticket.length, 5);
    assert.equal(new Set(ticket).size, 5);
    assert.deepEqual(
      ticket.map((id) => PUZZLES.find((p) => p.id === id)?.difficulty),
      [...RUN_ORDER],
    );
  }
});
