import type { Difficulty } from "../core/types.ts";

/** The version of the R2 generation inputs recorded in the reports. */
export const R2_CONFIG_VERSION = "r2-config-v1" as const;
export const R2_GENERATOR_SEED = 20260919 as const;
export const R2_CANDIDATES_PER_DIFFICULTY = 300 as const;
export const R2_ADOPTED_PER_DIFFICULTY = 30 as const;
export const R2_MAX_ATTEMPTS_PER_DIFFICULTY = 15_000 as const;

export type DifficultyBand = {
  difficulty: Difficulty;
  minMoves: number;
  maxMoves: number;
  minTargets: number;
  maxTargets: number;
  minEmitters: number;
  maxEmitters: number;
  minBlockers: number;
  maxBlockers: number;
  minOperatedRings: number;
  maxShortestGoalStates: number;
};

/**
 * Initial numeric proposal from implementation plan v2.0 §4.2.  These
 * values are persisted before generation and are not widened after seeing
 * generated data.
 */
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = Object.freeze([
  Object.freeze({
    difficulty: "easy",
    minMoves: 4,
    maxMoves: 6,
    minTargets: 2,
    maxTargets: 3,
    minEmitters: 3,
    maxEmitters: 4,
    minBlockers: 2,
    maxBlockers: 3,
    minOperatedRings: 2,
    maxShortestGoalStates: 4,
  }),
  Object.freeze({
    difficulty: "normal",
    minMoves: 7,
    maxMoves: 10,
    minTargets: 3,
    maxTargets: 4,
    minEmitters: 4,
    maxEmitters: 5,
    minBlockers: 3,
    maxBlockers: 4,
    minOperatedRings: 3,
    maxShortestGoalStates: 3,
  }),
  Object.freeze({
    difficulty: "hard",
    minMoves: 11,
    maxMoves: 15,
    minTargets: 4,
    maxTargets: 5,
    minEmitters: 5,
    maxEmitters: 6,
    minBlockers: 4,
    maxBlockers: 5,
    minOperatedRings: 3,
    maxShortestGoalStates: 2,
  }),
]);

export const R2_RUN_ORDER: readonly Difficulty[] = Object.freeze([
  "easy",
  "easy",
  "normal",
  "normal",
  "hard",
]);

/** Initial calibration proposal from implementation plan v2.0 §4.3. */
export const CALIBRATION_FORMULA = "100*shortestMoves + 40*minOperatedRingCount + 25*max(0,4-shortestGoalStateCount)" as const;
export const COMBINATION_TOLERANCE = 0.1 as const;
export const DRAW_TICKET_COUNT = 900 as const;
export const DRAW_SAMPLE_COUNT = 100_000 as const;

export function difficultyBand(difficulty: Difficulty): DifficultyBand {
  const band = DIFFICULTY_BANDS.find((candidate) => candidate.difficulty === difficulty);
  if (!band) throw new Error(`unknown difficulty ${difficulty}`);
  return band;
}
