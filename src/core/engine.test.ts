import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  acceptRotation,
  applyRotation,
  assertValidPuzzle,
  computePuzzleChecksum,
  createSession,
  decodeState,
  encodeState,
  evaluate,
  oppositeSlot,
  partWorldSlots,
  replay,
  replayMoves,
  selectRing,
  STATE_SPACE,
  validatePuzzle,
  validateBoardState,
  type MoveType,
  type Puzzle,
} from "./index.ts";
import { createDefaultSettings, setAudioEnabled } from "./settings.ts";

type PuzzleDraft = Omit<Puzzle, "contentChecksum">;

function puzzle(draft: Omit<PuzzleDraft, "schemaVersion" | "rulesetVersion" | "generatorVersion" | "slotCount">): Puzzle {
  const full: PuzzleDraft = {
    schemaVersion: 2,
    rulesetVersion: "stone-rings-v2",
    generatorVersion: "generator-v2",
    slotCount: 12,
    ...draft,
  };
  return { ...full, contentChecksum: computePuzzleChecksum(full) };
}

function basePuzzle(): Puzzle {
  return puzzle({
    id: "test-01",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "blocker", slot: 6 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
}

test("K01 rotation wraps, opposite slots are six apart, and twelve rights return", () => {
  assert.equal(oppositeSlot(0), 6);
  assert.equal(oppositeSlot(11), 5);
  let state = { rotations: [0, 0, 0] as [number, number, number] };
  state = applyRotation(state, "l", 0);
  assert.equal(state.rotations[0], 11);
  state = applyRotation(state, "r", 0);
  assert.equal(state.rotations[0], 0);
  for (let count = 0; count < 12; count += 1) state = applyRotation(state, "r", 0);
  assert.deepEqual(state.rotations, [0, 0, 0]);
});

test("K02 traces the first inward, outward, same-ring, and foreign-part blocker", () => {
  const inward = puzzle({
    id: "inward-block",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [] },
      { id: "middle", parts: [{ kind: "blocker", slot: 0 }] },
      { id: "outer", parts: [{ kind: "emitter", slot: 0 }] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const inwardBeam = evaluate(inward, inward.initialState).beams[0];
  assert.equal(inwardBeam?.phase, "in");
  assert.equal(inwardBeam?.blockedRing, 1);

  const outward = basePuzzle();
  const outwardBeam = evaluate(outward, outward.initialState).beams[0];
  assert.equal(outwardBeam?.phase, "out");
  assert.equal(outwardBeam?.blockedRing, 1);

  const sameRing = puzzle({
    id: "same-ring-block",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "blocker", slot: 6 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const sameRingBeam = evaluate(sameRing, sameRing.initialState).beams[0];
  assert.equal(sameRingBeam?.blockedRing, 0);
  assert.equal(sameRingBeam?.phase, "out");

  const foreignEmitter = puzzle({
    id: "foreign-emitter-block",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const beams = evaluate(foreignEmitter, foreignEmitter.initialState).beams;
  assert.equal(beams.length, 2);
  assert.equal(beams[0]?.reachedRim, true);
  assert.equal(beams[1]?.phase, "in");
});

test("K03 crossing beams solve, extra light is allowed, and a duplicate target counts once", () => {
  const crossing = puzzle({
    id: "crossing",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }, { kind: "emitter", slot: 3 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6, 9],
    initialState: { rotations: [0, 0, 0] },
  });
  const crossingResult = evaluate(crossing, crossing.initialState);
  assert.equal(crossingResult.solved, true);
  assert.equal(crossingResult.beams.filter((beam) => beam.reachedRim).length, 2);

  const extraLight = puzzle({
    id: "extra-light",
    difficulty: "easy",
    rings: crossing.rings,
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const extraLightResult = evaluate(extraLight, extraLight.initialState);
  assert.equal(extraLightResult.solved, true);
  assert.deepEqual(extraLightResult.litSlots, [6, 9]);
  assert.equal(extraLightResult.litRequired, 1);

  const missingRequired = puzzle({
    id: "missing-required",
    difficulty: "easy",
    rings: crossing.rings,
    targets: [6, 8],
    initialState: { rotations: [0, 0, 0] },
  });
  const missingRequiredResult = evaluate(missingRequired, missingRequired.initialState);
  assert.equal(missingRequiredResult.litRequired, 1);
  assert.equal(missingRequiredResult.requiredCount, 2);
  assert.equal(missingRequiredResult.solved, false);

  const duplicate = puzzle({
    id: "same-target",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const duplicateResult = evaluate(duplicate, duplicate.initialState);
  assert.equal(duplicateResult.solved, true);
  assert.deepEqual(duplicateResult.litSlots, [6]);
  assert.equal(duplicateResult.litRequired, 1);
  assert.equal(duplicateResult.beams.length, 2);
});

test("K04 encodes every 1,728 rotation states and each of six moves reverses", () => {
  const seen = new Set<number>();
  for (let inner = 0; inner < 12; inner += 1) {
    for (let middle = 0; middle < 12; middle += 1) {
      for (let outer = 0; outer < 12; outer += 1) {
        const state = { rotations: [inner, middle, outer] as [number, number, number] };
        const code = encodeState(state);
        seen.add(code);
        assert.deepEqual(decodeState(code), state);
        for (let ring = 0; ring < 3; ring += 1) {
          assert.deepEqual(applyRotation(applyRotation(state, "l", ring), "r", ring), state);
          assert.deepEqual(applyRotation(applyRotation(state, "r", ring), "l", ring), state);
        }
      }
    }
  }
  assert.equal(seen.size, STATE_SPACE);
  assert.equal(STATE_SPACE, 1728);
});

test("K05 selection has no move, rotation commits immediately, and replay agrees", () => {
  const twoMoves = puzzle({
    id: "two-moves",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "blocker", slot: 6 }] },
      { id: "outer", parts: [{ kind: "blocker", slot: 6 }] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  let session = createSession(twoMoves);
  const initialState = structuredClone(session.state);
  const selectedRing = selectRing(0, 2);
  assert.equal(selectedRing, 2);
  assert.deepEqual(session.state, initialState);
  assert.equal(session.history.length, 0);
  assert.deepEqual(applyRotation(initialState, "l", 0).rotations, [11, 0, 0]);
  assert.deepEqual(applyRotation(initialState, "r", 0).rotations, [1, 0, 0]);
  const first = acceptRotation(session, "r", 1, 5);
  assert.equal(first.accepted, true);
  if (!first.accepted) return;
  session = first.session;
  assert.equal(session.history.length, 1);
  assert.equal(session.status, "playing");
  const second = acceptRotation(session, "r", 2, 5);
  assert.equal(second.accepted, true);
  if (!second.accepted) return;
  assert.equal(second.session.status, "solved");
  assert.equal(second.session.history[1]?.n, 2);
  assert.equal(second.session.history[1]?.t, 5);
  const replayed = replay(twoMoves, second.session.history);
  assert.equal(replayed.illegal, false);
  assert.equal(replayed.solved, true);
  assert.equal(replayed.acceptedActions, 2);
  assert.deepEqual(replayed.state, second.session.state);
  const afterSuccess = acceptRotation(second.session, "r", 0, 6);
  assert.equal(afterSuccess.accepted, false);
  assert.equal(afterSuccess.reason, "solved");
  const moveReplay = replayMoves(twoMoves, [{ type: "r", ring: 1 }, { type: "r", ring: 2 }]);
  assert.equal(moveReplay.solved, true);
});

test("K06 rejects malformed v2 fields, old state, checksum changes, and bad history", () => {
  const valid = basePuzzle();
  const oldState = structuredClone(valid) as Record<string, unknown>;
  oldState.initialState = { rotations: [0, 0, 0], emissionEnabled: [true, true, true] };
  const oldResult = validatePuzzle(oldState);
  assert.equal(oldResult.ok, false);

  const cyclic = { ...valid } as Record<string, unknown>;
  cyclic.extra = cyclic;
  assert.doesNotThrow(() => validatePuzzle(cyclic));
  assert.equal(validatePuzzle(cyclic).ok, false);

  const extra = structuredClone(valid) as Record<string, unknown>;
  extra.shortestMoves = 1;
  assert.equal(validatePuzzle(extra).ok, false);

  const badChecksum = { ...valid, contentChecksum: "0000000000000000" };
  const checksumResult = validatePuzzle(badChecksum);
  assert.equal(checksumResult.ok, false);
  if (!checksumResult.ok) assert.deepEqual(checksumResult.issues.map((issue) => issue.path), ["$.contentChecksum"]);

  const noEmitter = { ...valid, rings: valid.rings.map((ring) => ({ ...ring, parts: [] })) as unknown as Puzzle["rings"] };
  noEmitter.contentChecksum = computePuzzleChecksum(noEmitter);
  assert.equal(validatePuzzle(noEmitter).ok, false);

  const malformed: Array<[string, (candidate: Puzzle) => void]> = [
    ["NaN part slot", (candidate) => { candidate.rings[0].parts[0].slot = Number.NaN; }],
    ["fractional part slot", (candidate) => { candidate.rings[0].parts[0].slot = 0.5; }],
    ["out of range part slot", (candidate) => { candidate.rings[0].parts[0].slot = 12; }],
    ["unknown part kind", (candidate) => {
      const part = candidate.rings[0].parts[0] as unknown as Record<string, unknown>;
      part.kind = "mirror";
    }],
    ["two rings", (candidate) => { candidate.rings = candidate.rings.slice(0, 2) as unknown as Puzzle["rings"]; }],
    ["duplicate cell", (candidate) => { candidate.rings[0].parts.push({ kind: "blocker", slot: 0 }); }],
    ["empty targets", (candidate) => { candidate.targets = []; }],
    ["duplicate targets", (candidate) => { candidate.targets = [6, 6]; }],
    ["old schema", (candidate) => { candidate.schemaVersion = 1 as Puzzle["schemaVersion"]; }],
    ["old ruleset", (candidate) => { candidate.rulesetVersion = "stone-rings-v1" as Puzzle["rulesetVersion"]; }],
    ["old generator", (candidate) => { candidate.generatorVersion = "generator-v1"; }],
  ];
  for (const [name, mutate] of malformed) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    candidate.contentChecksum = computePuzzleChecksum(candidate);
    const result = validatePuzzle(candidate);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.path !== "$.contentChecksum"), name);
  }

  const validAction = {
    puzzleId: valid.id,
    rulesetVersion: "stone-rings-v2" as const,
    n: 1,
    t: 0,
    type: "r" as const,
    ring: 0,
  };
  const missingNumber = replay(valid, [{ ...validAction, n: undefined }]);
  assert.equal(missingNumber.illegal, true);
  const fractionalRing = replay(valid, [{ ...validAction, ring: 0.5 }]);
  assert.equal(fractionalRing.illegal, true);
  const negativeTime = replay(valid, [{ ...validAction, t: -1 }]);
  assert.equal(negativeTime.illegal, true);
  const unknownType = replay(valid, [{ ...validAction, type: "t" }]);
  assert.equal(unknownType.illegal, true);
  const backwardsTime = replay(valid, [validAction, { ...validAction, n: 2, t: 0 - 1 }]);
  assert.equal(backwardsTime.illegal, true);
  const unsafeTime = acceptRotation(createSession(valid), "r", 0, Number.MAX_SAFE_INTEGER + 1);
  assert.equal(unsafeTime.accepted, false);
  const badType = acceptRotation(createSession(valid), "t" as unknown as MoveType, 0, 0);
  assert.equal(badType.accepted, false);
  assert.equal(badType.reason, "bad-type");
  const badRing = acceptRotation(createSession(valid), "r", 3, 0);
  assert.equal(badRing.accepted, false);
  assert.equal(badRing.reason, "bad-ring");
  assert.equal(validateBoardState({ rotations: Array(3) }), false);
  assert.equal(validateBoardState({ rotations: [0, 0, 0], emissionEnabled: [true, true, true] }), false);
  assert.equal(validatePuzzle({ ...valid, initialState: { rotations: Array(3) } }).ok, false);
  assert.throws(() => assertValidPuzzle(badChecksum));
});

test("K06 rejects actions after the first success while allowing same-time legal actions", () => {
  const target = puzzle({
    id: "success-boundary",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [{ kind: "blocker", slot: 6 }] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const actions = [
    { puzzleId: target.id, rulesetVersion: "stone-rings-v2" as const, n: 1, t: 10, type: "r" as const, ring: 1 },
    { puzzleId: target.id, rulesetVersion: "stone-rings-v2" as const, n: 2, t: 10, type: "r" as const, ring: 0 },
  ];
  const result = replay(target, actions);
  assert.equal(result.illegal, true);
  assert.equal(result.failure?.code, "after-success");
  assert.equal(result.acceptedActions, 1);
  assert.equal(result.solved, true);
});

test("replay keeps an initially solved result consistent when the history is invalid", () => {
  const solved = puzzle({
    id: "initially-solved",
    difficulty: "easy",
    rings: [
      { id: "inner", parts: [{ kind: "emitter", slot: 0 }] },
      { id: "middle", parts: [] },
      { id: "outer", parts: [] },
    ],
    targets: [6],
    initialState: { rotations: [0, 0, 0] },
  });
  const result = replay(solved, [{
    puzzleId: solved.id,
    rulesetVersion: "stone-rings-v2",
    n: 1,
    t: -1,
    type: "r",
    ring: 0,
  }]);
  assert.equal(result.illegal, true);
  assert.equal(result.solved, true);
  assert.equal(result.firstSolvedAt, 0);
  assert.equal(evaluate(solved, result.state).solved, result.solved);
});

test("K07 keeps sound preference separate and marks every emitter as continuously active", () => {
  const valid = basePuzzle();
  const parts = partWorldSlots(valid, valid.initialState);
  assert.equal(parts.find((part) => part.kind === "emitter")?.emitting, true);
  assert.equal(Object.prototype.hasOwnProperty.call(valid.initialState, "emissionEnabled"), false);
  const settings = createDefaultSettings();
  assert.equal(settings.audioEnabled, true);
  assert.equal(setAudioEnabled(settings, false).audioEnabled, false);
});

test("rotation-only example is valid and checksum protected", async () => {
  const raw = JSON.parse(await readFile("content/examples/rotation-only-v2.json", "utf8")) as unknown;
  const parsed = assertValidPuzzle(raw);
  assert.equal(parsed.rulesetVersion, "stone-rings-v2");
  assert.equal(evaluate(parsed, parsed.initialState).solved, false);
});
