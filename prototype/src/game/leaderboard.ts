import {
  ACTIVE_POOL_VERSION,
  MAX_MOVES_PER_STAGE,
  MAX_MOVES_TOTAL,
  MAX_RUN_MS,
  PLAYER_TAG_MAX,
  PLAYER_TAG_MIN,
  RUN_ORDER,
} from "./config.ts";
import { replay } from "./engine.ts";
import { sanitizePlayerTag } from "./format.ts";
import { getPuzzle, pickChallengeTicket, PUZZLE_BY_ID } from "./pool.ts";
import type { LeaderboardRow, StageRecord } from "./types.ts";

const RUNS_KEY = "sekibanmawashi.v1.runs";
const BOARD_KEY = "sekibanmawashi.v1.board";

type StoredRun = {
  id: string;
  poolVersion: string;
  clientInstanceId: string;
  playerTag: string;
  puzzleIds: string[];
  status: "prepared" | "active" | "submitted";
};

type StoredEntry = {
  id: string;
  poolVersion: string;
  playerTag: string;
  totalTimeMs: number;
  totalMoves: number;
  puzzleIds: string[];
  submittedAt: string;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

function newToken(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export type PrepareInput = {
  clientInstanceId: string;
  playerTag: string;
};

export type PrepareResult = {
  runToken: string;
  poolVersion: string;
  puzzleIds: string[];
};

export async function prepareRun(data: PrepareInput): Promise<PrepareResult> {
  const playerTag = sanitizePlayerTag(data.playerTag);
  if (!playerTag) throw new Error("名前を入力してください");
  const runs = readJson<StoredRun[]>(RUNS_KEY, []);
  const existing = runs.find(
    (run) =>
      run.clientInstanceId === data.clientInstanceId &&
      (run.status === "prepared" || run.status === "active") &&
      run.poolVersion === ACTIVE_POOL_VERSION,
  );
  if (existing) {
    return {
      runToken: existing.id,
      poolVersion: existing.poolVersion,
      puzzleIds: existing.puzzleIds,
    };
  }
  const ticket = pickChallengeTicket();
  const id = newToken();
  runs.push({
    id,
    poolVersion: ACTIVE_POOL_VERSION,
    clientInstanceId: data.clientInstanceId,
    playerTag,
    puzzleIds: ticket,
    status: "prepared",
  });
  writeJson(RUNS_KEY, runs.slice(-40));
  return { runToken: id, poolVersion: ACTIVE_POOL_VERSION, puzzleIds: ticket };
}

export type SubmitInput = {
  runToken: string;
  clientInstanceId: string;
  playerTag: string;
  stages: StageRecord[];
  totalTimeMs: number;
  totalMoves: number;
};

export async function submitRun(data: SubmitInput): Promise<{ ok: true; duplicate: boolean }> {
  const playerTag = sanitizePlayerTag(data.playerTag);
  if (!playerTag) throw new Error("名前が不正です");
  if (data.playerTag.length < PLAYER_TAG_MIN || data.playerTag.length > PLAYER_TAG_MAX) {
    throw new Error("名前が不正です");
  }
  const runs = readJson<StoredRun[]>(RUNS_KEY, []);
  const run = runs.find((row) => row.id === data.runToken);
  if (!run) throw new Error("この挑戦は見つかりません");
  if (run.clientInstanceId !== data.clientInstanceId) {
    throw new Error("この挑戦は別の端末のものです");
  }
  if (run.status === "submitted") {
    return { ok: true, duplicate: true };
  }
  const expectedIds = run.puzzleIds;
  if (expectedIds.length !== 5) throw new Error("割り当てが壊れています");
  if (data.stages.length !== 5) throw new Error("5問の結果が必要です");

  let sumTime = 0;
  let sumMoves = 0;
  for (let i = 0; i < 5; i += 1) {
    const stage = data.stages[i];
    const puzzle = getPuzzle(expectedIds[i]);
    if (!puzzle || puzzle.id !== stage.puzzleId) throw new Error("問題が一致しません");
    if (puzzle.difficulty !== RUN_ORDER[i]) throw new Error("難度の順が違います");
    if (puzzle.contentChecksum !== stage.puzzleChecksum) throw new Error("問題が改変されています");
    if (stage.moveCount !== stage.actions.length) throw new Error("手数が一致しません");
    if (stage.actions.length > MAX_MOVES_PER_STAGE) throw new Error("手数が上限を超えています");
    let lastT = -1;
    for (let a = 0; a < stage.actions.length; a += 1) {
      const action = stage.actions[a];
      if (action.n !== a + 1) throw new Error("操作番号が連続していません");
      if (action.t < lastT) throw new Error("操作時刻が逆行しています");
      lastT = action.t;
    }
    if (stage.timeMs < lastT) throw new Error("問題タイムが短すぎます");
    const played = replay(puzzle, stage.actions);
    if (played.illegal || !played.solved) throw new Error("再生しても解けていません");
    sumTime += stage.timeMs;
    sumMoves += stage.moveCount;
  }
  if (sumTime !== data.totalTimeMs) throw new Error("合計時間が一致しません");
  if (sumMoves !== data.totalMoves) throw new Error("総手数が一致しません");
  if (sumTime > MAX_RUN_MS) throw new Error("制限時間を超えています");
  if (sumMoves > MAX_MOVES_TOTAL) throw new Error("総手数が上限を超えています");

  const board = readJson<StoredEntry[]>(BOARD_KEY, []);
  if (!board.some((row) => row.id === data.runToken)) {
    board.push({
      id: data.runToken,
      poolVersion: run.poolVersion,
      playerTag,
      totalTimeMs: data.totalTimeMs,
      totalMoves: data.totalMoves,
      puzzleIds: expectedIds,
      submittedAt: new Date().toISOString(),
    });
    writeJson(BOARD_KEY, board);
  }
  run.status = "submitted";
  writeJson(RUNS_KEY, runs);
  return { ok: true, duplicate: false };
}

export async function listLeaderboard(): Promise<LeaderboardRow[]> {
  const board = readJson<StoredEntry[]>(BOARD_KEY, []);
  return board
    .filter((row) => row.poolVersion === ACTIVE_POOL_VERSION)
    .sort(
      (a, b) =>
        a.totalTimeMs - b.totalTimeMs ||
        a.totalMoves - b.totalMoves ||
        a.submittedAt.localeCompare(b.submittedAt),
    )
    .slice(0, 10)
    .map((row) => ({
      playerTag: row.playerTag,
      totalTimeMs: row.totalTimeMs,
      totalMoves: row.totalMoves,
      submittedAt: row.submittedAt,
    }));
}

export function validateTicketShape(ids: string[]): boolean {
  if (ids.length !== 5) return false;
  if (ids.length !== new Set(ids).size) return false;
  return ids.every((id, i) => PUZZLE_BY_ID.get(id)?.difficulty === RUN_ORDER[i]);
}
