import {
  computePuzzleChecksum,
  validatePuzzle,
  type Puzzle,
  type ValidationIssue,
  GENERATOR_VERSION,
  POOL_VERSION,
  RULESET_VERSION,
  SCHEMA_VERSION,
} from "../core/index.ts";
import { canonicalShapeKey } from "./normalization.ts";

export const R2_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export const R2_RUN_ORDER = ["easy", "easy", "normal", "normal", "hard"] as const;
export const R2_PUZZLE_COUNT = 90 as const;
export const R2_TICKET_COUNT = 900 as const;
export const R2_PER_DIFFICULTY = 30 as const;
export const R2_EASY_APPEARANCES = 60 as const;
export const R2_NORMAL_APPEARANCES = 60 as const;
export const R2_HARD_APPEARANCES = 30 as const;

export type DifficultyIds = Record<(typeof R2_DIFFICULTIES)[number], string[]>;
export type Ticket = [string, string, string, string, string];

export type DrawProfile = {
  order: [...typeof R2_RUN_ORDER];
  ticketCount: typeof R2_TICKET_COUNT;
  easyAppearancesPerPuzzle: typeof R2_EASY_APPEARANCES;
  normalAppearancesPerPuzzle: typeof R2_NORMAL_APPEARANCES;
  hardAppearancesPerPuzzle: typeof R2_HARD_APPEARANCES;
};

export type PoolManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  poolVersion: typeof POOL_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  generatorVersion: typeof GENERATOR_VERSION;
  puzzleCount: typeof R2_PUZZLE_COUNT;
  puzzleChecksum: string;
  puzzleIdsByDifficulty: {
    easy: string[];
    normal: string[];
    hard: string[];
  };
  drawProfile: DrawProfile;
  poolChecksum: string;
};

export type TicketManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  poolVersion: typeof POOL_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  generatorVersion: typeof GENERATOR_VERSION;
  poolChecksum: string;
  ticketCount: typeof R2_TICKET_COUNT;
  tickets: Ticket[];
  calibrationVersion: string;
  calibrationChecksum: string;
  ticketChecksum: string;
};

export type RangeThreshold = {
  baseline: number;
  tolerance: 0.1;
  min: number;
  max: number;
};

export type TicketCalibration = {
  schemaVersion: typeof SCHEMA_VERSION;
  calibrationVersion: "r2-calibration-v1";
  poolVersion: typeof POOL_VERSION;
  puzzleChecksum: string;
  metric: "calibrationScore";
  means: { easy: number; normal: number; hard: number };
  thresholds: {
    easyPair: RangeThreshold;
    normalPair: RangeThreshold;
    hardSingle: RangeThreshold;
    overall: RangeThreshold;
  };
  generatedBeforeTickets: true;
};

export type ArtifactValidation =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): ValidationIssue[] {
  const allowed = new Set(keys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => issue(`$.${key}`, "unknown field"));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inFixedRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** Stable object serialization for collection and artifact checksums. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeArtifactChecksum(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function copyWithout<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) if (name !== key) copy[name] = entry;
  return copy;
}

export function computePuzzleCollectionChecksum(puzzles: readonly Puzzle[]): string {
  return computeArtifactChecksum(puzzles);
}

export function computePoolChecksum(pool: PoolManifest): string {
  return computeArtifactChecksum(copyWithout(pool as unknown as Record<string, unknown>, "poolChecksum"));
}

export function computeTicketChecksum(tickets: TicketManifest): string {
  return computeArtifactChecksum(copyWithout(tickets as unknown as Record<string, unknown>, "ticketChecksum"));
}

function modSlot(slot: number): number {
  return ((slot % 12) + 12) % 12;
}

/**
 * Rotation/reflection invariant key for the physical board. Initial rotations
 * are folded into world positions so changing only the starting angle is
 * rejected as a near duplicate.
 */
export function normalizedPuzzleKey(puzzle: Puzzle): string {
  const worldRings = puzzle.rings.map((ring, ringIndex) =>
    ring.parts
      .map((part) => ({ kind: part.kind, slot: modSlot(part.slot + puzzle.initialState.rotations[ringIndex]) }))
      .sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind)),
  );
  const targetSlots = [...puzzle.targets].sort((left, right) => left - right);
  const forms: string[] = [];
  for (const reflected of [false, true]) {
    for (let shift = 0; shift < 12; shift += 1) {
      const rings = worldRings.map((parts) =>
        parts
          .map((part) => ({
            kind: part.kind,
            slot: modSlot((reflected ? -part.slot : part.slot) + shift),
          }))
          .sort((left, right) => left.slot - right.slot || left.kind.localeCompare(right.kind)),
      );
      const targets = targetSlots
        .map((slot) => modSlot((reflected ? -slot : slot) + shift))
        .sort((left, right) => left - right);
      forms.push(JSON.stringify({ rings, targets }));
    }
  }
  return forms.sort()[0] ?? "";
}

export type PuzzleCollectionValidation = ArtifactValidation & {
  puzzles?: Puzzle[];
  idsByDifficulty?: DifficultyIds;
  normalizedKeys?: string[];
};

export function validatePuzzleCollection(
  input: unknown,
  expectedIds?: DifficultyIds,
): PuzzleCollectionValidation {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(input)) return { ok: false, issues: [issue("$", "puzzles must be an array")] };
  if (input.length !== R2_PUZZLE_COUNT) issues.push(issue("$", "exactly 90 puzzles are required"));
  const puzzles: Puzzle[] = [];
  const ids = new Set<string>();
  const normalized = new Set<string>();
  const shapes = new Set<string>();
  const idsByDifficulty: DifficultyIds = { easy: [], normal: [], hard: [] };
  for (let index = 0; index < input.length; index += 1) {
    const checked = validatePuzzle(input[index]);
    if (!checked.ok) {
      issues.push(...checked.issues.map((entry) => issue(`$[${index}]${entry.path.slice(1)}`, entry.message)));
      continue;
    }
    const puzzle = checked.puzzle;
    if (ids.has(puzzle.id)) issues.push(issue(`$[${index}].id`, "duplicate puzzle id"));
    ids.add(puzzle.id);
    idsByDifficulty[puzzle.difficulty].push(puzzle.id);
    const key = normalizedPuzzleKey(puzzle);
    if (normalized.has(key)) issues.push(issue(`$[${index}]`, "rotation/reflection duplicate puzzle"));
    normalized.add(key);
    const shapeKey = canonicalShapeKey(puzzle);
    if (shapes.has(shapeKey)) issues.push(issue(`$[${index}]`, "same-shape duplicate puzzle (initial-angle-only water filling is not allowed)"));
    shapes.add(shapeKey);
    puzzles.push(puzzle);
  }
  for (const difficulty of R2_DIFFICULTIES) {
    if (idsByDifficulty[difficulty].length !== R2_PER_DIFFICULTY) {
      issues.push(issue(`$.difficulty.${difficulty}`, "each difficulty must contain exactly 30 puzzles"));
    }
    if (expectedIds) {
      const actual = [...idsByDifficulty[difficulty]].sort();
      const expected = [...expectedIds[difficulty]].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        issues.push(issue(`$.difficulty.${difficulty}`, "puzzle IDs changed from the expected pool"));
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    puzzles,
    idsByDifficulty,
    normalizedKeys: [...normalized],
  };
}

function expectedDrawProfile(value: unknown): value is DrawProfile {
  if (!isRecord(value)) return false;
  return (
    JSON.stringify(value.order) === JSON.stringify(R2_RUN_ORDER) &&
    value.ticketCount === R2_TICKET_COUNT &&
    value.easyAppearancesPerPuzzle === R2_EASY_APPEARANCES &&
    value.normalAppearancesPerPuzzle === R2_NORMAL_APPEARANCES &&
    value.hardAppearancesPerPuzzle === R2_HARD_APPEARANCES
  );
}

export function validatePoolArtifact(input: unknown, puzzles: readonly Puzzle[]): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [issue("$", "pool must be an object")] };
  issues.push(...hasOnlyKeys(input, [
    "schemaVersion",
    "poolVersion",
    "rulesetVersion",
    "generatorVersion",
    "puzzleCount",
    "puzzleChecksum",
    "puzzleIdsByDifficulty",
    "drawProfile",
    "poolChecksum",
  ]));
  if (input.schemaVersion !== SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "old or unknown schema version"));
  if (input.poolVersion !== POOL_VERSION) issues.push(issue("$.poolVersion", "old or unknown pool version"));
  if (input.rulesetVersion !== RULESET_VERSION) issues.push(issue("$.rulesetVersion", "old or unknown ruleset"));
  if (input.generatorVersion !== GENERATOR_VERSION) issues.push(issue("$.generatorVersion", "old or unknown generator"));
  if (input.puzzleCount !== R2_PUZZLE_COUNT) issues.push(issue("$.puzzleCount", "puzzleCount must be 90"));
  const checkedPuzzles = validatePuzzleCollection(puzzles);
  if (!checkedPuzzles.ok) issues.push(...checkedPuzzles.issues.map((entry) => issue(`$.puzzles${entry.path.slice(1)}`, entry.message)));
  if (typeof input.puzzleChecksum !== "string" || input.puzzleChecksum !== computePuzzleCollectionChecksum(puzzles)) {
    issues.push(issue("$.puzzleChecksum", "puzzle collection checksum mismatch"));
  }
  const idsByDifficulty = input.puzzleIdsByDifficulty;
  if (!isRecord(idsByDifficulty)) {
    issues.push(issue("$.puzzleIdsByDifficulty", "difficulty ID lists are required"));
  } else {
    issues.push(...hasOnlyKeys(idsByDifficulty, R2_DIFFICULTIES.map((difficulty) => difficulty)));
    for (const difficulty of R2_DIFFICULTIES) {
      const value = idsByDifficulty[difficulty];
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
        issues.push(issue(`$.puzzleIdsByDifficulty.${difficulty}`, "must be a string array"));
      } else {
        const expected = checkedPuzzles.ok ? checkedPuzzles.idsByDifficulty?.[difficulty] ?? [] : [];
        if (JSON.stringify([...value].sort()) !== JSON.stringify([...expected].sort())) {
          issues.push(issue(`$.puzzleIdsByDifficulty.${difficulty}`, "IDs do not match puzzle definitions"));
        }
      }
    }
  }
  if (isRecord(input.drawProfile)) {
    issues.push(...hasOnlyKeys(input.drawProfile, [
      "order",
      "ticketCount",
      "easyAppearancesPerPuzzle",
      "normalAppearancesPerPuzzle",
      "hardAppearancesPerPuzzle",
    ]));
  }
  if (!expectedDrawProfile(input.drawProfile)) issues.push(issue("$.drawProfile", "draw profile does not match R2"));
  if (typeof input.poolChecksum !== "string" || input.poolChecksum !== computePoolChecksum(input as unknown as PoolManifest)) {
    issues.push(issue("$.poolChecksum", "pool checksum mismatch"));
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function asTicket(value: unknown): value is Ticket {
  return Array.isArray(value) && value.length === 5 && value.every((entry) => typeof entry === "string");
}

export function normalizedTicketKey(ticket: Ticket): string {
  return JSON.stringify({
    easy: [...ticket.slice(0, 2)].sort(),
    normal: [...ticket.slice(2, 4)].sort(),
    hard: ticket[4],
  });
}

export type TicketValidationOptions = {
  puzzles: readonly Puzzle[];
  pool: PoolManifest;
  calibration?: TicketCalibration;
  scoreById?: ReadonlyMap<string, number>;
};

export function validateTicketsArtifact(input: unknown, options: TicketValidationOptions): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [issue("$", "tickets must be an object")] };
  issues.push(...hasOnlyKeys(input, [
    "schemaVersion",
    "poolVersion",
    "rulesetVersion",
    "generatorVersion",
    "poolChecksum",
    "ticketCount",
    "tickets",
    "calibrationVersion",
    "calibrationChecksum",
    "ticketChecksum",
  ]));
  if (input.schemaVersion !== SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "old or unknown schema version"));
  if (input.poolVersion !== POOL_VERSION) issues.push(issue("$.poolVersion", "old or unknown pool version"));
  if (input.rulesetVersion !== RULESET_VERSION) issues.push(issue("$.rulesetVersion", "old or unknown ruleset"));
  if (input.generatorVersion !== GENERATOR_VERSION) issues.push(issue("$.generatorVersion", "old or unknown generator"));
  if (input.poolChecksum !== options.pool.poolChecksum) issues.push(issue("$.poolChecksum", "ticket pool checksum mismatch"));
  if (input.ticketCount !== R2_TICKET_COUNT) issues.push(issue("$.ticketCount", "ticketCount must be 900"));
  if (typeof input.calibrationVersion !== "string" || input.calibrationVersion !== "r2-calibration-v1") {
    issues.push(issue("$.calibrationVersion", "calibration version is missing or old"));
  }
  if (options.calibration && input.calibrationChecksum !== computeArtifactChecksum(options.calibration)) {
    issues.push(issue("$.calibrationChecksum", "calibration checksum mismatch"));
  }
  if (options.calibration && options.calibration.puzzleChecksum !== options.pool.puzzleChecksum) {
    issues.push(issue("$.calibrationChecksum", "calibration belongs to a different puzzle pool"));
  }
  if (!Array.isArray(input.tickets) || input.tickets.length !== R2_TICKET_COUNT) {
    issues.push(issue("$.tickets", "exactly 900 tickets are required"));
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
  const puzzleById = new Map(options.puzzles.map((puzzle) => [puzzle.id, puzzle]));
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (let index = 0; index < input.tickets.length; index += 1) {
    const value = input.tickets[index];
    if (!asTicket(value)) {
      issues.push(issue(`$.tickets[${index}]`, "ticket must contain exactly five IDs"));
      continue;
    }
    const key = normalizedTicketKey(value);
    if (seen.has(key)) issues.push(issue(`$.tickets[${index}]`, "duplicate ticket after same-difficulty order normalization"));
    seen.add(key);
    for (const id of value) counts.set(id, (counts.get(id) ?? 0) + 1);
    const expected = [...R2_RUN_ORDER];
    for (let slot = 0; slot < expected.length; slot += 1) {
      const puzzle = puzzleById.get(value[slot]);
      if (!puzzle) {
        issues.push(issue(`$.tickets[${index}][${slot}]`, "unknown puzzle ID"));
      } else if (puzzle.difficulty !== expected[slot]) {
        issues.push(issue(`$.tickets[${index}][${slot}]`, "ticket difficulty order must be easy,easy,normal,normal,hard"));
      }
    }
    if (new Set(value).size !== value.length) issues.push(issue(`$.tickets[${index}]`, "ticket IDs must be unique"));
    if (options.calibration && options.scoreById) {
      const easyPair = (options.scoreById.get(value[0]) ?? Number.NaN) + (options.scoreById.get(value[1]) ?? Number.NaN);
      const normalPair = (options.scoreById.get(value[2]) ?? Number.NaN) + (options.scoreById.get(value[3]) ?? Number.NaN);
      const hardSingle = options.scoreById.get(value[4]) ?? Number.NaN;
      const overall = easyPair + normalPair + hardSingle;
      if (!inFixedRange(easyPair, options.calibration.thresholds.easyPair)) issues.push(issue(`$.tickets[${index}]`, "easy pair is outside saved ±10% range"));
      if (!inFixedRange(normalPair, options.calibration.thresholds.normalPair)) issues.push(issue(`$.tickets[${index}]`, "normal pair is outside saved ±10% range"));
      if (!inFixedRange(hardSingle, options.calibration.thresholds.hardSingle)) issues.push(issue(`$.tickets[${index}]`, "hard score is outside saved ±10% range"));
      if (!inFixedRange(overall, options.calibration.thresholds.overall)) issues.push(issue(`$.tickets[${index}]`, "overall score is outside saved ±10% range"));
    }
  }
  const expectedCounts = new Map<string, number>();
  for (const puzzle of options.puzzles) {
    expectedCounts.set(
      puzzle.id,
      puzzle.difficulty === "hard" ? R2_HARD_APPEARANCES : R2_EASY_APPEARANCES,
    );
  }
  for (const [id, expected] of expectedCounts) {
    if ((counts.get(id) ?? 0) !== expected) issues.push(issue("$.tickets", `${id} must occur ${expected} times`));
  }
  if (typeof input.ticketChecksum !== "string" || input.ticketChecksum !== computeTicketChecksum(input as unknown as TicketManifest)) {
    issues.push(issue("$.ticketChecksum", "ticket checksum mismatch"));
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function validateCalibration(input: unknown): { ok: true; calibration: TicketCalibration } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [issue("$", "calibration must be an object")] };
  issues.push(...hasOnlyKeys(input, [
    "schemaVersion",
    "calibrationVersion",
    "poolVersion",
    "puzzleChecksum",
    "metric",
    "means",
    "thresholds",
    "generatedBeforeTickets",
  ]));
  if (input.schemaVersion !== SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "schemaVersion must be 2"));
  if (input.calibrationVersion !== "r2-calibration-v1") issues.push(issue("$.calibrationVersion", "unknown calibration version"));
  if (input.poolVersion !== POOL_VERSION) issues.push(issue("$.poolVersion", "poolVersion must be pool-v2"));
  if (typeof input.puzzleChecksum !== "string") issues.push(issue("$.puzzleChecksum", "puzzle checksum is required"));
  if (input.metric !== "calibrationScore") issues.push(issue("$.metric", "calibration metric must be calibrationScore"));
  const means = input.means;
  if (!isRecord(means)) {
    issues.push(issue("$.means", "finite easy/normal/hard means are required"));
  } else {
    issues.push(...hasOnlyKeys(means, R2_DIFFICULTIES));
    if (!R2_DIFFICULTIES.every((difficulty) => isFiniteNumber(means[difficulty]))) {
      issues.push(issue("$.means", "finite easy/normal/hard means are required"));
    }
  }
  const thresholds = input.thresholds;
  if (!isRecord(thresholds)) {
    issues.push(issue("$.thresholds", "thresholds are required before ticket generation"));
  } else {
    issues.push(...hasOnlyKeys(thresholds, ["easyPair", "normalPair", "hardSingle", "overall"]));
    for (const name of ["easyPair", "normalPair", "hardSingle", "overall"] as const) {
      const value = thresholds[name];
      if (!isRecord(value)) {
        issues.push(issue(`$.thresholds.${name}`, "baseline, min, max and tolerance 0.1 are required"));
      } else if (value.tolerance !== 0.1 || !isFiniteNumber(value.baseline) || !isFiniteNumber(value.min) || !isFiniteNumber(value.max)) {
        issues.push(issue(`$.thresholds.${name}`, "baseline, min, max and tolerance 0.1 are required"));
      } else {
        issues.push(...hasOnlyKeys(value, ["baseline", "tolerance", "min", "max"]));
        if (value.min !== value.baseline * 0.9 || value.max !== value.baseline * 1.1) {
          issues.push(issue(`$.thresholds.${name}`, "threshold must be computed from baseline ±10%"));
        }
      }
    }
  }
  if (input.generatedBeforeTickets !== true) issues.push(issue("$.generatedBeforeTickets", "calibration must be saved before tickets"));
  return issues.length === 0 ? { ok: true, calibration: input as unknown as TicketCalibration } : { ok: false, issues };
}

export function makeCalibration(
  puzzles: readonly Puzzle[],
  scoreById: ReadonlyMap<string, number>,
  puzzleChecksum: string,
): TicketCalibration {
  const means = { easy: 0, normal: 0, hard: 0 };
  for (const difficulty of R2_DIFFICULTIES) {
    const values = puzzles
      .filter((puzzle) => puzzle.difficulty === difficulty)
      .map((puzzle) => scoreById.get(puzzle.id))
      .filter(isFiniteNumber);
    if (values.length !== R2_PER_DIFFICULTY) {
      throw new Error(`missing finite calibrationScore for ${difficulty}`);
    }
    means[difficulty] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const range = (baseline: number): RangeThreshold => ({
    baseline,
    tolerance: 0.1,
    min: baseline * 0.9,
    max: baseline * 1.1,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    calibrationVersion: "r2-calibration-v1",
    poolVersion: POOL_VERSION,
    puzzleChecksum,
    metric: "calibrationScore",
    means,
    thresholds: {
      easyPair: range(means.easy * 2),
      normalPair: range(means.normal * 2),
      hardSingle: range(means.hard),
      overall: range(means.easy * 2 + means.normal * 2 + means.hard),
    },
    generatedBeforeTickets: true,
  };
}

export { computePuzzleChecksum };
