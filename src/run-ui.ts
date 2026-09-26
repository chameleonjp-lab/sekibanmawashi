import {
  acceptRotation,
  createSession,
  evaluate,
  selectRing as selectCoreRing,
} from "./core/engine.ts";
import { GAME_TITLE } from "./core/index.ts";
import type { CoreSession, MoveType, Puzzle } from "./core/types.ts";
import { createBoardSvg } from "./board.ts";
import {
  InputController,
  isActivationKey,
  isEditableTarget,
  type InputPhase,
} from "./input.ts";
import {
  ASSIGNMENT_RETENTION_MS,
  INTERMISSION_MS,
  boundedHistory,
  createAssignment,
  createRunState,
  finalizeRun,
  isOverLimits,
  markAssignmentSeen,
  RunTimer,
  type FinalRunResult,
  type PreparedPool,
  type QuestionRecord,
  type RunMode,
  type RunPhase,
  type RunState,
  type TimerReading,
  validatePlayerName,
} from "./run.ts";
import {
  bestFromResult,
  clearAssignment,
  clearInterrupted,
  loadSave,
  saveAssignment,
  saveAudioEnabled,
  saveBest,
  saveHelpSeen,
  saveName,
} from "./storage.ts";
import { LAB_URL, PUBLIC_GAME_URL, shareOrCopy, shareText } from "./share.ts";
import { SoundController } from "./sound.ts";

const DIFFICULTY_LABELS: Record<Puzzle["difficulty"], string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
};

type ModalName = "help" | "abort";
type HomeOptions = { notice?: string; prefill?: string };
type RunOptions = { storageWarning?: string };
type FinalizedResultRecovery = {
  prepared: PreparedPool;
  result: FinalRunResult;
  playerName: string;
  initialNotice: string;
};

const teardownByRoot = new WeakMap<HTMLElement, () => void>();
const finalizedResultByRoot = new WeakMap<HTMLElement, FinalizedResultRecovery>();
let attemptSerial = 0;

function query<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function formatElapsed(ms: number, includeUnit = true): string {
  const safe = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : 0;
  return `${(Math.floor(safe / 10) / 100).toFixed(2)}${includeUnit ? "秒" : ""}`;
}

function storageMessage(error: "unavailable" | "write-failed"): string {
  return error === "unavailable"
    ? "この端末では保存を利用できません。結果は参考記録として表示します。"
    : "この端末に保存できませんでした。結果は参考記録として表示します。";
}

function teardownRoot(root: HTMLElement): void {
  teardownByRoot.get(root)?.();
  teardownByRoot.delete(root);
}

/** Dispose run/result listeners and timers when the app-level boundary takes over. */
export function teardownRunUi(root: HTMLElement): void {
  teardownRoot(root);
}

/** Whether a fully finalized in-memory result can be rebuilt after an exception. */
export function hasFinalizedResultRecovery(root: HTMLElement): boolean {
  return finalizedResultByRoot.has(root);
}

/** Rebuild the saved result through the normal renderer so its actions work. */
export function restoreFinalizedResult(root: HTMLElement): boolean {
  const recovery = finalizedResultByRoot.get(root);
  if (!recovery) return false;
  renderResult(root, recovery.prepared, recovery.result, recovery.playerName, recovery.initialNotice);
  return true;
}

function renderArtifactError(root: HTMLElement, message: string): void {
  teardownRoot(root);
  finalizedResultByRoot.delete(root);
  root.innerHTML = `
    <section class="app-shell load-error-screen" data-testid="load-error" data-error="artifact" role="alert">
      <h1>問題を読み込めません</h1>
      <p>${message}</p>
      <p class="muted-copy">問題庫を確認してから、もう一度読み込んでください。</p>
      <div class="fatal-error-actions">
        <button type="button" class="primary-button" data-action="reload">もう一度読み込む</button>
        <a class="secondary-button" href="${typeof window === "undefined" ? "/" : new URL("./", window.location.href).href}">ホームへ戻る</a>
        <a class="secondary-button" href="${LAB_URL}">実験場へ戻る</a>
      </div>
    </section>
  `;
  query<HTMLButtonElement>(root, "[data-action='reload']")?.addEventListener("click", () => window.location.reload());
}

function renderHomeError(root: HTMLElement, message: string): void {
  const existing = query<HTMLElement>(root, "[data-field='home-error']");
  if (existing) {
    existing.hidden = false;
    existing.textContent = message;
  }
}

function displayName(snapshotName: string, prefill: string | undefined): string {
  return prefill ?? snapshotName;
}

function uniqueAttemptId(seed: string): string {
  attemptSerial += 1;
  const random = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return `${seed.slice(0, 70)}-${Date.now().toString(36)}-${attemptSerial.toString(36)}-${random}`.slice(0, 128);
}

/** Render the default home screen. The puzzle query path remains owned by app.ts. */
export function renderHome(root: HTMLElement, prepared: PreparedPool, options: HomeOptions = {}): void {
  teardownRoot(root);
  finalizedResultByRoot.delete(root);
  let snapshot;
  try {
    snapshot = loadSave({ prepared });
  } catch {
    snapshot = {
      name: "",
      audioEnabled: true,
      assignment: null,
      interrupted: false,
      best: null,
      migration: { name: false, audio: false },
      errors: ["save"],
    };
  }

  root.innerHTML = `
    <section class="app-shell home-screen" data-testid="home-screen" data-screen="home" data-mode="home">
      <header class="app-header home-header">
        <div>
          <p class="eyebrow">常時発光・回転パズル</p>
          <h1 id="home-title">${GAME_TITLE}</h1>
          <p class="subtitle">三本の環を回して、5問を続けて解きます。</p>
        </div>
        <a class="secondary-button home-lab-link" href="${LAB_URL}">実験場へ戻る</a>
      </header>

      <main class="home-main" aria-labelledby="home-title">
        <section class="home-card start-card" aria-labelledby="start-title">
          <h2 id="start-title">挑戦を始める</h2>
          <p class="home-lead">名前を入力して、初級2問・中級2問・上級1問に挑みます。</p>
          <label class="name-field" for="player-name">名前（1〜16文字）</label>
          <input id="player-name" name="name" type="text" autocomplete="name" data-field="player-name" aria-describedby="name-hint name-error" />
          <p id="name-hint" class="field-hint">記録はこの端末に保存されます。</p>
          <p id="name-error" class="field-error" data-field="name-error" role="alert" hidden></p>
          <div class="start-actions">
            <form data-mode="challenge">
              <button type="submit" class="primary-button" data-action="start-challenge">チャレンジを始める</button>
            </form>
            <form data-mode="practice">
              <button type="submit" class="secondary-button" data-action="start-practice">練習を始める</button>
            </form>
          </div>
          <label class="audio-setting home-audio"><input type="checkbox" data-action="audio" id="home-audio" /> 音を有効にする</label>
          <p class="storage-note">記録はこの端末に保存されます。</p>
          <div class="home-share-row">
            <button type="button" class="secondary-button" data-action="home-share">このゲームを共有</button>
            <span class="share-inline" data-home-share-status aria-live="polite"></span>
          </div>
          <div class="result-share-area" data-home-share-area hidden></div>
        </section>

        <section class="home-card home-info-card" aria-labelledby="home-info-title">
          <h2 id="home-info-title">遊び方</h2>
          <ol class="how-list">
            <li>操作する環を選びます。選択は手数に数えません。</li>
            <li>左または右へ一区画ずつ回します。</li>
            <li>必要な受光紋をすべて点灯させます。</li>
          </ol>
          <p class="muted-copy">5問の問題を準備してから始まります。</p>
        </section>

        <section class="home-card best-card" aria-labelledby="best-title">
          <h2 id="best-title">この端末の自己ベスト</h2>
          <div data-best-record>
            <p data-best-empty class="muted-copy">まだチャレンジの記録はありません。</p>
            <p data-best-details hidden><strong data-best-time></strong><span data-best-moves></span><span data-best-name></span></p>
          </div>
        </section>

        <p class="home-notice" data-field="home-notice" role="status" hidden></p>
        <p class="home-error" data-field="home-error" role="alert" hidden></p>
      </main>

      <footer class="home-footer"><a href="${PUBLIC_GAME_URL}">ゲームURL</a></footer>
    </section>
  `;

  const shell = query<HTMLElement>(root, "[data-testid='home-screen']");
  const input = query<HTMLInputElement>(root, "[data-field='player-name']");
  const challengeForm = query<HTMLFormElement>(root, "form[data-mode='challenge']");
  const practiceForm = query<HTMLFormElement>(root, "form[data-mode='practice']");
  const audio = query<HTMLInputElement>(root, "[data-action='audio']");
  const nameError = query<HTMLElement>(root, "[data-field='name-error']");
  const notice = query<HTMLElement>(root, "[data-field='home-notice']");
  const bestEmpty = query<HTMLElement>(root, "[data-best-empty]");
  const bestDetails = query<HTMLElement>(root, "[data-best-details]");
  const bestTime = query<HTMLElement>(root, "[data-best-time]");
  const bestMoves = query<HTMLElement>(root, "[data-best-moves]");
  const bestName = query<HTMLElement>(root, "[data-best-name]");
  const homeShare = query<HTMLButtonElement>(root, "[data-action='home-share']");
  const homeShareArea = query<HTMLElement>(root, "[data-home-share-area]");
  if (!shell || !input || !challengeForm || !practiceForm || !audio || !nameError || !notice || !bestEmpty || !bestDetails || !bestTime || !bestMoves || !bestName || !homeShare || !homeShareArea) return;
  const sound = new SoundController({ enabled: snapshot.audioEnabled });

  input.value = displayName(snapshot.name, options.prefill);
  audio.checked = snapshot.audioEnabled;
  if (snapshot.best) {
    bestEmpty.hidden = true;
    bestDetails.hidden = false;
    bestTime.textContent = formatElapsed(snapshot.best.totalTimeMs);
    bestMoves.textContent = ` / ${snapshot.best.totalMoves}手`;
    bestName.textContent = `（${snapshot.best.name}）`;
  }
  if (snapshot.interrupted) {
    notice.hidden = false;
    notice.textContent = "前回の挑戦は中断されました。次のチャレンジでは同じ問題割当を使います。盤面は復元しません。";
  } else if (options.notice) {
    notice.hidden = false;
    notice.textContent = options.notice;
  }
  if (snapshot.errors.length > 0 && !snapshot.interrupted) {
    notice.hidden = false;
    notice.textContent = "保存データの一部を読み込めませんでした。新しい設定で続けられます。";
  }

  const controller = new AbortController();
  let shareRequestSerial = 0;
  const setNameError = (message = ""): void => {
    nameError.textContent = message;
    nameError.hidden = message.length === 0;
  };
  const start = (mode: RunMode): void => {
    const checked = validatePlayerName(input.value);
    if (!checked.ok) {
      void sound.unlockFromGesture().then((ready) => { if (ready) sound.play("error"); });
      setNameError(checked.message);
      input.focus();
      return;
    }
    void sound.unlockFromGesture();
    setNameError();
    const nameWrite = saveName(checked.name);
    let warning = nameWrite.ok ? "" : storageMessage(nameWrite.error);
    let assignment;
    try {
      const nowWallMs = Math.floor(Date.now());
      const reusable = mode === "challenge" && snapshot.assignment && assignmentIsFreshForUi(snapshot.assignment, nowWallMs)
        ? createAssignment(prepared, {
          mode: "challenge",
          ticketIndex: snapshot.assignment.ticketIndex,
          // Keep the held ticket and its original expiry, but give every
          // attempt a fresh identity so stale callbacks cannot enter a later
          // attempt that happens to use the same five puzzle IDs.
          runId: uniqueAttemptId(snapshot.assignment.runId),
          nowWallMs: snapshot.assignment.assignedAtWallMs,
          nowMonotonicMs: snapshot.assignment.assignedAtMonotonicMs,
        })
        : null;
      assignment = reusable ? markAssignmentSeen(reusable, nowWallMs) : createAssignment(prepared, { mode });
      if (mode === "challenge") {
        const assignmentWrite = saveAssignment(assignment);
        if (!assignmentWrite.ok) warning = warning || storageMessage(assignmentWrite.error);
      }
      const noticeWrite = clearInterrupted();
      if (!noticeWrite.ok && mode === "challenge") warning = warning || storageMessage(noticeWrite.error);
    } catch {
      renderHomeError(root, "問題の割当を作成できませんでした。時間を置いて再試行してください。");
      return;
    }
    renderRun(root, prepared, assignment, checked.name, warning ? { storageWarning: warning } : undefined);
  };

  challengeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    start("challenge");
  }, { signal: controller.signal });
  practiceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    start("practice");
  }, { signal: controller.signal });
  audio.addEventListener("change", () => {
    sound.setEnabled(audio.checked);
    if (audio.checked) void sound.unlockFromGesture();
    const result = saveAudioEnabled(audio.checked);
    if (!result.ok) {
      notice.hidden = false;
      notice.textContent = storageMessage(result.error);
    }
  }, { signal: controller.signal });
  homeShare.addEventListener("click", () => {
    void sound.unlockFromGesture();
    const status = query<HTMLElement>(root, "[data-home-share-status]");
    if (status) status.textContent = "";
    homeShareArea.hidden = true;
    homeShareArea.replaceChildren();
    const message = shareText();
    const originShell = shell;
    const requestSerial = ++shareRequestSerial;
    void shareOrCopy(message).then((result) => {
      if (requestSerial !== shareRequestSerial || !originShell.isConnected || !root.contains(originShell)) return;
      if (result.status === "cancelled") return;
      const currentStatus = query<HTMLElement>(root, "[data-home-share-status]");
      if (!currentStatus) return;
      if (result.status === "selectable") {
        homeShareArea.hidden = false;
        homeShareArea.innerHTML = `<label for="home-share-text">共有文（選択してコピーできます）</label><textarea id="home-share-text" data-share-text readonly rows="4"></textarea>`;
        const field = query<HTMLTextAreaElement>(homeShareArea, "[data-share-text]");
        if (field) field.value = result.text;
        currentStatus.textContent = "共有文を選択できます。";
        return;
      }
      currentStatus.textContent = result.status === "copied" ? "共有文をコピーしました。" : "共有しました。";
    });
  }, { signal: controller.signal });
  teardownByRoot.set(root, () => {
    controller.abort();
    sound.dispose();
  });
}

function assignmentIsFreshForUi(assignment: Parameters<typeof markAssignmentSeen>[0], nowWallMs: number): boolean {
  // Keep this small wrapper local so the UI never treats a clock rollback as a
  // reason to extend the 30-minute retention window.
  return assignment.mode === "challenge" && nowWallMs >= assignment.lastSeenWallMs && nowWallMs <= assignment.expiresAtWallMs && assignment.expiresAtWallMs === assignment.assignedAtWallMs + ASSIGNMENT_RETENTION_MS;
}

function inputPhaseForRun(phase: RunPhase): InputPhase {
  if (phase === "playing") return "playing";
  if (phase === "countdown") return "countdown";
  if (phase === "cancelled") return "cancelled";
  if (phase === "result") return "solved";
  return "loading";
}

function resultTimeLabel(record: QuestionRecord): string {
  return formatElapsed(record.timeMs);
}

/** Render and drive one five-question run. */
export function renderRun(
  root: HTMLElement,
  prepared: PreparedPool,
  initialAssignment: Parameters<typeof createRunState>[0],
  playerName: string,
  options: RunOptions = {},
): void {
  teardownRoot(root);
  finalizedResultByRoot.delete(root);
  let assignment = initialAssignment;
  let runState: RunState = createRunState(assignment);
  let phase: RunPhase = "loading";
  let questionIndex = 0;
  let currentPuzzle: Puzzle | null = null;
  let session: CoreSession | null = null;
  let selectedRing = 1;
  let actualMoves = 0;
  let currentTimeMs = 0;
  let countdownValue = 3;
  let activeModal: ModalName | null = null;
  let modalOpener: HTMLButtonElement | null = null;
  let timer: RunTimer | null = null;
  let timerInterval: number | null = null;
  let countdownInterval: number | null = null;
  let countdownTimeout: number | null = null;
  let intermissionTimeout: number | null = null;
  let disposed = false;
  let generation = 0;
  let storageWarning = options.storageWarning ?? "";
  const scheduled = new Set<number>();

  root.innerHTML = `
    <section class="app-shell game-screen" data-testid="game-screen" data-screen="game" data-mode="${assignment.mode}" data-phase="loading" data-run-phase="loading">
      <div class="game-content" data-game-content>
        <header class="app-header">
          <div>
            <p class="eyebrow">${assignment.mode === "challenge" ? "5問チャレンジ" : "5問練習"}</p>
            <h1 id="game-title">${GAME_TITLE}</h1>
            <p class="subtitle">三本の環を選び、左右へ一区画ずつ回します。</p>
          </div>
          <div class="header-actions" aria-label="補助操作">
            <button type="button" class="secondary-button" data-action="help" id="how-to-play">遊び方</button>
            <button type="button" class="secondary-button" data-action="abort" id="abort-game">中断</button>
          </div>
        </header>

        <section class="puzzle-status" aria-labelledby="puzzle-status-title">
          <h2 id="puzzle-status-title" class="visually-hidden">問題の状態</h2>
          <div class="status-card"><span class="status-label">問題</span><strong data-field="problem-number">1 / 5</strong><span class="status-subtext" data-field="difficulty" data-difficulty="easy">初級</span></div>
          <div class="status-card"><span class="status-label">点灯</span><strong data-field="light-count">0 / 0</strong></div>
          <div class="status-card"><span class="status-label">手数</span><strong data-field="move-count" data-move-count="0" data-moves="0">0</strong></div>
          <div class="status-card"><span class="status-label">時間（秒）</span><strong data-field="time" data-time-ms="0">未計測</strong></div>
          <p class="status-message" data-field="state" data-state="loading" aria-live="polite">問題を準備しています</p>
        </section>

        <p class="countdown-banner" data-countdown hidden aria-live="assertive">開始まで <strong data-field="countdown">3</strong>秒</p>
        <p class="intermission-banner" data-intermission hidden role="status">正解！ 次の問題を準備しています。</p>

        <div class="game-layout">
          <figure class="board-panel" data-board="board" aria-labelledby="board-caption">
            <div class="board-host" data-board-host></div>
            <figcaption id="board-caption">外周の受光紋をすべて点灯させてください。光は常に発光しています。</figcaption>
          </figure>

          <section class="control-panel" aria-labelledby="control-title">
            <h2 id="control-title">環を選ぶ</h2>
            <p class="control-help">環の選択は手数に数えません。回転は1回につき1手です。</p>
            <div class="ring-controls" role="group" aria-label="操作する環">
              <button type="button" class="ring-button" data-action="select-ring" data-ring="0" aria-pressed="false">内環 <span class="key-hint">1</span></button>
              <button type="button" class="ring-button" data-action="select-ring" data-ring="1" aria-pressed="true">中環 <span class="key-hint">2</span></button>
              <button type="button" class="ring-button" data-action="select-ring" data-ring="2" aria-pressed="false">外環 <span class="key-hint">3</span></button>
            </div>
            <div class="rotate-controls" role="group" aria-label="回転操作">
              <button type="button" class="rotate-button" data-action="rotate-left" data-rotate="left" id="rotate-left"><span aria-hidden="true">↺</span> 左へ回す</button>
              <button type="button" class="rotate-button" data-action="rotate-right" data-rotate="right" id="rotate-right"><span aria-hidden="true">↻</span> 右へ回す</button>
            </div>
            <button type="button" class="secondary-button reset-question" data-action="reset-question" hidden>今の問題をやり直す</button>
            <p class="keyboard-help">キーボード: 1・2・3 または ↑・↓で環を選択、←・→で回転</p>
            <label class="audio-setting"><input type="checkbox" data-action="audio" id="audio" /> 音を有効にする</label>
          </section>
        </div>
        <p class="game-note" data-game-note role="status">記録はこの端末に保存されます。問題の時間は操作可能になった時点から成功入力までです。</p>
      </div>

      <div class="modal-layer" data-modal="help" hidden>
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1">
          <h2 id="help-title">遊び方</h2>
          <p>三本の環を選び、左または右へ1区画ずつ回します。発光紋は常に光を出します。</p>
          <p>必要な受光紋がすべて点灯すれば成功です。説明を開いている間も、チャレンジの時間は進みます。</p>
          <button type="button" class="primary-button" data-action="close-help">盤面へ戻る</button>
        </section>
      </div>
      <div class="modal-layer" data-modal="abort" hidden>
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="abort-title" tabindex="-1">
          <h2 id="abort-title">この挑戦を中断しますか？</h2>
          <p>中断すると今回の盤面と進行を破棄します。再読込後は盤面を復元しません。</p>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-action="close-abort">続ける</button>
            <button type="button" class="danger-button" data-action="confirm-abort">中断する</button>
          </div>
        </section>
      </div>
    </section>
  `;

  const shell = query<HTMLElement>(root, "[data-testid='game-screen']");
  const gameContent = query<HTMLElement>(root, "[data-game-content]");
  const boardHost = query<HTMLElement>(root, "[data-board-host]");
  const stateElement = query<HTMLElement>(root, "[data-field='state']");
  const lightElement = query<HTMLElement>(root, "[data-field='light-count']");
  const movesElement = query<HTMLElement>(root, "[data-field='move-count']");
  const timeElement = query<HTMLElement>(root, "[data-field='time']");
  const numberElement = query<HTMLElement>(root, "[data-field='problem-number']");
  const difficultyElement = query<HTMLElement>(root, "[data-field='difficulty']");
  const countdownBanner = query<HTMLElement>(root, "[data-countdown]");
  const countdownElement = query<HTMLElement>(root, "[data-field='countdown']");
  const intermissionBanner = query<HTMLElement>(root, "[data-intermission]");
  const audio = query<HTMLInputElement>(root, "[data-action='audio']");
  const resetButton = query<HTMLButtonElement>(root, "[data-action='reset-question']");
  const helpLayer = query<HTMLElement>(root, "[data-modal='help']");
  const abortLayer = query<HTMLElement>(root, "[data-modal='abort']");
  const gameNote = query<HTMLElement>(root, "[data-game-note]");
  const helpButton = query<HTMLButtonElement>(root, "[data-action='help']");
  const abortButton = query<HTMLButtonElement>(root, "[data-action='abort']");
  const closeHelpButton = query<HTMLButtonElement>(root, "[data-action='close-help']");
  const closeAbortButton = query<HTMLButtonElement>(root, "[data-action='close-abort']");
  const confirmAbortButton = query<HTMLButtonElement>(root, "[data-action='confirm-abort']");
  const leftButton = query<HTMLButtonElement>(root, "[data-action='rotate-left']");
  const rightButton = query<HTMLButtonElement>(root, "[data-action='rotate-right']");
  if (!shell || !gameContent || !boardHost || !stateElement || !lightElement || !movesElement || !timeElement || !numberElement || !difficultyElement || !countdownBanner || !countdownElement || !intermissionBanner || !audio || !resetButton || !helpLayer || !abortLayer || !gameNote || !helpButton || !abortButton || !closeHelpButton || !closeAbortButton || !confirmAbortButton || !leftButton || !rightButton) return;

  shell.dataset.runId = assignment.runId;
  const settingsSnapshot = loadSave({ prepared });
  let helpSeen = settingsSnapshot.helpSeen;
  const sound = new SoundController({ enabled: settingsSnapshot.audioEnabled });
  audio.checked = settingsSnapshot.audioEnabled;

  const listeners = new AbortController();
  const clearScheduled = (): void => {
    generation += 1;
    for (const handle of scheduled) window.clearTimeout(handle);
    scheduled.clear();
    if (countdownInterval !== null) window.clearInterval(countdownInterval);
    if (timerInterval !== null) window.clearInterval(timerInterval);
    countdownInterval = null;
    timerInterval = null;
    if (countdownTimeout !== null) window.clearTimeout(countdownTimeout);
    if (intermissionTimeout !== null) window.clearTimeout(intermissionTimeout);
    countdownTimeout = null;
    intermissionTimeout = null;
  };
  const dispose = (): void => {
    disposed = true;
    clearScheduled();
    listeners.abort();
    sound.dispose();
  };
  teardownByRoot.set(root, dispose);

  const isInputOpen = (): boolean => phase === "playing" && activeModal === null && session !== null;
  const getInputState = () => ({
    phase: inputPhaseForRun(phase),
    puzzleValid: currentPuzzle !== null,
    sessionActive: session !== null && phase === "playing",
    modalOpen: activeModal !== null,
  });

  let controller: InputController;
  const modalLayer = (name: ModalName): HTMLElement => name === "help" ? helpLayer : abortLayer;
  const focusable = (layer: HTMLElement): HTMLElement[] => Array.from(layer.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"));

  const refreshTimer = (): void => {
    if (disposed) return;
    if (phase === "playing" && timer) {
      const reading = timer.reading();
      currentTimeMs = Math.max(currentTimeMs, reading.elapsedMs);
      timeElement.textContent = formatElapsed(currentTimeMs, false);
      timeElement.dataset.timeMs = String(currentTimeMs);
      if (reading.abnormal) shell.dataset.clock = "abnormal";
    } else {
      timeElement.textContent = phase === "countdown" ? "未計測" : currentTimeMs > 0 ? formatElapsed(currentTimeMs, false) : "未計測";
      timeElement.dataset.timeMs = String(currentTimeMs);
    }
  };

  const refreshStatus = (): void => {
    if (!currentPuzzle || !session) return;
    const light = evaluate(currentPuzzle, session.state);
    const accepting = isInputOpen();
    shell.dataset.phase = phase;
    shell.dataset.runPhase = phase;
    shell.dataset.status = phase;
    shell.dataset.state = phase;
    shell.dataset.puzzleId = currentPuzzle.id;
    shell.dataset.currentPuzzleId = currentPuzzle.id;
    shell.dataset.questionIndex = String(questionIndex);
    shell.dataset.selectedRing = String(selectedRing);
    shell.dataset.mode = assignment.mode;
    numberElement.textContent = `${questionIndex + 1} / 5`;
    difficultyElement.textContent = DIFFICULTY_LABELS[currentPuzzle.difficulty];
    difficultyElement.dataset.difficulty = currentPuzzle.difficulty;
    lightElement.textContent = `${light.litRequired} / ${light.requiredCount}`;
    movesElement.textContent = String(actualMoves);
    movesElement.dataset.moves = String(actualMoves);
    movesElement.dataset.moveCount = String(actualMoves);
    countdownBanner.hidden = phase !== "countdown";
    countdownElement.textContent = String(countdownValue);
    intermissionBanner.hidden = phase !== "intermission";
    if (phase === "countdown") stateElement.textContent = "問題を準備しています";
    else if (phase === "intermission") stateElement.textContent = "成功！ 次の問題を準備しています。";
    else if (phase === "playing") stateElement.textContent = `操作可能。${light.litRequired} / ${light.requiredCount} 個が点灯中`;
    else if (phase === "result") stateElement.textContent = "結果を表示しています";
    else stateElement.textContent = "問題を準備しています";
    stateElement.dataset.state = phase;
    stateElement.dataset.status = phase;
    leftButton.disabled = !accepting;
    rightButton.disabled = !accepting;
    helpButton.disabled = phase === "result" || phase === "cancelled";
    abortButton.disabled = phase === "result" || phase === "cancelled";
    resetButton.hidden = assignment.mode !== "practice" || phase !== "playing";
    resetButton.disabled = !accepting;
    for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action='select-ring']"))) {
      const ring = Number(button.dataset.ring);
      button.disabled = !accepting;
      button.setAttribute("aria-pressed", String(ring === selectedRing));
    }
    gameContent.inert = activeModal !== null;
    gameContent.setAttribute("aria-hidden", String(activeModal !== null));
    refreshTimer();
  };

  const refreshBoard = (): void => {
    if (!currentPuzzle || !session) return;
    if (phase === "countdown") {
      boardHost.replaceChildren();
      return;
    }
    const renderedQuestion = questionIndex;
    const renderedGeneration = generation;
    boardHost.replaceChildren(createBoardSvg(currentPuzzle, session.state, {
      selectedRing,
      disabled: !isInputOpen(),
      onSelectRing: (ring) => {
        if (disposed || renderedQuestion !== questionIndex || renderedGeneration !== generation) return;
        if (!controller.boardSelection(ring)) return;
        query<HTMLButtonElement>(root, `[data-action='select-ring'][data-ring='${ring}']`)?.focus();
      },
    }));
  };

  const refresh = (): void => {
    refreshBoard();
    refreshStatus();
  };

  const setStorageWarning = (message: string): void => {
    if (!message) return;
    sound.play("error");
    storageWarning = storageWarning || message;
    shell.dataset.storage = "warning";
    gameNote.textContent = "この端末に保存できません。今回は参考記録として表示します。未完了の割当を保持できない場合があります。";
    gameNote.dataset.storageWarning = "true";
  };

  if (storageWarning) setStorageWarning(storageWarning);

  const persistAssignmentSeen = (): void => {
    if (assignment.mode !== "challenge" || !assignment.incomplete) return;
    const nowWallMs = Math.floor(Date.now());
    const next = markAssignmentSeen(assignment, nowWallMs);
    if (next.lastSeenWallMs === assignment.lastSeenWallMs) return;
    assignment = next;
    runState = { ...runState, assignment };
    const written = saveAssignment(assignment);
    if (!written.ok) setStorageWarning(storageMessage(written.error));
  };

  const stopTimerDisplay = (): void => {
    if (timerInterval !== null) window.clearInterval(timerInterval);
    timerInterval = null;
  };

  const schedule = (delayMs: number, callback: () => void): void => {
    const captured = generation;
    const handle = window.setTimeout(() => {
      scheduled.delete(handle);
      if (disposed || captured !== generation) return;
      callback();
    }, delayMs);
    scheduled.add(handle);
  };

  const closeModal = (): void => {
    if (!activeModal) return;
    const layer = modalLayer(activeModal);
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    activeModal = null;
    const opener = modalOpener;
    modalOpener = null;
    refreshStatus();
    if (opener?.isConnected && !opener.disabled) opener.focus();
  };

  const abortRun = (): void => {
    if (phase === "result" || phase === "cancelled") return;
    clearScheduled();
    sound.invalidate();
    phase = "cancelled";
    runState = { ...runState, phase: "cancelled" };
    // Keep an unfinished challenge ticket during its 30-minute retention
    // window. Aborting discards the board, not the held assignment; the next
    // challenge starts from question 1 without restoring the board.
    persistAssignmentSeen();
    renderHome(root, prepared, { notice: storageWarning || "挑戦を中断しました。" });
  };

  const openModal = (name: ModalName, opener: HTMLButtonElement): void => {
    if (name === "abort" && (phase === "result" || phase === "cancelled")) return;
    if (name === "help" && !helpSeen) {
      const saved = saveHelpSeen(true);
      if (saved.ok) helpSeen = true;
      else setStorageWarning(storageMessage(saved.error));
    }
    if (activeModal) closeModal();
    activeModal = name;
    modalOpener = opener;
    const layer = modalLayer(name);
    layer.hidden = false;
    layer.removeAttribute("aria-hidden");
    refreshStatus();
    const first = focusable(layer)[0] ?? layer.querySelector<HTMLElement>("[role='dialog']");
    first?.focus();
  };

  const confirmAbort = (): void => {
    if (activeModal !== "abort") return;
    closeModal();
    abortRun();
  };

  const completeRun = (): void => {
    if (!runState.records.length || runState.records.length < 5) return;
    stopTimerDisplay();
    phase = "result";
    runState = { ...runState, phase: "result" };
    const result = finalizeRun(runState);
    const resultUnlock = sound.unlockFromGesture();
    const resultSound = new SoundController({ enabled: sound.isEnabled() });
    renderResult(root, prepared, result, playerName, storageWarning, resultSound);
    // Rendering the result tears down the game controller. Emit the terminal
    // effect from the result surface so teardown cannot cut it off.
    void resultUnlock.then((ready) => { if (ready) resultSound.play("success"); });
    const best = storageWarning ? null : bestFromResult(result, playerName);
    if (storageWarning) {
      updateResultNotice(root, storageWarning);
    } else if (best) {
      const written = saveBest(best);
      if (!written.ok) updateResultNotice(root, storageMessage(written.error));
    } else if (result.mode === "challenge") {
      updateResultNotice(root, result.abnormalClock || result.overLimits ? "時計または上限のため、これは参考記録です。" : "この結果は自己ベストの条件を満たしません。参考記録として表示します。");
    }
    const cleared = result.mode === "challenge" ? clearAssignment() : { ok: true as const };
    if (!cleared.ok) updateResultNotice(root, storageMessage(cleared.error));
  };

  const completeQuestion = (reading: TimerReading, nextSession: CoreSession, lightSolved: boolean): void => {
    if (!lightSolved || phase !== "playing" || questionIndex < 0 || questionIndex >= 5) return;
    stopTimerDisplay();
    const moves = actualMoves;
    const overLimits = isOverLimits(reading.elapsedMs, moves, runState.totalMoves + moves);
    const record: QuestionRecord = {
      puzzleId: currentPuzzle?.id ?? nextSession.puzzle.id,
      difficulty: currentPuzzle?.difficulty ?? nextSession.puzzle.difficulty,
      timeMs: reading.elapsedMs,
      moves,
      history: boundedHistory(nextSession.history),
      timerReference: reading.reference,
      abnormalClock: reading.abnormal,
      overLimits,
    };
    session = { ...nextSession, history: boundedHistory(nextSession.history), status: "solved" };
    currentTimeMs = reading.elapsedMs;
    runState = {
      ...runState,
      phase: questionIndex === 4 ? "result" : "intermission",
      questionIndex,
      records: [...runState.records, record],
      totalMoves: runState.totalMoves + moves,
      abnormalClock: runState.abnormalClock || reading.abnormal,
      overLimits: runState.overLimits || overLimits,
    };
    phase = questionIndex === 4 ? "result" : "intermission";
    refresh();
    if (questionIndex === 4) {
      completeRun();
      return;
    }
    schedule(INTERMISSION_MS, () => beginQuestion(questionIndex + 1));
  };

  const rotate = (type: MoveType): void => {
    if (!isInputOpen() || !session || !currentPuzzle || !timer) return;
    // This is the one timestamp for the accepted input.  The optional reading
    // argument on RunTimer.stop is used as a side-effect-only stop boundary so
    // a later callback cannot change the recorded solving time.
    const reading = timer.reading();
    const before = evaluate(currentPuzzle, session.state);
    const result = acceptRotation(session, type, selectedRing, reading.elapsedMs, actualMoves + 1);
    if (!result.accepted) {
      void sound.unlockFromGesture().then((ready) => { if (ready) sound.play("error"); });
      refreshStatus();
      return;
    }
    actualMoves += 1;
    const nextSession = { ...result.session, history: boundedHistory(result.session.history) };
    session = nextSession;
    void sound.unlockFromGesture();
    if (result.light.solved) {
      // Success is the only terminal effect; a simultaneous rotation/light
      // chord would make the six actions indistinguishable.
      if (questionIndex < 4) sound.play("success");
      timer.stop(reading);
      completeQuestion(reading, nextSession, true);
      return;
    }
    sound.play("rotate");
    if (result.light.litRequired > before.litRequired) sound.play("light");
    refreshBoard();
    refreshStatus();
  };

  const selectRing = (ring: number): void => {
    if (!isInputOpen()) return;
    selectedRing = selectCoreRing(selectedRing, ring);
    void sound.unlockFromGesture();
    sound.play("select");
    refreshBoard();
    refreshStatus();
  };

  controller = new InputController({
    getState: getInputState,
    getSelectedRing: () => selectedRing,
    selectRing,
    rotate,
  });

  const resetQuestion = (): void => {
    if (assignment.mode !== "practice" || phase !== "playing" || !currentPuzzle) return;
    clearScheduled();
    sound.invalidate();
    stopTimerDisplay();
    timer?.reset();
    session = createSession(currentPuzzle);
    actualMoves = 0;
    currentTimeMs = 0;
    selectedRing = 1;
    refresh();
    timer = new RunTimer();
    timer.start();
    timerInterval = window.setInterval(refreshTimer, 50);
    refreshStatus();
  };

  const beginQuestion = (index: number): void => {
    if (disposed || index < 0 || index >= 5) return;
    questionIndex = index;
    const puzzle = prepared.puzzlesById.get(assignment.puzzleIds[index]);
    if (!puzzle) {
      setStorageWarning("問題の割当を確認できません。挑戦を中断しました。");
      abortRun();
      return;
    }
    currentPuzzle = puzzle;
    sound.invalidate();
    session = createSession(puzzle);
    selectedRing = 1;
    actualMoves = 0;
    currentTimeMs = 0;
    timer?.reset();
    timer = new RunTimer();
    phase = "playing";
    sound.play("start");
    runState = { ...runState, phase: "playing", questionIndex: index };
    // Render the first board before starting the clock; the same synchronous
    // turn then enables input and starts the timer without a free preview.
    refreshBoard();
    timer.start();
    stopTimerDisplay();
    timerInterval = window.setInterval(refreshTimer, 50);
    refreshStatus();
  };

  const startCountdown = (): void => {
    currentPuzzle = prepared.puzzlesById.get(assignment.puzzleIds[0]) ?? null;
    if (!currentPuzzle) {
      renderArtifactError(root, "問題の割当を確認できません。");
      return;
    }
    session = createSession(currentPuzzle);
    phase = "countdown";
    runState = { ...runState, phase: "countdown", questionIndex: 0 };
    countdownValue = 3;
    refresh();
    countdownInterval = window.setInterval(() => {
      if (phase !== "countdown") return;
      countdownValue = Math.max(1, countdownValue - 1);
      refreshStatus();
    }, 1_000);
    countdownTimeout = window.setTimeout(() => {
      if (countdownInterval !== null) window.clearInterval(countdownInterval);
      countdownInterval = null;
      beginQuestion(0);
    }, 3_000);
  };

  const lifecycle = (event: "hidden" | "visible" | "pagehide" | "pageshow"): void => {
    if (event === "hidden" || event === "pagehide") sound.invalidate();
    timer?.lifecycle(event);
    persistAssignmentSeen();
    refreshTimer();
  };
  document.addEventListener("visibilitychange", () => lifecycle(document.hidden ? "hidden" : "visible"), { signal: listeners.signal });
  window.addEventListener("pagehide", () => lifecycle("pagehide"), { signal: listeners.signal });
  window.addEventListener("pageshow", () => lifecycle("pageshow"), { signal: listeners.signal });
  window.addEventListener("keydown", (event) => {
    if (isActivationKey(event.key)) {
      const target = event.target;
      if (event.repeat && !event.isComposing && target instanceof HTMLButtonElement && shell.contains(target) && !isEditableTarget(target)) event.preventDefault();
      return;
    }
    controller.keyboard(event);
  }, { signal: listeners.signal });

  const dialogKeyHandler = (event: KeyboardEvent): void => {
    if (!activeModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable(modalLayer(activeModal));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  };
  helpLayer.addEventListener("keydown", dialogKeyHandler, { signal: listeners.signal });
  abortLayer.addEventListener("keydown", dialogKeyHandler, { signal: listeners.signal });
  for (const layer of [helpLayer, abortLayer]) {
    layer.setAttribute("aria-hidden", "true");
    layer.addEventListener("click", (event) => {
      if (event.target === layer) event.preventDefault();
    }, { signal: listeners.signal });
  }

  helpButton.addEventListener("click", () => openModal("help", helpButton), { signal: listeners.signal });
  abortButton.addEventListener("click", () => openModal("abort", abortButton), { signal: listeners.signal });
  closeHelpButton.addEventListener("click", closeModal, { signal: listeners.signal });
  closeAbortButton.addEventListener("click", closeModal, { signal: listeners.signal });
  confirmAbortButton.addEventListener("click", confirmAbort, { signal: listeners.signal });
  leftButton.addEventListener("click", () => controller.rotate("l"), { signal: listeners.signal });
  rightButton.addEventListener("click", () => controller.rotate("r"), { signal: listeners.signal });
  resetButton.addEventListener("click", resetQuestion, { signal: listeners.signal });
  audio.addEventListener("change", () => {
    sound.setEnabled(audio.checked);
    if (audio.checked) void sound.unlockFromGesture();
    const result = saveAudioEnabled(audio.checked);
    if (!result.ok) setStorageWarning(storageMessage(result.error));
  }, { signal: listeners.signal });
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action='select-ring']"))) {
    button.addEventListener("click", () => controller.selectRing(Number(button.dataset.ring)), { signal: listeners.signal });
  }

  startCountdown();
}

function updateResultNotice(root: HTMLElement, message: string): void {
  const element = query<HTMLElement>(root, "[data-result-notice]");
  if (!element || !message) return;
  const recovery = finalizedResultByRoot.get(root);
  if (recovery) recovery.initialNotice = message;
  element.hidden = false;
  element.textContent = message;
}

function resultActionButton(root: HTMLElement, selector: string): HTMLButtonElement | null {
  return query<HTMLButtonElement>(root, selector);
}

/** Render a finalized in-memory result before attempting storage writes. */
export function renderResult(root: HTMLElement, prepared: PreparedPool, result: FinalRunResult, playerName: string, initialNotice = "", terminalSound: SoundController | null = null): void {
  teardownRoot(root);
  finalizedResultByRoot.set(root, { prepared, result, playerName, initialNotice });
  root.innerHTML = `
    <section class="app-shell result-screen" data-testid="result-screen" data-screen="result" data-mode="${result.mode}">
      <header class="app-header result-header">
        <div>
          <p class="eyebrow">5問完了</p>
          <h1 id="result-title">結果</h1>
          <p class="subtitle"><span data-result-player></span>さんの今回の記録</p>
        </div>
        <a class="secondary-button home-lab-link" href="${LAB_URL}">実験場へ戻る</a>
      </header>
      <main class="result-main" aria-labelledby="result-title">
        <section class="result-summary" aria-label="合計">
          <div><span class="status-label">合計時間</span><strong data-total-time data-total-time-ms="${result.totalTimeMs}" data-field="total-time">${formatElapsed(result.totalTimeMs)}</strong></div>
          <div><span class="status-label">合計手数</span><strong data-total-moves="${result.totalMoves}">${result.totalMoves}手</strong></div>
        </section>
        <p class="result-notice" data-result-notice role="status" hidden></p>
        <p class="result-note">記録はこの端末に保存されます。</p>
        <section class="result-list" aria-labelledby="question-results-title">
          <h2 id="question-results-title">問題ごとの結果</h2>
          ${result.records.map((record, index) => `
            <article class="question-result" data-result-question data-puzzle-id="${record.puzzleId}">
              <h3>問題 ${index + 1}<span data-difficulty="${record.difficulty}">${DIFFICULTY_LABELS[record.difficulty]}</span></h3>
              <p><span>時間</span><strong data-result-time data-time-ms="${record.timeMs}" data-result-time-ms="${record.timeMs}">${resultTimeLabel(record)}</strong><span>手数</span><strong data-result-moves="${record.moves}" data-moves="${record.moves}">${record.moves}手</strong></p>
            </article>
          `).join("")}
        </section>
        <div class="result-actions">
          <button type="button" class="primary-button" data-action="retry">もう一度チャレンジ</button>
          <button type="button" class="secondary-button" data-action="result-practice">練習する</button>
          <button type="button" class="secondary-button" data-action="result-home">ホームへ戻る</button>
          <button type="button" class="secondary-button" data-action="result-share">結果を共有</button>
        </div>
        <div class="result-share-area" data-share-area hidden></div>
      </main>
      <footer class="home-footer"><a href="${PUBLIC_GAME_URL}">ゲームURL</a></footer>
    </section>
  `;
  const listeners = new AbortController();
  const retry = resultActionButton(root, "[data-action='retry']");
  const practice = resultActionButton(root, "[data-action='result-practice']");
  const home = resultActionButton(root, "[data-action='result-home']");
  const share = resultActionButton(root, "[data-action='result-share']");
  const shareArea = query<HTMLElement>(root, "[data-share-area]");
  const resultPlayer = query<HTMLElement>(root, "[data-result-player]");
  if (!retry || !practice || !home || !share || !shareArea || !resultPlayer) {
    terminalSound?.dispose();
    return;
  }
  let terminalSoundTimer: number | null = null;
  if (terminalSound) {
    terminalSoundTimer = window.setTimeout(() => {
      terminalSoundTimer = null;
      terminalSound.dispose();
    }, 260);
  }
  resultPlayer.textContent = playerName;
  if (initialNotice) updateResultNotice(root, initialNotice);
  let shareRequestSerial = 0;

  const startAgain = (mode: RunMode): void => {
    renderHome(root, prepared, { prefill: playerName });
    const input = query<HTMLInputElement>(root, "[data-field='player-name']");
    const button = query<HTMLButtonElement>(root, mode === "challenge" ? "[data-action='start-challenge']" : "[data-action='start-practice']");
    if (input && button) {
      // Starting via the visible home control preserves all name validation and
      // assignment persistence logic in one place.
      input.value = playerName;
      button.click();
    }
  };
  retry.addEventListener("click", () => startAgain("challenge"), { signal: listeners.signal });
  practice.addEventListener("click", () => startAgain("practice"), { signal: listeners.signal });
  home.addEventListener("click", () => renderHome(root, prepared), { signal: listeners.signal });
  share.addEventListener("click", () => {
    shareArea.hidden = true;
    shareArea.replaceChildren();
    shareArea.removeAttribute("data-share-status");
    const message = shareText({ result });
    const originShell = query<HTMLElement>(root, "[data-testid='result-screen']");
    const requestSerial = ++shareRequestSerial;
    void shareOrCopy(message).then((shared) => {
      if (requestSerial !== shareRequestSerial || !originShell?.isConnected || !root.contains(originShell)) return;
      if (shared.status === "cancelled") return;
      if (shared.status === "selectable") {
        shareArea.hidden = false;
        shareArea.innerHTML = `<label for="share-text">共有文（選択してコピーできます）</label><textarea id="share-text" data-share-text readonly rows="4"></textarea>`;
        const field = query<HTMLTextAreaElement>(shareArea, "[data-share-text]");
        if (field) field.value = shared.text;
        return;
      }
      shareArea.hidden = false;
      shareArea.textContent = shared.status === "copied" ? "共有文をコピーしました。" : "共有しました。";
      shareArea.dataset.shareStatus = "done";
    });
  }, { signal: listeners.signal });
  teardownByRoot.set(root, () => {
    listeners.abort();
    if (terminalSoundTimer !== null) window.clearTimeout(terminalSoundTimer);
    terminalSound?.dispose();
  });
}
