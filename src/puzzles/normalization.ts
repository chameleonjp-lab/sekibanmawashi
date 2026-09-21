import { computePuzzleChecksum } from "../core/checksum.ts";
import { assertValidPuzzle } from "../core/validation.ts";
import {
  GENERATOR_VERSION,
  RING_IDS,
  RULESET_VERSION,
  SCHEMA_VERSION,
  SLOT_COUNT,
  type Difficulty,
  type Puzzle,
  type RingPart,
} from "../core/types.ts";

type UnknownRecord = Record<string, unknown>;

export type NormalizationOptions = {
  id?: string;
  difficulty?: Difficulty;
};

export type LegacyNormalization = {
  puzzle: Puzzle;
  sourceId: string;
  sourceSchemaVersion: unknown;
  strippedFields: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDifficulty(value: unknown): Difficulty {
  if (value === "easy" || value === "normal" || value === "hard") return value;
  throw new Error("difficulty must be easy, normal, or hard");
}

function asSlot(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= SLOT_COUNT) {
    throw new Error("slot must be an integer from 0 through 11");
  }
  return value;
}

function makeId(input: unknown, override?: string): string {
  const id = override ?? input;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw new Error("id must use a lower-case identifier");
  }
  return id;
}

function normalizeParts(value: unknown): RingPart[] {
  if (!Array.isArray(value)) throw new Error("ring parts must be an array");
  const parts = value.map((part): RingPart => {
    if (!isRecord(part) || (part.kind !== "emitter" && part.kind !== "blocker")) {
      throw new Error("ring part kind must be emitter or blocker");
    }
    return { kind: part.kind, slot: asSlot(part.slot) };
  });
  const seen = new Set<number>();
  for (const part of parts) {
    if (seen.has(part.slot)) throw new Error("a ring cannot contain duplicate slots");
    seen.add(part.slot);
  }
  return parts.sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind));
}

function normalizedDraft(input: unknown, options?: NormalizationOptions): Omit<Puzzle, "contentChecksum"> {
  if (!isRecord(input)) throw new Error("puzzle must be an object");
  if (!Array.isArray(input.rings) || input.rings.length !== RING_IDS.length) {
    throw new Error("exactly three rings are required");
  }
  const rings = input.rings.map((ring, index) => {
    if (!isRecord(ring) || ring.id !== RING_IDS[index]) throw new Error("ring ids must be inner, middle, outer");
    return { id: RING_IDS[index], parts: normalizeParts(ring.parts) };
  }) as Puzzle["rings"];
  if (!Array.isArray(input.targets) || input.targets.length < 1) throw new Error("at least one target is required");
  const targets = input.targets.map(asSlot);
  if (new Set(targets).size !== targets.length) throw new Error("targets cannot contain duplicates");
  const initialState = isRecord(input.initialState) ? input.initialState : undefined;
  if (!initialState || !Array.isArray(initialState.rotations) || initialState.rotations.length !== RING_IDS.length) {
    throw new Error("three initial rotations are required");
  }
  const rotations = initialState.rotations.map(asSlot) as Puzzle["initialState"]["rotations"];
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: makeId(input.id, options?.id),
    difficulty: options?.difficulty ?? asDifficulty(input.difficulty),
    slotCount: SLOT_COUNT,
    rings,
    targets: [...new Set(targets)].sort((a, b) => a - b),
    initialState: { rotations },
  };
}

/**
 * Normalize a v2 or v1-shaped object into the public v2 schema.  The
 * `emissionEnabled` field from v1 is intentionally ignored: in v2 all
 * emitters are always on.  Analysis fields are never copied into the result.
 */
export function normalizePuzzle(input: unknown, options?: NormalizationOptions): Puzzle {
  const draft = normalizedDraft(input, options);
  const contentChecksum = computePuzzleChecksum(draft);
  return assertValidPuzzle({ ...draft, contentChecksum });
}

/** Explicit name used by the migration report and tests. */
export function normalizeLegacyPuzzle(input: unknown, options?: NormalizationOptions): LegacyNormalization {
  if (!isRecord(input)) throw new Error("legacy puzzle must be an object");
  const sourceId = typeof input.id === "string" ? input.id : "unknown";
  const normalizeOptions: NormalizationOptions = { id: options?.id ?? `${sourceId}-v2` };
  if (options?.difficulty !== undefined) normalizeOptions.difficulty = options.difficulty;
  const puzzle = normalizePuzzle(input, normalizeOptions);
  const strippedFields = [
    "schemaVersion",
    "rulesetVersion",
    "generatorVersion",
    "contentChecksum",
    "shortestMoves",
    "shortestSolutionCount",
    "shortestPathCount",
    "requiredRingIndexes",
    "requiredToggleCount",
    "calibrationScore",
  ];
  if (isRecord(input.initialState) && Object.prototype.hasOwnProperty.call(input.initialState, "emissionEnabled")) {
    strippedFields.push("initialState.emissionEnabled");
  }
  return {
    puzzle,
    sourceId,
    sourceSchemaVersion: input.schemaVersion,
    strippedFields,
  };
}

export const normalizeV1Puzzle = normalizeLegacyPuzzle;

type CanonicalRing = { id: string; parts: RingPart[] };

function mapSlot(slot: number, shift: number, reflected: boolean): number {
  const oriented = reflected ? (SLOT_COUNT - slot) % SLOT_COUNT : slot;
  return (oriented + shift) % SLOT_COUNT;
}

function canonicalGeometryPayload(puzzle: Puzzle, useInitialWorld: boolean, shift: number, reflected: boolean): string {
  const rings: CanonicalRing[] = puzzle.rings.map((ring, ringIndex) => ({
    id: ring.id,
    parts: ring.parts
      .map((part) => {
        const sourceSlot = useInitialWorld
          ? (part.slot + puzzle.initialState.rotations[ringIndex]) % SLOT_COUNT
          : part.slot;
        return { kind: part.kind, slot: mapSlot(sourceSlot, shift, reflected) };
      })
      .sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind)),
  }));
  const targets = puzzle.targets
    .map((slot) => mapSlot(slot, shift, reflected))
    .sort((left, right) => left - right);
  return JSON.stringify({ rings, targets });
}

function minimumDihedralKey(puzzle: Puzzle, useInitialWorld: boolean, reflections: readonly boolean[] = [false, true]): string {
  let best = "";
  for (const reflected of reflections) {
    for (let shift = 0; shift < SLOT_COUNT; shift += 1) {
      const candidate = canonicalGeometryPayload(puzzle, useInitialWorld, shift, reflected);
      if (best === "" || candidate < best) best = candidate;
    }
  }
  return best;
}

function independentRingShapeKey(puzzle: Puzzle, reflected: boolean): string {
  const rings = puzzle.rings.map((ring) => {
    let best = "";
    for (let shift = 0; shift < SLOT_COUNT; shift += 1) {
      const parts = ring.parts
        .map((part) => ({ kind: part.kind, slot: mapSlot(part.slot, shift, reflected) }))
        .sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind));
      const key = JSON.stringify(parts);
      if (best === "" || key < best) best = key;
    }
    return { id: ring.id, parts: best };
  });
  let targetKey = "";
  for (let shift = 0; shift < SLOT_COUNT; shift += 1) {
    const key = JSON.stringify(puzzle.targets.map((slot) => mapSlot(slot, shift, reflected)).sort((a, b) => a - b));
    if (targetKey === "" || key < targetKey) targetKey = key;
  }
  return JSON.stringify({ rings, targets: targetKey });
}

/** Geometry key invariant under each ring's local cyclic origin and mirror reflection. */
export function canonicalShapeKey(puzzle: Puzzle): string {
  const direct = independentRingShapeKey(puzzle, false);
  const reflected = independentRingShapeKey(puzzle, true);
  return direct < reflected ? direct : reflected;
}

export function canonicalShapeRotationKey(puzzle: Puzzle): string {
  return independentRingShapeKey(puzzle, false);
}

export function canonicalShapeReflectionKey(puzzle: Puzzle): string {
  return independentRingShapeKey(puzzle, true);
}

/** Alias used by duplicate filtering code. */
export const canonicalPuzzleKey = canonicalShapeKey;
export const canonicalKey = canonicalShapeKey;
export const rotationInvariantKey = canonicalShapeKey;

/** Key for the physical initial board, invariant under global rotation/mirror. */
export function canonicalInitialWorldKey(puzzle: Puzzle): string {
  return minimumDihedralKey(puzzle, true);
}

export const initialWorldKey = canonicalInitialWorldKey;

export function canonicalInitialWorldRotationKey(puzzle: Puzzle): string {
  return minimumDihedralKey(puzzle, true, [false]);
}

export function canonicalInitialWorldReflectionKey(puzzle: Puzzle): string {
  return minimumDihedralKey(puzzle, true, [true]);
}

/**
 * A stable exact key retaining the initial rotations.  It is useful for
 * distinguishing a true duplicate from a same-shape puzzle with another
 * start angle in reports.
 */
export function exactPuzzleKey(puzzle: Puzzle): string {
  return JSON.stringify({
    rings: puzzle.rings.map((ring) => ({ id: ring.id, parts: ring.parts.map((part) => ({ ...part })) })),
    targets: [...puzzle.targets],
    rotations: [...puzzle.initialState.rotations],
    difficulty: puzzle.difficulty,
  });
}

export type DuplicateRelation = "exact" | "rotation" | "reflection" | "difficulty-cross" | "initial-angle-only";

/** Classify the first relevant relationship between two normalized puzzles. */
export function duplicateRelation(left: Puzzle, right: Puzzle): DuplicateRelation | null {
  if (exactPuzzleKey(left) === exactPuzzleKey(right)) return "exact";
  if (canonicalShapeKey(left) === canonicalShapeKey(right)) {
    if (left.difficulty !== right.difficulty) return "difficulty-cross";
    if (left.initialState.rotations.some((rotation, index) => rotation !== right.initialState.rotations[index])) {
      return "initial-angle-only";
    }
    return canonicalShapeRotationKey(left) === canonicalShapeRotationKey(right) ? "rotation" : "reflection";
  }
  if (canonicalInitialWorldKey(left) === canonicalInitialWorldKey(right)) return "initial-angle-only";
  return null;
}
