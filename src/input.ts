import { RING_COUNT, type MoveType } from "./core/types.ts";

export type InputPhase = "loading" | "countdown" | "playing" | "solved" | "cancelled";

export type InputGuardState = {
  phase: InputPhase;
  puzzleValid: boolean;
  sessionActive: boolean;
  modalOpen: boolean;
};

export type KeyboardIntent =
  | { kind: "select"; ring: number }
  | { kind: "cycle"; direction: "previous" | "next" }
  | { kind: "rotate"; type: MoveType };

/**
 * Every input path (board hit area, ordinary button, and keyboard) uses this
 * same gate.  A dialog is an input boundary, not just a visual overlay.
 */
export function canAcceptInput(state: InputGuardState): boolean {
  return state.puzzleValid && state.sessionActive && state.phase === "playing" && !state.modalOpen;
}

export function cycleRing(currentRing: number, direction: "previous" | "next"): number {
  if (!Number.isInteger(currentRing) || currentRing < 0 || currentRing >= RING_COUNT) {
    throw new RangeError("current ring must be an integer from 0 through 2");
  }
  const offset = direction === "next" ? 1 : -1;
  return (currentRing + offset + RING_COUNT) % RING_COUNT;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Convert only the game's documented keyboard shortcuts.  Enter/Space are
 * intentionally omitted: focused buttons receive their normal native click,
 * while a global handler must never execute a second operation.
 */
export function keyboardIntent(event: KeyboardEvent): KeyboardIntent | null {
  if (event.defaultPrevented || event.isComposing || event.repeat || isEditableTarget(event.target)) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "1": return { kind: "select", ring: 0 };
    case "2": return { kind: "select", ring: 1 };
    case "3": return { kind: "select", ring: 2 };
    case "ArrowUp": return { kind: "cycle", direction: "previous" };
    case "ArrowDown": return { kind: "cycle", direction: "next" };
    case "ArrowLeft": return { kind: "rotate", type: "l" };
    case "ArrowRight": return { kind: "rotate", type: "r" };
    default: return null;
  }
}

export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export type InputControllerOptions = {
  getState: () => InputGuardState;
  getSelectedRing: () => number;
  selectRing: (ring: number) => void;
  rotate: (type: MoveType) => void;
};

/**
 * Small imperative adapter used by the DOM app.  It makes it possible to unit
 * test the common guard without constructing a browser or duplicating guard
 * checks in every event listener.
 */
export class InputController {
  private readonly options: InputControllerOptions;

  constructor(options: InputControllerOptions) {
    this.options = options;
  }

  selectRing(ring: number): boolean {
    if (!canAcceptInput(this.options.getState())) return false;
    if (!Number.isInteger(ring) || ring < 0 || ring >= RING_COUNT) return false;
    this.options.selectRing(ring);
    return true;
  }

  rotate(type: MoveType): boolean {
    if (!canAcceptInput(this.options.getState())) return false;
    if (type !== "l" && type !== "r") return false;
    this.options.rotate(type);
    return true;
  }

  keyboard(event: KeyboardEvent): boolean {
    const intent = keyboardIntent(event);
    if (!intent || !canAcceptInput(this.options.getState())) return false;
    event.preventDefault();
    if (intent.kind === "select") {
      this.options.selectRing(intent.ring);
      return true;
    }
    if (intent.kind === "cycle") {
      this.options.selectRing(cycleRing(this.options.getSelectedRing(), intent.direction));
      return true;
    }
    this.options.rotate(intent.type);
    return true;
  }

  /** Used by board ring hit areas where a pointer/click is one selection. */
  boardSelection(ring: number): boolean {
    return this.selectRing(ring);
  }

  selectedRing(): number {
    return this.options.getSelectedRing();
  }
}
