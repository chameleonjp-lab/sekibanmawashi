import assert from "node:assert/strict";
import { test } from "node:test";
import { computePuzzleChecksum } from "../core/checksum.ts";
import { decodeState, evaluate, replayMoves } from "../core/engine.ts";
import type { Puzzle } from "../core/types.ts";
import { analyzePuzzle, enumerateFastLitMasks } from "./solver.ts";

function puzzle(
  id: string,
  rings: Puzzle["rings"],
  targets: number[],
  rotations: [number, number, number] = [0, 0, 0],
): Puzzle {
  const draft = {
    schemaVersion: 2 as const,
    rulesetVersion: "stone-rings-v2" as const,
    generatorVersion: "generator-v2",
    id,
    difficulty: "easy" as const,
    slotCount: 12 as const,
    rings,
    targets,
    initialState: { rotations },
  };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

test("P02 distinguishes one shortest goal state from two shortest operation orders", () => {
  const sample = puzzle(
    "solver-known-v2",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 1 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 4 }] },
      { id: "outer", parts: [] },
    ],
    [6, 9],
  );
  const analysis = analyzePuzzle(sample);
  assert.equal(analysis.shortestMoves, 2);
  assert.equal(analysis.shortestGoalStateCount, 1);
  assert.equal(analysis.shortestPathCount, "2");
  assert.equal(analysis.minOperatedRingCount, 2);
  assert.deepEqual(analysis.requiredRingIndexes, [0, 1]);
  assert.deepEqual(analysis.representativeSolution, [
    { type: "l", ring: 0 },
    { type: "l", ring: 1 },
  ]);
  assert.equal(replayMoves(sample, analysis.representativeSolution).solved, true);
});

test("P02 reports an initially complete puzzle without inventing an operation", () => {
  const complete = puzzle(
    "solver-complete-v2",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    [6],
  );
  const analysis = analyzePuzzle(complete);
  assert.equal(analysis.shortestMoves, 0);
  assert.equal(analysis.shortestGoalStateCount, 1);
  assert.equal(analysis.shortestPathCount, "1");
  assert.equal(analysis.minOperatedRingCount, 0);
  assert.deepEqual(analysis.requiredRingIndexes, []);
  assert.deepEqual(analysis.representativeSolution, []);
  assert.equal(analysis.visitedStates, 1);
  assert.equal(analysis.truncated, false);
});

test("P02 reports an impossible puzzle after all 1,728 states", () => {
  const impossible = puzzle(
    "solver-impossible-v2",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 6 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    [6],
  );
  const analysis = analyzePuzzle(impossible);
  assert.equal(analysis.shortestMoves, null);
  assert.equal(analysis.shortestGoalStateCount, 0);
  assert.equal(analysis.shortestPathCount, "0");
  assert.equal(analysis.minOperatedRingCount, 0);
  assert.deepEqual(analysis.requiredRingIndexes, []);
  assert.equal(analysis.visitedStates, 1728);
  assert.equal(analysis.truncated, false);
});

test("P03 fast masks agree with the core evaluator over all states", () => {
  const sample = puzzle(
    "solver-mask-v2",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 1 }, { kind: "blocker", slot: 8 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 4 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 7 }] },
    ],
    [6, 9],
    [2, 3, 5],
  );
  const masks = enumerateFastLitMasks(sample);
  assert.equal(masks.length, 1728);
  for (let code = 0; code < masks.length; code += 1) {
    assert.equal(masks[code], evaluate(sample, decodeState(code)).litMask, `state ${code}`);
  }
});
