import puzzlePool from "../content/puzzles-v2.json";
import {
  acceptRotation,
  createSession,
  evaluate,
  selectRing as selectCoreRing,
} from "./core/engine.ts";
import { createDefaultSettings, setAudioEnabled, type UserSettings } from "./core/settings.ts";
import type { CoreSession, MoveType, Puzzle } from "./core/types.ts";
import { validatePuzzle } from "./core/validation.ts";
import { createBoardSvg } from "./board.ts";
import {
  canAcceptInput,
  InputController,
  isActivationKey,
  type InputPhase,
} from "./input.ts";
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
  section.append(heading, message);
  root.replaceChildren(section);
}

/** Render the R3 single-puzzle screen. R4 owns five-question progression. */
export function renderPuzzle(root: HTMLElement, puzzle: Puzzle): void {
  teardownByRoot.get(root)?.();
  let session: CoreSession = createSession(puzzle);
  let settings: UserSettings = createDefaultSettings();
  let selectedRing = 1;
  let phase: InputPhase = session.status === "solved" ? "solved" : "playing";
  let sessionActive = phase === "playing";
  let activeModal: ModalName | null = null;
  let modalOpener: HTMLButtonElement | null = null;
  let startedAt = Date.now();
  let statusMessage = phase === "solved" ? "最初から成功しています" : "操作可能";
  const initialLight = evaluate(puzzle, session.state);

  root.innerHTML = `
    <section class="app-shell" data-testid="puzzle-screen">
      <div class="game-content" data-game-content>
      <header class="app-header">
        <div>
          <p class="eyebrow">1問の盤面確認</p>
          <h1 id="game-title">石板回し</h1>
          <p class="subtitle">三本の環を選び、左右へ一区画ずつ回します。</p>
        </div>
        <div class="header-actions" aria-label="補助操作">
          <button type="button" class="secondary-button" data-action="help" id="how-to-play">遊び方</button>
          <button type="button" class="secondary-button" data-action="abort" id="abort-game">中断</button>
        </div>
      </header>

      <section class="puzzle-status" aria-labelledby="puzzle-status-title">
        <h2 id="puzzle-status-title" class="visually-hidden">問題の状態</h2>
        <div class="status-card"><span class="status-label">問題</span><strong data-field="problem-number">1 / 1</strong><span class="status-subtext" data-field="difficulty">${DIFFICULTY_LABELS[puzzle.difficulty]}</span></div>
        <div class="status-card"><span class="status-label">点灯</span><strong data-field="light-count">${initialLight.litRequired} / ${initialLight.requiredCount}</strong></div>
        <div class="status-card"><span class="status-label">手数</span><strong data-field="move-count">0</strong></div>
        <div class="status-card"><span class="status-label">時間</span><strong data-field="time">未計測</strong><span class="status-subtext">R4で計測</span></div>
        <p class="status-message" data-field="state" aria-live="polite">${statusMessage}</p>
      </section>

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
          <p class="keyboard-help">キーボード: 1・2・3 または ↑・↓で環を選択、←・→で回転</p>
          <label class="audio-setting"><input type="checkbox" data-action="audio" id="audio" checked /> 音を有効にする</label>
        </section>
      </div>

      <p class="game-note">この画面では問題を1問だけ操作します。記録や5問の進行は後段で追加します。</p>
      </div>

      <div class="modal-layer" data-modal="help" hidden>
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1">
          <h2 id="help-title">遊び方</h2>
          <p>三本の環を選び、左または右へ1区画ずつ回します。発光紋は常に光を出し、遮断石や別の部品が光を止めます。</p>
          <p>必要な受光紋がすべて点灯すれば成功です。光が交差しても互いを止めません。</p>
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
  const audio = query<HTMLInputElement>(root, "[data-action='audio']");
  const helpLayer = query<HTMLElement>(root, "[data-modal='help']");
  const abortLayer = query<HTMLElement>(root, "[data-modal='abort']");
  const helpButton = query<HTMLButtonElement>(root, "[data-action='help']");
  const abortButton = query<HTMLButtonElement>(root, "[data-action='abort']");
  const closeHelpButton = query<HTMLButtonElement>(root, "[data-action='close-help']");
  const closeAbortButton = query<HTMLButtonElement>(root, "[data-action='close-abort']");
  const confirmAbortButton = query<HTMLButtonElement>(root, "[data-action='confirm-abort']");
  const leftButton = query<HTMLButtonElement>(root, "[data-action='rotate-left']");
  const rightButton = query<HTMLButtonElement>(root, "[data-action='rotate-right']");
  if (!shell || !gameContent || !boardHost || !stateElement || !lightElement || !movesElement || !audio || !helpLayer || !abortLayer || !helpButton || !abortButton || !closeHelpButton || !closeAbortButton || !confirmAbortButton || !leftButton || !rightButton) return;
  shell.setAttribute("data-puzzle-id", puzzle.id);

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
      onSelectRing: (ring) => { controller.boardSelection(ring); },
    }));
  };

  const selectRing = (ring: number): void => {
    selectedRing = selectCoreRing(selectedRing, ring);
    statusMessage = `選択中: ${["内環", "中環", "外環"][selectedRing]}`;
    refresh();
  };

  const rotate = (type: MoveType): void => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const result = acceptRotation(session, type, selectedRing, elapsed);
    if (!result.accepted) {
      statusMessage = result.reason === "solved" ? "成功済み" : "入力を受け付けません";
      refresh();
      return;
    }
    session = result.session;
    const light = result.light;
    if (light.solved) {
      phase = "solved";
      sessionActive = false;
      statusMessage = `成功！ ${light.litRequired}個の受光紋が点灯しました。`;
    } else {
      statusMessage = `操作可能。${light.litRequired} / ${light.requiredCount} 個が点灯中`;
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
    sessionActive = false;
    phase = "cancelled";
    statusMessage = "この問題を中断しました。";
    closeModal();
    refresh();
  };

  audio.addEventListener("change", () => {
    settings = setAudioEnabled(settings, audio.checked);
    shell.dataset.audio = settings.audioEnabled ? "on" : "off";
  });
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

  const keyHandler = (event: KeyboardEvent): void => {
    // Let a focused button perform its normal single activation. Suppress
    // only repeated native activations caused by a held Enter/Space key.
    if (isActivationKey(event.key)) {
      if (event.repeat) event.preventDefault();
      return;
    }
    controller.keyboard(event);
  };
  const listenerController = new AbortController();
  window.addEventListener("keydown", keyHandler, { signal: listenerController.signal });
  teardownByRoot.set(root, () => listenerController.abort());
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
  const result = validatePuzzle(definition);
  if (!result.ok) {
    renderLoadError(root, result.issues);
    return;
  }
  renderPuzzle(root, result.puzzle);
}

const root = document.querySelector<HTMLElement>("#app");
if (root) boot(root, puzzleForLocation());
