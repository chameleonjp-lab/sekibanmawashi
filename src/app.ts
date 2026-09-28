import puzzlePool from "../content/puzzles-v2.json";
import {
  acceptRotation,
  createSession,
  evaluate,
  selectRing as selectCoreRing,
} from "./core/engine.ts";
import { GAME_TITLE, LAB_URL } from "./core/index.ts";
import type { CoreSession, MoveType, Puzzle } from "./core/types.ts";
import { validatePuzzle } from "./core/validation.ts";
import { createBoardSvg } from "./board.ts";
import poolManifest from "../content/pool-v2.json";
import ticketManifest from "../content/tickets-v2.json";
import { preparePoolArtifacts } from "./run.ts";
import { hasFinalizedResultRecovery, renderHome, restoreFinalizedResult, teardownRunUi } from "./run-ui.ts";
import { loadSave } from "./storage.ts";
import {
  canAcceptInput,
  InputController,
  isActivationKey,
  isEditableTarget,
  type InputPhase,
} from "./input.ts";
import { SoundController } from "./sound.ts";
import "./app.css";

const DIFFICULTY_LABELS: Record<Puzzle["difficulty"], string> = {
  easy: "初級",
  normal: "中級",
  hard: "上級",
};

type ModalName = "help" | "abort";

const teardownByRoot = new WeakMap<HTMLElement, () => void>();

function firstOfficialPuzzle(): unknown {
  return Array.isArray(puzzlePool) && puzzlePool.length > 0 ? puzzlePool[0] : null;
}

function puzzleForLocation(): unknown {
  if (typeof window === "undefined") return firstOfficialPuzzle();
  const requestedId = new URLSearchParams(window.location.search).get("puzzleId");
  if (!requestedId) return firstOfficialPuzzle();
  if (!Array.isArray(puzzlePool)) return null;
  return puzzlePool.find((candidate) => (
    typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === requestedId
  )) ?? null;
}

function query<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function puzzleLoadReason(path: string): string {
  if (path.includes("Checksum") || path.includes("checksum")) return "問題の内容を確認できません";
  if (path.includes("Version") || path.includes("version")) return "問題の版を確認できません";
  return "問題の形式を確認できません";
}

function renderLoadError(root: HTMLElement, issues: readonly { path: string }[]): void {
  teardownByRoot.get(root)?.();
  teardownByRoot.delete(root);
  const section = document.createElement("section");
  section.className = "app-shell load-error-screen";
  section.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "問題を読み込めません";
  const message = document.createElement("p");
  message.textContent = puzzleLoadReason(issues[0]?.path ?? "");
  const actions = document.createElement("div");
  actions.className = "fatal-error-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary-button";
  retry.textContent = "もう一度読み込む";
  retry.addEventListener("click", () => window.location.reload());
  const home = document.createElement("a");
  home.className = "secondary-button";
  home.href = typeof window === "undefined" ? "/" : new URL("./", window.location.href).href;
  home.textContent = "ホームへ戻る";
  const lab = document.createElement("a");
  lab.className = "secondary-button";
  lab.href = LAB_URL;
  lab.textContent = "実験場へ戻る";
  actions.append(retry, home, lab);
  section.append(heading, message, actions);
  root.replaceChildren(section);
}

/** Keep a user-facing recovery route when boot or a browser callback fails. */
export function renderFatalError(root: HTMLElement): void {
  const canRestoreFinalizedResult = hasFinalizedResultRecovery(root);
  try { teardownRunUi(root); } catch { /* run timers/listeners must not block recovery */ }
  try { teardownByRoot.get(root)?.(); } catch { /* recovery must survive teardown failures */ }
  teardownByRoot.delete(root);
  const section = document.createElement("section");
  section.className = "app-shell load-error-screen fatal-error-screen";
  section.dataset.fatalError = "true";
  section.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "画面を表示できません";
  const message = document.createElement("p");
  message.textContent = "一時的な問題が起きました。再試行するか、ホームからやり直してください。";
  const actions = document.createElement("div");
  actions.className = "fatal-error-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary-button";
  retry.dataset.action = "retry";
  retry.textContent = "もう一度読み込む";
  retry.addEventListener("click", () => {
    try {
      boot(root, puzzleForLocation());
    } catch {
      renderFatalError(root);
    }
  });
  const home = document.createElement("a");
  home.className = "secondary-button";
  home.href = typeof window === "undefined" ? "/" : new URL("./", window.location.href).href;
  home.textContent = "ホームへ戻る";
  const lab = document.createElement("a");
  lab.className = "secondary-button";
  lab.href = LAB_URL;
  lab.textContent = "実験場へ戻る";
  actions.append(retry, home, lab);
  if (canRestoreFinalizedResult) {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "secondary-button";
    result.dataset.action = "restore-finalized-result";
    result.textContent = "確定済みの結果を表示";
    result.addEventListener("click", () => {
      try {
        if (!restoreFinalizedResult(root)) renderFatalError(root);
      } catch {
        renderFatalError(root);
      }
    });
    actions.append(result);
  }
  section.append(heading, message, actions);
  try {
    root.replaceChildren(section);
  } catch {
    root.textContent = "画面を表示できません。ホームへ戻ってください。";
  }
}

/** Render the explicit one-puzzle inspection screen. Normal play uses home. */
export function renderPuzzle(root: HTMLElement, puzzle: Puzzle): void {
  teardownByRoot.get(root)?.();
  let session: CoreSession = createSession(puzzle);
  const audioEnabled = loadSave().audioEnabled;
  let selectedRing = 1;
  let phase: InputPhase = session.status === "solved" ? "solved" : "playing";
  let sessionActive = phase === "playing";
  let activeModal: ModalName | null = null;
  let modalOpener: HTMLButtonElement | null = null;
  let startedAt = Date.now();
  let statusMessage = phase === "solved" ? "この問題は、すでに解けています。" : "操作できます。";
  const initialLight = evaluate(puzzle, session.state);

  root.innerHTML = `
    <section class="app-shell" data-testid="puzzle-screen">
      <div class="game-content" data-game-content>
      <header class="app-header">
        <div>
          <p class="eyebrow">1問の盤面確認</p>
          <h1 id="game-title">${GAME_TITLE}</h1>
          <p class="subtitle">3本の輪を選び、左か右へ1つずつ動かします。</p>
        </div>
        <div class="header-actions" aria-label="補助操作">
          <button type="button" class="secondary-button" data-action="help" id="how-to-play">遊び方</button>
          <button type="button" class="secondary-button" data-action="abort" id="abort-game">中断</button>
        </div>
      </header>

      <section class="puzzle-status" aria-labelledby="puzzle-status-title">
        <h2 id="puzzle-status-title" class="visually-hidden">問題の状態</h2>
        <div class="status-card"><span class="status-label">問題</span><strong data-field="problem-number">1 / 1</strong><span class="status-subtext" data-field="difficulty">${DIFFICULTY_LABELS[puzzle.difficulty]}</span></div>
        <div class="status-card"><span class="status-label">光った目標</span><strong data-field="light-count">${initialLight.litRequired} / ${initialLight.requiredCount}</strong></div>
        <div class="status-card"><span class="status-label">手数</span><strong data-field="move-count">0</strong></div>
        <div class="status-card"><span class="status-label">時間</span><strong data-field="time">未計測</strong><span class="status-subtext">記録なし</span></div>
        <p class="status-message" data-field="state" aria-live="polite">${statusMessage}</p>
      </section>

      <div class="game-layout">
        <figure class="board-panel" data-board="board" aria-labelledby="board-caption">
          <div class="board-host" data-board-host></div>
          <figcaption id="board-caption">外側の目標を全部光らせてください。光る石は光を出し続けます。</figcaption>
        </figure>

        <section class="control-panel" aria-labelledby="control-title">
          <h2 id="control-title">回す輪を選ぶ</h2>
          <p class="control-help">輪を選ぶだけでは手数は増えません。動かすたびに1手です。</p>
          <div class="ring-controls" role="group" aria-label="動かす輪">
            <button type="button" class="ring-button" data-action="select-ring" data-ring="0" aria-label="内側の輪" aria-pressed="false">内側 <span class="key-hint">1</span></button>
            <button type="button" class="ring-button" data-action="select-ring" data-ring="1" aria-label="真ん中の輪" aria-pressed="true">中央 <span class="key-hint">2</span></button>
            <button type="button" class="ring-button" data-action="select-ring" data-ring="2" aria-label="外側の輪" aria-pressed="false">外側 <span class="key-hint">3</span></button>
          </div>
          <div class="rotate-controls" role="group" aria-label="輪を動かす操作">
            <button type="button" class="rotate-button" data-action="rotate-left" data-rotate="left" id="rotate-left"><span aria-hidden="true">↺</span> 左へ回す</button>
            <button type="button" class="rotate-button" data-action="rotate-right" data-rotate="right" id="rotate-right"><span aria-hidden="true">↻</span> 右へ回す</button>
          </div>
          <p class="keyboard-help">キーボード: 1・2・3 または ↑・↓で輪を選び、←・→で動かします。</p>
        </section>
      </div>

      <p class="game-note">これは問題庫を確認する1問用画面です。5問の挑戦はホームから始めてください。</p>
      </div>

      <div class="modal-layer" data-modal="help" hidden>
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1">
          <h2 id="help-title">遊び方</h2>
          <p>石板には3本の輪があります。輪を選び、左か右へ1つずつ動かしてください。光る石は光を出し続け、黒い場所では光が止まります。</p>
          <p>外側の目標が全部光れば成功です。光が交差しても互いを止めません。</p>
          <button type="button" class="primary-button" data-action="close-help">盤面へ戻る</button>
        </section>
      </div>
      <div class="modal-layer" data-modal="abort" hidden>
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="abort-title" tabindex="-1">
          <h2 id="abort-title">この問題を中断しますか？</h2>
          <p>盤面の状態は破棄されます。中断を取り消す場合は「続ける」を選んでください。</p>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-action="close-abort">続ける</button>
            <button type="button" class="danger-button" data-action="confirm-abort">中断する</button>
          </div>
        </section>
      </div>
    </section>
  `;

  const shell = query<HTMLElement>(root, "[data-testid='puzzle-screen']");
  const gameContent = query<HTMLElement>(root, "[data-game-content]");
  const boardHost = query<HTMLElement>(root, "[data-board-host]");
  const stateElement = query<HTMLElement>(root, "[data-field='state']");
  const lightElement = query<HTMLElement>(root, "[data-field='light-count']");
  const movesElement = query<HTMLElement>(root, "[data-field='move-count']");
  const helpLayer = query<HTMLElement>(root, "[data-modal='help']");
  const abortLayer = query<HTMLElement>(root, "[data-modal='abort']");
  const helpButton = query<HTMLButtonElement>(root, "[data-action='help']");
  const abortButton = query<HTMLButtonElement>(root, "[data-action='abort']");
  const closeHelpButton = query<HTMLButtonElement>(root, "[data-action='close-help']");
  const closeAbortButton = query<HTMLButtonElement>(root, "[data-action='close-abort']");
  const confirmAbortButton = query<HTMLButtonElement>(root, "[data-action='confirm-abort']");
  const leftButton = query<HTMLButtonElement>(root, "[data-action='rotate-left']");
  const rightButton = query<HTMLButtonElement>(root, "[data-action='rotate-right']");
  if (!shell || !gameContent || !boardHost || !stateElement || !lightElement || !movesElement || !helpLayer || !abortLayer || !helpButton || !abortButton || !closeHelpButton || !closeAbortButton || !confirmAbortButton || !leftButton || !rightButton) return;
  shell.setAttribute("data-puzzle-id", puzzle.id);
  const sound = new SoundController({ enabled: audioEnabled });
  const listenerController = new AbortController();

  const getInputState = () => ({
    phase,
    puzzleValid: true,
    sessionActive,
    modalOpen: activeModal !== null,
  });

  let controller: InputController;

  const refresh = (): void => {
    const light = evaluate(puzzle, session.state);
    const accepting = canAcceptInput(getInputState());
    shell.dataset.phase = phase;
    shell.dataset.selectedRing = String(selectedRing);
    shell.dataset.moveCount = String(session.history.length);
    gameContent.inert = activeModal !== null;
    gameContent.setAttribute("aria-hidden", String(activeModal !== null));
    movesElement.dataset.moves = String(session.history.length);
    lightElement.textContent = `${light.litRequired} / ${light.requiredCount}`;
    movesElement.textContent = String(session.history.length);
    stateElement.textContent = statusMessage;
    stateElement.dataset.status = phase;
    stateElement.dataset.state = phase;
    leftButton.disabled = !accepting;
    rightButton.disabled = !accepting;
    helpButton.disabled = phase === "cancelled";
    abortButton.disabled = !accepting;
    for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action='select-ring']"))) {
      const ring = Number(button.dataset.ring);
      button.setAttribute("aria-pressed", String(ring === selectedRing));
      button.disabled = !accepting;
    }
    boardHost.replaceChildren(createBoardSvg(puzzle, session.state, {
      selectedRing,
      disabled: !accepting,
      onSelectRing: (ring) => {
        if (!controller.boardSelection(ring)) return;
        // The SVG is rebuilt after every selection. Move focus to the
        // equivalent labelled HTML control so touch selection never strands
        // keyboard focus on a removed path.
        query<HTMLButtonElement>(root, `[data-action='select-ring'][data-ring='${ring}']`)?.focus({ preventScroll: true });
      },
    }));
  };

  const selectRing = (ring: number): void => {
    void sound.unlockFromGesture();
    selectedRing = selectCoreRing(selectedRing, ring);
    sound.play("select");
    statusMessage = `選択中: ${["内側", "中央", "外側"][selectedRing]}`;
    refresh();
  };

  const rotate = (type: MoveType): void => {
    void sound.unlockFromGesture();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const before = evaluate(puzzle, session.state);
    const result = acceptRotation(session, type, selectedRing, elapsed);
    if (!result.accepted) {
      sound.play("error");
      statusMessage = result.reason === "solved" ? "成功済み" : "入力を受け付けません";
      refresh();
      return;
    }
    session = result.session;
    const light = result.light;
    if (light.solved) {
      phase = "solved";
      sessionActive = false;
      sound.play("success");
      statusMessage = "できました！ 目標が全部光りました。";
    } else {
      sound.play("rotate");
      if (light.litRequired > before.litRequired) sound.play("light");
      statusMessage = `操作できます。光った目標 ${light.litRequired} / ${light.requiredCount}`;
    }
    refresh();
  };

  controller = new InputController({
    getState: getInputState,
    getSelectedRing: () => selectedRing,
    selectRing,
    rotate,
  });

  const modalLayer = (name: ModalName): HTMLElement => name === "help" ? helpLayer : abortLayer;
  const focusable = (layer: HTMLElement): HTMLElement[] => Array.from(layer.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"));

  const closeModal = (): void => {
    if (!activeModal) return;
    const closing = modalLayer(activeModal);
    closing.hidden = true;
    closing.setAttribute("aria-hidden", "true");
    activeModal = null;
    const opener = modalOpener;
    modalOpener = null;
    refresh();
    if (opener && opener.isConnected && !opener.disabled) opener.focus();
  };

  const openModal = (name: ModalName, opener: HTMLButtonElement): void => {
    if (name === "abort" && !canAcceptInput(getInputState())) return;
    if (activeModal) closeModal();
    activeModal = name;
    modalOpener = opener;
    const layer = modalLayer(name);
    layer.hidden = false;
    layer.removeAttribute("aria-hidden");
    refresh();
    const first = focusable(layer)[0] ?? layer.querySelector<HTMLElement>('[role="dialog"]');
    first?.focus();
  };

  const confirmAbort = (): void => {
    if (!activeModal || activeModal !== "abort") return;
    sound.invalidate();
    sessionActive = false;
    phase = "cancelled";
    statusMessage = "この問題を中断しました。";
    closeModal();
    refresh();
  };

  helpButton.addEventListener("click", () => openModal("help", helpButton));
  abortButton.addEventListener("click", () => openModal("abort", abortButton));
  closeHelpButton.addEventListener("click", closeModal);
  closeAbortButton.addEventListener("click", closeModal);
  confirmAbortButton.addEventListener("click", confirmAbort);
  leftButton.addEventListener("click", () => { controller.rotate("l"); });
  rightButton.addEventListener("click", () => { controller.rotate("r"); });
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action='select-ring']"))) {
    button.addEventListener("click", () => controller.selectRing(Number(button.dataset.ring)));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sound.invalidate();
  }, { signal: listenerController.signal });
  window.addEventListener("pagehide", () => sound.invalidate(), { signal: listenerController.signal });

  const keyHandler = (event: KeyboardEvent): void => {
    // Let a focused button perform its normal single activation. Suppress
    // only repeated native activations caused by a held Enter/Space key.
    if (isActivationKey(event.key)) {
      const target = event.target;
      const isOwnButton = target instanceof HTMLButtonElement && shell.contains(target);
      if (event.repeat && !event.isComposing && isOwnButton && !isEditableTarget(target)) event.preventDefault();
      return;
    }
    controller.keyboard(event);
  };
  window.addEventListener("keydown", keyHandler, { signal: listenerController.signal });
  teardownByRoot.set(root, () => {
    listenerController.abort();
    sound.dispose();
  });
  const dialogKeyHandler = (event: KeyboardEvent): void => {
    if (!activeModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const layer = modalLayer(activeModal);
    const items = focusable(layer);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  helpLayer.addEventListener("keydown", dialogKeyHandler);
  abortLayer.addEventListener("keydown", dialogKeyHandler);

  for (const layer of [helpLayer, abortLayer]) {
    layer.setAttribute("aria-hidden", "true");
    layer.addEventListener("click", (event) => {
      if (event.target === layer) event.preventDefault();
    });
  }

  startedAt = Date.now();
  refresh();
}

export function boot(root: HTMLElement, definition: unknown): void {
  try {
    const requestedId = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("puzzleId");
    // The explicit puzzleId path is a stable one-question inspection surface.
    if (requestedId !== null) {
      const result = validatePuzzle(definition);
      if (!result.ok) {
        renderLoadError(root, result.issues);
        return;
      }
      renderPuzzle(root, result.puzzle);
      return;
    }
    const prepared = preparePoolArtifacts(puzzlePool, poolManifest, ticketManifest);
    if (!prepared.ok) {
      renderLoadError(root, prepared.issues);
      return;
    }
    renderHome(root, prepared.prepared);
  } catch {
    renderFatalError(root);
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (root) {
  let boundaryActive = false;
  const handleUnexpectedError = (): void => {
    if (boundaryActive || root.dataset.fatalError === "true") return;
    boundaryActive = true;
    renderFatalError(root);
  };
  // A successful retry clears the guard so a later independent failure still
  // gets the recovery surface instead of becoming a blank page.
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("[data-fatal-error] [data-action='retry'], [data-fatal-error] [data-action='restore-finalized-result']")) boundaryActive = false;
  }, true);
  window.addEventListener("error", (event) => {
    if (event.error || event.message) {
      event.preventDefault();
      handleUnexpectedError();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    handleUnexpectedError();
  });
  boot(root, puzzleForLocation());
}
