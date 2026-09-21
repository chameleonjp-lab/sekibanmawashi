import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededSource, uniformIndex, UINT32_RANGE, XorShift32 } from "./random.ts";

test("uniformIndex rejects the incomplete 32-bit tail", () => {
  const values = [UINT32_RANGE - 1, 7];
  let calls = 0;
  const index = uniformIndex(() => {
    const value = values[calls];
    calls += 1;
    return value ?? 0;
  }, 10);
  assert.equal(index, 7);
  assert.equal(calls, 2);
});

test("seeded random streams and xorshift output are reproducible", () => {
  const left = new XorShift32(0x5202_0900);
  const right = new XorShift32(0x5202_0900);
  for (let index = 0; index < 100; index += 1) assert.equal(left.nextUint32(), right.nextUint32());
  const source = createSeededSource(123);
  const values = Array.from({ length: 20 }, () => uniformIndex(source, 900));
  assert.deepEqual(values, [756, 198, 138, 452, 642, 790, 885, 170, 251, 451, 648, 57, 424, 53, 626, 366, 351, 61, 170, 100]);
});
