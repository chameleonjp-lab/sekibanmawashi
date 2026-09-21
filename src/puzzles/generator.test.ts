import assert from "node:assert/strict";
import { test } from "node:test";
import { computePuzzleChecksum } from "../core/checksum.ts";
import type { Puzzle } from "../core/types.ts";
import { contentIdSuffix } from "./generator.ts";

function makePuzzle(id: string, offset: number): Puzzle {
  const rings = [
    { id: "inner" as const, parts: [{ kind: "emitter" as const, slot: offset % 12 }, { kind: "blocker" as const, slot: (offset + 2) % 12 }] },
    { id: "middle" as const, parts: [{ kind: "emitter" as const, slot: (offset + 4) % 12 }] },
    { id: "outer" as const, parts: [{ kind: "blocker" as const, slot: (offset + 7) % 12 }] },
  ] as Puzzle["rings"];
  const draft = {
    schemaVersion: 2 as const,
    rulesetVersion: "stone-rings-v2" as const,
    generatorVersion: "generator-v2",
    id,
    difficulty: "easy" as const,
    slotCount: 12 as const,
    rings,
    targets: [(offset + 6) % 12, (offset + 9) % 12].sort((left, right) => left - right),
    initialState: { rotations: [0, 0, 0] as [number, number, number] },
  };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

test("content ID suffix changes when raw content is globally rotated", () => {
  const left = makePuzzle("left", 0);
  const right = makePuzzle("right", 1);
  assert.notEqual(contentIdSuffix(left), contentIdSuffix(right));
});
