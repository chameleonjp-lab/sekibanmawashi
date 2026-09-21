import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { createAssignment, preparePoolArtifacts } from "./run.ts";
import {
  LEGACY_STORAGE_KEYS,
  loadSave,
  readBest,
  saveAudioEnabled,
  saveBest,
  saveHelpSeen,
  saveName,
  STORAGE_KEYS,
  type BestRecord,
  type StorageLike,
} from "./storage.ts";

type Memory = StorageLike & { values: Map<string, string> };

function memory(initial: Record<string, string> = {}, enumerable = true): Memory {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    ...(enumerable ? {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
    } : {}),
  } as Memory;
}

test("S02 settings load independently and migrate only the known v1 fields", () => {
  const storage = memory({
    [LEGACY_STORAGE_KEYS.name]: JSON.stringify("  Luna  "),
    [LEGACY_STORAGE_KEYS.audio]: JSON.stringify(false),
  });
  const loaded = loadSave({ storage });
  assert.equal(loaded.name, "Luna");
  assert.equal(loaded.audioEnabled, false);
  assert.equal(loaded.helpSeen, false);
  assert.deepEqual(loaded.migration, { name: true, audio: true });
  assert.equal(storage.values.has(STORAGE_KEYS.name), true);
  assert.equal(storage.values.has(STORAGE_KEYS.audio), true);
});

test("S02 malformed fields produce field errors without hiding valid settings", () => {
  const storage = memory({
    [STORAGE_KEYS.name]: "not-json",
    [STORAGE_KEYS.audio]: JSON.stringify(false),
    [STORAGE_KEYS.helpSeen]: JSON.stringify(true),
    [STORAGE_KEYS.notice]: JSON.stringify(true),
  });
  const loaded = loadSave({ storage });
  assert.equal(loaded.name, "");
  assert.equal(loaded.audioEnabled, false);
  assert.equal(loaded.helpSeen, true);
  assert.equal(loaded.interrupted, true);
  assert.ok(loaded.errors.includes("name-corrupt"));
});

test("S02 help and audio writes remain independent", () => {
  const storage = memory();
  assert.deepEqual(saveName("Luna", storage), { ok: true });
  assert.deepEqual(saveAudioEnabled(false, storage), { ok: true });
  assert.deepEqual(saveHelpSeen(true, storage), { ok: true });
  const loaded = loadSave({ storage });
  assert.equal(loaded.name, "Luna");
  assert.equal(loaded.audioEnabled, false);
  assert.equal(loaded.helpSeen, true);
});

test("S02 a refreshed assignment persists lastSeen without restoring board state", () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "content", file), "utf8")) as unknown;
  const preparedResult = preparePoolArtifacts(read("puzzles-v2.json"), read("pool-v2.json"), read("tickets-v2.json"));
  assert.equal(preparedResult.ok, true);
  if (!preparedResult.ok) return;
  const assignment = createAssignment(preparedResult.prepared, {
    mode: "challenge",
    ticketIndex: 0,
    runId: "storage-run-01",
    nowWallMs: 1_700_000_000_000,
    nowMonotonicMs: 1,
  });
  const storage = memory({ [STORAGE_KEYS.assignment]: JSON.stringify(assignment) });
  const loaded = loadSave({ storage, prepared: preparedResult.prepared, nowWallMs: assignment.lastSeenWallMs + 1_000 });
  assert.equal(loaded.assignment?.lastSeenWallMs, assignment.lastSeenWallMs + 1_000);
  const stored = JSON.parse(storage.values.get(STORAGE_KEYS.assignment) ?? "null") as { lastSeenWallMs?: number };
  assert.equal(stored.lastSeenWallMs, assignment.lastSeenWallMs + 1_000);
  const loadedAgain = loadSave({ storage, prepared: preparedResult.prepared, nowWallMs: assignment.lastSeenWallMs + 2_000 });
  assert.equal(loadedAgain.assignment?.lastSeenWallMs, assignment.lastSeenWallMs + 2_000);
});

function validBest(overrides: Partial<BestRecord> = {}): BestRecord {
  return {
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    poolVersion: "pool-v2",
    generatorVersion: "generator-v2",
    ticketChecksum: "0123456789abcdef",
    runId: "storage-run-02",
    name: "Luna",
    mode: "challenge",
    totalTimeMs: 100,
    totalMoves: 5,
    completedAtWallMs: 1_700_000_000_000,
    abnormalClock: false,
    overLimits: false,
    ...overrides,
  };
}

test("S02 best records work with a non-enumerable adapter and never regress", () => {
  const storage = memory({}, false);
  const better = validBest({ totalTimeMs: 100 });
  const worse = validBest({ runId: "storage-run-03", totalTimeMs: 200 });
  assert.deepEqual(saveBest(better, storage), { ok: true });
  assert.deepEqual(saveBest(worse, storage), { ok: true });
  assert.deepEqual(readBest(storage, better.ticketChecksum), better);
});
