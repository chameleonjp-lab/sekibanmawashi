import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOARD_CENTER,
  BOARD_VIEWBOX,
  RECEIVER_RADIUS,
  beamSegments,
  createBoardRenderModel,
  polarPoint,
  ringPath,
} from "./board.ts";
import { computePuzzleChecksum, evaluate } from "./core/index.ts";
import type { Puzzle } from "./core/types.ts";

function puzzle(draft: Omit<Puzzle, "contentChecksum">): Puzzle {
  return { ...draft, contentChecksum: computePuzzleChecksum(draft) };
}

function oneEmitter(overrides: Partial<Omit<Puzzle, "contentChecksum">> = {}): Puzzle {
  return puzzle({
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    generatorVersion: "generator-v2",
    id: "board-test",
    difficulty: "easy",
    slotCount: 12,
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
    ...overrides,
  });
}

test("board geometry keeps all twelve receivers and beams inside the viewBox", () => {
  for (let slot = 0; slot < 12; slot += 1) {
    const point = polarPoint(RECEIVER_RADIUS, slot);
    assert.ok(point.x > BOARD_VIEWBOX.minX && point.x < BOARD_VIEWBOX.width);
    assert.ok(point.y > BOARD_VIEWBOX.minY && point.y < BOARD_VIEWBOX.height);
  }
  assert.deepEqual(BOARD_CENTER, { x: 150, y: 150 });
  assert.match(ringPath(31, 55), /^M 150 95/);
});

test("beam geometry stops at the first inward blocker and does not draw past it", () => {
  const blocked = oneEmitter({
    id: "board-inward-block",
    rings: [
      { id: "inner", parts: [] },
      { id: "middle", parts: [{ kind: "blocker", slot: 0 }] },
      { id: "outer", parts: [{ kind: "emitter", slot: 0 }] },
    ],
  });
  const light = evaluate(blocked, blocked.initialState);
  const segments = beamSegments(light.beams);
  const outerBeam = segments.filter((segment) => segment.beamIndex === 0);
  assert.equal(outerBeam.length, 1);
  assert.equal(outerBeam[0]?.phase, "in");
  assert.equal(outerBeam[0]?.blockedRing, 1);
  assert.equal(outerBeam[0]?.blockedSlot, 0);
  assert.equal(outerBeam[0]?.end.x, polarPoint(73, 0).x);
  assert.equal(outerBeam[0]?.end.y, polarPoint(73, 0).y);
});

test("outward blocker metadata belongs only to the centre-to-blocker segment", () => {
  const blocked = oneEmitter({
    id: "board-outward-block",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 6 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
  });
  const segments = beamSegments(evaluate(blocked, blocked.initialState).beams);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.phase, "in");
  assert.equal(segments[0]?.blockedRing, null);
  assert.equal(segments[1]?.phase, "out");
  assert.equal(segments[1]?.blockedRing, 0);
  assert.equal(segments[1]?.blockedSlot, 6);
});

test("clear beams have both halves and reach their opposite receiver", () => {
  const clear = oneEmitter({ id: "board-clear" });
  const light = evaluate(clear, clear.initialState);
  const model = createBoardRenderModel(clear, clear.initialState);
  assert.equal(light.beams[0]?.reachedRim, true);
  assert.equal(model.beams.length, 2);
  assert.equal(model.beams[0]?.blockedRing, null);
  assert.equal(model.beams[1]?.blockedRing, null);
  assert.deepEqual(model.beams[1]?.end, polarPoint(RECEIVER_RADIUS, 6));
});

test("render model exposes world slots once, so a rotated part is not double-rotated", () => {
  const rotated = oneEmitter({
    id: "board-rotated",
    initialState: { rotations: [1, 0, 0] },
  });
  const model = createBoardRenderModel(rotated, rotated.initialState);
  assert.deepEqual(model.parts.find((part) => part.kind === "emitter")?.slot, 1);
});
