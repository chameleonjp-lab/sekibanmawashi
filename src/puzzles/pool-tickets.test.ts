import assert from "node:assert/strict";
import { test } from "node:test";
import { computePuzzleChecksum, type Puzzle } from "../core/index.ts";
import { createPoolManifest } from "./pool.ts";
import {
  computePoolChecksum,
  computePuzzleCollectionChecksum,
  makeCalibration,
  normalizedPuzzleKey,
  validatePoolArtifact,
  validateTicketsArtifact,
} from "./validation.ts";
import { canonicalShapeKey } from "./normalization.ts";
import { createTicketsManifest, ticketPairDiversity } from "./tickets.ts";
import { createSeededSource } from "./random.ts";

function puzzle(index: number, difficulty: Puzzle["difficulty"]): Puzzle {
  const inner = index % 12;
  const middle = Math.floor(index / 12) % 12;
  const outer = Math.floor(index / 144) % 12;
  const innerBlocker = (inner + 1 + Math.floor(index / 12) % 8) % 12;
  const middleBlocker = (middle + 2 + Math.floor(index / 6) % 8) % 12;
  const outerBlocker = (outer + 3 + Math.floor(index / 4) % 7) % 12;
  const draft: Omit<Puzzle, "contentChecksum"> = {
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    generatorVersion: "generator-v2",
    id: `${difficulty}-${String(index + 1).padStart(2, "0")}`,
    difficulty,
    slotCount: 12,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: inner }, { kind: "blocker", slot: innerBlocker }] },
      { id: "middle", parts: [{ kind: "emitter", slot: middle }, { kind: "blocker", slot: middleBlocker }] },
      { id: "outer", parts: [{ kind: "emitter", slot: outer }, { kind: "blocker", slot: outerBlocker }] },
    ],
    targets: [(inner + 6) % 12, (inner + 7) % 12],
    initialState: { rotations: [index % 12, Math.floor(index / 3) % 12, Math.floor(index / 7) % 12] },
  };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

function fixture(): Puzzle[] {
  const puzzles: Puzzle[] = [];
  const keys = new Set<string>();
  const shapeKeys = new Set<string>();
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    let attempt = 0;
    while (puzzles.filter((candidate) => candidate.difficulty === difficulty).length < 30) {
      const candidate = puzzle(attempt, difficulty);
      candidate.id = `${difficulty}-${String(attempt + 1).padStart(2, "0")}`;
      candidate.contentChecksum = computePuzzleChecksum(candidate);
      attempt += 1;
      const key = normalizedPuzzleKey(candidate);
      const shapeKey = canonicalShapeKey(candidate);
      if (keys.has(key) || shapeKeys.has(shapeKey)) continue;
      keys.add(key);
      shapeKeys.add(shapeKey);
      puzzles.push(candidate);
    }
  }
  return puzzles;
}

test("pool and tickets preserve versions, checksums, counts and normalized uniqueness", () => {
  const puzzles = fixture();
  const pool = createPoolManifest(puzzles);
  assert.equal(validatePoolArtifact(pool, puzzles).ok, true);
  const scores = new Map(puzzles.map((candidate) => [candidate.id, 1000]));
  const calibration = makeCalibration(puzzles, scores, computePuzzleCollectionChecksum(puzzles));
  const built = createTicketsManifest(puzzles, pool, { calibration, scoreById: scores, seed: 0x1234_5678 });
  assert.equal(validateTicketsArtifact(built.manifest, { puzzles, pool, calibration }).ok, true);
  assert.equal(new Set(built.manifest.tickets.map((ticket) => JSON.stringify({
    easy: [...ticket.slice(0, 2)].sort(),
    normal: [...ticket.slice(2, 4)].sort(),
    hard: ticket[4],
  }))).size, 900);
  const diversity = ticketPairDiversity(built.manifest.tickets);
  assert.ok(diversity.easyPairKinds > 300);
  assert.ok(diversity.normalPairKinds > 300);
  assert.equal(diversity.hardKinds, 30);
});

test("pool and ticket validators reject old versions, IDs and duplicate normalized tickets", () => {
  const puzzles = fixture();
  const pool = createPoolManifest(puzzles);
  const oldPool = { ...pool, poolVersion: "pool-v1" };
  assert.equal(validatePoolArtifact(oldPool, puzzles).ok, false);
  const scores = new Map(puzzles.map((candidate) => [candidate.id, 1000]));
  const calibration = makeCalibration(puzzles, scores, computePuzzleCollectionChecksum(puzzles));
  const built = createTicketsManifest(puzzles, pool, { calibration, scoreById: scores });
  const altered = structuredClone(built.manifest);
  altered.tickets[1] = [...altered.tickets[0]] as typeof altered.tickets[number];
  assert.equal(validateTicketsArtifact(altered, { puzzles, pool, calibration }).ok, false);
  const changedIds = structuredClone(pool);
  changedIds.puzzleIdsByDifficulty.easy[0] = "easy-renamed";
  changedIds.poolChecksum = "";
  assert.equal(validatePoolArtifact(changedIds, puzzles).ok, false);
});

test("artifact validators reject malformed ticket shape, versions and all checksums", () => {
  const puzzles = fixture();
  const pool = createPoolManifest(puzzles);
  const scores = new Map(puzzles.map((candidate) => [candidate.id, 1000]));
  const calibration = makeCalibration(puzzles, scores, computePuzzleCollectionChecksum(puzzles));
  const built = createTicketsManifest(puzzles, pool, { calibration, scoreById: scores, seed: 0x9876_5432 });
  const shortTickets = { ...built.manifest, tickets: built.manifest.tickets.slice(0, 899) };
  const longTickets = { ...built.manifest, tickets: [...built.manifest.tickets, built.manifest.tickets[0]] };
  assert.equal(validateTicketsArtifact(shortTickets, { puzzles, pool, calibration }).ok, false);
  assert.equal(validateTicketsArtifact(longTickets, { puzzles, pool, calibration }).ok, false);

  const repeatedId = structuredClone(built.manifest);
  repeatedId.tickets[0] = [repeatedId.tickets[0][0], repeatedId.tickets[0][0], repeatedId.tickets[0][2], repeatedId.tickets[0][3], repeatedId.tickets[0][4]];
  assert.equal(validateTicketsArtifact(repeatedId, { puzzles, pool, calibration }).ok, false);
  const wrongOrder = structuredClone(built.manifest);
  wrongOrder.tickets[0] = [wrongOrder.tickets[0][2], wrongOrder.tickets[0][1], wrongOrder.tickets[0][0], wrongOrder.tickets[0][3], wrongOrder.tickets[0][4]];
  assert.equal(validateTicketsArtifact(wrongOrder, { puzzles, pool, calibration }).ok, false);
  const unknownId = structuredClone(built.manifest);
  unknownId.tickets[0] = ["unknown-puzzle", unknownId.tickets[0][1], unknownId.tickets[0][2], unknownId.tickets[0][3], unknownId.tickets[0][4]];
  assert.equal(validateTicketsArtifact(unknownId, { puzzles, pool, calibration }).ok, false);

  assert.equal(validateTicketsArtifact({ ...built.manifest, poolVersion: "pool-v1" }, { puzzles, pool, calibration }).ok, false);
  assert.equal(validateTicketsArtifact({ ...built.manifest, poolChecksum: "0000000000000000" }, { puzzles, pool, calibration }).ok, false);
  assert.equal(validateTicketsArtifact({ ...built.manifest, calibrationChecksum: "0000000000000000" }, { puzzles, pool, calibration }).ok, false);
  assert.equal(validateTicketsArtifact({ ...built.manifest, ticketChecksum: "0000000000000000" }, { puzzles, pool, calibration }).ok, false);
});

test("pool validation rejects nested unknown fields even with recomputed checksums", () => {
  const puzzles = fixture();
  const pool = createPoolManifest(puzzles);
  const nestedIds = structuredClone(pool);
  (nestedIds.puzzleIdsByDifficulty as unknown as Record<string, unknown>).extra = [];
  nestedIds.poolChecksum = computePoolChecksum(nestedIds);
  assert.equal(validatePoolArtifact(nestedIds, puzzles).ok, false);
  const nestedDraw = structuredClone(pool);
  (nestedDraw.drawProfile as unknown as Record<string, unknown>).extra = "unexpected";
  nestedDraw.poolChecksum = computePoolChecksum(nestedDraw);
  assert.equal(validatePoolArtifact(nestedDraw, puzzles).ok, false);
});

test("seed source can be passed to pair generation without clock entropy", () => {
  const source = createSeededSource(0x42);
  assert.equal(typeof source(), "number");
});
