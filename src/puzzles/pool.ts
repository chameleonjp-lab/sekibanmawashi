import {
  GENERATOR_VERSION,
  POOL_VERSION,
  RULESET_VERSION,
  SCHEMA_VERSION,
  type Puzzle,
} from "../core/index.ts";
import {
  computePoolChecksum,
  computePuzzleCollectionChecksum,
  R2_DIFFICULTIES,
  R2_PER_DIFFICULTY,
  R2_PUZZLE_COUNT,
  type DifficultyIds,
  type DrawProfile,
  type PoolManifest,
  validatePoolArtifact,
} from "./validation.ts";

export type { DifficultyIds, DrawProfile, PoolManifest } from "./validation.ts";

export function idsByDifficulty(puzzles: readonly Puzzle[]): DifficultyIds {
  const ids: DifficultyIds = { easy: [], normal: [], hard: [] };
  for (const puzzle of puzzles) ids[puzzle.difficulty].push(puzzle.id);
  return ids;
}

export function createPoolManifest(puzzles: readonly Puzzle[]): PoolManifest {
  if (puzzles.length !== R2_PUZZLE_COUNT) throw new Error("pool requires exactly 90 puzzles");
  const ids = idsByDifficulty(puzzles);
  for (const difficulty of R2_DIFFICULTIES) {
    if (ids[difficulty].length !== R2_PER_DIFFICULTY) throw new Error(`${difficulty} requires exactly 30 puzzles`);
  }
  const drawProfile: DrawProfile = {
    order: ["easy", "easy", "normal", "normal", "hard"],
    ticketCount: 900,
    easyAppearancesPerPuzzle: 60,
    normalAppearancesPerPuzzle: 60,
    hardAppearancesPerPuzzle: 30,
  };
  const draft: PoolManifest = {
    schemaVersion: SCHEMA_VERSION,
    poolVersion: POOL_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    puzzleCount: R2_PUZZLE_COUNT,
    puzzleChecksum: computePuzzleCollectionChecksum(puzzles),
    puzzleIdsByDifficulty: ids,
    drawProfile,
    poolChecksum: "",
  };
  draft.poolChecksum = computePoolChecksum(draft);
  return draft;
}

export function validatePool(
  input: unknown,
  puzzles: readonly Puzzle[],
): ReturnType<typeof validatePoolArtifact> {
  return validatePoolArtifact(input, puzzles);
}

export function getPuzzleMap(puzzles: readonly Puzzle[]): ReadonlyMap<string, Puzzle> {
  return new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));
}
