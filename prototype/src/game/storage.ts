import { makeClientInstanceId } from "./format.ts";
import type { StageRecord } from "./types.ts";

const PREFIX = "sekibanmawashi.v1.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

export function loadPlayerTag(): string {
  return read("playerTag", "");
}

export function savePlayerTag(tag: string) {
  write("playerTag", tag);
}

export function loadSoundOn(): boolean {
  return read("soundOn", true);
}

export function saveSoundOn(on: boolean) {
  write("soundOn", on);
}

export function loadClientId(): string {
  const existing = read<string>("clientId", "");
  if (existing) return existing;
  const id = makeClientInstanceId();
  write("clientId", id);
  return id;
}

export type PendingSubmit = {
  runToken: string;
  mode: "challenge";
  playerTag: string;
  clientInstanceId: string;
  stages: StageRecord[];
  totalTimeMs: number;
  totalMoves: number;
};

export function loadPendingSubmit(): PendingSubmit | null {
  return read<PendingSubmit | null>("pendingSubmit", null);
}

export function savePendingSubmit(pending: PendingSubmit | null) {
  if (!pending) {
    try {
      localStorage.removeItem(PREFIX + "pendingSubmit");
    } catch {
      /* ignore */
    }
    return;
  }
  write("pendingSubmit", pending);
}

export type LocalBest = {
  playerTag: string;
  totalTimeMs: number;
  totalMoves: number;
  submittedAt: string;
};

export function loadLocalBests(): LocalBest[] {
  return read<LocalBest[]>("localBests", []);
}

export function recordLocalBest(entry: LocalBest) {
  const list = loadLocalBests();
  list.push(entry);
  list.sort((a, b) => a.totalTimeMs - b.totalTimeMs || a.totalMoves - b.totalMoves);
  write("localBests", list.slice(0, 10));
}
