import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  ASSIGNMENT_RETENTION_MS,
  boundedHistory,
  createAssignment,
  createRunState,
  finalizeRun,
  isOverLimits,
  assignmentIsFresh,
  markAssignmentSeen,
  preparePoolArtifacts,
  validatePlayerName,
  validateRunAssignment,
} from "./run.ts";
import { acceptRotation, createSession } from "./core/engine.ts";
import { analyzePuzzle } from "./puzzles/solver.ts";
import type { HistoryAction } from "./core/types.ts";

// Keep fixture loading compatible with the repository's Node
// --experimental-strip-types test runner. JSON module imports require an
// import attribute on recent Node releases, while readFileSync also works in
// the same runner and does not change the production artifact boundary.
const puzzleInput = JSON.parse(readFileSync(resolve(process.cwd(), "content/puzzles-v2.json"), "utf8")) as unknown;
const poolInput = JSON.parse(readFileSync(resolve(process.cwd(), "content/pool-v2.json"), "utf8")) as unknown;
const ticketInput = JSON.parse(readFileSync(resolve(process.cwd(), "content/tickets-v2.json"), "utf8")) as unknown;

test("R4 validates display names by Unicode length and control characters", () => {
  assert.equal(validatePlayerName("").ok, false);
  assert.equal(validatePlayerName("   ").ok, false);
  assert.equal(validatePlayerName("\u2007\u202f").ok, false);
  assert.equal(validatePlayerName("abcdefghijklmnopq").ok, false);
  assert.equal(validatePlayerName("石板 回し").ok, true);
  assert.equal(validatePlayerName("bad\u0007name").ok, false);
  assert.equal(validatePlayerName("\n名前").ok, false);
  assert.equal(validatePlayerName("名前\t").ok, false);
  assert.equal(validatePlayerName("na\u0085me").ok, false);
  const trimmed = validatePlayerName("  Luna  ");
  assert.deepEqual(trimmed, { ok: true, name: "Luna" });
});

test("R4 validates the bundled pool and ticket artifacts at the assignment boundary", () => {
  const loaded = preparePoolArtifacts(puzzleInput, poolInput, ticketInput);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const assignment = createAssignment(loaded.prepared, {
    mode: "challenge",
    ticketIndex: 0,
    runId: "fixture-run-01",
    nowWallMs: 1_700_000_000_000,
    nowMonotonicMs: 42,
  });
  assert.deepEqual(assignment.puzzleIds, loaded.prepared.tickets.tickets[0]);
  assert.equal(assignment.expiresAtWallMs - assignment.assignedAtWallMs, ASSIGNMENT_RETENTION_MS);
  assert.equal(validateRunAssignment(assignment, loaded.prepared).ok, true);
  assert.equal(validateRunAssignment({ ...assignment, puzzleIds: [...assignment.puzzleIds].reverse() }, loaded.prepared).ok, false);
});

test("R4 assignment retention never extends across a backwards wall clock", () => {
  const loaded = preparePoolArtifacts(puzzleInput, poolInput, ticketInput);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const assignment = createAssignment(loaded.prepared, {
    mode: "challenge",
    ticketIndex: 1,
    runId: "fixture-run-02",
    nowWallMs: 1_700_000_000_000,
    nowMonotonicMs: 1,
  });
  assert.equal(assignmentIsFresh(assignment, assignment.assignedAtWallMs + 1_000), true);
  const seen = markAssignmentSeen(assignment, assignment.assignedAtWallMs + 1_000);
  assert.equal(seen.lastSeenWallMs, assignment.assignedAtWallMs + 1_000);
  assert.equal(assignmentIsFresh(seen, assignment.assignedAtWallMs), false);
  assert.equal(assignmentIsFresh(seen, assignment.expiresAtWallMs + 1), false);
});

test("R4 bounded history and finalization retain reference results after limits", () => {
  const history = Array.from({ length: 301 }, (_, index): HistoryAction => ({
    puzzleId: "fixture-v2-puzzle",
    rulesetVersion: "stone-rings-v2",
    n: index + 1,
    t: index,
    type: "r",
    ring: index % 3,
  }));
  assert.equal(boundedHistory(history).length, 300);
  assert.equal(boundedHistory(history)[0]?.n, 2);
  assert.equal(isOverLimits(1, 301, 301), true);

  const loaded = preparePoolArtifacts(puzzleInput, poolInput, ticketInput);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const assignment = createAssignment(loaded.prepared, {
    mode: "practice",
    ticketIndex: 2,
    runId: "fixture-run-03",
    nowWallMs: 1_700_000_000_000,
    nowMonotonicMs: 1,
  });
  const state = createRunState(assignment);
  state.records = assignment.puzzleIds.map((puzzleId, index) => ({
    puzzleId,
    difficulty: loaded.prepared.puzzlesById.get(puzzleId)?.difficulty ?? "easy",
    timeMs: index + 1,
    moves: index + 301,
    history: [],
    timerReference: "monotonic",
    abnormalClock: false,
    overLimits: index === 0,
  }));
  state.records[0]!.history = history;
  const result = finalizeRun(state);
  assert.equal(result.finalized, true);
  assert.equal(result.totalTimeMs, 15);
  assert.equal(result.totalMoves, 1_515);
  assert.equal(result.overLimits, true);
  assert.equal(result.records[0]?.history.length, 300);
});

test("R4 accepts more than 300 moves, keeps global action numbers, and can still solve", () => {
  const loaded = preparePoolArtifacts(puzzleInput, poolInput, ticketInput);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const puzzle = loaded.prepared.puzzles[0];
  assert.ok(puzzle);
  const analysis = analyzePuzzle(puzzle);
  assert.ok(analysis.representativeSolution.length > 0);
  let session = createSession(puzzle);
  // Every pair returns to the initial unsolved state. The bounded history is
  // the same policy used by the UI, while action numbers remain global.
  for (let index = 0; index < 300; index += 1) {
    const moved = acceptRotation(session, index % 2 === 0 ? "r" : "l", 0, index + 1, index + 1);
    assert.equal(moved.accepted, true);
    if (!moved.accepted) return;
    session = { ...moved.session, history: boundedHistory(moved.session.history) };
  }
  assert.equal(session.status, "playing");
  assert.equal(session.history.length, 300);
  assert.equal(session.history[0]?.n, 1);
  for (let index = 0; index < analysis.representativeSolution.length; index += 1) {
    const move = analysis.representativeSolution[index]!;
    const moved = acceptRotation(session, move.type, move.ring, 301 + index, 301 + index);
    assert.equal(moved.accepted, true);
    if (!moved.accepted) return;
    session = { ...moved.session, history: boundedHistory(moved.session.history) };
  }
  assert.equal(session.status, "solved");
  assert.ok(session.history.length <= 300);
  assert.equal(session.history.at(-1)?.n, 300 + analysis.representativeSolution.length);
});
