import { evaluate } from "../src/core/engine.ts";
import {
  RING_COUNT,
  SLOT_COUNT,
  STATE_SPACE,
  type BeamPhase,
  type BeamTrace,
  type BoardState,
  type LightResult,
  type Puzzle,
  type ValidationIssue,
} from "../src/core/types.ts";
import { CoreValidationError, validatePuzzle } from "../src/core/validation.ts";
import { analyzePuzzle, enumerateFastLitMasks } from "../src/puzzles/solver.ts";

const MAX_MISMATCH_EXAMPLES = 20;

type AxisPart = {
  ring: number;
  slot: number;
  kind: "emitter" | "blocker";
};

type IndependentBeam = Pick<
  BeamTrace,
  | "sourceRing"
  | "sourceSlot"
  | "oppositeSlot"
  | "reachedRim"
  | "blockedRing"
  | "blockedSlot"
  | "phase"
>;

type IndependentLight = Pick<
  LightResult,
  "litMask" | "litSlots" | "solved" | "litRequired" | "requiredCount"
> & {
  beams: IndependentBeam[];
};

export type IndependentLightMismatch = {
  puzzleId: string;
  stateOrdinal: number;
  rotations: BoardState["rotations"];
  difference: string;
};

export type IndependentLightVerification = {
  puzzleCount: number;
  statesPerPuzzle: typeof STATE_SPACE;
  comparisonCount: number;
  beamComparisonCount: number;
  fastMaskComparisonCount: number;
  mismatchCount: number;
  coreMismatchCount: number;
  fastMaskMismatchCount: number;
  mismatchExamples: IndependentLightMismatch[];
};

export type IndependentSolutionMismatch = {
  puzzleId: string;
  difference: string;
};

export type IndependentSolutionVerification = {
  puzzleCount: number;
  stateComparisonCount: number;
  mismatchCount: number;
  mismatchExamples: IndependentSolutionMismatch[];
};

function mod(value: number): number {
  return ((value % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
}

function positionParts(puzzle: Puzzle, state: BoardState): AxisPart[] {
  return puzzle.rings.flatMap((ring, ringIndex) =>
    ring.parts.map((part) => ({
      ring: ringIndex,
      slot: mod(part.slot + state.rotations[ringIndex]),
      kind: part.kind,
    })),
  );
}

/**
 * Treat the diameter through an emitter as one signed axis. The source side
 * has radii -3..-1 and the opposite side +1..+3. Starting at the emitter's
 * coordinate, the occupied coordinate with the smallest greater value is the
 * first blocker. This is deliberately different from the core's inward and
 * outward ring loops.
 */
function independentLight(puzzle: Puzzle, state: BoardState): IndependentLight {
  const parts = positionParts(puzzle, state);
  const beams: IndependentBeam[] = [];
  let litMask = 0;

  for (const source of parts) {
    if (source.kind !== "emitter") continue;

    const opposite = mod(source.slot + SLOT_COUNT / 2);
    const sourceCoordinate = -(source.ring + 1);
    let firstBlocker: { coordinate: number; part: AxisPart } | undefined;

    for (const part of parts) {
      let coordinate: number | undefined;
      if (part.slot === source.slot) coordinate = -(part.ring + 1);
      if (part.slot === opposite) coordinate = part.ring + 1;
      if (coordinate === undefined || coordinate <= sourceCoordinate) continue;
      if (firstBlocker === undefined || coordinate < firstBlocker.coordinate) {
        firstBlocker = { coordinate, part };
      }
    }

    if (firstBlocker === undefined) {
      beams.push({
        sourceRing: source.ring,
        sourceSlot: source.slot,
        oppositeSlot: opposite,
        reachedRim: true,
        blockedRing: null,
        blockedSlot: null,
        phase: "clear",
      });
      litMask |= 1 << opposite;
      continue;
    }

    const phase: BeamPhase = firstBlocker.coordinate < 0 ? "in" : "out";
    beams.push({
      sourceRing: source.ring,
      sourceSlot: source.slot,
      oppositeSlot: opposite,
      reachedRim: false,
      blockedRing: firstBlocker.part.ring,
      blockedSlot: phase === "in" ? source.slot : opposite,
      phase,
    });
  }

  const litSlots = Array.from({ length: SLOT_COUNT }, (_, slot) => slot).filter(
    (slot) => (litMask & (1 << slot)) !== 0,
  );
  const targetMask = puzzle.targets.reduce((mask, slot) => mask | (1 << slot), 0);
  return {
    litMask,
    litSlots,
    beams,
    solved: (litMask & targetMask) === targetMask,
    litRequired: puzzle.targets.filter((slot) => (litMask & (1 << slot)) !== 0).length,
    requiredCount: puzzle.targets.length,
  };
}

function validateAllBeforeComparison(puzzles: Puzzle[]): Puzzle[] {
  if (!Array.isArray(puzzles)) {
    throw new CoreValidationError("independent light input must be a Puzzle array");
  }

  const issues: ValidationIssue[] = [];
  const checked: Puzzle[] = [];
  for (let index = 0; index < puzzles.length; index += 1) {
    const result = validatePuzzle(puzzles[index]);
    if (result.ok) {
      checked.push(result.puzzle);
      continue;
    }
    for (const issue of result.issues) {
      issues.push({
        path: `$[${index}]${issue.path === "$" ? "" : issue.path.slice(1)}`,
        message: issue.message,
      });
    }
  }
  if (issues.length > 0) throw new CoreValidationError("invalid puzzle array", issues);
  return checked;
}

function firstDifference(expected: IndependentLight, actual: LightResult): string | undefined {
  const scalarKeys = ["litMask", "solved", "litRequired", "requiredCount"] as const;
  for (const key of scalarKeys) {
    if (expected[key] !== actual[key]) return `${key}: expected ${expected[key]}, actual ${actual[key]}`;
  }
  if (expected.litSlots.join(",") !== actual.litSlots.join(",")) {
    return `litSlots: expected [${expected.litSlots}], actual [${actual.litSlots}]`;
  }
  if (expected.beams.length !== actual.beams.length) {
    return `beam count: expected ${expected.beams.length}, actual ${actual.beams.length}`;
  }

  const beamKeys = [
    "sourceRing",
    "sourceSlot",
    "oppositeSlot",
    "reachedRim",
    "blockedRing",
    "blockedSlot",
    "phase",
  ] as const;
  for (let beamIndex = 0; beamIndex < expected.beams.length; beamIndex += 1) {
    const expectedBeam = expected.beams[beamIndex];
    const actualBeam = actual.beams[beamIndex];
    for (const key of beamKeys) {
      if (expectedBeam[key] !== actualBeam[key]) {
        return `beam ${beamIndex} ${key}: expected ${String(expectedBeam[key])}, actual ${String(actualBeam[key])}`;
      }
    }
  }
  return undefined;
}

export function verifyIndependentLight(puzzles: Puzzle[]): IndependentLightVerification {
  const checked = validateAllBeforeComparison(puzzles);
  let comparisonCount = 0;
  let beamComparisonCount = 0;
  let fastMaskComparisonCount = 0;
  let mismatchCount = 0;
  let coreMismatchCount = 0;
  let fastMaskMismatchCount = 0;
  const mismatchExamples: IndependentLightMismatch[] = [];

  for (const puzzle of checked) {
    const fastMasks = enumerateFastLitMasks(puzzle);
    let stateOrdinal = 0;
    for (let inner = 0; inner < SLOT_COUNT; inner += 1) {
      for (let middle = 0; middle < SLOT_COUNT; middle += 1) {
        for (let outer = 0; outer < SLOT_COUNT; outer += 1) {
          const rotations: BoardState["rotations"] = [inner, middle, outer];
          const state: BoardState = { rotations };
          const expected = independentLight(puzzle, state);
          const actual = evaluate(puzzle, state);
          comparisonCount += 1;
          beamComparisonCount += expected.beams.length;
          fastMaskComparisonCount += 1;

          const differences: string[] = [];
          const coreDifference = firstDifference(expected, actual);
          if (coreDifference !== undefined) {
            coreMismatchCount += 1;
            differences.push(`core ${coreDifference}`);
          }
          const fastMask = fastMasks[stateOrdinal];
          if (fastMask !== expected.litMask) {
            fastMaskMismatchCount += 1;
            differences.push(`fast litMask: expected ${expected.litMask}, actual ${String(fastMask)}`);
          }
          if (differences.length > 0) {
            mismatchCount += 1;
            if (mismatchExamples.length < MAX_MISMATCH_EXAMPLES) {
              mismatchExamples.push({
                puzzleId: puzzle.id,
                stateOrdinal,
                rotations,
                difference: differences.join("; "),
              });
            }
          }
          stateOrdinal += 1;
        }
      }
    }
  }

  return {
    puzzleCount: checked.length,
    statesPerPuzzle: STATE_SPACE,
    comparisonCount,
    beamComparisonCount,
    fastMaskComparisonCount,
    mismatchCount,
    coreMismatchCount,
    fastMaskMismatchCount,
    mismatchExamples,
  };
}

function factorial(value: number): bigint {
  let result = 1n;
  for (let factor = 2; factor <= value; factor += 1) result *= BigInt(factor);
  return result;
}

function pathCountToState(distances: readonly number[]): bigint {
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  let count = factorial(total);
  for (const distance of distances) count /= factorial(distance);
  for (const distance of distances) {
    if (distance === SLOT_COUNT / 2) count *= 2n;
  }
  return count;
}

/**
 * Independently checks the BFS metrics by treating the 1,728 states as a
 * three-dimensional torus. A goal's distance is the sum of the three circular
 * distances. Its shortest operation sequences are a multinomial interleaving,
 * with two direction choices for every ring exactly half a turn away.
 */
export function verifyIndependentSolutions(puzzles: Puzzle[]): IndependentSolutionVerification {
  const checked = validateAllBeforeComparison(puzzles);
  let stateComparisonCount = 0;
  let mismatchCount = 0;
  const mismatchExamples: IndependentSolutionMismatch[] = [];

  for (const puzzle of checked) {
    let shortestMoves: number | null = null;
    let shortestGoalStateCount = 0;
    let shortestPathCount = 0n;
    let minOperatedRingCount: number = RING_COUNT;
    let requiredRingMask = (1 << RING_COUNT) - 1;
    const independentMasks = new Uint16Array(STATE_SPACE);
    let stateOrdinal = 0;

    for (let inner = 0; inner < SLOT_COUNT; inner += 1) {
      for (let middle = 0; middle < SLOT_COUNT; middle += 1) {
        for (let outer = 0; outer < SLOT_COUNT; outer += 1) {
          const rotations: BoardState["rotations"] = [inner, middle, outer];
          const state: BoardState = { rotations };
          stateComparisonCount += 1;
          const light = independentLight(puzzle, state);
          independentMasks[stateOrdinal] = light.litMask;
          stateOrdinal += 1;
          if (!light.solved) continue;

          const distances = rotations.map((rotation, ring) => {
            const clockwise = mod(rotation - puzzle.initialState.rotations[ring]);
            return Math.min(clockwise, SLOT_COUNT - clockwise);
          });
          const distance = distances.reduce((sum, value) => sum + value, 0);
          const operatedRingMask = distances.reduce(
            (mask, value, ring) => mask | (value === 0 ? 0 : 1 << ring),
            0,
          );

          if (shortestMoves === null || distance < shortestMoves) {
            shortestMoves = distance;
            shortestGoalStateCount = 1;
            shortestPathCount = pathCountToState(distances);
            minOperatedRingCount = distances.filter((value) => value !== 0).length;
            requiredRingMask = operatedRingMask;
          } else if (distance === shortestMoves) {
            shortestGoalStateCount += 1;
            shortestPathCount += pathCountToState(distances);
            minOperatedRingCount = Math.min(
              minOperatedRingCount,
              distances.filter((value) => value !== 0).length,
            );
            requiredRingMask &= operatedRingMask;
          }
        }
      }
    }

    const expectedEffectiveRings: number[] = [];
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      let effective = false;
      for (let inner = 0; inner < SLOT_COUNT && !effective; inner += 1) {
        for (let middle = 0; middle < SLOT_COUNT && !effective; middle += 1) {
          for (let outer = 0; outer < SLOT_COUNT && !effective; outer += 1) {
            const rotations = [inner, middle, outer];
            const shifted = [...rotations];
            shifted[ring] = mod(shifted[ring] + 1);
            const code = (rotations[0] * SLOT_COUNT + rotations[1]) * SLOT_COUNT + rotations[2];
            const shiftedCode = (shifted[0] * SLOT_COUNT + shifted[1]) * SLOT_COUNT + shifted[2];
            effective = independentMasks[code] !== independentMasks[shiftedCode];
          }
        }
      }
      if (effective) expectedEffectiveRings.push(ring);
    }

    const expectedRequiredRings = Array.from({ length: RING_COUNT }, (_, ring) => ring).filter(
      (ring) => (requiredRingMask & (1 << ring)) !== 0,
    );
    const expected = {
      shortestMoves,
      shortestGoalStateCount,
      shortestPathCount: shortestPathCount.toString(10),
      minOperatedRingCount: shortestMoves === null ? 0 : minOperatedRingCount,
      requiredRingIndexes: shortestMoves === null ? [] : expectedRequiredRings,
      effectiveRingIndexes: expectedEffectiveRings,
      truncated: false,
    };
    const actual = analyzePuzzle(puzzle);
    const differences: string[] = [];
    const scalarKeys = [
      "shortestMoves",
      "shortestGoalStateCount",
      "shortestPathCount",
      "minOperatedRingCount",
      "truncated",
    ] as const;
    for (const key of scalarKeys) {
      if (expected[key] !== actual[key]) {
        differences.push(`${key}: expected ${String(expected[key])}, actual ${String(actual[key])}`);
      }
    }
    if (expected.requiredRingIndexes.join(",") !== actual.requiredRingIndexes.join(",")) {
      differences.push(
        `requiredRingIndexes: expected [${expected.requiredRingIndexes}], actual [${actual.requiredRingIndexes}]`,
      );
    }
    if (expected.effectiveRingIndexes.join(",") !== actual.effectiveRingIndexes.join(",")) {
      differences.push(
        `effectiveRingIndexes: expected [${expected.effectiveRingIndexes}], actual [${actual.effectiveRingIndexes}]`,
      );
    }
    if (differences.length > 0) {
      mismatchCount += 1;
      if (mismatchExamples.length < MAX_MISMATCH_EXAMPLES) {
        mismatchExamples.push({ puzzleId: puzzle.id, difference: differences.join("; ") });
      }
    }
  }

  return {
    puzzleCount: checked.length,
    stateComparisonCount,
    mismatchCount,
    mismatchExamples,
  };
}
