import type { Puzzle } from "../core/index.ts";
import {
  computeArtifactChecksum,
  computeTicketChecksum,
  normalizedTicketKey,
  R2_DIFFICULTIES,
  R2_HARD_APPEARANCES,
  R2_RUN_ORDER,
  R2_TICKET_COUNT,
  type Ticket,
  type PoolManifest,
  type TicketCalibration,
  type TicketManifest,
  validateTicketsArtifact,
} from "./validation.ts";
import { createSeededSource, shuffled, type Uint32Source } from "./random.ts";

export type TicketScore = {
  easyPair: number;
  normalPair: number;
  hardSingle: number;
  overall: number;
};

export type TicketBuildOptions = {
  seed?: number;
  calibration: TicketCalibration;
  scoreById: ReadonlyMap<string, number>;
  calibrationChecksum?: string;
};

type PairOccurrence = {
  first: string;
  second: string;
  score: number;
};

function scoreOf(id: string, scoreById: ReadonlyMap<string, number>): number {
  const score = scoreById.get(id);
  if (typeof score !== "number" || !Number.isFinite(score)) throw new Error(`missing finite calibrationScore for ${id}`);
  return score;
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * Produces 30 fixed-range perfect matchings. Each matching gives every ID one
 * partner, so every ID occurs exactly 60 times across the 900 pair slots. The
 * matching search prefers directed edges that have not appeared before to
 * keep the ticket set varied while retaining deterministic seeded output.
 */
export function balancedPairOccurrences(
  ids: readonly string[],
  scoreById: ReadonlyMap<string, number>,
  range: { min: number; max: number },
  nextUint32: Uint32Source,
): PairOccurrence[] {
  if (ids.length !== 30 || new Set(ids).size !== ids.length) throw new Error("pair source requires 30 unique IDs");
  const occurrences: PairOccurrence[] = [];
  const usedEdges = new Set<string>();
  const edgeScore = (first: string, second: string): number => {
    const score = scoreOf(first, scoreById) + scoreOf(second, scoreById);
    if (!inRange(score, range)) throw new Error(`pair calibration range cannot include ${first}/${second}: ${score}`);
    return score;
  };
  const matching = (): PairOccurrence[] | null => {
    const left = shuffled(ids, nextUint32);
    const targetToLeft = new Map<string, string>();
    const candidates = new Map<string, string[]>();
    for (const first of left) {
      const choices = ids.filter((second) => second !== first && inRange(scoreOf(first, scoreById) + scoreOf(second, scoreById), range));
      if (choices.length === 0) return null;
      const ordered = shuffled(choices, nextUint32).sort((a, b) => {
        const aUsed = usedEdges.has(`${first}\u0000${a}`) ? 1 : 0;
        const bUsed = usedEdges.has(`${first}\u0000${b}`) ? 1 : 0;
        return aUsed - bUsed;
      });
      candidates.set(first, ordered);
    }
    const assign = (first: string, seenTargets: Set<string>): boolean => {
      const choices = candidates.get(first) ?? [];
      for (const second of choices) {
        if (seenTargets.has(second)) continue;
        seenTargets.add(second);
        const previous = targetToLeft.get(second);
        if (!previous || assign(previous, seenTargets)) {
          targetToLeft.set(second, first);
          return true;
        }
      }
      return false;
    };
    for (const first of left) if (!assign(first, new Set<string>())) return null;
    return [...targetToLeft.entries()].map(([second, first]) => ({
      first,
      second,
      score: edgeScore(first, second),
    }));
  };
  for (let round = 0; round < 30; round += 1) {
    let edges: PairOccurrence[] | null = null;
    for (let attempt = 0; attempt < 128 && edges === null; attempt += 1) edges = matching();
    if (!edges) throw new Error("no perfect pair matching satisfies the fixed calibration range");
    for (const edge of edges) {
      occurrences.push(edge);
      usedEdges.add(`${edge.first}\u0000${edge.second}`);
    }
  }
  return shuffled(occurrences, nextUint32);
}

function occurrenceCounts(pairs: readonly PairOccurrence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.first, (counts.get(pair.first) ?? 0) + 1);
    counts.set(pair.second, (counts.get(pair.second) ?? 0) + 1);
  }
  return counts;
}

function assertPairOccurrences(pairs: readonly PairOccurrence[], ids: readonly string[]): void {
  if (pairs.length !== R2_TICKET_COUNT) throw new Error("pair occurrence count must be 900");
  const counts = occurrenceCounts(pairs);
  for (const id of ids) if (counts.get(id) !== 60) throw new Error(`${id} must occur exactly 60 times in pairs`);
}

function buildCandidates(
  pairs: readonly PairOccurrence[],
  idList: readonly string[],
  scoreById: ReadonlyMap<string, number>,
  range: { min: number; max: number },
  nextUint32: Uint32Source,
): PairOccurrence[] {
  const copy = shuffled(pairs, nextUint32);
  assertPairOccurrences(copy, idList);
  for (const pair of copy) {
    if (!inRange(pair.score, range)) throw new Error(`pair score outside fixed range: ${pair.score}`);
    if (!Number.isFinite(scoreOf(pair.first, scoreById) + scoreOf(pair.second, scoreById))) {
      throw new Error("pair score is not finite");
    }
  }
  return copy;
}

function tryCombine(
  easyPairs: readonly PairOccurrence[],
  normalPairs: readonly PairOccurrence[],
  hardIds: readonly string[],
  scoreById: ReadonlyMap<string, number>,
  calibration: TicketCalibration,
  nextUint32: Uint32Source,
): { tickets: Ticket[]; scores: TicketScore[] } | null {
  const easy = shuffled(easyPairs, nextUint32);
  const normal = shuffled(normalPairs, nextUint32);
  const hard = shuffled(
    hardIds.flatMap((id) => Array.from({ length: R2_HARD_APPEARANCES }, () => id)),
    nextUint32,
  );
  const seen = new Set<string>();
  const tickets: Ticket[] = [];
  const scores: TicketScore[] = [];
  for (let index = 0; index < R2_TICKET_COUNT; index += 1) {
    const easyPair = easy[index];
    const normalPair = normal[index];
    const hardId = hard[index];
    const ticket: Ticket = [easyPair.first, easyPair.second, normalPair.first, normalPair.second, hardId];
    const key = normalizedTicketKey(ticket);
    const score: TicketScore = {
      easyPair: easyPair.score,
      normalPair: normalPair.score,
      hardSingle: scoreOf(hardId, scoreById),
      overall: easyPair.score + normalPair.score + scoreOf(hardId, scoreById),
    };
    if (new Set(ticket).size !== ticket.length) return null;
    if (seen.has(key)) return null;
    if (!inRange(score.easyPair, calibration.thresholds.easyPair)) return null;
    if (!inRange(score.normalPair, calibration.thresholds.normalPair)) return null;
    if (!inRange(score.hardSingle, calibration.thresholds.hardSingle)) return null;
    if (!inRange(score.overall, calibration.thresholds.overall)) return null;
    seen.add(key);
    tickets.push(ticket);
    scores.push(score);
  }
  return { tickets, scores };
}

function ensureDifficultyIds(puzzles: readonly Puzzle[]): { easy: string[]; normal: string[]; hard: string[] } {
  const ids = { easy: [], normal: [], hard: [] } as { easy: string[]; normal: string[]; hard: string[] };
  for (const puzzle of puzzles) ids[puzzle.difficulty].push(puzzle.id);
  if (R2_DIFFICULTIES.some((difficulty) => ids[difficulty].length !== 30)) throw new Error("tickets require 30 IDs per difficulty");
  return ids;
}

export function createTicketsManifest(
  puzzles: readonly Puzzle[],
  pool: PoolManifest,
  options: TicketBuildOptions,
): { manifest: TicketManifest; scores: TicketScore[] } {
  if (options.calibration.puzzleChecksum !== pool.puzzleChecksum) throw new Error("calibration does not belong to this pool");
  const ids = ensureDifficultyIds(puzzles);
  const seed = options.seed ?? 0x5202_0900;
  const source = createSeededSource(seed);
  const rawEasy = balancedPairOccurrences(ids.easy, options.scoreById, options.calibration.thresholds.easyPair, source);
  const rawNormal = balancedPairOccurrences(ids.normal, options.scoreById, options.calibration.thresholds.normalPair, source);
  const easyPairs = buildCandidates(rawEasy, ids.easy, options.scoreById, options.calibration.thresholds.easyPair, source);
  const normalPairs = buildCandidates(rawNormal, ids.normal, options.scoreById, options.calibration.thresholds.normalPair, source);
  let result: { tickets: Ticket[]; scores: TicketScore[] } | null = null;
  for (let attempt = 0; attempt < 128 && result === null; attempt += 1) {
    result = tryCombine(easyPairs, normalPairs, ids.hard, options.scoreById, options.calibration, source);
  }
  if (!result) throw new Error("could not combine balanced pairs within fixed calibration thresholds");
  const calibrationChecksum = options.calibrationChecksum ?? computeArtifactChecksum(options.calibration);
  const draft: TicketManifest = {
    schemaVersion: 2,
    poolVersion: pool.poolVersion,
    rulesetVersion: pool.rulesetVersion,
    generatorVersion: pool.generatorVersion,
    poolChecksum: pool.poolChecksum,
    ticketCount: R2_TICKET_COUNT,
    tickets: result.tickets,
    calibrationVersion: options.calibration.calibrationVersion,
    calibrationChecksum,
    ticketChecksum: "",
  };
  draft.ticketChecksum = computeTicketChecksum(draft);
  return { manifest: draft, scores: result.scores };
}

export function validateTickets(
  input: unknown,
  puzzles: readonly Puzzle[],
  pool: PoolManifest,
  calibration?: TicketCalibration,
  scoreById?: ReadonlyMap<string, number>,
): ReturnType<typeof validateTicketsArtifact> {
  if (calibration && scoreById) return validateTicketsArtifact(input, { puzzles, pool, calibration, scoreById });
  if (calibration) return validateTicketsArtifact(input, { puzzles, pool, calibration });
  return validateTicketsArtifact(input, { puzzles, pool });
}

export function ticketDifficultyOrder(): typeof R2_RUN_ORDER {
  return R2_RUN_ORDER;
}

export type TicketPairDiversity = {
  easyPairKinds: number;
  normalPairKinds: number;
  hardKinds: number;
  minEasyPartners: number;
  minNormalPartners: number;
};

function pairKey(first: string, second: string): string {
  return [first, second].sort().join("\u0000");
}

export function ticketPairDiversity(tickets: readonly Ticket[]): TicketPairDiversity {
  const easyPairs = new Set<string>();
  const normalPairs = new Set<string>();
  const hard = new Set<string>();
  const easyPartners = new Map<string, Set<string>>();
  const normalPartners = new Map<string, Set<string>>();
  for (const ticket of tickets) {
    easyPairs.add(pairKey(ticket[0], ticket[1]));
    normalPairs.add(pairKey(ticket[2], ticket[3]));
    hard.add(ticket[4]);
    const easyLeft = easyPartners.get(ticket[0]) ?? new Set<string>();
    easyLeft.add(ticket[1]);
    easyPartners.set(ticket[0], easyLeft);
    const easyRight = easyPartners.get(ticket[1]) ?? new Set<string>();
    easyRight.add(ticket[0]);
    easyPartners.set(ticket[1], easyRight);
    const normalLeft = normalPartners.get(ticket[2]) ?? new Set<string>();
    normalLeft.add(ticket[3]);
    normalPartners.set(ticket[2], normalLeft);
    const normalRight = normalPartners.get(ticket[3]) ?? new Set<string>();
    normalRight.add(ticket[2]);
    normalPartners.set(ticket[3], normalRight);
  }
  const minPartners = (sets: ReadonlyMap<string, Set<string>>): number => {
    const values = [...sets.values()].map((set) => set.size);
    return values.length === 0 ? 0 : Math.min(...values);
  };
  return {
    easyPairKinds: easyPairs.size,
    normalPairKinds: normalPairs.size,
    hardKinds: hard.size,
    minEasyPartners: minPartners(easyPartners),
    minNormalPartners: minPartners(normalPartners),
  };
}
