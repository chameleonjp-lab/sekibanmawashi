/**
 * Independent R1 light-path review.
 *
 * Generates 40 deterministic synthetic boards and compares evaluate().litMask
 * with a small reference implementation over all 1,728 rotation states. This
 * checks only the R1 path/blocking rule. It does not validate the 90 published
 * puzzles, solvability, difficulty, uniqueness, or any R2 acceptance criterion.
 *
 * Run with:
 *   node --experimental-strip-types scripts/review-light-oracle.mjs
 */

import { computePuzzleChecksum } from "../src/core/checksum.ts";
import { decodeState, evaluate } from "../src/core/engine.ts";

const INITIAL_SEED = 0x6d2b79f5;
const BOARD_COUNT = 40;
const STATE_COUNT = 12 ** 3;

let seed = INITIAL_SEED;

function random() {
  seed =
    (Math.imul(seed ^ (seed >>> 15), 1 | seed) +
      (Math.imul(seed ^ (seed >>> 7), 61 | seed) ^ seed)) ^
    0;
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}

function referenceLitMask(puzzle, state) {
  const occupied = puzzle.rings.map((ring, ringIndex) =>
    new Set(ring.parts.map((part) => (part.slot + state.rotations[ringIndex]) % 12)),
  );
  let litMask = 0;

  for (let sourceRing = 0; sourceRing < puzzle.rings.length; sourceRing += 1) {
    for (const part of puzzle.rings[sourceRing].parts) {
      if (part.kind !== "emitter") continue;

      const sourceSlot = (part.slot + state.rotations[sourceRing]) % 12;
      const destinationSlot = (sourceSlot + 6) % 12;
      let blocked = false;

      for (let ring = sourceRing - 1; ring >= 0; ring -= 1) {
        if (occupied[ring].has(sourceSlot)) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        for (let ring = 0; ring < puzzle.rings.length; ring += 1) {
          if (occupied[ring].has(destinationSlot)) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) litMask |= 1 << destinationSlot;
    }
  }

  return litMask;
}

function syntheticPuzzle(index) {
  const rings = ["inner", "middle", "outer"].map((id) => ({ id, parts: [] }));

  for (const ring of rings) {
    const usedSlots = new Set();
    const partCount = 1 + Math.floor(random() * 4);
    while (ring.parts.length < partCount) {
      const slot = Math.floor(random() * 12);
      if (usedSlots.has(slot)) continue;
      usedSlots.add(slot);
      ring.parts.push({ kind: random() < 0.5 ? "emitter" : "blocker", slot });
    }
  }

  if (!rings.some((ring) => ring.parts.some((part) => part.kind === "emitter"))) {
    rings[0].parts[0].kind = "emitter";
  }

  const emitterCount = rings
    .flatMap((ring) => ring.parts)
    .filter((part) => part.kind === "emitter").length;
  const puzzle = {
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    generatorVersion: "generator-v2",
    id: `review-oracle-${index}`,
    difficulty: "easy",
    slotCount: 12,
    rings,
    targets: Array.from({ length: Math.min(emitterCount, 2) }, (_, target) => target),
    initialState: { rotations: [0, 0, 0] },
  };
  puzzle.contentChecksum = computePuzzleChecksum(puzzle);
  return puzzle;
}

let compared = 0;
for (let puzzleIndex = 0; puzzleIndex < BOARD_COUNT; puzzleIndex += 1) {
  const puzzle = syntheticPuzzle(puzzleIndex);
  for (let code = 0; code < STATE_COUNT; code += 1) {
    const state = decodeState(code);
    const expected = referenceLitMask(puzzle, state);
    const actual = evaluate(puzzle, state).litMask;
    if (actual !== expected) {
      throw new Error(
        `light mismatch: ${JSON.stringify({ puzzleIndex, code, expected, actual, puzzle, state })}`,
      );
    }
    compared += 1;
  }
}

console.log({
  scope: "R1 synthetic light-path comparison; not an R2 puzzle-pool check",
  initialSeed: INITIAL_SEED,
  finalSeed: seed >>> 0,
  boards: BOARD_COUNT,
  statesPerBoard: STATE_COUNT,
  compared,
});
