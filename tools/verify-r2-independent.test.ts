import assert from "node:assert/strict";
import { test } from "node:test";
import { computePuzzleChecksum } from "../src/core/checksum.ts";
import type { Puzzle } from "../src/core/types.ts";
import { analyzePuzzle } from "../src/puzzles/solver.ts";
import { verifyIndependentLight, verifyIndependentSolutions } from "./verify-r2-independent.ts";

type PuzzleDraft = Omit<Puzzle, "contentChecksum">;

function puzzle(draft: PuzzleDraft): Puzzle {
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

const twoOrdersOneGoal = puzzle({
  schemaVersion: 2,
  rulesetVersion: "stone-rings-v2",
  generatorVersion: "generator-v2",
  id: "independent-two-orders",
  difficulty: "easy",
  slotCount: 12,
  rings: [
    { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
    { id: "middle", parts: [{ kind: "blocker", slot: 5 }, { kind: "blocker", slot: 6 }] },
    { id: "outer", parts: [{ kind: "blocker", slot: 5 }, { kind: "blocker", slot: 6 }] },
  ],
  targets: [6],
  initialState: { rotations: [0, 0, 0] },
});

const unsolvable = puzzle({
  schemaVersion: 2,
  rulesetVersion: "stone-rings-v2",
  generatorVersion: "generator-v2",
  id: "independent-unsolvable",
  difficulty: "easy",
  slotCount: 12,
  rings: [
    { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 6 }] },
    { id: "middle", parts: [] },
    { id: "outer", parts: [] },
  ],
  targets: [6],
  initialState: { rotations: [0, 0, 0] },
});

const halfTurn = puzzle({
  schemaVersion: 2,
  rulesetVersion: "stone-rings-v2",
  generatorVersion: "generator-v2",
  id: "independent-half-turn",
  difficulty: "easy",
  slotCount: 12,
  rings: [
    { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
    { id: "middle", parts: [] },
    { id: "outer", parts: [] },
  ],
  targets: [0],
  initialState: { rotations: [0, 0, 0] },
});

test("P02 separates one shortest goal state from two shortest operation sequences", () => {
  const analysis = analyzePuzzle(twoOrdersOneGoal);
  assert.equal(analysis.shortestMoves, 2);
  assert.equal(analysis.shortestGoalStateCount, 1);
  assert.equal(analysis.shortestPathCount, "2");
  assert.equal(analysis.minOperatedRingCount, 2);
  assert.deepEqual(analysis.requiredRingIndexes, [1, 2]);
  assert.equal(analysis.truncated, false);
});

test("P02 exhausts an unsolvable fixture without reporting truncation", () => {
  const analysis = analyzePuzzle(unsolvable);
  assert.equal(analysis.shortestMoves, null);
  assert.equal(analysis.shortestGoalStateCount, 0);
  assert.equal(analysis.shortestPathCount, "0");
  assert.equal(analysis.visitedStates, 1728);
  assert.equal(analysis.truncated, false);
});

test("P03 compares core and fast solver masks with the independent axis oracle", () => {
  const result = verifyIndependentLight([twoOrdersOneGoal, unsolvable]);
  assert.equal(result.puzzleCount, 2);
  assert.equal(result.statesPerPuzzle, 1728);
  assert.equal(result.comparisonCount, 3456);
  assert.equal(result.fastMaskComparisonCount, 3456);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.coreMismatchCount, 0);
  assert.equal(result.fastMaskMismatchCount, 0);
  assert.deepEqual(result.mismatchExamples, []);
});

test("P02 matches BFS metrics with torus distance and combinatorics", () => {
  const result = verifyIndependentSolutions([twoOrdersOneGoal, unsolvable, halfTurn]);
  assert.equal(result.puzzleCount, 3);
  assert.equal(result.stateComparisonCount, 5184);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.mismatchExamples, []);

  const halfTurnAnalysis = analyzePuzzle(halfTurn);
  assert.equal(halfTurnAnalysis.shortestMoves, 6);
  assert.equal(halfTurnAnalysis.shortestGoalStateCount, 1);
  assert.equal(halfTurnAnalysis.shortestPathCount, "2");
  assert.equal(halfTurnAnalysis.minOperatedRingCount, 1);
  assert.deepEqual(halfTurnAnalysis.requiredRingIndexes, [0]);
});

test("P03 validates the complete input array before comparing states", () => {
  const malformed = { ...twoOrdersOneGoal, schemaVersion: 1 } as unknown as Puzzle;
  assert.throws(
    () => verifyIndependentLight([twoOrdersOneGoal, malformed]),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CoreValidationError" &&
      error.message === "invalid puzzle array",
  );
});
