/** Deterministic 32-bit random helpers used by R2 generation and simulation. */

export const UINT32_RANGE = 0x1_0000_0000;

export type Uint32Source = () => number;

function assertUint32(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError("random source must return an unsigned 32-bit integer");
  }
  return value;
}

/**
 * A small, reproducible generator for offline artifacts. The state is never
 * seeded from the clock, so generated files remain byte-for-byte reproducible.
 */
export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
      throw new RangeError("seed must be an unsigned 32-bit integer");
    }
    this.state = seed === 0 ? 0x6d2b79f5 : seed >>> 0;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }
}

/**
 * Uniformly maps a 32-bit value to [0, bound). Values in the incomplete tail
 * of the 2^32 range are rejected instead of using `% bound` directly.
 */
export function uniformIndex(nextUint32: Uint32Source, bound: number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
    throw new RangeError("bound must be an integer from 1 through 2^32");
  }
  if (bound === 1) return 0;
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let value = assertUint32(nextUint32());
  while (value >= limit) value = assertUint32(nextUint32());
  return value % bound;
}

export function shuffleInPlace<T>(items: T[], nextUint32: Uint32Source): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = uniformIndex(nextUint32, index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
}

export function shuffled<T>(items: readonly T[], nextUint32: Uint32Source): T[] {
  const copy = [...items];
  shuffleInPlace(copy, nextUint32);
  return copy;
}

export function createSeededSource(seed: number): Uint32Source {
  const generator = new XorShift32(seed);
  return () => generator.nextUint32();
}
