/**
 * R2 artifact commands. Generation and validation are deliberately separate:
 * validation never overwrites a public artifact and reproducibility checks use
 * a temporary directory.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generatePuzzles } from "../src/puzzles/generator.ts";
import {
  CALIBRATION_FORMULA,
  COMBINATION_TOLERANCE,
  DIFFICULTY_BANDS,
  DRAW_SAMPLE_COUNT,
  DRAW_TICKET_COUNT,
  R2_ADOPTED_PER_DIFFICULTY,
  R2_CANDIDATES_PER_DIFFICULTY,
  R2_CONFIG_VERSION,
  R2_GENERATOR_SEED,
  R2_MAX_ATTEMPTS_PER_DIFFICULTY,
  difficultyBand,
} from "../src/puzzles/config.ts";
import { GENERATOR_VERSION, RULESET_VERSION, SCHEMA_VERSION } from "../src/core/index.ts";
import { analyzePuzzle, type PuzzleAnalysis } from "../src/puzzles/solver.ts";
import { createPoolManifest, validatePool, type PoolManifest } from "../src/puzzles/pool.ts";
import {
  computeArtifactChecksum,
  computePuzzleCollectionChecksum,
  makeCalibration,
  normalizedTicketKey,
  R2_PUZZLE_COUNT,
  R2_RUN_ORDER,
  R2_TICKET_COUNT,
  validateCalibration,
  validatePuzzleCollection,
  validateTicketsArtifact,
  type Ticket,
  type TicketCalibration,
  type TicketManifest,
} from "../src/puzzles/validation.ts";
import { createTicketsManifest, ticketPairDiversity, type TicketScore } from "../src/puzzles/tickets.ts";
import { createSeededSource, uniformIndex } from "../src/puzzles/random.ts";
import { verifyIndependentLight } from "./verify-r2-independent.ts";
import { verifyIndependentSolutions } from "./verify-r2-independent.ts";
import { replayMoves, validatePuzzle, type Puzzle } from "../src/core/index.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CONTENT_DIR = join(ROOT, "content");
const REPORT_DIR = join(ROOT, "reports", "r2");
const PUZZLES_FILE = join(CONTENT_DIR, "puzzles-v2.json");
const POOL_FILE = join(CONTENT_DIR, "pool-v2.json");
const TICKETS_FILE = join(CONTENT_DIR, "tickets-v2.json");
const ANALYSES_FILE = join(REPORT_DIR, "analyses.json");
const CALIBRATION_FILE = join(REPORT_DIR, "ticket-calibration.json");
const CONFIG_FILE = join(REPORT_DIR, "config.json");
const LEGACY_PUZZLES_FILE = join(ROOT, "prototype", "src", "game", "data", "puzzles.json");

type AnalysisRecord = { puzzleId: string } & PuzzleAnalysis;
type ScoreMap = ReadonlyMap<string, number>;

type CliOptions = {
  seed?: number;
  runs?: number;
  out?: string;
};

type ValidationReport = {
  schemaVersion: 2;
  poolVersion: "pool-v2";
  configVersion: string;
  puzzleCount: number;
  checks: Record<string, { passed: boolean; details: string }>;
  generatedAtPolicy: "deterministic-no-timestamp";
  evidence?: Record<string, unknown>;
};

function configSnapshot(): Record<string, unknown> {
  return {
    configVersion: R2_CONFIG_VERSION,
    seed: R2_GENERATOR_SEED,
    rulesetVersion: RULESET_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    candidatesPerDifficulty: R2_CANDIDATES_PER_DIFFICULTY,
    adoptedPerDifficulty: R2_ADOPTED_PER_DIFFICULTY,
    difficultyBands: DIFFICULTY_BANDS,
    calibration: {
      formula: CALIBRATION_FORMULA,
      tolerance: COMBINATION_TOLERANCE,
    },
    draw: {
      ticketCount: DRAW_TICKET_COUNT,
      sampleCount: DRAW_SAMPLE_COUNT,
    },
    numericChanges: [],
    maxAttemptsPerDifficulty: R2_MAX_ATTEMPTS_PER_DIFFICULTY,
  };
}

function parseArgs(argv: readonly string[]): { command: string; options: CliOptions } {
  const command = argv[0] ?? "puzzles:test";
  const options: CliOptions = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--seed" && next !== undefined) {
      options.seed = Number(next);
      index += 1;
    } else if (argument === "--runs" && next !== undefined) {
      options.runs = Number(next);
      index += 1;
    } else if (argument === "--out" && next !== undefined) {
      options.out = next;
      index += 1;
    }
  }
  return { command, options };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function requireConfigSnapshot(): Promise<void> {
  const actual = await readJson(CONFIG_FILE);
  const generation = record(await readJson(join(REPORT_DIR, "generation.json")).catch(() => undefined));
  if (generation && generation.seed !== R2_GENERATOR_SEED) {
    throw new Error(`${join(REPORT_DIR, "generation.json")}: seed must match src/puzzles/config.ts`);
  }
  if (computeArtifactChecksum(actual) !== computeArtifactChecksum(configSnapshot())) {
    throw new Error(`${CONFIG_FILE}: snapshot differs from src/puzzles/config.ts or generation seed`);
  }
}

function asPuzzleArray(input: unknown, path: string): Puzzle[] {
  const checked = validatePuzzleCollection(input);
  if (!checked.ok) throw new Error(`${path}: ${formatIssues(checked.issues)}`);
  if (!checked.puzzles) throw new Error(`${path}: puzzle validation returned no puzzles`);
  return checked.puzzles;
}

function asPool(input: unknown, path: string): PoolManifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`${path}: pool must be an object`);
  return input as PoolManifest;
}

function asTickets(input: unknown, path: string): TicketManifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`${path}: tickets must be an object`);
  return input as TicketManifest;
}

function asAnalyses(input: unknown, path: string): AnalysisRecord[] {
  if (!Array.isArray(input)) throw new Error(`${path}: analyses must be an array`);
  const records: AnalysisRecord[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.puzzleId !== "string") {
      throw new Error(`${path}[${index}]: analysis requires puzzleId`);
    }
    records.push(value as AnalysisRecord);
  }
  return records;
}

function formatIssues(issues: readonly { path: string; message: string }[]): string {
  return issues.slice(0, 8).map((entry) => `${entry.path} ${entry.message}`).join("; ");
}

async function loadPuzzles(): Promise<Puzzle[]> {
  return asPuzzleArray(await readJson(PUZZLES_FILE), PUZZLES_FILE);
}

async function loadLegacyPuzzles(): Promise<readonly unknown[]> {
  const value = await readJson(LEGACY_PUZZLES_FILE);
  if (!Array.isArray(value)) throw new Error(`${LEGACY_PUZZLES_FILE}: legacy puzzles must be an array`);
  return value;
}

async function loadPool(puzzles: readonly Puzzle[]): Promise<PoolManifest> {
  const pool = asPool(await readJson(POOL_FILE), POOL_FILE);
  const checked = validatePool(pool, puzzles);
  if (!checked.ok) throw new Error(`${POOL_FILE}: ${formatIssues(checked.issues)}`);
  return pool;
}

async function loadAnalyses(puzzles: readonly Puzzle[]): Promise<AnalysisRecord[]> {
  const analyses = asAnalyses(await readJson(ANALYSES_FILE), ANALYSES_FILE);
  const byId = new Map(analyses.map((analysis) => [analysis.puzzleId, analysis]));
  if (analyses.length !== puzzles.length || puzzles.some((puzzle) => !byId.has(puzzle.id))) {
    throw new Error("analysis IDs must match all adopted puzzle IDs exactly");
  }
  return puzzles.map((puzzle) => byId.get(puzzle.id) as AnalysisRecord);
}

function scoreMap(analyses: readonly AnalysisRecord[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const analysis of analyses) {
    if (typeof analysis.calibrationScore !== "number" || !Number.isFinite(analysis.calibrationScore)) {
      throw new Error(`analysis ${analysis.puzzleId} has no finite calibrationScore`);
    }
    result.set(analysis.puzzleId, analysis.calibrationScore);
  }
  return result;
}

function checkAnalysisShape(analysis: AnalysisRecord): string | undefined {
  const arrayFields = ["requiredRingIndexes", "representativeSolution", "effectiveRingIndexes"] as const;
  for (const field of arrayFields) if (!Array.isArray(analysis[field])) return `${field} must be an array`;
  if (analysis.shortestMoves !== null && (!Number.isInteger(analysis.shortestMoves) || analysis.shortestMoves < 0)) return "shortestMoves is invalid";
  if (!Number.isInteger(analysis.shortestGoalStateCount) || analysis.shortestGoalStateCount < 0) return "shortestGoalStateCount is invalid";
  if (typeof analysis.shortestPathCount !== "string" || !/^\d+$/.test(analysis.shortestPathCount)) return "shortestPathCount is invalid";
  if (!Number.isInteger(analysis.minOperatedRingCount) || analysis.minOperatedRingCount < 0 || analysis.minOperatedRingCount > 3) return "minOperatedRingCount is invalid";
  if (!Number.isInteger(analysis.visitedStates) || analysis.visitedStates < 1 || analysis.visitedStates > 1728) return "visitedStates is invalid";
  if (typeof analysis.truncated !== "boolean") return "truncated is invalid";
  return undefined;
}

function validateAnalysisSet(puzzles: readonly Puzzle[], analyses: readonly AnalysisRecord[]): Record<string, { passed: boolean; details: string }> {
  const checks: Record<string, { passed: boolean; details: string }> = {};
  const shapeErrors = analyses.flatMap((analysis) => {
    const error = checkAnalysisShape(analysis);
    return error ? [`${analysis.puzzleId}: ${error}`] : [];
  });
  const byId = new Map(analyses.map((analysis) => [analysis.puzzleId, analysis]));
  const recomputeErrors: string[] = [];
  const representativeErrors: string[] = [];
  const bandErrors: string[] = [];
  for (const puzzle of puzzles) {
    const saved = byId.get(puzzle.id);
    if (!saved) {
      recomputeErrors.push(`${puzzle.id}: missing analysis`);
      continue;
    }
    const actual = analyzePuzzle(puzzle);
    const fields = ["shortestMoves", "shortestGoalStateCount", "shortestPathCount", "minOperatedRingCount", "visitedStates", "truncated", "calibrationScore"] as const;
    for (const field of fields) if (saved[field] !== actual[field]) recomputeErrors.push(`${puzzle.id}: ${field} differs`);
    if (saved.requiredRingIndexes.join(",") !== actual.requiredRingIndexes.join(",")) recomputeErrors.push(`${puzzle.id}: requiredRingIndexes differs`);
    if (saved.effectiveRingIndexes.join(",") !== actual.effectiveRingIndexes.join(",")) recomputeErrors.push(`${puzzle.id}: effectiveRingIndexes differs`);
    if (JSON.stringify(saved.representativeSolution) !== JSON.stringify(actual.representativeSolution)) recomputeErrors.push(`${puzzle.id}: representativeSolution differs`);
    const replayed = replayMoves(puzzle, saved.representativeSolution);
    if (saved.shortestMoves === null || replayed.illegal || !replayed.solved || replayed.acceptedMoves !== saved.shortestMoves) {
      representativeErrors.push(`${puzzle.id}: representative solution does not solve in the saved shortest length`);
    }
    const band = difficultyBand(puzzle.difficulty);
    const emitters = puzzle.rings.reduce((sum, ring) => sum + ring.parts.filter((part) => part.kind === "emitter").length, 0);
    const blockers = puzzle.rings.reduce((sum, ring) => sum + ring.parts.filter((part) => part.kind === "blocker").length, 0);
    if (saved.shortestMoves === null || saved.shortestMoves < band.minMoves || saved.shortestMoves > band.maxMoves ||
      puzzle.targets.length < band.minTargets || puzzle.targets.length > band.maxTargets ||
      emitters < band.minEmitters || emitters > band.maxEmitters ||
      blockers < band.minBlockers || blockers > band.maxBlockers ||
      saved.minOperatedRingCount < band.minOperatedRings || saved.shortestGoalStateCount > band.maxShortestGoalStates ||
      actual.effectiveRingIndexes.length !== 3) {
      bandErrors.push(`${puzzle.id}: difficulty band mismatch`);
    }
  }
  checks.P02 = {
    passed: shapeErrors.length === 0 && recomputeErrors.length === 0 && representativeErrors.length === 0,
    details: shapeErrors.length === 0 && recomputeErrors.length === 0 && representativeErrors.length === 0
      ? "saved analyses, recomputed BFS metrics and representative replays agree"
      : [...shapeErrors, ...recomputeErrors, ...representativeErrors].join("; "),
  };
  checks.P01 = {
    passed: puzzles.length === R2_PUZZLE_COUNT && representativeErrors.length === 0 && analyses.every((analysis) => analysis.shortestMoves !== null && analysis.shortestMoves > 0 && analysis.representativeSolution.length === analysis.shortestMoves),
    details: representativeErrors.length === 0 ? "90 puzzles have successful representative rotation-only solutions" : representativeErrors.join("; "),
  };
  checks.P06 = {
    passed: bandErrors.length === 0,
    details: bandErrors.length === 0 ? `all ${DIFFICULTY_BANDS.length} fixed difficulty bands match` : bandErrors.join("; "),
  };
  return checks;
}

function requireAnalysisSet(puzzles: readonly Puzzle[], analyses: readonly AnalysisRecord[]): void {
  const checks = validateAnalysisSet(puzzles, analyses);
  const failures = Object.entries(checks).filter(([, check]) => !check.passed).map(([name, check]) => `${name}: ${check.details}`);
  if (failures.length > 0) throw new Error(`analysis validation failed: ${failures.join("; ")}`);
}

async function generateCommand(options: CliOptions): Promise<void> {
  if (options.seed !== undefined && options.seed !== R2_GENERATOR_SEED) {
    throw new Error(`puzzles:generate uses the fixed config seed ${R2_GENERATOR_SEED}`);
  }
  const legacyPuzzles = await loadLegacyPuzzles();
  const generated = options.seed === undefined
    ? generatePuzzles({ legacyPuzzles })
    : generatePuzzles({ seed: options.seed, legacyPuzzles });
  await writeJson(PUZZLES_FILE, generated.puzzles);
  await writeJson(ANALYSES_FILE, generated.analyses);
  await writeJson(join(REPORT_DIR, "candidates.json"), generated.candidates);
  await writeJson(join(REPORT_DIR, "migration.json"), generated.migration);
  await writeJson(join(REPORT_DIR, "near-duplicates.json"), generated.nearDuplicates);
  await writeJson(CONFIG_FILE, configSnapshot());
  await writeJson(join(REPORT_DIR, "generation.json"), {
    configVersion: generated.configVersion,
    seed: generated.seed,
    counts: generated.counts,
    candidateCount: generated.candidates.length,
    adoptedCount: generated.puzzles.length,
    generatedAtPolicy: "deterministic-no-timestamp",
  });
  console.log(`puzzles:generate wrote ${generated.puzzles.length} puzzles and ${generated.analyses.length} analyses`);
}

async function validatePuzzlesCommand(): Promise<{ puzzles: Puzzle[]; analyses: AnalysisRecord[]; report: ValidationReport }> {
  await requireConfigSnapshot();
  const puzzles = await loadPuzzles();
  const poolInput = await readJson(POOL_FILE).catch(() => undefined);
  const expectedIds = poolInput === undefined ? undefined : asPool(poolInput, POOL_FILE).puzzleIdsByDifficulty;
  const checked = validatePuzzleCollection(puzzles, expectedIds);
  if (!checked.ok) throw new Error(`${PUZZLES_FILE}: ${formatIssues(checked.issues)}`);
  const analyses = await loadAnalyses(puzzles);
  const checks = validateAnalysisSet(puzzles, analyses);
  if (Object.values(checks).some((check) => !check.passed)) throw new Error(`puzzles:validate: ${Object.values(checks).map((check) => check.details).join("; ")}`);
  const report: ValidationReport = {
    schemaVersion: 2,
    poolVersion: "pool-v2",
    configVersion: "r2-config-v1",
    puzzleCount: puzzles.length,
    checks,
    generatedAtPolicy: "deterministic-no-timestamp",
  };
  await writeJson(join(REPORT_DIR, "validation.json"), report);
  return { puzzles, analyses, report };
}

async function poolCreateCommand(): Promise<void> {
  const puzzles = await loadPuzzles();
  const checked = validatePuzzleCollection(puzzles);
  if (!checked.ok) throw new Error(`${PUZZLES_FILE}: ${formatIssues(checked.issues)}`);
  const pool = createPoolManifest(puzzles);
  await writeJson(POOL_FILE, pool);
  console.log(`pool:create wrote ${pool.puzzleCount} puzzle IDs (${pool.poolChecksum})`);
}

async function poolValidateCommand(): Promise<void> {
  const puzzles = await loadPuzzles();
  await loadPool(puzzles);
  console.log("pool:validate ok");
}

async function writeCalibration(puzzles: readonly Puzzle[], analyses: readonly AnalysisRecord[], pool: PoolManifest): Promise<TicketCalibration> {
  const scoreById = scoreMap(analyses);
  const calibration = makeCalibration(puzzles, scoreById, pool.puzzleChecksum);
  const existing = await readJson(CALIBRATION_FILE).catch(() => undefined);
  if (existing !== undefined) {
    const checked = validateCalibration(existing);
    if (!checked.ok || computeArtifactChecksum(checked.calibration) !== computeArtifactChecksum(calibration)) {
      throw new Error(`${CALIBRATION_FILE}: existing calibration differs; do not widen or rewrite thresholds after ticket generation`);
    }
  } else {
    await writeJson(CALIBRATION_FILE, calibration);
  }
  return calibration;
}

async function ticketsCreateCommand(options: CliOptions): Promise<void> {
  const puzzles = await loadPuzzles();
  const pool = await loadPool(puzzles);
  const analyses = await loadAnalyses(puzzles);
  requireAnalysisSet(puzzles, analyses);
  const calibration = await writeCalibration(puzzles, analyses, pool);
  const scoreById = scoreMap(analyses);
  const built = createTicketsManifest(puzzles, pool, {
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    calibration,
    scoreById,
  });
  await writeJson(TICKETS_FILE, built.manifest);
  await writeJson(join(REPORT_DIR, "ticket-scores.json"), built.scores);
  await writeJson(join(REPORT_DIR, "ticket-diversity.json"), ticketPairDiversity(built.manifest.tickets));
  console.log(`tickets:create wrote ${built.manifest.tickets.length} tickets (${built.manifest.ticketChecksum})`);
}

function ticketScores(
  tickets: readonly Ticket[],
  scoreById: ScoreMap,
): TicketScore[] {
  return tickets.map((ticket) => {
    const easyPair = (scoreById.get(ticket[0]) ?? Number.NaN) + (scoreById.get(ticket[1]) ?? Number.NaN);
    const normalPair = (scoreById.get(ticket[2]) ?? Number.NaN) + (scoreById.get(ticket[3]) ?? Number.NaN);
    const hardSingle = scoreById.get(ticket[4]) ?? Number.NaN;
    return { easyPair, normalPair, hardSingle, overall: easyPair + normalPair + hardSingle };
  });
}

async function loadValidatedTicketBundle(
  puzzles: readonly Puzzle[],
  pool: PoolManifest,
): Promise<{ tickets: TicketManifest; analyses: AnalysisRecord[]; calibration: TicketCalibration }> {
  const analyses = await loadAnalyses(puzzles);
  requireAnalysisSet(puzzles, analyses);
  const calibrationInput = await readJson(CALIBRATION_FILE);
  const checkedCalibration = validateCalibration(calibrationInput);
  if (!checkedCalibration.ok) throw new Error(`${CALIBRATION_FILE}: ${formatIssues(checkedCalibration.issues)}`);
  const calibration = checkedCalibration.calibration;
  const recomputedCalibration = makeCalibration(puzzles, scoreMap(analyses), pool.puzzleChecksum);
  if (computeArtifactChecksum(recomputedCalibration) !== computeArtifactChecksum(calibration)) {
    throw new Error(`${CALIBRATION_FILE}: saved thresholds do not match freshly recomputed analysis scores`);
  }
  const tickets = asTickets(await readJson(TICKETS_FILE), TICKETS_FILE);
  const checkedTickets = validateTicketsArtifact(tickets, {
    puzzles,
    pool,
    calibration,
    scoreById: scoreMap(analyses),
  });
  if (!checkedTickets.ok) throw new Error(`${TICKETS_FILE}: ${formatIssues(checkedTickets.issues)}`);
  return { tickets, analyses, calibration };
}

async function ticketsValidateCommand(): Promise<void> {
  const puzzles = await loadPuzzles();
  const pool = await loadPool(puzzles);
  const { tickets, analyses } = await loadValidatedTicketBundle(puzzles, pool);
  await writeJson(join(REPORT_DIR, "ticket-scores.json"), ticketScores(tickets.tickets, scoreMap(analyses)));
  await writeJson(join(REPORT_DIR, "ticket-diversity.json"), ticketPairDiversity(tickets.tickets));
  console.log("tickets:validate ok");
}

type Frequency = { observed: number; expected: number; sigma: number; deviation: number; within5Sigma: boolean };
type SimulationReport = {
  schemaVersion: 2;
  poolVersion: string;
  seed: number;
  runs: number;
  randomMethod: "uint32-rejection-sampling";
  ticketExpected: number;
  ticketFrequency: Frequency[];
  puzzleFrequency: Array<Frequency & { puzzleId: string; difficulty: Puzzle["difficulty"] }>;
  passed: boolean;
  generatedAtPolicy: "deterministic-no-timestamp";
  note: string;
};

function frequency(observed: number, expected: number, probability: number, runs: number): Frequency {
  const sigma = Math.sqrt(runs * probability * (1 - probability));
  return {
    observed,
    expected,
    sigma,
    deviation: observed - expected,
    within5Sigma: Math.abs(observed - expected) <= 5 * sigma,
  };
}

async function simulateCommand(options: CliOptions): Promise<SimulationReport> {
  const puzzles = await loadPuzzles();
  const pool = await loadPool(puzzles);
  const { tickets } = await loadValidatedTicketBundle(puzzles, pool);
  const runs = options.runs ?? 100_000;
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const seed = options.seed ?? 0x5202_0900;
  const source = createSeededSource(seed);
  const ticketCounts = new Array<number>(R2_TICKET_COUNT).fill(0);
  const puzzleCounts = new Map<string, number>();
  for (let run = 0; run < runs; run += 1) {
    const ticketIndex = uniformIndex(source, tickets.tickets.length);
    ticketCounts[ticketIndex] += 1;
    for (const id of tickets.tickets[ticketIndex]) puzzleCounts.set(id, (puzzleCounts.get(id) ?? 0) + 1);
  }
  const ticketExpected = runs / tickets.tickets.length;
  const ticketFrequency = ticketCounts.map((observed) => frequency(observed, ticketExpected, 1 / tickets.tickets.length, runs));
  const puzzleFrequency = puzzles.map((puzzle) => {
    const probability = puzzle.difficulty === "hard" ? 1 / 30 : 2 / 30;
    const expected = runs * probability;
    return {
      puzzleId: puzzle.id,
      difficulty: puzzle.difficulty,
      ...frequency(puzzleCounts.get(puzzle.id) ?? 0, expected, probability, runs),
    };
  });
  const passed = ticketFrequency.every((entry) => entry.within5Sigma) && puzzleFrequency.every((entry) => entry.within5Sigma);
  const report: SimulationReport = {
    schemaVersion: 2,
    poolVersion: pool.poolVersion,
    seed,
    runs,
    randomMethod: "uint32-rejection-sampling",
    ticketExpected,
    ticketFrequency,
    puzzleFrequency,
    passed,
    generatedAtPolicy: "deterministic-no-timestamp",
    note: "5σ is a bias-detection gate, not a proof of mathematical fairness.",
  };
  await writeJson(join(REPORT_DIR, "selection-simulation.json"), report);
  if (!passed) throw new Error("selection:simulate failed 5σ frequency check");
  console.log(`selection:simulate ok (${runs} fixed-seed draws)`);
  return report;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function boardSvg(puzzle: Puzzle): string {
  const ringRadii = [18, 32, 46] as const;
  const points = (slot: number, radius: number): [number, number] => {
    const angle = -Math.PI / 2 + (slot * Math.PI * 2) / 12;
    return [60 + Math.cos(angle) * radius, 60 + Math.sin(angle) * radius];
  };
  const parts = puzzle.rings.flatMap((ring, ringIndex) => ring.parts.map((part) => {
    const worldSlot = (part.slot + puzzle.initialState.rotations[ringIndex]) % 12;
    const [x, y] = points(worldSlot, ringRadii[ringIndex]);
    if (part.kind === "emitter") return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.5" fill="#53d6ff" stroke="#e0f2fe"/>`;
    return `<rect x="${(x - 4).toFixed(2)}" y="${(y - 4).toFixed(2)}" width="8" height="8" rx="1" fill="#4b5563" stroke="#cbd5e1"/>`;
  })).join("");
  const targets = puzzle.targets.map((slot) => {
    const [x, y] = points(slot, 52);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="#f2c14e" stroke="#fff"/>`;
  }).join("");
  return `<svg class="board" viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(puzzle.id)}"><circle cx="60" cy="60" r="52" fill="#101827" stroke="#718096"/><circle cx="60" cy="60" r="46" fill="none" stroke="#334155"/><circle cx="60" cy="60" r="32" fill="none" stroke="#334155"/><circle cx="60" cy="60" r="18" fill="none" stroke="#334155"/>${targets}${parts}</svg>`;
}

function inspectionVariant(puzzle: Puzzle, reflected: boolean): Puzzle {
  const variant = structuredClone(puzzle);
  variant.id = `${puzzle.id}-inspection-${reflected ? "mirror" : "rotate"}`;
  for (const ring of variant.rings) {
    for (const part of ring.parts) part.slot = reflected ? (12 - part.slot) % 12 : (part.slot + 1) % 12;
  }
  variant.targets = variant.targets.map((slot) => reflected ? (12 - slot) % 12 : (slot + 1) % 12).sort((left, right) => left - right);
  return variant;
}

function scoreStats(scores: readonly TicketScore[]): string {
  if (scores.length === 0) return "データなし";
  const value = (name: keyof TicketScore): string => {
    const values = scores.map((score) => score[name]);
    return `${Math.min(...values).toFixed(1)}〜${Math.max(...values).toFixed(1)}`;
  };
  return `初級ペア ${value("easyPair")} / 中級ペア ${value("normalPair")} / 上級 ${value("hardSingle")} / 総合 ${value("overall")}`;
}

async function reportCommand(): Promise<void> {
  await requireConfigSnapshot();
  const puzzles = await loadPuzzles();
  const pool = await loadPool(puzzles);
  const analyses = await loadAnalyses(puzzles);
  requireAnalysisSet(puzzles, analyses);
  const tickets = asTickets(await readJson(TICKETS_FILE), TICKETS_FILE);
  const calibration = validateCalibration(await readJson(CALIBRATION_FILE));
  if (!calibration.ok) throw new Error(`${CALIBRATION_FILE}: ${formatIssues(calibration.issues)}`);
  const recomputedCalibration = makeCalibration(puzzles, scoreMap(analyses), pool.puzzleChecksum);
  if (computeArtifactChecksum(recomputedCalibration) !== computeArtifactChecksum(calibration.calibration)) {
    throw new Error(`${CALIBRATION_FILE}: saved thresholds do not match freshly recomputed analysis scores`);
  }
  const ticketCheck = validateTicketsArtifact(tickets, {
    puzzles,
    pool,
    calibration: calibration.calibration,
    scoreById: scoreMap(analyses),
  });
  if (!ticketCheck.ok) throw new Error(`${TICKETS_FILE}: ${formatIssues(ticketCheck.issues)}`);
  const scores = ticketScores(tickets.tickets, scoreMap(analyses));
  const candidateReport = await readJson(join(REPORT_DIR, "candidates.json")).catch(() => []) as unknown[];
  const migration = await readJson(join(REPORT_DIR, "migration.json")).catch(() => []) as unknown[];
  const nearDuplicates = await readJson(join(REPORT_DIR, "near-duplicates.json")).catch(() => []) as unknown[];
  const simulationReport = record(await readJson(join(REPORT_DIR, "selection-simulation.json")).catch(() => undefined));
  const simulationTickets = Array.isArray(simulationReport?.ticketFrequency) ? simulationReport.ticketFrequency.filter((entry): entry is Record<string, unknown> => record(entry) !== undefined) : [];
  const simulationPuzzles = Array.isArray(simulationReport?.puzzleFrequency) ? simulationReport.puzzleFrequency.filter((entry): entry is Record<string, unknown> => record(entry) !== undefined) : [];
  const numericObserved = (entries: readonly Record<string, unknown>[]): number[] => entries.map((entry) => entry.observed).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const ticketObserved = numericObserved(simulationTickets);
  const puzzleObserved = numericObserved(simulationPuzzles);
  const migrationCounts = new Map<string, number>();
  for (const entry of migration) {
    const value = record(entry);
    if (typeof value?.action === "string") migrationCounts.set(value.action, (migrationCounts.get(value.action) ?? 0) + 1);
  }
  const candidatePuzzles = new Map<string, Puzzle>();
  for (const candidate of candidateReport) {
    const candidateRecord = record(candidate);
    const candidateId = candidateRecord?.candidateId;
    const candidatePuzzle = candidateRecord?.puzzle;
    if (typeof candidateId !== "string" || candidatePuzzle === undefined) continue;
    const checkedPuzzle = validatePuzzle(candidatePuzzle);
    if (checkedPuzzle.ok) candidatePuzzles.set(candidateId, checkedPuzzle.puzzle);
  }
  const findPuzzle = (id: string): Puzzle | undefined => puzzles.find((puzzle) => puzzle.id === id) ?? candidatePuzzles.get(id);
  const rejectionCounts = new Map<string, number>();
  for (const candidate of candidateReport) {
    if (typeof candidate !== "object" || candidate === null || !("rejectionReasons" in candidate)) continue;
    const reasons = candidate.rejectionReasons;
    if (!Array.isArray(reasons)) continue;
    for (const reason of reasons) if (typeof reason === "string") rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }
  const puzzleCards = puzzles.map((puzzle) => {
    const analysis = analyses.find((candidate) => candidate.puzzleId === puzzle.id);
    return `<article class="card"><div>${boardSvg(puzzle)}</div><div><b>${escapeHtml(puzzle.id)}</b><span class="badge">${escapeHtml(puzzle.difficulty)}</span><p>最短 ${String(analysis?.shortestMoves ?? "なし")}手 / 完成配置 ${String(analysis?.shortestGoalStateCount ?? "-")} / 操作環数 ${String(analysis?.minOperatedRingCount ?? "-")} / C ${String(analysis?.calibrationScore ?? "-")}</p></div></article>`;
  }).join("");
  const rejectionList = [...rejectionCounts.entries()].sort((left, right) => right[1] - left[1]).map(([reason, count]) => `<li>${escapeHtml(reason)}: ${count}</li>`).join("") || "<li>記録なし</li>";
  const duplicateItems = nearDuplicates.length > 0
    ? nearDuplicates.slice(0, 24).map((entry) => {
      const duplicate = record(entry);
      if (!duplicate) return "";
      const leftId = typeof duplicate.leftId === "string" ? duplicate.leftId : "unknown";
      const rightId = typeof duplicate.rightId === "string" ? duplicate.rightId : "unknown";
      const left = findPuzzle(leftId);
      const right = findPuzzle(rightId);
      const relation = typeof duplicate.relation === "string" ? duplicate.relation : "不明";
      const keptId = typeof duplicate.keptId === "string" ? duplicate.keptId : "不明";
      const droppedId = typeof duplicate.droppedId === "string" ? duplicate.droppedId : "不明";
      const reason = typeof duplicate.reason === "string" ? duplicate.reason : "記録なし";
      return `<article class="duplicate"><div>${left ? boardSvg(left) : ""}</div><div>${right ? boardSvg(right) : ""}</div><p>${escapeHtml(leftId)} ↔ ${escapeHtml(rightId)}<br>関係: ${escapeHtml(relation)}<br>採用: ${escapeHtml(keptId)} / 不採用: ${escapeHtml(droppedId)}<br>理由: ${escapeHtml(reason)}</p></article>`;
    }).join("")
    : puzzles.slice(0, 3).map((puzzle) => `<article class="duplicate"><div>${boardSvg(puzzle)}</div><div>${boardSvg(inspectionVariant(puzzle, true))}</div><p>${escapeHtml(puzzle.id)} の回転/反転検査用変換。自然な近似重複0件のため、これは採用外の説明用画像。</p></article>`).join("");
  const migrationSummary = [...migrationCounts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([action, count]) => `${action} ${count}件`).join(" / ") || "記録なし";
  const simulationSummary = simulationReport && ticketObserved.length > 0 && puzzleObserved.length > 0
    ? `抽選seed ${String(simulationReport.seed)} / ${String(simulationReport.runs)}回 / 券選択 ${Math.min(...ticketObserved)}〜${Math.max(...ticketObserved)}回 / 問題出現 ${Math.min(...puzzleObserved)}〜${Math.max(...puzzleObserved)}回 / ${simulationReport.passed === true ? "5σ合格" : "5σ不合格"}`
    : "抽選分布は未記録";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R2 問題庫検査</title><style>body{margin:0;background:#0b1020;color:#e5e7eb;font:15px/1.5 system-ui,sans-serif}main{max-width:980px;margin:auto;padding:16px}h1,h2{line-height:1.2}section{background:#131b2e;border:1px solid #2d3b58;border-radius:12px;padding:14px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}.card,.duplicate{display:flex;gap:12px;align-items:center;background:#0f172a;border-radius:10px;padding:8px}.duplicate{margin:6px 0}.board{width:120px;height:120px;flex:none}.badge{display:inline-block;margin-left:7px;border:1px solid #64748b;border-radius:999px;padding:1px 6px;font-size:12px}.muted{color:#aab6ca}li{margin:2px 0}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}@media(max-width:430px){main{padding:10px}h1{font-size:22px}.grid{display:block}.card{margin:6px 0}.duplicate{align-items:flex-start}.board{width:120px;height:120px}.card>div:last-child,.duplicate p{overflow-wrap:anywhere;min-width:0}}</style></head><body><main><h1>R2 問題庫・900組 検査レポート</h1><p class="muted">pool-v2 / 問題 ${puzzles.length}問 / 券 ${tickets.tickets.length}件。生成物は固定seedで作成し、日時は含めていません。</p><section><h2>凡例と検査結果</h2><p>青い円=発光紋、灰色の四角=遮断石、黄色の円=必須受光紋。</p><ul><li>採用: ${puzzles.length === 90 ? "合格" : "不合格"}（初級30・中級30・上級30）</li><li>券構成: easy,easy,normal,normal,hard / 各ID重複なし / 正規化券重複0</li><li>校正範囲: 事前保存した各基準の±10%。実測範囲: ${escapeHtml(scoreStats(scores))}</li><li>未試遊: 自動検査のみ。人による試遊・iPhone実機確認は未実施。</li></ul></section><section><h2>採用90問</h2><div class="grid">${puzzleCards}</div></section><section><h2>候補・移行</h2><p>候補数: ${candidateReport.length} / 却下理由:</p><ul>${rejectionList}</ul><p>旧90移行記録: ${migration.length}件。${escapeHtml(migrationSummary)}</p></section><section><h2>近似問題の採否（画像付き）</h2><p>正規化は全体回転・反転・初期配置を含む物理位置で実施。自然な近似重複: ${nearDuplicates.length}件。</p>${duplicateItems}</section><section><h2>900券と分布</h2><p>券数: ${tickets.tickets.length}。出現数は初級/中級各60回、上級各30回。${escapeHtml(scoreStats(scores))}</p><p>ペア多様性: ${escapeHtml(JSON.stringify(ticketPairDiversity(tickets.tickets)))}</p><p>${escapeHtml(simulationSummary)}</p><p>詳細は <code>reports/r2/selection-simulation.json</code> に固定seed・10万回・5σ検査として保存。</p></section><section><h2>校正閾値</h2><pre>${escapeHtml(JSON.stringify(calibration.calibration, null, 2))}</pre></section></main></body></html>`;
  await writeFile(join(REPORT_DIR, "report.html"), html, "utf8");
  console.log("puzzles:report wrote reports/r2/report.html");
}

type ReproducibilityReport = {
  passed: true;
  files: Record<string, { expectedBytes: number; actualBytes: number; identical: true }>;
  checksums: {
    puzzleCollection: string;
    pool: string;
    tickets: string;
  };
};

async function reproducibilityCheck(): Promise<ReproducibilityReport> {
  const puzzles = await loadPuzzles();
  const generated = generatePuzzles({ legacyPuzzles: await loadLegacyPuzzles() });
  const generatedPool = createPoolManifest(generated.puzzles);
  const generatedAnalyses = generated.analyses;
  const generatedScores = scoreMap(generatedAnalyses);
  const generatedCalibration = makeCalibration(
    generated.puzzles,
    generatedScores,
    computePuzzleCollectionChecksum(generated.puzzles),
  );
  const generatedTickets = createTicketsManifest(generated.puzzles, generatedPool, {
    calibration: generatedCalibration,
    scoreById: generatedScores,
  }).manifest;
  const expectedFiles: ReadonlyMap<string, string> = new Map([
    ["puzzles-v2.json", `${JSON.stringify(generated.puzzles, null, 2)}\n`],
    ["pool-v2.json", `${JSON.stringify(generatedPool, null, 2)}\n`],
    ["tickets-v2.json", `${JSON.stringify(generatedTickets, null, 2)}\n`],
  ]);
  if (JSON.stringify(generated.puzzles) !== JSON.stringify(puzzles)) throw new Error("same-seed regeneration differs from content/puzzles-v2.json");
  const files: Record<string, { expectedBytes: number; actualBytes: number; identical: true }> = {};
  const temporary = await mkdtemp(join(tmpdir(), "sekibanmawashi-r2-"));
  try {
    for (const [name, expected] of expectedFiles) {
      const temporaryPath = join(temporary, name);
      await writeFile(temporaryPath, expected, "utf8");
      const roundTrip = await readFile(temporaryPath, "utf8");
      if (roundTrip !== expected) throw new Error(`temporary ${name} regeneration round-trip differs`);
      const publicPath = join(CONTENT_DIR, name);
      const actual = await readFile(publicPath, "utf8").catch(() => "");
      if (actual !== expected) throw new Error(`same-seed regeneration differs from ${publicPath}`);
      files[name] = { expectedBytes: Buffer.byteLength(expected), actualBytes: Buffer.byteLength(actual), identical: true };
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    passed: true,
    files,
    checksums: {
      puzzleCollection: computePuzzleCollectionChecksum(generated.puzzles),
      pool: generatedPool.poolChecksum,
      tickets: generatedTickets.ticketChecksum,
    },
  };
}

async function puzzlesTestCommand(options: CliOptions): Promise<void> {
  const { puzzles, analyses, report: puzzleReport } = await validatePuzzlesCommand();
  const pool = await loadPool(puzzles);
  const { tickets, calibration } = await loadValidatedTicketBundle(puzzles, pool);
  const reproducibility = await reproducibilityCheck();
  const independentSolutions = verifyIndependentSolutions(puzzles);
  const expectedStateComparisons = R2_PUZZLE_COUNT * 1728;
  const p02IndependentPassed = independentSolutions.stateComparisonCount === expectedStateComparisons && independentSolutions.mismatchCount === 0;
  if (!p02IndependentPassed) {
    throw new Error(`P02 independent solution verification failed: ${JSON.stringify(independentSolutions)}`);
  }
  const independent = verifyIndependentLight(puzzles);
  const p03Passed = independent.comparisonCount === expectedStateComparisons &&
    independent.fastMaskComparisonCount === expectedStateComparisons &&
    independent.mismatchCount === 0 && independent.coreMismatchCount === 0 && independent.fastMaskMismatchCount === 0;
  if (!p03Passed) {
    throw new Error(`P03 independent verification failed: ${JSON.stringify(independent)}`);
  }
  const simulationSeed = 0x5202_0900;
  if (options.runs !== undefined && options.runs !== DRAW_SAMPLE_COUNT) {
    throw new Error(`puzzles:test requires exactly ${DRAW_SAMPLE_COUNT} simulation runs for P09`);
  }
  if (options.seed !== undefined && options.seed !== simulationSeed) {
    throw new Error(`puzzles:test requires the fixed P09 seed ${simulationSeed}`);
  }
  const simulation = await simulateCommand({ runs: DRAW_SAMPLE_COUNT, seed: simulationSeed });

  const collection = validatePuzzleCollection(puzzles);
  const nearDuplicateInput = await readJson(join(REPORT_DIR, "near-duplicates.json")).catch(() => []) as unknown[];
  const adoptedIds = new Set(puzzles.map((puzzle) => puzzle.id));
  const droppedNearDuplicates = nearDuplicateInput.filter((entry) => {
    const value = record(entry);
    return typeof value?.droppedId === "string" && !adoptedIds.has(value.droppedId);
  }).length;
  const p04Passed = collection.ok && collection.normalizedKeys?.length === R2_PUZZLE_COUNT && droppedNearDuplicates === nearDuplicateInput.length;
  const scoreById = scoreMap(analyses);
  const ticketKeys = new Set(tickets.tickets.map((ticket) => normalizedTicketKey(ticket)));
  const counts = new Map<string, number>();
  let orderValid = true;
  for (const ticket of tickets.tickets) {
    for (const id of ticket) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (let slot = 0; slot < R2_RUN_ORDER.length; slot += 1) {
      const puzzle = puzzles.find((candidate) => candidate.id === ticket[slot]);
      if (!puzzle || puzzle.difficulty !== R2_RUN_ORDER[slot]) orderValid = false;
    }
  }
  const countsValid = puzzles.every((puzzle) => counts.get(puzzle.id) === (puzzle.difficulty === "hard" ? 30 : 60));
  const p07Passed = tickets.tickets.length === R2_TICKET_COUNT && ticketKeys.size === R2_TICKET_COUNT && orderValid && countsValid;
  const scores = ticketScores(tickets.tickets, scoreById);
  const ranges = {
    easyPair: { min: Math.min(...scores.map((score) => score.easyPair)), max: Math.max(...scores.map((score) => score.easyPair)), threshold: calibration.thresholds.easyPair },
    normalPair: { min: Math.min(...scores.map((score) => score.normalPair)), max: Math.max(...scores.map((score) => score.normalPair)), threshold: calibration.thresholds.normalPair },
    hardSingle: { min: Math.min(...scores.map((score) => score.hardSingle)), max: Math.max(...scores.map((score) => score.hardSingle)), threshold: calibration.thresholds.hardSingle },
    overall: { min: Math.min(...scores.map((score) => score.overall)), max: Math.max(...scores.map((score) => score.overall)), threshold: calibration.thresholds.overall },
  };
  const p08Passed = scores.every((score) =>
    score.easyPair >= calibration.thresholds.easyPair.min && score.easyPair <= calibration.thresholds.easyPair.max &&
    score.normalPair >= calibration.thresholds.normalPair.min && score.normalPair <= calibration.thresholds.normalPair.max &&
    score.hardSingle >= calibration.thresholds.hardSingle.min && score.hardSingle <= calibration.thresholds.hardSingle.max &&
    score.overall >= calibration.thresholds.overall.min && score.overall <= calibration.thresholds.overall.max,
  );
  if (!p04Passed || !p07Passed || !p08Passed || !simulation.passed) {
    throw new Error(`R2 ticket checks failed: ${JSON.stringify({ p04Passed, p07Passed, p08Passed, p09Passed: simulation.passed })}`);
  }
  const checks = {
    ...puzzleReport.checks,
    P02: {
      passed: puzzleReport.checks.P02.passed && p02IndependentPassed,
      details: `${puzzleReport.checks.P02.details}; independent state comparisons ${independentSolutions.stateComparisonCount}/${expectedStateComparisons}, mismatches ${independentSolutions.mismatchCount}`,
    },
    P03: {
      passed: p03Passed,
      details: `core ${independent.comparisonCount}, beam ${independent.beamComparisonCount}, fast mask ${independent.fastMaskComparisonCount}; mismatches ${independent.mismatchCount} (core ${independent.coreMismatchCount}, fast ${independent.fastMaskMismatchCount})`,
    },
    P04: {
      passed: p04Passed,
      details: `adopted normalized keys ${collection.ok ? collection.normalizedKeys?.length ?? 0 : 0}/${R2_PUZZLE_COUNT}; near duplicate records ${nearDuplicateInput.length}, dropped candidates ${droppedNearDuplicates}`,
    },
    P05: {
      passed: reproducibility.passed,
      details: `byte-identical regeneration for ${Object.keys(reproducibility.files).length} public artifacts; puzzle/pool/ticket checksums ${reproducibility.checksums.puzzleCollection}/${reproducibility.checksums.pool}/${reproducibility.checksums.tickets}`,
    },
    P07: {
      passed: p07Passed,
      details: `tickets ${tickets.tickets.length}; normalized unique ${ticketKeys.size}; order ${orderValid}; per-ID counts ${countsValid}; pair diversity ${JSON.stringify(ticketPairDiversity(tickets.tickets))}`,
    },
    P08: {
      passed: p08Passed,
      details: `all 4 saved ±10% ranges pass; measured ${JSON.stringify(ranges)}`,
    },
    P09: {
      passed: simulation.passed,
      details: `seed ${simulation.seed}, runs ${simulation.runs}, method ${simulation.randomMethod}; all ticket and puzzle frequencies within 5σ`,
    },
  };
  await writeJson(join(REPORT_DIR, "validation.json"), {
    ...puzzleReport,
    checks,
    evidence: {
      independentSolutions,
      independentLight: independent,
      reproducibility,
      ticketDiversity: ticketPairDiversity(tickets.tickets),
      calibrationRanges: ranges,
      simulation: {
        seed: simulation.seed,
        runs: simulation.runs,
        ticketExpected: simulation.ticketExpected,
        ticketFrequencyRange: [Math.min(...simulation.ticketFrequency.map((entry) => entry.observed)), Math.max(...simulation.ticketFrequency.map((entry) => entry.observed))],
      },
    },
  });
  console.log("puzzles:test ok (P01-P09 all passed)");
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "puzzles:generate":
      await generateCommand(options);
      break;
    case "puzzles:validate":
      await validatePuzzlesCommand();
      console.log("puzzles:validate ok");
      break;
    case "puzzles:report":
      await reportCommand();
      break;
    case "pool:create":
      await poolCreateCommand();
      break;
    case "pool:validate":
      await poolValidateCommand();
      break;
    case "tickets:create":
      await ticketsCreateCommand(options);
      break;
    case "tickets:validate":
      await ticketsValidateCommand();
      break;
    case "selection:simulate":
      await simulateCommand(options);
      break;
    case "puzzles:test":
      await puzzlesTestCommand(options);
      break;
    default:
      throw new Error(`unknown R2 command: ${command}`);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
