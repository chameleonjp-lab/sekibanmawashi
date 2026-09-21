import assert from "node:assert/strict";
import { test } from "node:test";
import { computePuzzleChecksum } from "../core/checksum.ts";
import type { Puzzle } from "../core/types.ts";
import {
  canonicalInitialWorldKey,
  canonicalShapeKey,
  duplicateRelation,
  normalizeLegacyPuzzle,
} from "./normalization.ts";

function makePuzzle(id: string, rings: Puzzle["rings"], targets: number[], rotations: [number, number, number] = [0, 0, 0], difficulty: Puzzle["difficulty"] = "easy"): Puzzle {
  const draft = {
    schemaVersion: 2 as const,
    rulesetVersion: "stone-rings-v2" as const,
    generatorVersion: "generator-v2",
    id,
    difficulty,
    slotCount: 12 as const,
    rings,
    targets,
    initialState: { rotations },
  };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

test("P04 normalizes each ring's local cyclic origin before duplicate comparison", () => {
  const left = makePuzzle(
    "shape-left",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 3 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 5 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 8 }] },
    ],
    [6, 9],
  );
  const right = makePuzzle(
    "shape-right",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 4 }, { kind: "blocker", slot: 7 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 10 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 2 }] },
    ],
    [6, 9],
  );
  assert.equal(canonicalShapeKey(left), canonicalShapeKey(right));
});

test("P04 identifies a changed initial angle as an initial-angle-only near duplicate", () => {
  const left = makePuzzle(
    "angle-left",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 3 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 5 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 8 }] },
    ],
    [6, 9],
    [0, 0, 0],
  );
  const right = makePuzzle(
    "angle-right",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 3 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 5 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 8 }] },
    ],
    [6, 9],
    [1, 0, 0],
  );
  assert.equal(canonicalShapeKey(left), canonicalShapeKey(right));
  assert.notEqual(canonicalInitialWorldKey(left), canonicalInitialWorldKey(right));
  assert.equal(duplicateRelation(left, right), "initial-angle-only");
});

test("P04 records a common mirror as a reflection duplicate", () => {
  const left = makePuzzle(
    "mirror-left",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 2 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 4 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 7 }] },
    ],
    [6, 9],
  );
  const mirror = makePuzzle(
    "mirror-right",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 10 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 8 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 5 }] },
    ],
    [3, 6],
  );
  assert.equal(duplicateRelation(left, mirror), "reflection");
});

test("P04 does not permit the same shape to cross difficulty bands", () => {
  const easy = makePuzzle(
    "cross-easy",
    [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 2 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 4 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 7 }] },
    ],
    [6, 9],
    [0, 0, 0],
    "easy",
  );
  const hard = { ...easy, id: "cross-hard", difficulty: "hard" as const, contentChecksum: "" };
  hard.contentChecksum = computePuzzleChecksum(hard);
  assert.equal(duplicateRelation(easy, hard), "difficulty-cross");
});

test("legacy normalization strips v1 emission and analysis fields and recomputes v2 checksum", () => {
  const legacy = {
    schemaVersion: 1,
    rulesetVersion: "stone-rings-v1",
    generatorVersion: "generator-v1",
    id: "legacy-one",
    difficulty: "easy",
    slotCount: 12,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0], emissionEnabled: [false, true, true] },
    contentChecksum: "sha256:old",
    shortestMoves: 1,
  };
  const converted = normalizeLegacyPuzzle(legacy);
  assert.equal(converted.puzzle.id, "legacy-one-v2");
  assert.equal(converted.puzzle.rulesetVersion, "stone-rings-v2");
  assert.deepEqual(converted.puzzle.initialState, { rotations: [0, 0, 0] });
  assert.ok(converted.strippedFields.includes("initialState.emissionEnabled"));
});
