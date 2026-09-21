import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedHistory, isOverLimits, RunTimer, type ClockSource } from "./run.ts";
import type { HistoryAction } from "./core/types.ts";

type FakeClock = ClockSource & {
  mono: number;
  wall: number;
  advance: (monotonicMs: number, wallMs?: number) => void;
  set: (monotonicMs: number, wallMs: number) => void;
};

function fakeClock(mono = 0, wall = 0): FakeClock {
  let clock!: FakeClock;
  clock = {
    mono,
    wall,
    monotonicMs: () => clock.mono,
    wallMs: () => clock.wall,
    advance: (monotonicMs: number, wallMs = monotonicMs) => {
      clock.mono += monotonicMs;
      clock.wall += wallMs;
    },
    set: (monotonicMs: number, wallMs: number) => {
      clock.mono = monotonicMs;
      clock.wall = wallMs;
    },
  };
  return clock;
}

test("R4 timer stop freezes the reading even if callbacks keep polling", () => {
  const clock = fakeClock();
  const timer = new RunTimer({ clocks: clock });
  timer.start();
  clock.advance(250, 250);
  const stopped = timer.stop();
  assert.equal(stopped.elapsedMs, 250);

  // A stale rAF/setTimeout callback must not rewrite a solved question's time.
  clock.advance(10_000, 10_000);
  assert.deepEqual(timer.elapsed(), stopped.elapsedMs);
  assert.deepEqual(timer.reading(), stopped);
  assert.deepEqual(timer.stop(), stopped);
});

test("R4 timer clears suspension after resume and flags a later visible clock jump", () => {
  const clock = fakeClock(10_000, 10_000);
  const timer = new RunTimer({ clocks: clock });
  timer.start();

  clock.advance(100, 100);
  timer.lifecycle("hidden");
  // Mobile suspension can pause the monotonic clock while wall time advances.
  clock.advance(100, 120_000);
  timer.lifecycle("visible");
  assert.equal(timer.reading().abnormal, false, "sleep interval itself is not an anomaly");

  // Once visible again, a later wall-only jump is suspicious and must not be
  // silently accepted as a short/fast personal best.
  clock.advance(100, 120_000);
  assert.equal(timer.observe().abnormal, true);
});

test("R4 timer keeps a normal post-resume interval clean across duplicate pageshow events", () => {
  const clock = fakeClock(20_000, 20_000);
  const timer = new RunTimer({ clocks: clock });
  timer.start();
  clock.advance(100, 100);
  timer.lifecycle("pagehide");
  clock.advance(100, 120_000);
  timer.lifecycle("pageshow");
  const resumed = timer.reading();

  // A normal visible interval after the suspension boundary must not inherit
  // the expected sleep-clock discrepancy as an anomaly. Duplicate lifecycle
  // notifications are deliberately sent before the next observation.
  clock.advance(1_000, 1_000);
  timer.lifecycle("pageshow");
  timer.lifecycle("pageshow");
  const progressing = timer.observe();
  assert.ok(progressing.elapsedMs >= resumed.elapsedMs);
  assert.equal(progressing.abnormal, false);
});

test("R4 timer never decreases after a wall-clock rollback", () => {
  const clock = fakeClock(1_000, 1_000);
  const timer = new RunTimer({ clocks: clock });
  timer.start();
  clock.advance(100, 5_000);
  const beforeRollback = timer.reading();
  clock.set(1_200, 1_200);
  const afterRollback = timer.reading();

  assert.equal(afterRollback.abnormal, true);
  assert.ok(
    afterRollback.elapsedMs >= beforeRollback.elapsedMs,
    `elapsed time regressed from ${beforeRollback.elapsedMs} to ${afterRollback.elapsedMs}`,
  );
});

test("R4 timer flags a wall rollback that occurs across a hide boundary", () => {
  const clock = fakeClock();
  const timer = new RunTimer({ clocks: clock });
  timer.start();
  clock.set(10_000, 10_000);
  timer.lifecycle("hidden");
  // The wall clock returns to 5s while the monotonic source is at 10s.
  clock.set(10_000, 5_000);
  timer.lifecycle("visible");
  const stopped = timer.stop();
  assert.equal(stopped.abnormal, true);
  assert.ok(stopped.elapsedMs >= 10_000);
});

test("R4 timer accepts a two-minute visible interval when both clocks agree", () => {
  const clock = fakeClock(50_000, 1_700_000_000_000);
  const timer = new RunTimer({ clocks: clock });
  timer.start();
  clock.advance(120_000, 120_000);
  const reading = timer.observe();

  assert.equal(reading.elapsedMs, 120_000);
  assert.equal(reading.abnormal, false);
});

test("R4 over-limit reference history is bounded without turning the result into a loss", () => {
  const history = Array.from({ length: 301 }, (_, index): HistoryAction => ({
    puzzleId: "fixture-v2-puzzle",
    rulesetVersion: "stone-rings-v2",
    n: index + 1,
    t: index,
    type: "r",
    ring: index % 3,
  }));
  const bounded = boundedHistory(history);
  assert.equal(bounded.length, 300);
  assert.equal(bounded[0]?.n, 2);
  assert.equal(bounded.at(-1)?.n, 301);
  assert.equal(isOverLimits(1, history.length, history.length), true);
  assert.equal(isOverLimits(1, 1, 1), false);
});
