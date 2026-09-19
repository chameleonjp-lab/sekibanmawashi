import { ACTIVE_POOL_VERSION, RUN_ORDER } from "./config.ts";
import type { Puzzle } from "./types.ts";
import puzzlesJson from "./data/puzzles.json";
import ticketsJson from "./data/tickets.json";

export const PUZZLES = puzzlesJson as Puzzle[];
export const TICKETS = ticketsJson as string[][];

export const PUZZLE_BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));

export const POOL_VERSION = ACTIVE_POOL_VERSION;

export function getPuzzle(id: string): Puzzle | undefined {
  return PUZZLE_BY_ID.get(id);
}

export function puzzlesFromTicket(ids: string[]): Puzzle[] {
  const list: Puzzle[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const puzzle = PUZZLE_BY_ID.get(ids[i]);
    if (!puzzle) throw new Error(`unknown puzzle ${ids[i]}`);
    if (puzzle.difficulty !== RUN_ORDER[i]) throw new Error(`ticket order mismatch at ${i}`);
    list.push(puzzle);
  }
  return list;
}

export function pickPracticeTicket(): string[] {
  const i = Math.floor(Math.random() * TICKETS.length);
  return TICKETS[i] ?? TICKETS[0];
}

export function pickChallengeTicket(): string[] {
  const bytes = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return TICKETS[bytes[0] % TICKETS.length] ?? TICKETS[0];
}
