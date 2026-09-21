import {
  GENERATOR_VERSION,
  POOL_VERSION,
  RULESET_VERSION,
  SAVE_SCHEMA_VERSION,
  type UserSettings,
} from "./core/index.ts";
import { MAX_MOVES_TOTAL, MAX_RUN_TIME_MS, type Assignment, validatePlayerName, validateRunAssignment, type PreparedPool, type FinalRunResult } from "./run.ts";

/** v2 uses separate keys so one corrupt field cannot hide the other settings. */
export const STORAGE_PREFIX = "sekibanmawashi.v2.";
export const SAVE_KEY = `${STORAGE_PREFIX}save`;
export const STORAGE_KEYS = Object.freeze({
  name: `${STORAGE_PREFIX}name`,
  audio: `${STORAGE_PREFIX}audioEnabled`,
  helpSeen: `${STORAGE_PREFIX}helpSeen`,
  assignment: `${STORAGE_PREFIX}assignment`,
  bestPrefix: `${STORAGE_PREFIX}best.`,
  notice: `${STORAGE_PREFIX}interrupted`,
});

export const LEGACY_STORAGE_KEYS = Object.freeze({
  name: "sekibanmawashi.v1.playerTag",
  audio: "sekibanmawashi.v1.soundOn",
});

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  readonly length?: number;
  key?: (index: number) => string | null;
};

export type BestRecord = {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  poolVersion: typeof POOL_VERSION;
  generatorVersion: typeof GENERATOR_VERSION;
  ticketChecksum: string;
  runId: string;
  name: string;
  mode: "challenge";
  totalTimeMs: number;
  totalMoves: number;
  completedAtWallMs: number;
  abnormalClock: false;
  overLimits: false;
};

export type SaveSnapshot = {
  name: string;
  audioEnabled: boolean;
  helpSeen: boolean;
  assignment: Assignment | null;
  interrupted: boolean;
  best: BestRecord | null;
  migration: { name: boolean; audio: boolean };
  errors: string[];
};

export type WriteResult = { ok: true } | { ok: false; error: "unavailable" | "write-failed" };

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function jsonParse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

type ReadResult = { ok: true; value: string | null } | { ok: false; error: "unavailable" | "read-failed" };

function readRaw(storage: StorageLike | null, key: string): ReadResult {
  if (!storage) return { ok: false, error: "unavailable" };
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}

function writeRaw(storage: StorageLike | null, key: string, value: string): WriteResult {
  if (!storage) return { ok: false, error: "unavailable" };
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteSafe(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validAssignment(input: unknown, prepared: PreparedPool | undefined): input is Assignment {
  if (!prepared) return false;
  return validateRunAssignment(input, prepared).ok;
}

function validBest(input: unknown, expectedTicketChecksum?: string): input is BestRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  const allowedKeys = [
    "schemaVersion", "rulesetVersion", "poolVersion", "generatorVersion", "ticketChecksum", "runId",
    "name", "mode", "totalTimeMs", "totalMoves", "completedAtWallMs", "abnormalClock", "overLimits",
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return false;
  return (
    value.schemaVersion === SAVE_SCHEMA_VERSION && value.rulesetVersion === RULESET_VERSION &&
    value.poolVersion === POOL_VERSION && value.generatorVersion === GENERATOR_VERSION &&
    typeof value.ticketChecksum === "string" && /^[0-9a-f]{16}$/u.test(value.ticketChecksum) &&
    (expectedTicketChecksum === undefined || value.ticketChecksum === expectedTicketChecksum) &&
    typeof value.runId === "string" && /^[A-Za-z0-9_-]{8,128}$/u.test(value.runId) &&
    validatePlayerName(value.name).ok && value.mode === "challenge" &&
    isFiniteSafe(value.totalTimeMs) && value.totalTimeMs <= MAX_RUN_TIME_MS &&
    isFiniteSafe(value.totalMoves) && value.totalMoves <= MAX_MOVES_TOTAL && isFiniteSafe(value.completedAtWallMs) &&
    value.abnormalClock === false && value.overLimits === false
  );
}

function compareBest(left: BestRecord, right: BestRecord): number {
  return left.totalTimeMs - right.totalTimeMs || left.totalMoves - right.totalMoves || left.completedAtWallMs - right.completedAtWallMs;
}

function storageKeys(storage: StorageLike | null): string[] {
  const keys: string[] = [];
  try {
    if (!storage || typeof storage.length !== "number" || !Number.isSafeInteger(storage.length) || storage.length < 0 || typeof storage.key !== "function") return [];
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string") keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function supportsKeyEnumeration(storage: StorageLike | null): boolean {
  try {
    return Boolean(storage) && typeof storage?.length === "number" && typeof storage?.key === "function";
  } catch {
    return false;
  }
}

/** Read only valid v2 candidates; malformed records are ignored field-by-field. */
export function readBest(storage: StorageLike | null = browserStorage(), expectedTicketChecksum?: string): BestRecord | null {
  const candidates: BestRecord[] = [];
  for (const key of storageKeys(storage).filter((entry) => entry.startsWith(STORAGE_KEYS.bestPrefix))) {
    const raw = readRaw(storage, key);
    const parsed = jsonParse(raw.ok ? raw.value : null);
    if (validBest(parsed, expectedTicketChecksum)) candidates.push(parsed);
  }
  // This compatibility slot helps small test doubles that do not implement
  // key()/length. It is never overwritten by saveBest, so it cannot erase a
  // better append-only candidate from another tab.
  const aggregateRaw = readRaw(storage, `${STORAGE_PREFIX}best`);
  const aggregate = jsonParse(aggregateRaw.ok ? aggregateRaw.value : null);
  if (Array.isArray(aggregate)) for (const value of aggregate) if (validBest(value, expectedTicketChecksum)) candidates.push(value);
  candidates.sort(compareBest);
  return candidates[0] ?? null;
}

export function bestFromResult(result: FinalRunResult, name: string, nowWallMs = Date.now()): BestRecord | null {
  if (result.mode !== "challenge" || result.abnormalClock || result.overLimits ||
      !isFiniteSafe(result.totalTimeMs) || result.totalTimeMs > MAX_RUN_TIME_MS ||
      !isFiniteSafe(result.totalMoves) || result.totalMoves > MAX_MOVES_TOTAL) return null;
  const checkedName = validatePlayerName(name);
  if (!checkedName.ok) return null;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    poolVersion: POOL_VERSION,
    generatorVersion: GENERATOR_VERSION,
    ticketChecksum: result.assignment.ticketChecksum,
    runId: result.runId,
    name: checkedName.name,
    mode: "challenge",
    totalTimeMs: result.totalTimeMs,
    totalMoves: result.totalMoves,
    completedAtWallMs: Math.max(0, Math.floor(nowWallMs)),
    abnormalClock: false,
    overLimits: false,
  };
}

/** Append an immutable candidate: concurrent tabs cannot replace a better record. */
export function saveBest(record: BestRecord, storage: StorageLike | null = browserStorage()): WriteResult {
  if (!validBest(record)) return { ok: false, error: "write-failed" };
  const current = readBest(storage, record.ticketChecksum);
  if (current && compareBest(current, record) <= 0) return { ok: true };
  // Web Storage always exposes key()/length. A deliberately smaller storage
  // adapter can still be useful in tests or an embedded host, so retain the
  // same field validation through the compatibility aggregate there.
  if (!supportsKeyEnumeration(storage)) {
    const aggregateRaw = readRaw(storage, `${STORAGE_PREFIX}best`);
    const aggregate = jsonParse(aggregateRaw.ok ? aggregateRaw.value : null);
    const records = Array.isArray(aggregate) ? aggregate.filter((value): value is BestRecord => validBest(value, record.ticketChecksum)) : [];
    records.push(record);
    return writeRaw(storage, `${STORAGE_PREFIX}best`, JSON.stringify(records));
  }
  const candidateKey = `${STORAGE_KEYS.bestPrefix}${record.runId}.${record.completedAtWallMs}.${record.totalTimeMs}.${record.totalMoves}`;
  return writeRaw(storage, candidateKey, JSON.stringify(record));
}

export function saveName(name: string, storage: StorageLike | null = browserStorage()): WriteResult {
  const checked = validatePlayerName(name);
  if (!checked.ok) return { ok: false, error: "write-failed" };
  return writeRaw(storage, STORAGE_KEYS.name, JSON.stringify(checked.name));
}

export function saveAudioEnabled(enabled: boolean, storage: StorageLike | null = browserStorage()): WriteResult {
  if (!isBoolean(enabled)) return { ok: false, error: "write-failed" };
  return writeRaw(storage, STORAGE_KEYS.audio, JSON.stringify(enabled));
}

export function saveHelpSeen(seen: boolean, storage: StorageLike | null = browserStorage()): WriteResult {
  if (!isBoolean(seen)) return { ok: false, error: "write-failed" };
  return writeRaw(storage, STORAGE_KEYS.helpSeen, JSON.stringify(seen));
}

export function saveAssignment(assignment: Assignment, storage: StorageLike | null = browserStorage()): WriteResult {
  return writeRaw(storage, STORAGE_KEYS.assignment, JSON.stringify(assignment));
}

export function clearAssignment(storage: StorageLike | null = browserStorage()): WriteResult {
  if (!storage) return { ok: false, error: "unavailable" };
  try {
    storage.removeItem(STORAGE_KEYS.assignment);
    return { ok: true };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

export type SaveLoadOptions = { storage?: StorageLike | null; prepared?: PreparedPool; nowWallMs?: number };

export function loadSave(options: SaveLoadOptions = {}): SaveSnapshot {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const errors: string[] = [];
  let name = "";
  let audioEnabled = true;
  let helpSeen = false;
  let nameMigrated = false;
  let audioMigrated = false;

  if (!storage) errors.push("storage-unavailable");

  const nameRaw = readRaw(storage, STORAGE_KEYS.name);
  if (!nameRaw.ok) {
    if (nameRaw.error === "read-failed") errors.push("name-read");
  } else if (nameRaw.value !== null) {
    const nameParsed = jsonParse(nameRaw.value);
    if (nameParsed === undefined) errors.push("name-corrupt");
    else {
      const checked = validatePlayerName(nameParsed);
      if (checked.ok) name = checked.name;
      else errors.push("name-invalid");
    }
  } else {
    const old = readRaw(storage, LEGACY_STORAGE_KEYS.name);
    if (!old.ok) {
      if (old.error === "read-failed") errors.push("name-legacy-read");
    } else if (old.value !== null) {
      const oldValue = jsonParse(old.value);
      if (oldValue === undefined) errors.push("name-legacy-corrupt");
      else {
        const checked = validatePlayerName(oldValue);
        if (checked.ok) {
          name = checked.name;
          nameMigrated = saveName(name, storage).ok;
          if (!nameMigrated) errors.push("name-migration-write");
        }
      }
    }
  }

  const audioRaw = readRaw(storage, STORAGE_KEYS.audio);
  if (!audioRaw.ok) {
    if (audioRaw.error === "read-failed") errors.push("audio-read");
  } else if (audioRaw.value !== null) {
    const audioParsed = jsonParse(audioRaw.value);
    if (audioParsed === undefined) errors.push("audio-corrupt");
    else if (isBoolean(audioParsed)) audioEnabled = audioParsed;
    else errors.push("audio-invalid");
  } else {
    const old = readRaw(storage, LEGACY_STORAGE_KEYS.audio);
    if (!old.ok) {
      if (old.error === "read-failed") errors.push("audio-legacy-read");
    } else if (old.value !== null) {
      const oldValue = jsonParse(old.value);
      if (oldValue === undefined) errors.push("audio-legacy-corrupt");
      else if (isBoolean(oldValue)) {
        audioEnabled = oldValue;
        audioMigrated = saveAudioEnabled(audioEnabled, storage).ok;
        if (!audioMigrated) errors.push("audio-migration-write");
      }
    }
  }

  const helpRaw = readRaw(storage, STORAGE_KEYS.helpSeen);
  if (!helpRaw.ok) {
    if (helpRaw.error === "read-failed") errors.push("help-read");
  } else if (helpRaw.value !== null) {
    const helpParsed = jsonParse(helpRaw.value);
    if (helpParsed === undefined) errors.push("help-corrupt");
    else if (isBoolean(helpParsed)) helpSeen = helpParsed;
    else errors.push("help-invalid");
  }

  let assignment: Assignment | null = null;
  const assignmentRaw = readRaw(storage, STORAGE_KEYS.assignment);
  if (!assignmentRaw.ok) {
    if (assignmentRaw.error === "read-failed") errors.push("assignment-read");
  } else if (assignmentRaw.value !== null) {
    const parsedAssignment = jsonParse(assignmentRaw.value);
    if (parsedAssignment === undefined) {
      errors.push("assignment-corrupt");
      if (!clearAssignment(storage).ok) errors.push("assignment-clear");
    } else if (!options.prepared) {
      // Keep an opaque assignment until the checked artifact set is ready;
      // deleting it merely because loading happened in the wrong order would
      // defeat the 30-minute same-ticket retention guarantee.
      errors.push("assignment-unverified");
    } else if (validAssignment(parsedAssignment, options.prepared)) {
      const candidate = parsedAssignment as Assignment;
      const now = Math.floor(options.nowWallMs ?? Date.now());
      if (candidate.mode === "challenge" && candidate.incomplete && now >= candidate.lastSeenWallMs && now <= candidate.expiresAtWallMs) {
        assignment = { ...candidate, lastSeenWallMs: Math.max(candidate.lastSeenWallMs, now) };
        if (assignment.lastSeenWallMs !== candidate.lastSeenWallMs) {
          const refreshed = saveAssignment(assignment, storage);
          if (!refreshed.ok) errors.push("assignment-refresh");
        }
      } else if (candidate.mode === "challenge" && candidate.incomplete) {
        errors.push("assignment-expired");
        if (!clearAssignment(storage).ok) errors.push("assignment-clear");
      } else {
        // Completed or practice assignments are not resumable challenge state.
        if (!clearAssignment(storage).ok) errors.push("assignment-clear");
      }
    } else {
      errors.push("assignment-invalid");
      if (!clearAssignment(storage).ok) errors.push("assignment-clear");
    }
  }

  let interruptedNotice = false;
  const noticeRaw = readRaw(storage, STORAGE_KEYS.notice);
  if (!noticeRaw.ok) {
    if (noticeRaw.error === "read-failed") errors.push("notice-read");
  } else if (noticeRaw.value !== null) {
    const noticeParsed = jsonParse(noticeRaw.value);
    if (noticeParsed === undefined) errors.push("notice-corrupt");
    else if (isBoolean(noticeParsed)) interruptedNotice = noticeParsed;
    else errors.push("notice-invalid");
  }

  return {
    name,
    audioEnabled,
    helpSeen,
    assignment,
    interrupted: interruptedNotice || assignment?.incomplete === true,
    best: readBest(storage, options.prepared?.tickets.ticketChecksum),
    migration: { name: nameMigrated, audio: audioMigrated },
    errors,
  };
}

export function markInterrupted(storage: StorageLike | null = browserStorage()): WriteResult {
  return writeRaw(storage, STORAGE_KEYS.notice, JSON.stringify(true));
}

export function clearInterrupted(storage: StorageLike | null = browserStorage()): WriteResult {
  if (!storage) return { ok: false, error: "unavailable" };
  try {
    storage.removeItem(STORAGE_KEYS.notice);
    return { ok: true };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

export type { UserSettings };
