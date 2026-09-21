import { computePuzzleChecksum } from "./checksum.ts";
import {
  RING_COUNT,
  RING_IDS,
  RULESET_VERSION,
  SCHEMA_VERSION,
  SLOT_COUNT,
  type BoardState,
  type Difficulty,
  type HistoryAction,
  type HistoryFailureCode,
  type HistoryValidation,
  type MoveType,
  type Puzzle,
  type RingDefinition,
  type RingPart,
  type ValidationIssue,
} from "./types.ts";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
const MOVE_TYPES: readonly MoveType[] = ["l", "r"];
const PUZZLE_FIELDS = new Set([
  "schemaVersion",
  "rulesetVersion",
  "generatorVersion",
  "id",
  "difficulty",
  "slotCount",
  "rings",
  "targets",
  "initialState",
  "contentChecksum",
]);
const RING_FIELDS = new Set(["id", "parts"]);
const PART_FIELDS = new Set(["kind", "slot"]);
const STATE_FIELDS = new Set(["rotations"]);

export class CoreValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "CoreValidationError";
    this.issues = issues.length > 0 ? issues : [{ path: "$", message }];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(issues, `${path}.${key}`, "unknown field is not part of the public v2 format");
  }
}

function validatePart(value: unknown, path: string): value is RingPart {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    add(issues, path, "part must be an object");
  } else {
    rejectUnknownFields(value, PART_FIELDS, path, issues);
    if (value.kind !== "emitter" && value.kind !== "blocker") {
      add(issues, `${path}.kind`, "kind must be emitter or blocker");
    }
    if (!isIntegerInRange(value.slot, 0, SLOT_COUNT - 1)) {
      add(issues, `${path}.slot`, "slot must be an integer from 0 through 11");
    }
  }
  return issues.length === 0;
}

function validateRing(value: unknown, index: number): value is RingDefinition {
  const issues: ValidationIssue[] = [];
  const path = `$.rings[${index}]`;
  if (!isRecord(value)) {
    add(issues, path, "ring must be an object");
  } else {
    rejectUnknownFields(value, RING_FIELDS, path, issues);
    if (value.id !== RING_IDS[index]) add(issues, `${path}.id`, "ring id is out of order");
    if (!Array.isArray(value.parts)) {
      add(issues, `${path}.parts`, "parts must be an array");
    } else {
      if (value.parts.length > 4) add(issues, `${path}.parts`, "a ring has at most four parts");
      const slots = new Set<number>();
      for (let partIndex = 0; partIndex < value.parts.length; partIndex += 1) {
        const partPath = `${path}.parts[${partIndex}]`;
        if (!validatePart(value.parts[partIndex], partPath)) {
          add(issues, partPath, "invalid ring part");
          continue;
        }
        const part = value.parts[partIndex] as RingPart;
        if (slots.has(part.slot)) add(issues, `${partPath}.slot`, "duplicate part in one ring");
        slots.add(part.slot);
      }
    }
  }
  return issues.length === 0;
}

export function validatePuzzle(input: unknown): { ok: true; puzzle: Puzzle } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [...issues, { path: "$", message: "puzzle must be an object" }] };
  rejectUnknownFields(input, PUZZLE_FIELDS, "$", issues);

  if (input.schemaVersion !== SCHEMA_VERSION) add(issues, "$.schemaVersion", "schemaVersion must be 2");
  if (input.rulesetVersion !== RULESET_VERSION) add(issues, "$.rulesetVersion", "rulesetVersion must be stone-rings-v2");
  if (input.generatorVersion !== "generator-v2") add(issues, "$.generatorVersion", "generatorVersion must be generator-v2");
  if (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) {
    add(issues, "$.id", "id must use a lower-case identifier");
  }
  if (!DIFFICULTIES.includes(input.difficulty as Difficulty)) add(issues, "$.difficulty", "unknown difficulty");
  if (input.slotCount !== SLOT_COUNT) add(issues, "$.slotCount", "slotCount must be 12");

  if (!Array.isArray(input.rings) || input.rings.length !== RING_COUNT) {
    add(issues, "$.rings", "exactly three rings are required");
  } else {
    for (let index = 0; index < RING_COUNT; index += 1) {
      if (!validateRing(input.rings[index], index)) add(issues, `$.rings[${index}]`, "invalid ring definition");
    }
  }

  if (!Array.isArray(input.targets) || input.targets.length < 1) {
    add(issues, "$.targets", "at least one target is required");
  } else {
    const targets = new Set<number>();
    for (let index = 0; index < input.targets.length; index += 1) {
      const slot = input.targets[index];
      if (!isIntegerInRange(slot, 0, SLOT_COUNT - 1)) add(issues, `$.targets[${index}]`, "target must be an integer from 0 through 11");
      else if (targets.has(slot)) add(issues, `$.targets[${index}]`, "duplicate target");
      else targets.add(slot);
    }
  }

  const state = input.initialState;
  if (isRecord(state)) rejectUnknownFields(state, STATE_FIELDS, "$.initialState", issues);
  if (!isRecord(state) || !Array.isArray(state.rotations) || state.rotations.length !== RING_COUNT) {
    add(issues, "$.initialState.rotations", "three initial rotation values are required");
  } else {
    for (let index = 0; index < RING_COUNT; index += 1) {
      if (!isIntegerInRange(state.rotations[index], 0, SLOT_COUNT - 1)) {
        add(issues, `$.initialState.rotations[${index}]`, "rotation must be an integer from 0 through 11");
      }
    }
  }

  if (typeof input.contentChecksum !== "string" || !/^[0-9a-f]{16}$/.test(input.contentChecksum)) {
    add(issues, "$.contentChecksum", "contentChecksum must be 16 lower-case hexadecimal characters");
  }

  if (issues.length > 0) return { ok: false, issues };
  const puzzle = input as unknown as Puzzle;
  const emitterCount = puzzle.rings.reduce(
    (count, ring) => count + ring.parts.filter((part) => part.kind === "emitter").length,
    0,
  );
  if (emitterCount < 1) add(issues, "$.rings", "at least one emitter is required");
  if (puzzle.targets.length > emitterCount) add(issues, "$.targets", "targets cannot exceed the number of emitters");
  if (issues.length > 0) return { ok: false, issues };
  const expectedChecksum = computePuzzleChecksum(puzzle);
  if (puzzle.contentChecksum !== expectedChecksum) {
    add(issues, "$.contentChecksum", `checksum mismatch; expected ${expectedChecksum}`);
    return { ok: false, issues };
  }
  return { ok: true, puzzle };
}

export function assertValidPuzzle(input: unknown): Puzzle {
  const result = validatePuzzle(input);
  if (!result.ok) throw new CoreValidationError("invalid puzzle", result.issues);
  return result.puzzle;
}

export function validateBoardState(input: unknown): input is BoardState {
  if (!isRecord(input) || !Array.isArray(input.rotations) || input.rotations.length !== RING_COUNT) return false;
  if (Object.keys(input).some((key) => key !== "rotations")) return false;
  for (let index = 0; index < RING_COUNT; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input.rotations, index)) return false;
    if (!isIntegerInRange(input.rotations[index], 0, SLOT_COUNT - 1)) return false;
  }
  return true;
}

export function assertValidBoardState(input: unknown): BoardState {
  if (!validateBoardState(input)) throw new CoreValidationError("invalid board state");
  return input;
}

function failure(index: number, code: HistoryFailureCode, message: string): HistoryValidation {
  return { ok: false, index, code, message };
}

export function validateHistory(input: unknown, puzzle: Puzzle): HistoryValidation {
  if (!Array.isArray(input)) return failure(-1, "not-array", "history must be an array");
  const actions: HistoryAction[] = [];
  let previousTime = 0;
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!isRecord(value)) return failure(index, "missing-field", "history entry must be an object");
    const required = ["puzzleId", "rulesetVersion", "n", "t", "type", "ring"];
    if (required.some((key) => !hasOwn(value, key))) return failure(index, "missing-field", "history entry is missing a field");
    if (value.puzzleId !== puzzle.id) return failure(index, "wrong-puzzle", "history puzzle id does not match");
    if (value.rulesetVersion !== RULESET_VERSION) return failure(index, "wrong-ruleset", "history ruleset does not match");
    if (value.n !== index + 1) return failure(index, "bad-sequence", "history n must start at 1 and increase by one");
    if (!isIntegerInRange(value.t, 0, Number.MAX_SAFE_INTEGER)) return failure(index, "bad-time", "history t must be a non-negative integer");
    if (value.t < previousTime) return failure(index, "bad-time", "history t must be non-decreasing");
    if (!MOVE_TYPES.includes(value.type as MoveType)) return failure(index, "bad-type", "history type must be l or r");
    if (!isIntegerInRange(value.ring, 0, RING_COUNT - 1)) return failure(index, "bad-ring", "history ring must be an integer from 0 through 2");
    const action: HistoryAction = {
      puzzleId: puzzle.id,
      rulesetVersion: RULESET_VERSION,
      n: value.n as number,
      t: value.t as number,
      type: value.type as MoveType,
      ring: value.ring as number,
    };
    actions.push(action);
    previousTime = action.t;
  }
  return { ok: true, actions };
}

export function assertValidHistory(input: unknown, puzzle: Puzzle): HistoryAction[] {
  const result = validateHistory(input, puzzle);
  if (!result.ok) throw new CoreValidationError(result.message, [{ path: `$[${result.index}]`, message: result.message }]);
  return result.actions;
}

export function clonePuzzle(puzzle: Puzzle): Puzzle {
  return {
    ...puzzle,
    rings: puzzle.rings.map((ring) => ({ ...ring, parts: ring.parts.map((part) => ({ ...part })) })) as Puzzle["rings"],
    targets: [...puzzle.targets],
    initialState: { rotations: [...puzzle.initialState.rotations] as BoardState["rotations"] },
  };
}
