import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InputController,
  canAcceptInput,
  cycleRing,
  isActivationKey,
  keyboardIntent,
  type InputGuardState,
} from "./input.ts";

function keyEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  let prevented = false;
  return {
    key,
    get defaultPrevented() { return prevented; },
    isComposing: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    preventDefault() { prevented = true; },
    ...overrides,
  } as KeyboardEvent;
}

const playing: InputGuardState = {
  phase: "playing",
  puzzleValid: true,
  sessionActive: true,
  modalOpen: false,
};

test("input guard rejects every non-playing boundary", () => {
  assert.equal(canAcceptInput(playing), true);
  for (const state of [
    { ...playing, phase: "loading" as const },
    { ...playing, phase: "countdown" as const },
    { ...playing, phase: "solved" as const },
    { ...playing, phase: "cancelled" as const },
    { ...playing, puzzleValid: false },
    { ...playing, sessionActive: false },
    { ...playing, modalOpen: true },
  ]) assert.equal(canAcceptInput(state), false);
});

test("keyboard intents match documented shortcuts and ignore held activations", () => {
  assert.deepEqual(keyboardIntent(keyEvent("1")), { kind: "select", ring: 0 });
  assert.deepEqual(keyboardIntent(keyEvent("2")), { kind: "select", ring: 1 });
  assert.deepEqual(keyboardIntent(keyEvent("3")), { kind: "select", ring: 2 });
  assert.deepEqual(keyboardIntent(keyEvent("ArrowUp")), { kind: "cycle", direction: "previous" });
  assert.deepEqual(keyboardIntent(keyEvent("ArrowDown")), { kind: "cycle", direction: "next" });
  assert.deepEqual(keyboardIntent(keyEvent("ArrowLeft")), { kind: "rotate", type: "l" });
  assert.deepEqual(keyboardIntent(keyEvent("ArrowRight")), { kind: "rotate", type: "r" });
  assert.equal(keyboardIntent(keyEvent("Enter")), null);
  assert.equal(keyboardIntent(keyEvent(" ")), null);
  assert.equal(keyboardIntent(keyEvent("ArrowRight", { repeat: true })), null);
  assert.equal(keyboardIntent(keyEvent("ArrowRight", { isComposing: true })), null);
  assert.equal(isActivationKey("Enter"), true);
  assert.equal(isActivationKey(" "), true);
  assert.equal(isActivationKey("ArrowRight"), false);
});

test("cycleRing wraps and controller applies exactly one guarded action", () => {
  assert.equal(cycleRing(0, "previous"), 2);
  assert.equal(cycleRing(2, "next"), 0);
  let state = { ...playing };
  let selectedRing = 0;
  const rotations: string[] = [];
  const controller = new InputController({
    getState: () => state,
    getSelectedRing: () => selectedRing,
    selectRing: (ring) => { selectedRing = ring; },
    rotate: (type) => { rotations.push(type); },
  });

  assert.equal(controller.selectRing(2), true);
  assert.equal(selectedRing, 2);
  assert.equal(controller.rotate("r"), true);
  assert.deepEqual(rotations, ["r"]);
  const event = keyEvent("ArrowLeft");
  assert.equal(controller.keyboard(event), true);
  assert.deepEqual(rotations, ["r", "l"]);
  assert.equal(event.defaultPrevented, true);

  state = { ...state, modalOpen: true };
  assert.equal(controller.rotate("r"), false);
  assert.equal(controller.keyboard(keyEvent("ArrowRight")), false);
  assert.deepEqual(rotations, ["r", "l"]);
});
