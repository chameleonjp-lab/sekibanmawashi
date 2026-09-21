import type { Puzzle } from "./types.ts";

type ChecksumInput = Pick<
  Puzzle,
  | "schemaVersion"
  | "rulesetVersion"
  | "generatorVersion"
  | "id"
  | "difficulty"
  | "slotCount"
  | "rings"
  | "targets"
  | "initialState"
>;

export function canonicalPuzzlePayload(puzzle: ChecksumInput): string {
  return JSON.stringify({
    schemaVersion: puzzle.schemaVersion,
    rulesetVersion: puzzle.rulesetVersion,
    generatorVersion: puzzle.generatorVersion,
    id: puzzle.id,
    difficulty: puzzle.difficulty,
    slotCount: puzzle.slotCount,
    rings: puzzle.rings.map((ring) => ({
      id: ring.id,
      parts: ring.parts.map((part) => ({ kind: part.kind, slot: part.slot })),
    })),
    targets: [...puzzle.targets],
    initialState: { rotations: [...puzzle.initialState.rotations] },
  });
}

/** FNV-1a over UTF-8. The fixed-width hexadecimal result is the v2 checksum. */
export function computePuzzleChecksum(puzzle: ChecksumInput): string {
  const bytes = new TextEncoder().encode(canonicalPuzzlePayload(puzzle));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
