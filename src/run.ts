import {
  GENERATOR_VERSION,
  POOL_VERSION,
  RULESET_VERSION,
  RUN_ORDER,
  SAVE_SCHEMA_VERSION,
  type Difficulty,
  type HistoryAction,
  type Puzzle,
} from "./core/index.ts";
import {
  R2_TICKET_COUNT,
  validatePoolArtifact,
  validatePuzzleCollection,
  validateTicketsArtifact,
  type PoolManifest,
  type Ticket,
  type TicketManifest,
} from "./puzzles/validation.ts";
import { uniformIndex } from "./puzzles/random.ts";

/** The two fixed delays are deliberately kept in one place for the UI and tests. */
export const COUNTDOWN_MS = 3_000;
export const INTERMISSION_MS = 1_000;
export const ASSIGNMENT_RETENTION_MS = 30 * 60 * 1_000;
export const MAX_MOVES_PER_QUESTION = 300;
export const MAX_MOVES_TOTAL = 1_500;
export const MAX_RUN_TIME_MS = 15 * 60 * 1_000;

/**
 * A normal device can have a small scheduling difference between the two
 * clocks.  Larger differences are recorded as an anomaly instead of silently
 * presenting the shorter clock as a better result.
 */
export const CLOCK_DISCREPANCY_THRESHOLD_MS = 5_000;
export const WALL_CLOCK_JUMP_THRESHOLD_MS = 60_000;

export type RunMode = "challenge" | "practice";
export type RunPhase = "loading" | "countdown" | "playing" | "intermission" | "result" | "cancelled";

export type ClockSource = {
  monotonicMs: () => number;
  wallMs: () => number;
};

export type TimerReference = "monotonic" | "wall" | "none";

export type TimerReading = {
  elapsedMs: number;
  reference: TimerReference;
  abnormal: boolean;
};

export type RunTimerOptions = {
  clocks?: ClockSource;
  discrepancyThresholdMs?: number;
  wallJumpThresholdMs?: number;
};

function defaultClocks(): ClockSource {
  return {
    monotonicMs: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    wallMs: () => Date.now(),
  };
}

function finiteClock(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Timer using both a monotonic source and wall clock.  Lifecycle notifications
 * are boundaries only; elapsed time is always calculated from the original
 * start, so repeated visibility/pagehide events cannot add the same interval
 * twice.  A hidden-page suspension is expected to stop performance.now() in
 * some mobile browsers, therefore that interval is allowed to use wall time
 * without being called an anomaly.  A clock jump while visible is flagged.
 */
export class RunTimer {
  private readonly clocks: ClockSource;
  private readonly discrepancyThresholdMs: number;
  private readonly wallJumpThresholdMs: number;
  private started = false;
  private stopped = false;
  private startMono = 0;
  private startWall = 0;
  private lastMono = 0;
  private lastWall = 0;
  private lastReading: TimerReading = { elapsedMs: 0, reference: "none", abnormal: false };
  private hidden = false;
  /** One visible sample may follow one or more duplicate hide/show events. */
  private suspensionBoundary = false;
  /** Keep the first post-resume reading on the suspension side of the boundary. */
  private suspensionGrace = false;
  private abnormal = false;

  constructor(options: RunTimerOptions = {}) {
    this.clocks = options.clocks ?? defaultClocks();
    this.discrepancyThresholdMs = options.discrepancyThresholdMs ?? CLOCK_DISCREPANCY_THRESHOLD_MS;
    this.wallJumpThresholdMs = options.wallJumpThresholdMs ?? WALL_CLOCK_JUMP_THRESHOLD_MS;
  }

  start(): TimerReading {
    const mono = finiteClock(this.clocks.monotonicMs());
    const wall = finiteClock(this.clocks.wallMs());
    this.started = true;
    this.stopped = false;
    this.startMono = mono;
    this.startWall = wall;
    this.lastMono = mono;
    this.lastWall = wall;
    this.hidden = false;
    this.suspensionBoundary = false;
    this.suspensionGrace = false;
    this.lastReading = { elapsedMs: 0, reference: "none", abnormal: false };
    this.abnormal = false;
    return this.lastReading;
  }

  /** Mark a page lifecycle boundary without adding an elapsed interval. */
  lifecycle(event: "hidden" | "visible" | "pagehide" | "pageshow"): void {
    if (event === "hidden" || event === "pagehide") {
      // Capture the visible interval immediately before entering suspension.
      // visibilitychange and pagehide can both fire for one transition, so a
      // second notification while already hidden is intentionally a no-op.
      if (!this.hidden) this.observe();
      this.hidden = true;
      return;
    }
    if (this.hidden) this.suspensionBoundary = true;
    this.hidden = false;
    this.observe();
  }

  observe(): TimerReading {
    if (!this.started) return this.lastReading;
    const { mono, wall } = this.sample();
    return this.readAt(mono, wall);
  }

  private sample(): { mono: number; wall: number } {
    return {
      mono: finiteClock(this.clocks.monotonicMs()),
      wall: finiteClock(this.clocks.wallMs()),
    };
  }

  /**
   * Consume one already-sampled clock pair. Keeping sampling outside this
   * method is important when a successful answer freezes a timer: stop() must
   * never observe a later callback's clock value.
   */
  private readAt(mono: number, wall: number): TimerReading {
    const previousMono = this.lastMono;
    const previousWall = this.lastWall;
    const monoDelta = mono - previousMono;
    const wallDelta = wall - previousWall;
    const lifecycleSuspension = this.hidden || this.suspensionBoundary;
    const grace = this.suspensionGrace;
    const suspension = lifecycleSuspension || grace;
    if (monoDelta < 0 || wallDelta < 0) this.abnormal = true;
    if (!suspension && Math.abs(monoDelta - wallDelta) > this.discrepancyThresholdMs) this.abnormal = true;
    // A long but matching interval is normal.  The threshold applies to an
    // unexplained wall-clock jump, not to the absolute length of a question.
    if (!suspension && wallDelta > this.wallJumpThresholdMs && Math.abs(monoDelta - wallDelta) > this.discrepancyThresholdMs) this.abnormal = true;
    if (lifecycleSuspension) {
      // Rebase both epochs at a mobile suspension boundary. This preserves
      // the wall-clock sleep interval once, then lets subsequent visible
      // samples compare like-for-like instead of carrying a permanent offset.
      const monoElapsed = Math.max(0, mono - this.startMono);
      const wallElapsed = Math.max(0, wall - this.startWall);
      const elapsed = Math.max(this.lastReading.elapsedMs, monoElapsed, wallElapsed);
      this.startMono = mono - elapsed;
      this.startWall = wall - elapsed;
    }
    if (mono >= previousMono) this.lastMono = mono;
    if (wall >= previousWall) this.lastWall = wall;
    if (lifecycleSuspension) this.suspensionGrace = true;
    this.suspensionBoundary = false;
    const monotonicElapsed = Math.max(0, mono - this.startMono);
    const wallElapsed = Math.max(0, wall - this.startWall);
    const difference = Math.abs(monotonicElapsed - wallElapsed);
    if (mono < this.startMono || wall < this.startWall) this.abnormal = true;
    if (!suspension && difference > this.discrepancyThresholdMs) this.abnormal = true;
    if (!suspension && Math.abs(wall - previousWall) > this.wallJumpThresholdMs && difference > this.discrepancyThresholdMs) this.abnormal = true;
    const useWall = wallElapsed > monotonicElapsed;
    const elapsedMs = Math.max(this.lastReading.elapsedMs, Math.floor(useWall ? wallElapsed : monotonicElapsed));
    this.lastReading = {
      elapsedMs,
      reference: useWall ? "wall" : "monotonic",
      abnormal: this.abnormal,
    };
    // One ordinary sample after resume is grace-protected. Consume that grace
    // only after calculating this sample so reading() immediately after a
    // pageshow cannot reinterpret the same boundary as a visible jump.
    if (!lifecycleSuspension && grace) this.suspensionGrace = false;
    return this.lastReading;
  }

  elapsed(): number {
    return this.reading().elapsedMs;
  }

  reading(): TimerReading {
    if (!this.started) return { elapsedMs: 0, reference: "none", abnormal: this.abnormal };
    if (this.stopped) return this.lastReading;
    const { mono, wall } = this.sample();
    return this.readAt(mono, wall);
  }

  stop(acceptedReading?: TimerReading): TimerReading {
    if (!this.started) return { elapsedMs: 0, reference: "none", abnormal: this.abnormal };
    if (!this.stopped) {
      // The UI may sample immediately before dispatching the successful move.
      // Accept only the exact object returned by this timer; a copied or
      // fabricated reading cannot inject a better result. This freezes the
      // accepted-input timestamp without a second clock read.
      if (acceptedReading !== undefined && acceptedReading === this.lastReading) {
        this.stopped = true;
        return this.lastReading;
      }
      // Take exactly one pair at the action/success boundary. This prevents
      // a delayed callback or a clock getter with observable side effects from
      // changing the recorded answer time during finalization.
      const { mono, wall } = this.sample();
      this.lastReading = this.readAt(mono, wall);
      this.stopped = true;
    }
    return this.lastReading;
  }

  reset(): void {
    this.started = false;
    this.stopped = false;
    this.suspensionBoundary = false;
    this.suspensionGrace = false;
    this.lastReading = { elapsedMs: 0, reference: "none", abnormal: false };
    this.abnormal = false;
  }

  isRunning(): boolean {
    return this.started && !this.stopped;
  }
}

export type PreparedPool = {
  puzzles: Puzzle[];
  pool: PoolManifest;
  tickets: TicketManifest;
  puzzlesById: ReadonlyMap<string, Puzzle>;
};

export type ArtifactLoad =
  | { ok: true; prepared: PreparedPool }
  | { ok: false; message: string; issues: { path: string; message: string }[] };

/** Validate all three bundled artifacts as one assignment boundary. */
export function preparePoolArtifacts(puzzlesInput: unknown, poolInput: unknown, ticketsInput: unknown): ArtifactLoad {
  const puzzlesResult = validatePuzzleCollection(puzzlesInput);
  if (!puzzlesResult.ok) return { ok: false, message: "問題庫の問題を確認できません", issues: puzzlesResult.issues };
  const puzzles = puzzlesResult.puzzles;
  if (!puzzles) return { ok: false, message: "問題庫の問題を確認できません", issues: [] };
  const poolResult = validatePoolArtifact(poolInput, puzzles);
  if (!poolResult.ok) return { ok: false, message: "問題庫の版を確認できません", issues: poolResult.issues };
  const pool = poolInput as PoolManifest;
  const ticketResult = validateTicketsArtifact(ticketsInput, { puzzles, pool });
  if (!ticketResult.ok) return { ok: false, message: "抽選券を確認できません", issues: ticketResult.issues };
  const tickets = ticketsInput as TicketManifest;
  return {
    ok: true,
    prepared: {
      puzzles,
      pool,
      tickets,
      puzzlesById: new Map(puzzles.map((puzzle) => [puzzle.id, puzzle])),
    },
  };
}

export type Assignment = {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  poolVersion: typeof POOL_VERSION;
  generatorVersion: typeof GENERATOR_VERSION;
  ticketChecksum: string;
  poolChecksum: string;
  ticketIndex: number;
  puzzleIds: Ticket;
  mode: RunMode;
  runId: string;
  assignedAtWallMs: number;
  assignedAtMonotonicMs: number;
  expiresAtWallMs: number;
  lastSeenWallMs: number;
  incomplete: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Name is display text, not an identifier: trim outer whitespace but retain
 * intentional internal spaces and Unicode code points. */
export function validatePlayerName(input: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof input !== "string") return { ok: false, message: "1〜16文字で名前を入力してください" };
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(input)) return { ok: false, message: "名前に制御文字は使えません" };
  const name = input.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 16) {
    return { ok: false, message: "1〜16文字で名前を入力してください" };
  }
  return { ok: true, name };
}

function ticketHasOrder(ticket: readonly string[], puzzlesById: ReadonlyMap<string, Puzzle>): ticket is Ticket {
  return ticket.length === RUN_ORDER.length && ticket.every((id, index) => puzzlesById.get(id)?.difficulty === RUN_ORDER[index]);
}

export function validateRunAssignment(input: unknown, prepared: PreparedPool): { ok: true; assignment: Assignment } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "割当がありません" };
  const required = [
    "schemaVersion", "rulesetVersion", "poolVersion", "generatorVersion", "ticketChecksum", "poolChecksum",
    "ticketIndex", "puzzleIds", "mode", "runId", "assignedAtWallMs", "assignedAtMonotonicMs",
    "expiresAtWallMs", "lastSeenWallMs", "incomplete",
  ];
  if (Object.keys(input).some((key) => !required.includes(key))) return { ok: false, message: "割当の形式が不正です" };
  if (input.schemaVersion !== SAVE_SCHEMA_VERSION || input.rulesetVersion !== RULESET_VERSION ||
      input.poolVersion !== POOL_VERSION || input.generatorVersion !== GENERATOR_VERSION) {
    return { ok: false, message: "割当の版が一致しません" };
  }
  if (input.ticketChecksum !== prepared.tickets.ticketChecksum || input.poolChecksum !== prepared.pool.poolChecksum) {
    return { ok: false, message: "割当の問題庫が一致しません" };
  }
  if (!safeInteger(input.ticketIndex) || input.ticketIndex < 0 || input.ticketIndex >= R2_TICKET_COUNT) {
    return { ok: false, message: "割当の番号が不正です" };
  }
  if (!Array.isArray(input.puzzleIds) || !ticketHasOrder(input.puzzleIds, prepared.puzzlesById) || new Set(input.puzzleIds).size !== 5) {
    return { ok: false, message: "割当の問題順が不正です" };
  }
  const ticket = prepared.tickets.tickets[input.ticketIndex];
  if (!ticket || JSON.stringify(ticket) !== JSON.stringify(input.puzzleIds)) return { ok: false, message: "割当券と問題が一致しません" };
  if (input.mode !== "challenge" && input.mode !== "practice") return { ok: false, message: "割当モードが不正です" };
  if (typeof input.runId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(input.runId)) return { ok: false, message: "挑戦IDが不正です" };
  const assignedAtWallMs = input.assignedAtWallMs;
  const assignedAtMonotonicMs = input.assignedAtMonotonicMs;
  const expiresAtWallMs = input.expiresAtWallMs;
  const lastSeenWallMs = input.lastSeenWallMs;
  if (!safeInteger(assignedAtWallMs) || assignedAtWallMs < 0 ||
      !safeInteger(assignedAtMonotonicMs) || assignedAtMonotonicMs < 0 ||
      !safeInteger(expiresAtWallMs) || expiresAtWallMs < 0 ||
      !safeInteger(lastSeenWallMs) || lastSeenWallMs < 0) {
    return { ok: false, message: "割当の時刻が不正です" };
  }
  if (expiresAtWallMs !== assignedAtWallMs + ASSIGNMENT_RETENTION_MS || lastSeenWallMs < assignedAtWallMs) {
    return { ok: false, message: "割当の期限が不正です" };
  }
  if (typeof input.incomplete !== "boolean") return { ok: false, message: "割当の状態が不正です" };
  return { ok: true, assignment: input as unknown as Assignment };
}

export type AssignmentCreateOptions = {
  mode: RunMode;
  nowWallMs?: number;
  nowMonotonicMs?: number;
  ticketIndex?: number;
  runId?: string;
  randomIndex?: (maxExclusive: number) => number;
};

function randomIndex(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const cryptoObject = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (cryptoObject?.getRandomValues) {
    return uniformIndex(() => {
      const values = new Uint32Array(1);
      cryptoObject.getRandomValues(values);
      return values[0] ?? 0;
    }, maxExclusive);
  }
  return uniformIndex(() => Math.floor(Math.random() * 0x1_0000_0000), maxExclusive);
}

function generatedRunId(nowWallMs: number): string {
  const source = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (source?.getRandomValues) {
    const values = new Uint32Array(4);
    source.getRandomValues(values);
    return `run-${values[0].toString(36)}-${values[1].toString(36)}-${values[2].toString(36)}-${values[3].toString(36)}`;
  }
  return `run-${Math.floor(nowWallMs).toString(36)}-${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
}

export function createAssignment(prepared: PreparedPool, options: AssignmentCreateOptions): Assignment {
  const nowWallMs = options.nowWallMs ?? Date.now();
  const nowMonotonicMs = options.nowMonotonicMs ?? (typeof performance !== "undefined" ? performance.now() : nowWallMs);
  const index = options.ticketIndex ?? (options.randomIndex ?? randomIndex)(R2_TICKET_COUNT);
  if (!Number.isInteger(index) || index < 0 || index >= R2_TICKET_COUNT) throw new Error("ticketIndex must be from 0 through 899");
  const ticket = prepared.tickets.tickets[index];
  if (!ticket || !ticketHasOrder(ticket, prepared.puzzlesById) || new Set(ticket).size !== 5) throw new Error("selected ticket is invalid");
  const assignment: Assignment = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    poolVersion: POOL_VERSION,
    generatorVersion: GENERATOR_VERSION,
    ticketChecksum: prepared.tickets.ticketChecksum,
    poolChecksum: prepared.pool.poolChecksum,
    ticketIndex: index,
    puzzleIds: [...ticket] as Ticket,
    mode: options.mode,
    runId: options.runId ?? generatedRunId(nowWallMs),
    assignedAtWallMs: Math.floor(nowWallMs),
    assignedAtMonotonicMs: Math.floor(nowMonotonicMs),
    expiresAtWallMs: Math.floor(nowWallMs) + ASSIGNMENT_RETENTION_MS,
    lastSeenWallMs: Math.floor(nowWallMs),
    incomplete: options.mode === "challenge",
  };
  const checked = validateRunAssignment(assignment, prepared);
  if (!checked.ok) throw new Error(checked.message);
  return checked.assignment;
}

export function assignmentIsFresh(assignment: Assignment, nowWallMs: number): boolean {
  if (assignment.mode !== "challenge") return true;
  // A backwards wall-clock jump never extends the retention window.
  return Number.isSafeInteger(nowWallMs) && nowWallMs >= assignment.lastSeenWallMs && nowWallMs <= assignment.expiresAtWallMs;
}

export function markAssignmentSeen(assignment: Assignment, nowWallMs: number): Assignment {
  if (!Number.isSafeInteger(nowWallMs) || nowWallMs < assignment.lastSeenWallMs) return assignment;
  return { ...assignment, lastSeenWallMs: nowWallMs };
}

export type QuestionRecord = {
  puzzleId: string;
  difficulty: Difficulty;
  timeMs: number;
  moves: number;
  history: HistoryAction[];
  timerReference: TimerReference;
  abnormalClock: boolean;
  overLimits: boolean;
};

export type RunState = {
  runId: string;
  mode: RunMode;
  assignment: Assignment;
  phase: RunPhase;
  questionIndex: number;
  records: QuestionRecord[];
  totalMoves: number;
  abnormalClock: boolean;
  overLimits: boolean;
};

export type FinalRunResult = {
  finalized: true;
  runId: string;
  mode: RunMode;
  assignment: Assignment;
  records: QuestionRecord[];
  totalTimeMs: number;
  totalMoves: number;
  abnormalClock: boolean;
  overLimits: boolean;
};

export function createRunState(assignment: Assignment): RunState {
  return {
    runId: assignment.runId,
    mode: assignment.mode,
    assignment,
    phase: "loading",
    questionIndex: 0,
    records: [],
    totalMoves: 0,
    abnormalClock: false,
    overLimits: false,
  };
}

export function finalizeRun(state: RunState): FinalRunResult {
  const tooManyRecords = state.records.length > RUN_ORDER.length;
  const records = state.records.slice(0, RUN_ORDER.length).map((record) => ({
    ...record,
    history: boundedHistory(record.history),
  }));
  const totalTimeMs = records.reduce((sum, record) => sum + record.timeMs, 0);
  const totalMoves = records.reduce((sum, record) => sum + record.moves, 0);
  const totalHistory = records.reduce((sum, record) => sum + record.history.length, 0);
  const historyOverLimit = state.records.some((record) => record.history.length > MAX_MOVES_PER_QUESTION) || totalHistory > MAX_MOVES_TOTAL;
  return {
    finalized: true,
    runId: state.runId,
    mode: state.mode,
    assignment: state.assignment,
    records,
    totalTimeMs,
    totalMoves,
    abnormalClock: state.abnormalClock || records.some((record) => record.abnormalClock),
    overLimits: state.overLimits || state.totalMoves > MAX_MOVES_TOTAL || tooManyRecords || historyOverLimit || totalMoves > MAX_MOVES_TOTAL || totalTimeMs > MAX_RUN_TIME_MS || records.some((record) => record.overLimits),
  };
}

export function isOverLimits(timeMs: number, questionMoves: number, totalMoves: number): boolean {
  return timeMs > MAX_RUN_TIME_MS || questionMoves > MAX_MOVES_PER_QUESTION || totalMoves > MAX_MOVES_TOTAL;
}

export function boundedHistory(history: readonly HistoryAction[], max = MAX_MOVES_PER_QUESTION): HistoryAction[] {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("history bound must be positive");
  return history.length <= max ? [...history] : history.slice(history.length - max);
}

export function formatTimeMs(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  return `${Math.floor(safe / 60_000).toString().padStart(2, "0")}:${Math.floor((safe % 60_000) / 1_000).toString().padStart(2, "0")}.${Math.floor((safe % 1_000) / 10).toString().padStart(2, "0")}`;
}

export function difficultyOrderIsValid(ids: readonly string[], puzzlesById: ReadonlyMap<string, Puzzle>): boolean {
  return ticketHasOrder(ids, puzzlesById);
}

export type { Ticket, TicketManifest, PoolManifest };
