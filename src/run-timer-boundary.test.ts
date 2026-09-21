import assert from "node:assert/strict";
import { test } from "node:test";
import { RunTimer, type ClockSource } from "./run.ts";

test("R4 timer samples one clock pair when freezing a success", () => {
  let mono = 0;
  let wall = 0;
  let monoReads = 0;
  let wallReads = 0;
  const clocks: ClockSource = {
    monotonicMs: () => {
      monoReads += 1;
      return mono;
    },
    wallMs: () => {
      wallReads += 1;
      return wall;
    },
  };
  const timer = new RunTimer({ clocks });
  timer.start();
  const readsBeforeStop = { mono: monoReads, wall: wallReads };
  mono = 10;
  wall = 10;
  const stopped = timer.stop();
  assert.equal(monoReads - readsBeforeStop.mono, 1);
  assert.equal(wallReads - readsBeforeStop.wall, 1);
  assert.equal(stopped.elapsedMs, 10);
  assert.deepEqual(timer.stop(), stopped);
});

test("R4 timer can freeze the exact accepted reading without resampling", () => {
  let now = 0;
  let reads = 0;
  const timer = new RunTimer({
    clocks: {
      monotonicMs: () => { reads += 1; return now; },
      wallMs: () => { reads += 1; return now; },
    },
  });
  timer.start();
  now = 25;
  const accepted = timer.reading();
  const readsAtAcceptance = reads;
  now = 10_000;
  assert.deepEqual(timer.stop(accepted), accepted);
  assert.equal(reads, readsAtAcceptance);
  assert.equal(timer.elapsed(), 25);
});

test("R4 timer samples hide boundary and flags a rollback during suspension", () => {
  let mono = 0;
  let wall = 0;
  const clocks: ClockSource = {
    monotonicMs: () => mono,
    wallMs: () => wall,
  };
  const timer = new RunTimer({ clocks });
  timer.start();
  mono = 10_000;
  wall = 10_000;
  timer.lifecycle("hidden");
  mono = 10_000;
  wall = 5_000;
  timer.lifecycle("visible");
  assert.equal(timer.reading().abnormal, true);
});
