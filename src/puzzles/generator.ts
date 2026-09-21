import { computePuzzleChecksum } from "../core/checksum.ts";
import {
  RING_IDS,
  SLOT_COUNT,
  type Difficulty,
  type Puzzle,
  type RingPart,
} from "../core/types.ts";
import {
  CALIBRATION_FORMULA,
  DIFFICULTY_BANDS,
  R2_ADOPTED_PER_DIFFICULTY,
  R2_CANDIDATES_PER_DIFFICULTY,
  R2_CONFIG_VERSION,
  R2_GENERATOR_SEED,
  R2_MAX_ATTEMPTS_PER_DIFFICULTY,
  difficultyBand,
  type DifficultyBand,
} from "./config.ts";
import {
  analyzePuzzle,
  evaluateStateFast,
  type PuzzleAnalysis,
} from "./solver.ts";
import {
  canonicalInitialWorldKey,
  canonicalShapeKey,
  duplicateRelation,
  normalizeLegacyPuzzle,
  normalizePuzzle,
} from "./normalization.ts";

type Rng = () => number;

export type CandidateSource = "generated" | "legacy";

export type CandidateRecord = {
  candidateId: string;
  source: CandidateSource;
  difficulty: Difficulty;
  accepted: boolean;
  rejectionReasons: string[];
  shapeKey: string;
  initialWorldKey: string;
  puzzle?: Puzzle;
  analysis?: PuzzleAnalysis;
};

export type MigrationAction = "reused" | "adjusted" | "replaced" | "rejected";

export type MigrationRecord = {
  oldId: string;
  oldDifficulty: Difficulty | null;
  action: MigrationAction;
  reason: string;
  normalizedPuzzleId: string | null;
  analysis: PuzzleAnalysis | null;
  newPuzzleIds: string[];
};

export type NearDuplicateRecord = {
  leftId: string;
  rightId: string;
  relation: "rotation" | "reflection" | "difficulty-cross" | "initial-angle-only" | "exact";
  keptId: string;
  droppedId: string;
  reason: string;
};

export type GenerationOptions = {
  seed?: number | undefined;
  candidatesPerDifficulty?: number | undefined;
  adoptedPerDifficulty?: number | undefined;
  maxAttemptsPerDifficulty?: number | undefined;
  /** Legacy v1 definitions are supplied by the offline CLI, never bundled in src. */
  legacyPuzzles?: readonly unknown[] | undefined;
};

export type GenerationResult = {
  configVersion: typeof R2_CONFIG_VERSION;
  seed: number;
  candidates: CandidateRecord[];
  puzzles: Puzzle[];
  analyses: Array<{ puzzleId: string } & PuzzleAnalysis>;
  migration: MigrationRecord[];
  nearDuplicates: NearDuplicateRecord[];
  counts: Record<Difficulty, { inspected: number; accepted: number; adopted: number; attempts: number; exhausted: boolean }>;
};

type MutablePuzzle = Omit<Puzzle, "contentChecksum">;

function mulberry32(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function pickInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[pickInt(rng, 0, values.length - 1)];
}

function shuffle<T>(rng: Rng, values: readonly T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = pickInt(rng, 0, index);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function chooseCount(rng: Rng, min: number, max: number): number {
  return pickInt(rng, min, max);
}

function emptyCounts(): [number, number, number] {
  return [0, 0, 0];
}

function distributeEmitters(rng: Rng, band: DifficultyBand, total: number): [number, number, number] {
  const counts = emptyCounts();
  const required = band.minOperatedRings >= 3 ? [0, 1, 2] : [0, 1];
  for (const ring of required) counts[ring] += 1;
  for (let left = total - required.length; left > 0; left -= 1) {
    const available = [0, 1, 2].filter((ring) => counts[ring] < 4);
    counts[pick(rng, available)] += 1;
  }
  return counts;
}

function distributeBlockers(rng: Rng, emitters: readonly number[], total: number): [number, number, number] | null {
  const counts = emptyCounts();
  for (let left = total; left > 0; left -= 1) {
    const available = [0, 1, 2].filter((ring) => emitters[ring] + counts[ring] < 4);
    if (available.length === 0) return null;
    counts[pick(rng, available)] += 1;
  }
  return counts;
}

function makeParts(rng: Rng, band: DifficultyBand): [RingPart[], RingPart[], RingPart[]] | null {
  const emitterTotal = chooseCount(rng, band.minEmitters, band.maxEmitters);
  const blockerTotal = chooseCount(rng, band.minBlockers, band.maxBlockers);
  const emitterCounts = distributeEmitters(rng, band, emitterTotal);
  const blockerCounts = distributeBlockers(rng, emitterCounts, blockerTotal);
  if (!blockerCounts) return null;
  const rings: [RingPart[], RingPart[], RingPart[]] = [[], [], []];
  for (let ring = 0; ring < 3; ring += 1) {
    const used = new Set<number>();
    for (let index = 0; index < emitterCounts[ring]; index += 1) {
      let slot = pickInt(rng, 0, SLOT_COUNT - 1);
      while (used.has(slot)) slot = pickInt(rng, 0, SLOT_COUNT - 1);
      used.add(slot);
      rings[ring].push({ kind: "emitter", slot });
    }
    for (let index = 0; index < blockerCounts[ring]; index += 1) {
      let slot = pickInt(rng, 0, SLOT_COUNT - 1);
      while (used.has(slot)) slot = pickInt(rng, 0, SLOT_COUNT - 1);
      used.add(slot);
      rings[ring].push({ kind: "blocker", slot });
    }
    rings[ring].sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind));
  }
  return rings;
}

function randomRotations(rng: Rng): [number, number, number] {
  return [pickInt(rng, 0, 11), pickInt(rng, 0, 11), pickInt(rng, 0, 11)];
}

function basePuzzle(
  id: string,
  difficulty: Difficulty,
  rings: [RingPart[], RingPart[], RingPart[]],
  targets: number[],
  rotations: [number, number, number],
): Puzzle {
  const draft: MutablePuzzle = {
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    generatorVersion: "generator-v2",
    id,
    difficulty,
    slotCount: SLOT_COUNT,
    rings: [
      { id: RING_IDS[0], parts: rings[0] },
      { id: RING_IDS[1], parts: rings[1] },
      { id: RING_IDS[2], parts: rings[2] },
    ],
    targets: [...targets].sort((a, b) => a - b),
    initialState: { rotations },
  };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

function targetSlotsAtGoal(puzzle: Puzzle, goal: [number, number, number], rng: Rng, band: DifficultyBand): number[] | null {
  const result = evaluateStateFast(puzzle, { rotations: goal });
  const litSlots: number[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    if ((result.litMask & (1 << slot)) !== 0) litSlots.push(slot);
  }
  const emitterCount = puzzle.rings.reduce(
    (count, ring) => count + ring.parts.filter((part) => part.kind === "emitter").length,
    0,
  );
  const maxTargets = Math.min(band.maxTargets, emitterCount, litSlots.length);
  if (maxTargets < band.minTargets) return null;
  const count = pickInt(rng, band.minTargets, maxTargets);
  return shuffle(rng, litSlots).slice(0, count).sort((a, b) => a - b);
}

function reasonsForBand(puzzle: Puzzle, analysis: PuzzleAnalysis, band: DifficultyBand): string[] {
  const reasons: string[] = [];
  const emitters = puzzle.rings.reduce((count, ring) => count + ring.parts.filter((part) => part.kind === "emitter").length, 0);
  const blockers = puzzle.rings.reduce((count, ring) => count + ring.parts.filter((part) => part.kind === "blocker").length, 0);
  if (analysis.shortestMoves === null) reasons.push("unsolved");
  if (analysis.shortestMoves !== null && (analysis.shortestMoves < band.minMoves || analysis.shortestMoves > band.maxMoves)) {
    reasons.push("shortest-moves-outside-band");
  }
  if (puzzle.targets.length < band.minTargets || puzzle.targets.length > band.maxTargets) reasons.push("target-count-outside-band");
  if (emitters < band.minEmitters || emitters > band.maxEmitters) reasons.push("emitter-count-outside-band");
  if (blockers < band.minBlockers || blockers > band.maxBlockers) reasons.push("blocker-count-outside-band");
  if (analysis.minOperatedRingCount < band.minOperatedRings) reasons.push("too-few-operated-rings");
  if (analysis.effectiveRingIndexes.length < 3) reasons.push("ineffective-ring");
  if (analysis.shortestGoalStateCount > band.maxShortestGoalStates) reasons.push("too-many-shortest-goal-states");
  if (analysis.shortestMoves === 0) reasons.push("initially-solved");
  return reasons;
}

function candidatePuzzle(rng: Rng, band: DifficultyBand, candidateId: string): { puzzle: Puzzle; analysis: PuzzleAnalysis } | null {
  for (let boardAttempt = 0; boardAttempt < 80; boardAttempt += 1) {
    const parts = makeParts(rng, band);
    if (!parts) continue;
    const goal = randomRotations(rng);
    const provisional = basePuzzle(candidateId, band.difficulty, parts, [0], goal);
    const targets = targetSlotsAtGoal(provisional, goal, rng, band);
    if (!targets) continue;
    for (let initialAttempt = 0; initialAttempt < 16; initialAttempt += 1) {
      const initial = randomRotations(rng);
      const puzzle = basePuzzle(candidateId, band.difficulty, parts, targets, initial);
      const analysis = analyzePuzzle(puzzle);
      const reasons = reasonsForBand(puzzle, analysis, band);
      if (reasons.length === 0) return { puzzle, analysis };
    }
  }
  return null;
}

function candidateFailureRecord(
  candidateId: string,
  source: CandidateSource,
  difficulty: Difficulty,
  puzzle: Puzzle,
  analysis: PuzzleAnalysis,
  reasons: string[],
): CandidateRecord {
  return {
    candidateId,
    source,
    difficulty,
    accepted: false,
    rejectionReasons: reasons,
    shapeKey: canonicalShapeKey(puzzle),
    initialWorldKey: canonicalInitialWorldKey(puzzle),
    puzzle,
    analysis,
  };
}

function generateBandCandidates(
  difficulty: Difficulty,
  seed: number,
  targetCount: number,
  nearDuplicates: NearDuplicateRecord[],
  existingByShape: Map<string, CandidateRecord>,
  existingByInitialWorld: Map<string, CandidateRecord>,
  maxAttempts: number,
): { records: CandidateRecord[]; exhausted: boolean } {
  const band = difficultyBand(difficulty);
  const rng = mulberry32(seed);
  const records: CandidateRecord[] = [];
  let accepted = 0;
  let attempt = 0;
  while (accepted < targetCount && attempt < maxAttempts) {
    attempt += 1;
    const candidateId = `candidate-${difficulty}-${String(attempt).padStart(5, "0")}`;
    const result = candidatePuzzle(rng, band, candidateId);
    if (!result) {
      // A board that could not find a valid start is still an inspected
      // attempt; retain a compact reason and retry with the fixed stream.
      records.push({
        candidateId,
        source: "generated",
        difficulty,
        accepted: false,
        rejectionReasons: ["no-valid-start-after-80-board-attempts"],
        shapeKey: "",
        initialWorldKey: "",
      });
      continue;
    }
    const { puzzle, analysis } = result;
    const bandReasons = reasonsForBand(puzzle, analysis, band);
    const shapeKey = canonicalShapeKey(puzzle);
    const initialWorldKey = canonicalInitialWorldKey(puzzle);
    const previousShape = existingByShape.get(shapeKey);
    const previousWorld = existingByInitialWorld.get(initialWorldKey);
    const duplicate = previousShape ?? previousWorld;
    if (bandReasons.length > 0 || duplicate) {
      const reasons = [...bandReasons];
      if (duplicate) {
        const relation = duplicateRelation(duplicate.puzzle as Puzzle, puzzle);
        reasons.push(relation ? `near-duplicate:${relation}` : "near-duplicate");
        nearDuplicates.push({
          leftId: duplicate.candidateId,
          rightId: candidateId,
          relation: relation ?? "exact",
          keptId: duplicate.candidateId,
          droppedId: candidateId,
          reason: "same normalized geometry or physical initial board",
        });
      }
      records.push(candidateFailureRecord(candidateId, "generated", difficulty, puzzle, analysis, reasons));
      continue;
    }
    const record: CandidateRecord = {
      candidateId,
      source: "generated",
      difficulty,
      accepted: true,
      rejectionReasons: [],
      shapeKey,
      initialWorldKey,
      puzzle,
      analysis,
    };
    records.push(record);
    existingByShape.set(shapeKey, record);
    existingByInitialWorld.set(initialWorldKey, record);
    accepted += 1;
  }
  return { records, exhausted: accepted < targetCount };
}

function chooseAdopted(records: CandidateRecord[], count: number): CandidateRecord[] {
  const accepted = records.filter((record) => record.accepted && record.puzzle && record.analysis);
  if (accepted.length < count) throw new Error(`only ${accepted.length} accepted candidates available; need ${count}`);
  // Compatible v1 conversions are retained ahead of fresh geometry. This is
  // the explicit reuse policy recorded by the migration report; later
  // generated candidates fill the remaining slots after the old set.
  const legacy = accepted
    .filter((record) => record.source === "legacy")
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const retained = legacy.slice(0, count);
  if (retained.length === count) return retained;
  const retainedSet = new Set(retained);
  const fresh = accepted.filter((record) => !retainedSet.has(record));
  const targetScore = retained.length > 0
    ? retained.reduce((sum, record) => sum + (record.analysis?.calibrationScore ?? 0), 0) / retained.length
    : fresh.reduce((sum, record) => sum + (record.analysis?.calibrationScore ?? 0), 0) / Math.max(1, fresh.length);
  fresh.sort((left, right) => {
    const leftDistance = Math.abs((left.analysis?.calibrationScore ?? 0) - targetScore);
    const rightDistance = Math.abs((right.analysis?.calibrationScore ?? 0) - targetScore);
    return leftDistance - rightDistance || left.candidateId.localeCompare(right.candidateId);
  });
  retained.push(...fresh.slice(0, count - retained.length));
  return retained.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

function inspectLegacyCandidates(
  legacyValues: readonly unknown[],
  byShape: Map<string, CandidateRecord>,
  byInitialWorld: Map<string, CandidateRecord>,
  nearDuplicates: NearDuplicateRecord[],
): Map<Difficulty, CandidateRecord[]> {
  const byDifficulty = new Map<Difficulty, CandidateRecord[]>([
    ["easy", []],
    ["normal", []],
    ["hard", []],
  ]);
  for (const value of legacyValues) {
    let sourceId = "unknown";
    try {
      if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") sourceId = value.id;
      const converted = normalizeLegacyPuzzle(value);
      const puzzle = converted.puzzle;
      sourceId = converted.sourceId;
      const analysis = analyzePuzzle(puzzle);
      const band = difficultyBand(puzzle.difficulty);
      const reasons = reasonsForBand(puzzle, analysis, band);
      const shapeKey = canonicalShapeKey(puzzle);
      const initialWorldKey = canonicalInitialWorldKey(puzzle);
      const previous = byShape.get(shapeKey) ?? byInitialWorld.get(initialWorldKey);
      if (previous) {
        const relation = duplicateRelation(previous.puzzle as Puzzle, puzzle);
        reasons.push(`near-duplicate:${relation ?? "exact"}`);
        nearDuplicates.push({
          leftId: previous.candidateId,
          rightId: puzzle.id,
          relation: relation ?? "exact",
          keptId: previous.candidateId,
          droppedId: puzzle.id,
          reason: "legacy candidate duplicates an earlier normalized candidate",
        });
      }
      const record: CandidateRecord = {
        candidateId: `legacy-${sourceId}`,
        source: "legacy",
        difficulty: puzzle.difficulty,
        accepted: reasons.length === 0,
        rejectionReasons: reasons,
        shapeKey,
        initialWorldKey,
        puzzle,
        analysis,
      };
      byDifficulty.get(puzzle.difficulty)?.push(record);
      if (record.accepted && !previous) {
        byShape.set(shapeKey, record);
        byInitialWorld.set(initialWorldKey, record);
      }
    } catch (error) {
      // Retain one record per old id, even if malformed, so migration has a
      // reason and never silently drops an old definition.
      const difficulty = typeof value === "object" && value !== null && "difficulty" in value &&
        (value.difficulty === "easy" || value.difficulty === "normal" || value.difficulty === "hard")
        ? value.difficulty
        : "easy";
      const record: CandidateRecord = {
        candidateId: `legacy-${sourceId}`,
        source: "legacy",
        difficulty,
        accepted: false,
        rejectionReasons: [`normalization-error:${error instanceof Error ? error.message : "unknown"}`],
        shapeKey: "",
        initialWorldKey: "",
      };
      byDifficulty.get(difficulty)?.push(record);
    }
  }
  return byDifficulty;
}

function cloneWithId(puzzle: Puzzle, id: string): Puzzle {
  const draft: MutablePuzzle = { ...puzzle, id };
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

export function contentIdSuffix(puzzle: Puzzle): string {
  // Use the v2 checksum over every public field while replacing the id with a
  // fixed placeholder. This keeps the suffix stable while constructing the
  // final id, and still changes it for a raw rotation/target/part edit that a
  // geometry-invariant duplicate key would intentionally collapse.
  return computePuzzleChecksum({ ...puzzle, id: "content" }).slice(0, 16);
}

function migrationReason(analysis: PuzzleAnalysis | null, puzzle: Puzzle | null, band: DifficultyBand | null): string {
  if (!analysis || !puzzle || !band) return "legacy record could not be normalized";
  const reasons = reasonsForBand(puzzle, analysis, band);
  return reasons.length === 0 ? "v2 conversion retained all geometry and passed the fixed band" : reasons.join(", ");
}

function buildMigration(
  adopted: Puzzle[],
  legacyValues: readonly unknown[],
): MigrationRecord[] {
  const selectedByShape = new Map(adopted.map((puzzle) => [canonicalShapeKey(puzzle), puzzle]));
  const selectedByWorld = new Map(adopted.map((puzzle) => [canonicalInitialWorldKey(puzzle), puzzle]));
  const replacementsByDifficulty = new Map<Difficulty, string[]>([
    ["easy", adopted.filter((puzzle) => puzzle.difficulty === "easy").map((puzzle) => puzzle.id)],
    ["normal", adopted.filter((puzzle) => puzzle.difficulty === "normal").map((puzzle) => puzzle.id)],
    ["hard", adopted.filter((puzzle) => puzzle.difficulty === "hard").map((puzzle) => puzzle.id)],
  ]);
  const replacementCursor = new Map<Difficulty, number>([["easy", 0], ["normal", 0], ["hard", 0]]);
  return legacyValues.map((value) => {
    let normalized: Puzzle | null = null;
    let analysis: PuzzleAnalysis | null = null;
    let oldId = "unknown";
    let oldDifficulty: Difficulty | null = null;
    try {
      const converted = normalizeLegacyPuzzle(value);
      normalized = converted.puzzle;
      oldId = converted.sourceId;
      oldDifficulty = normalized.difficulty;
      analysis = analyzePuzzle(normalized);
    } catch {
      if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") oldId = value.id;
    }
    if (!normalized || !analysis || !oldDifficulty) {
      return {
        oldId,
        oldDifficulty,
        action: "rejected",
        reason: "legacy definition failed v2 normalization",
        normalizedPuzzleId: null,
        analysis,
        newPuzzleIds: [],
      };
    }
    const shapeMatch = selectedByShape.get(canonicalShapeKey(normalized));
    const worldMatch = selectedByWorld.get(canonicalInitialWorldKey(normalized));
    const sameShape = shapeMatch?.difficulty === oldDifficulty ? shapeMatch : undefined;
    const sameWorld = worldMatch?.difficulty === oldDifficulty ? worldMatch : undefined;
    const band = difficultyBand(oldDifficulty);
    const reason = migrationReason(analysis, normalized, band);
    if (sameShape) {
      return {
        oldId,
        oldDifficulty,
        action: "reused",
        reason: `${reason}; selected as ${sameShape.id}`,
        normalizedPuzzleId: normalized.id,
        analysis,
        newPuzzleIds: [sameShape.id],
      };
    }
    if (sameWorld) {
      return {
        oldId,
        oldDifficulty,
        action: "adjusted",
        reason: `${reason}; same physical initial board as ${sameWorld.id}`,
        normalizedPuzzleId: normalized.id,
        analysis,
        newPuzzleIds: [sameWorld.id],
      };
    }
    const rejected = analysis.shortestMoves === null || reasonsForBand(normalized, analysis, band).includes("initially-solved");
    const replacementList = replacementsByDifficulty.get(oldDifficulty) ?? [];
    const replacementIndex = replacementCursor.get(oldDifficulty) ?? 0;
    const replacementId = replacementList[replacementIndex];
    replacementCursor.set(oldDifficulty, replacementIndex + 1);
    return {
      oldId,
      oldDifficulty,
      action: rejected ? "rejected" : "replaced",
      reason,
      normalizedPuzzleId: normalized.id,
      analysis,
      newPuzzleIds: rejected || !replacementId ? [] : [replacementId],
    };
  });
}

/** Generate deterministic candidate pools and the selected 90-puzzle corpus. */
export function generatePuzzles(options?: GenerationOptions): GenerationResult {
  const seed = options?.seed ?? R2_GENERATOR_SEED;
  const candidateTarget = options?.candidatesPerDifficulty ?? R2_CANDIDATES_PER_DIFFICULTY;
  const adoptedTarget = options?.adoptedPerDifficulty ?? R2_ADOPTED_PER_DIFFICULTY;
  const maxAttempts = options?.maxAttemptsPerDifficulty ?? (
    candidateTarget === R2_CANDIDATES_PER_DIFFICULTY
      ? R2_MAX_ATTEMPTS_PER_DIFFICULTY
      : Math.max(2_000, candidateTarget * 50)
  );
  if (!Number.isInteger(seed) || !Number.isInteger(candidateTarget) || candidateTarget < adoptedTarget) {
    throw new Error("seed and candidate/adopted counts must be integers, with candidates >= adopted");
  }
  const candidates: CandidateRecord[] = [];
  const nearDuplicates: NearDuplicateRecord[] = [];
  const byShape = new Map<string, CandidateRecord>();
  const byInitialWorld = new Map<string, CandidateRecord>();
  const legacyByDifficulty = inspectLegacyCandidates(options?.legacyPuzzles ?? [], byShape, byInitialWorld, nearDuplicates);
  const selected: Puzzle[] = [];
  const selectedAnalyses: Array<{ puzzleId: string } & PuzzleAnalysis> = [];
  const counts = {} as Record<Difficulty, { inspected: number; accepted: number; adopted: number; attempts: number; exhausted: boolean }>;
  for (let index = 0; index < DIFFICULTY_BANDS.length; index += 1) {
    const band = DIFFICULTY_BANDS[index];
    const legacyRecords = legacyByDifficulty.get(band.difficulty) ?? [];
    const legacyAccepted = legacyRecords.filter((record) => record.accepted).length;
    const generated = generateBandCandidates(
      band.difficulty,
      seed + index + 1,
      Math.max(0, candidateTarget - legacyAccepted),
      nearDuplicates,
      byShape,
      byInitialWorld,
      maxAttempts,
    );
    const records = [...legacyRecords, ...generated.records];
    candidates.push(...records);
    const adoptedRecords = chooseAdopted(records, adoptedTarget);
    for (let adoptedIndex = 0; adoptedIndex < adoptedRecords.length; adoptedIndex += 1) {
      const record = adoptedRecords[adoptedIndex];
      if (!record.puzzle || !record.analysis) throw new Error("accepted candidate is missing puzzle analysis");
      // A content-derived suffix makes changes visible even when the ordering
      // slot remains the same across a regeneration.
      const id = `${band.difficulty}-v2-${String(adoptedIndex + 1).padStart(2, "0")}-${contentIdSuffix(record.puzzle)}`;
      const puzzle = cloneWithId(record.puzzle, id);
      selected.push(puzzle);
      selectedAnalyses.push({ puzzleId: id, ...record.analysis });
    }
    const accepted = records.filter((record) => record.accepted).length;
    counts[band.difficulty] = {
      inspected: records.length,
      accepted,
      adopted: adoptedRecords.length,
      attempts: records.length,
      exhausted: generated.exhausted,
    };
  }
  const migration = buildMigration(selected, options?.legacyPuzzles ?? []);
  return {
    configVersion: R2_CONFIG_VERSION,
    seed,
    candidates,
    puzzles: selected,
    analyses: selectedAnalyses,
    migration,
    nearDuplicates,
    counts,
  };
}

/** Convenience entry point for reports that need the inspected candidate set. */
export function generateCandidates(options?: GenerationOptions): CandidateRecord[] {
  return generatePuzzles(options).candidates;
}

export { CALIBRATION_FORMULA };
export { normalizePuzzle, normalizeLegacyPuzzle };
