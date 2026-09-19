/**
 * Offline generator for the 90-puzzle pool and 900 draw tickets.
 * Run: node --experimental-strip-types tools/generate-puzzles.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_POOL_VERSION,
  GENERATOR_VERSION,
  RING_COUNT,
  RING_IDS,
  RULESET_VERSION,
  SCHEMA_VERSION,
  SLOT_COUNT,
} from "../src/game/config.ts";
import {
  applyMove,
  decodeState,
  encodeState,
  evaluate,
  isSolvedAtStart,
  STATE_SPACE,
} from "../src/game/engine.ts";
import { analyzePuzzle, calibrationScore } from "../src/game/solver.ts";
import type { BoardState, Difficulty, MoveType, Puzzle, RingDef, RingPart } from "../src/game/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/game/data");

type Band = {
  difficulty: Difficulty;
  minMoves: number;
  maxMoves: number;
  minRings: number;
  minToggles: number;
  maxSolutions: number;
  minTargets: number;
  maxTargets: number;
};

const BANDS: Band[] = [
  {
    difficulty: "easy",
    minMoves: 4,
    maxMoves: 6,
    minRings: 2,
    minToggles: 0,
    maxSolutions: 4,
    minTargets: 2,
    maxTargets: 3,
  },
  {
    difficulty: "normal",
    minMoves: 7,
    maxMoves: 10,
    minRings: 3,
    minToggles: 1,
    maxSolutions: 6,
    minTargets: 2,
    maxTargets: 4,
  },
  {
    difficulty: "hard",
    minMoves: 10,
    maxMoves: 15,
    minRings: 3,
    minToggles: 1,
    maxSolutions: 5,
    minTargets: 3,
    maxTargets: 5,
  },
];

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pickN<T>(rng: () => number, items: T[], n: number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function emptySlotsExcept(used: Set<number>): number[] {
  const out: number[] = [];
  for (let s = 0; s < SLOT_COUNT; s += 1) if (!used.has(s)) out.push(s);
  return out;
}

function placeRing(rng: () => number, id: RingDef["id"], band: Band): RingDef {
  const used = new Set<number>();
  const parts: RingPart[] = [];
  const emitterCount =
    band.difficulty === "hard" ? (rng() < 0.65 ? 2 : 1) : band.difficulty === "normal" ? 1 : 1;
  for (let i = 0; i < emitterCount; i += 1) {
    const free = emptySlotsExcept(used);
    const slot = free[pickInt(rng, 0, free.length - 1)];
    used.add(slot);
    parts.push({ kind: "emitter", slot });
  }
  let blockers = 0;
  if (band.difficulty === "easy") blockers = rng() < 0.75 ? 1 : 0;
  else if (band.difficulty === "normal") blockers = rng() < 0.4 ? 2 : 1;
  else blockers = rng() < 0.7 ? 2 : 1;
  for (let i = 0; i < blockers; i += 1) {
    const free = emptySlotsExcept(used);
    if (free.length === 0) break;
    const slot = free[pickInt(rng, 0, free.length - 1)];
    used.add(slot);
    parts.push({ kind: "blocker", slot });
  }
  parts.sort((a, b) => a.slot - b.slot);
  return { id, parts };
}

function randomState(rng: () => number): BoardState {
  const emissionEnabled: BoardState["emissionEnabled"] = [true, true, true];
  if (rng() < 0.35) emissionEnabled[pickInt(rng, 0, 2)] = false;
  if (!emissionEnabled.some(Boolean)) emissionEnabled[0] = true;
  return {
    rotations: [pickInt(rng, 0, 11), pickInt(rng, 0, 11), pickInt(rng, 0, 11)],
    emissionEnabled,
  };
}

function canonicalKey(puzzle: Puzzle): string {
  let best = "";
  for (let shift = 0; shift < SLOT_COUNT; shift += 1) {
    const rings = puzzle.rings.map((ring) => ({
      id: ring.id,
      parts: ring.parts
        .map((p) => ({ kind: p.kind, slot: (p.slot + shift) % SLOT_COUNT }))
        .sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind)),
    }));
    const targets = puzzle.targets.map((t) => (t + shift) % SLOT_COUNT).sort((a, b) => a - b);
    const key = JSON.stringify({ rings, targets });
    if (!best || key < best) best = key;
  }
  return best;
}

function checksumPayload(puzzle: Omit<Puzzle, "contentChecksum">): string {
  return JSON.stringify({
    schemaVersion: puzzle.schemaVersion,
    rulesetVersion: puzzle.rulesetVersion,
    generatorVersion: puzzle.generatorVersion,
    id: puzzle.id,
    difficulty: puzzle.difficulty,
    slotCount: puzzle.slotCount,
    rings: puzzle.rings,
    targets: puzzle.targets,
    initialState: puzzle.initialState,
  });
}

function collectSolved(puzzle: Puzzle): number[] {
  const solved: number[] = [];
  for (let code = 0; code < STATE_SPACE; code += 1) {
    if (evaluate(puzzle, decodeState(code)).solved) solved.push(code);
  }
  return solved;
}

function reverseDistances(allowToggle: boolean, goals: number[]): Int16Array {
  const dist = new Int16Array(STATE_SPACE);
  dist.fill(-1);
  const queue = new Int32Array(STATE_SPACE);
  let qh = 0;
  let qt = 0;
  for (const g of goals) {
    dist[g] = 0;
    queue[qt++] = g;
  }
  const moves: { type: MoveType; ring: number }[] = [];
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    moves.push({ type: "l", ring }, { type: "r", ring });
    if (allowToggle) moves.push({ type: "t", ring });
  }
  while (qh < qt) {
    const code = queue[qh++];
    const d = dist[code];
    const state = decodeState(code);
    for (const move of moves) {
      const ncode = encodeState(applyMove(state, move.type, move.ring));
      if (dist[ncode] !== -1) continue;
      dist[ncode] = d + 1;
      queue[qt++] = ncode;
    }
  }
  return dist;
}

function tryMake(
  rng: () => number,
  band: Band,
  index: number,
  bump: (reason: string) => void,
): Puzzle | null {
  const rings: [RingDef, RingDef, RingDef] = [
    placeRing(rng, RING_IDS[0], band),
    placeRing(rng, RING_IDS[1], band),
    placeRing(rng, RING_IDS[2], band),
  ];
  const goal = randomState(rng);
  const stub: Puzzle = {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: `${band.difficulty}-${String(index + 1).padStart(2, "0")}`,
    difficulty: band.difficulty,
    slotCount: SLOT_COUNT,
    rings,
    targets: [],
    initialState: goal,
    contentChecksum: "",
    shortestMoves: 0,
    shortestSolutionCount: 0,
    requiredRingIndexes: [],
    requiredToggleCount: 0,
    calibrationScore: 0,
  };
  const lit = evaluate(stub, goal).litSlots;
  if (lit.length < band.minTargets) {
    bump("few-lit");
    return null;
  }
  const maxT = Math.min(band.maxTargets, lit.length);
  const targetCount = pickInt(rng, band.minTargets, maxT);
  stub.targets = pickN(rng, lit, targetCount).sort((a, b) => a - b);

  const solved = collectSolved(stub);
  if (solved.length === 0) {
    bump("unsolvable-space");
    return null;
  }
  if (solved.length > 800) {
    bump("too-many-solved");
    return null;
  }

  const fullDist = reverseDistances(true, solved);
  const noTogDist = band.minToggles > 0 ? reverseDistances(false, solved) : null;
  const candidates: number[] = [];
  for (let code = 0; code < STATE_SPACE; code += 1) {
    const d = fullDist[code];
    if (d < band.minMoves || d > band.maxMoves) continue;
    if (noTogDist) {
      const nd = noTogDist[code];
      if (nd !== -1 && nd <= d) continue;
    }
    candidates.push(code);
  }
  if (candidates.length === 0) {
    bump("no-start");
    return null;
  }

  stub.initialState = decodeState(candidates[pickInt(rng, 0, candidates.length - 1)]);
  if (isSolvedAtStart(stub)) {
    bump("already-solved");
    return null;
  }

  const result = analyzePuzzle(stub);
  if (result.shortestMoves < band.minMoves || result.shortestMoves > band.maxMoves) {
    bump(`moves:${result.shortestMoves}`);
    return null;
  }
  if (result.shortestSolutionCount < 1 || result.shortestSolutionCount > band.maxSolutions) {
    bump(`sols:${result.shortestSolutionCount}`);
    return null;
  }
  if (result.requiredRingIndexes.length < band.minRings) {
    bump(`rings:${result.requiredRingIndexes.length}`);
    return null;
  }
  if (result.requiredToggleCount < band.minToggles) {
    bump("no-toggle");
    return null;
  }

  stub.shortestMoves = result.shortestMoves;
  stub.shortestSolutionCount = result.shortestSolutionCount;
  stub.requiredRingIndexes = result.requiredRingIndexes;
  stub.requiredToggleCount = result.requiredToggleCount;
  stub.calibrationScore = calibrationScore(result);
  stub.contentChecksum = sha256(checksumPayload(stub));
  return stub;
}

function generateBand(band: Band, seed: number): Puzzle[] {
  const rng = mulberry32(seed);
  const found: Puzzle[] = [];
  const keys = new Set<string>();
  let attempts = 0;
  const limit = 4000;
  const reasons: Record<string, number> = {};
  const bump = (r: string) => {
    reasons[r] = (reasons[r] ?? 0) + 1;
  };
  while (found.length < 30 && attempts < limit) {
    attempts += 1;
    const puzzle = tryMake(rng, band, found.length, bump);
    if (!puzzle) continue;
    const key = canonicalKey(puzzle);
    if (keys.has(key)) {
      bump("dup");
      continue;
    }
    keys.add(key);
    found.push(puzzle);
    process.stdout.write(
      `\r${band.difficulty} ${found.length}/30  attempts=${attempts}  moves=${puzzle.shortestMoves} tog=${puzzle.requiredToggleCount}   `,
    );
  }
  process.stdout.write("\n");
  if (found.length < 30) {
    console.error(band.difficulty, "reject reasons", reasons);
    throw new Error(`${band.difficulty}: only generated ${found.length}/30 after ${attempts} attempts`);
  }
  return found;
}

function balancedPairs(ids: string[], copies: number, seed: number): [string, string][] {
  const rng = mulberry32(seed);
  const bag: string[] = [];
  for (const id of ids) for (let i = 0; i < copies; i += 1) bag.push(id);
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i < bag.length; i += 2) {
    let a = bag[i];
    let b = bag[i + 1];
    if (a === b) {
      for (let k = i + 2; k < bag.length; k += 1) {
        if (bag[k] !== a) {
          b = bag[k];
          bag[k] = bag[i + 1];
          bag[i + 1] = b;
          break;
        }
      }
    }
    if (a === b) throw new Error("failed to derange identical pair");
    pairs.push([a, b]);
  }
  return pairs;
}

function buildTickets(puzzles: Puzzle[]): string[][] {
  const easy = puzzles.filter((p) => p.difficulty === "easy").map((p) => p.id);
  const normal = puzzles.filter((p) => p.difficulty === "normal").map((p) => p.id);
  const hard = puzzles.filter((p) => p.difficulty === "hard").map((p) => p.id);
  const easyPairs = balancedPairs(easy, 60, 0xa11ce);
  const normalPairs = balancedPairs(normal, 60, 0xb0b5);
  const tickets: string[][] = [];
  for (let i = 0; i < 900; i += 1) {
    tickets.push([
      easyPairs[i][0],
      easyPairs[i][1],
      normalPairs[i][0],
      normalPairs[i][1],
      hard[i % 30],
    ]);
  }
  const count = new Map<string, number>();
  for (const t of tickets) for (const id of t) count.set(id, (count.get(id) ?? 0) + 1);
  for (const id of easy) if (count.get(id) !== 60) throw new Error(`easy ${id} count ${count.get(id)}`);
  for (const id of normal) if (count.get(id) !== 60) throw new Error(`normal ${id} count ${count.get(id)}`);
  for (const id of hard) if (count.get(id) !== 30) throw new Error(`hard ${id} count ${count.get(id)}`);
  return tickets;
}

function main() {
  const seedBase = 20260919;
  const easy = generateBand(BANDS[0], seedBase + 1);
  const normal = generateBand(BANDS[1], seedBase + 2);
  const hard = generateBand(BANDS[2], seedBase + 3);
  const puzzles = [...easy, ...normal, ...hard];
  const tickets = buildTickets(puzzles);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "puzzles.json"), JSON.stringify(puzzles));
  writeFileSync(join(OUT_DIR, "tickets.json"), JSON.stringify(tickets));
  const pool = {
    schemaVersion: SCHEMA_VERSION,
    poolVersion: ACTIVE_POOL_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    puzzleIdsByDifficulty: {
      easy: easy.map((p) => p.id),
      normal: normal.map((p) => p.id),
      hard: hard.map((p) => p.id),
    },
    drawProfile: {
      order: ["easy", "easy", "normal", "normal", "hard"],
      ticketCount: tickets.length,
      easyAppearancesPerPuzzle: 60,
      normalAppearancesPerPuzzle: 60,
      hardAppearancesPerPuzzle: 30,
    },
    nonce: randomBytes(8).toString("hex"),
  };
  writeFileSync(join(OUT_DIR, "pool.json"), JSON.stringify(pool, null, 2));
  console.log(`wrote ${puzzles.length} puzzles and ${tickets.length} tickets`);
}

main();
