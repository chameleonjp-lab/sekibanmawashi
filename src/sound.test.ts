import assert from "node:assert/strict";
import test from "node:test";
import { SOUND_NAMES, SoundController, type AudioContextLike } from "./sound.ts";

type FakeState = {
  resumes: number;
  starts: number;
  stops: number;
  disconnects: number;
  oscillators: { stop: () => void; disconnect: () => void }[];
  suspended: boolean;
};

function fakeContext(state: FakeState, rejectResume = false): AudioContextLike {
  const context: AudioContextLike = {
    currentTime: 0,
    destination: {},
    state: state.suspended ? "suspended" : "running",
    resume: async () => {
      state.resumes += 1;
      if (rejectResume) throw new Error("blocked");
      state.suspended = false;
      context.state = "running";
    },
    createOscillator: () => {
      let stopped = false;
      const oscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => { state.starts += 1; },
        stop: () => {
          if (!stopped) {
            stopped = true;
            state.stops += 1;
          }
        },
        disconnect: () => { state.disconnects += 1; },
      };
      state.oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({
      gain: { value: 0 },
      connect: () => undefined,
      disconnect: () => { state.disconnects += 1; },
    }),
  };
  return context;
}

test("audio is initially enabled but creates no context until a gesture unlock", async () => {
  const state: FakeState = { resumes: 0, starts: 0, stops: 0, disconnects: 0, oscillators: [], suspended: true };
  let factories = 0;
  const sound = new SoundController({ contextFactory: () => { factories += 1; return fakeContext(state); } });
  assert.equal(factories, 0);
  sound.play("rotate");
  assert.equal(factories, 0);
  assert.equal(await sound.unlockFromGesture(), true);
  assert.equal(factories, 1);
  assert.equal(state.resumes, 1);
  sound.play("rotate");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.starts, 1);
  sound.dispose();
});

test("all six sound actions are distinct calls and muting stops active tones", async () => {
  const state: FakeState = { resumes: 0, starts: 0, stops: 0, disconnects: 0, oscillators: [], suspended: false };
  const sound = new SoundController({ contextFactory: () => fakeContext(state) });
  assert.equal(await sound.unlockFromGesture(), true);
  for (const name of SOUND_NAMES) sound.play(name);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.starts, SOUND_NAMES.length);
  sound.setEnabled(false);
  assert.equal(state.stops, SOUND_NAMES.length);
  assert.equal(state.disconnects, SOUND_NAMES.length * 2);
  sound.dispose();
});

test("a failed or incomplete resume is contained and a stale unlock cannot play after dispose", async () => {
  const failedState: FakeState = { resumes: 0, starts: 0, stops: 0, disconnects: 0, oscillators: [], suspended: true };
  const failed = new SoundController({ contextFactory: () => fakeContext(failedState, true) });
  assert.equal(await failed.unlockFromGesture(), false);
  failed.play("error");
  assert.equal(failedState.starts, 0);

  const incompleteState: FakeState = { resumes: 0, starts: 0, stops: 0, disconnects: 0, oscillators: [], suspended: true };
  const incompleteContext = fakeContext(incompleteState);
  incompleteContext.resume = async () => { incompleteState.resumes += 1; };
  const incomplete = new SoundController({ contextFactory: () => incompleteContext });
  assert.equal(await incomplete.unlockFromGesture(), false);
  assert.equal(incompleteState.resumes, 1);
  incomplete.play("start");
  assert.equal(incompleteState.starts, 0);
  incomplete.dispose();

  let resolveResume: (() => void) | undefined;
  const lateState: FakeState = { resumes: 0, starts: 0, stops: 0, disconnects: 0, oscillators: [], suspended: true };
  const lateContext = fakeContext(lateState);
  lateContext.resume = () => new Promise<void>((resolve) => {
    resolveResume = () => {
      lateContext.state = "running";
      resolve();
    };
  });
  const late = new SoundController({ contextFactory: () => lateContext });
  const unlock = late.unlockFromGesture();
  late.dispose();
  resolveResume?.();
  assert.equal(await unlock, true);
  late.play("success");
  assert.equal(lateState.starts, 0);
});

test("a failed scheduled stop disconnects a started tone", async () => {
  let stopCalls = 0;
  let disconnects = 0;
  let throwScheduledStop = true;
  const context: AudioContextLike = {
    currentTime: 0,
    destination: {},
    state: "running",
    resume: async () => undefined,
    createOscillator: () => ({
      type: "sine",
      frequency: { value: 0 },
      connect: () => undefined,
      start: () => undefined,
      stop: () => {
        stopCalls += 1;
        if (throwScheduledStop) {
          throwScheduledStop = false;
          throw new Error("scheduled stop failed");
        }
      },
      disconnect: () => { disconnects += 1; },
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect: () => undefined,
      disconnect: () => { disconnects += 1; },
    }),
  };
  const sound = new SoundController({ contextFactory: () => context });
  assert.equal(await sound.unlockFromGesture(), true);
  sound.play("rotate");
  assert.equal(stopCalls, 2);
  assert.equal(disconnects, 2);
  sound.dispose();
});
