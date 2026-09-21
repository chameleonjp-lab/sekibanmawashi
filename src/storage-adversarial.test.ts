import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATOR_VERSION,
  POOL_VERSION,
  RULESET_VERSION,
  SAVE_SCHEMA_VERSION,
} from "./core/constants.ts";
import { MAX_MOVES_TOTAL, MAX_RUN_TIME_MS } from "./run.ts";
import {
  readBest,
  STORAGE_PREFIX,
  STORAGE_KEYS,
  type BestRecord,
  type StorageLike,
} from "./storage.ts";

function validBest(overrides: Partial<BestRecord> = {}): BestRecord {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    poolVersion: POOL_VERSION,
    generatorVersion: GENERATOR_VERSION,
    ticketChecksum: "0123456789abcdef",
    runId: "fixture-run-01",
    name: "Luna",
    mode: "challenge",
    totalTimeMs: 12_345,
    totalMoves: 42,
    completedAtWallMs: 1_700_000_000_000,
    abnormalClock: false,
    overLimits: false,
    ...overrides,
  };
}

function keyedStorage(entries: Record<string, string>): StorageLike {
  const keys = Object.keys(entries);
  return {
    getItem: (key) => entries[key] ?? null,
    setItem: () => undefined,
    removeItem: () => undefined,
    length: keys.length,
    key: (index) => keys[index] ?? null,
  };
}

test("S01 storage read contains a throwing length getter", () => {
  const hostile: StorageLike = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    get length(): number {
      throw new Error("synthetic quota/storage length failure");
    },
    key: () => null,
  };
  assert.doesNotThrow(() => readBest(hostile));
  assert.equal(readBest(hostile), null);
});

test("S01 readBest survives a getItem that throws on its second call", () => {
  const key = `${STORAGE_KEYS.bestPrefix}fixture-run-01`;
  const aggregateKey = `${STORAGE_PREFIX}best`;
  const encoded = JSON.stringify(validBest());
  let bestCalls = 0;
  let aggregateCalls = 0;
  const hostile: StorageLike = {
    getItem: (requestedKey) => {
      if (requestedKey === key) {
        bestCalls += 1;
        if (bestCalls === 1) return encoded;
        throw new Error("synthetic read failure on repeated access");
      }
      if (requestedKey === aggregateKey) {
        aggregateCalls += 1;
        if (aggregateCalls === 1) return "[]";
        throw new Error("synthetic aggregate read failure on repeated access");
      }
      return null;
    },
    setItem: () => undefined,
    removeItem: () => undefined,
    length: 1,
    key: () => key,
  };
  const read = readBest(hostile);
  assert.deepEqual(read, validBest());
  assert.equal(bestCalls, 1, "the raw value is read once per storage key");
  assert.equal(aggregateCalls, 1, "the aggregate compatibility value is read once");
});

test("S03 malformed best records cannot enter the valid candidate set", () => {
  const records = [
    validBest({ mode: "practice" as BestRecord["mode"] }),
    validBest({ schemaVersion: (SAVE_SCHEMA_VERSION - 1) as BestRecord["schemaVersion"] }),
    validBest({ totalTimeMs: MAX_RUN_TIME_MS + 1 }),
    validBest({ totalMoves: MAX_MOVES_TOTAL + 1 }),
    validBest({ totalTimeMs: -1 }),
    validBest({ totalMoves: Number.MAX_SAFE_INTEGER + 1 }),
  ];
  const entries = Object.fromEntries(records.map((record, index) => [
    `${STORAGE_KEYS.bestPrefix}bad-${index}`,
    JSON.stringify(record),
  ]));
  assert.equal(readBest(keyedStorage(entries)), null);
});
