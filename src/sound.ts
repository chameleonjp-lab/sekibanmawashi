/**
 * Small, dependency-free sound effects for the six game actions.  The
 * controller does not create an AudioContext while the page is loading: the
 * first call to unlockFromGesture must come from a user gesture.  All browser
 * audio failures are contained so sound can never block the puzzle.
 */

export const SOUND_NAMES = [
  "rotate",
  "select",
  "light",
  "success",
  "start",
  "error",
] as const;

export type SoundName = typeof SOUND_NAMES[number];

type AudioParamLike = {
  value: number;
  setValueAtTime?: (value: number, startTime: number) => void;
  exponentialRampToValueAtTime?: (value: number, endTime: number) => void;
};

type OscillatorLike = {
  type: OscillatorType | string;
  frequency: AudioParamLike;
  connect: (destination: unknown) => unknown;
  disconnect?: () => void;
  start: (when?: number) => void;
  stop: (when?: number) => void;
};

type GainLike = {
  gain: AudioParamLike;
  connect: (destination: unknown) => unknown;
  disconnect?: () => void;
};

/** Narrow interface used by the runtime and by deterministic unit tests. */
export type AudioContextLike = {
  currentTime: number;
  destination: unknown;
  state: string;
  createOscillator: () => OscillatorLike;
  createGain: () => GainLike;
  resume: () => Promise<void>;
};

export type SoundControllerOptions = {
  enabled?: boolean;
  contextFactory?: () => AudioContextLike | null;
};

const SOUND_SHAPES: Record<SoundName, { frequency: number; durationMs: number; gain: number; type: OscillatorType }> = {
  rotate: { frequency: 190, durationMs: 55, gain: 0.035, type: "triangle" },
  select: { frequency: 280, durationMs: 50, gain: 0.03, type: "sine" },
  light: { frequency: 520, durationMs: 90, gain: 0.04, type: "sine" },
  success: { frequency: 760, durationMs: 180, gain: 0.05, type: "sine" },
  start: { frequency: 420, durationMs: 120, gain: 0.04, type: "triangle" },
  error: { frequency: 120, durationMs: 130, gain: 0.045, type: "square" },
};

type BrowserAudioGlobals = typeof globalThis & {
  webkitAudioContext?: new () => AudioContextLike;
};

function browserContextFactory(): AudioContextLike | null {
  try {
    const globals = globalThis as BrowserAudioGlobals;
    const Constructor = typeof globals.AudioContext === "function"
      ? globals.AudioContext as unknown as (new () => AudioContextLike)
      : globals.webkitAudioContext;
    return Constructor ? new Constructor() : null;
  } catch {
    return null;
  }
}

// Keep one context for the lifetime of a page.  Rendering home, game, and
// result screens repeatedly must not create one context per attempt.  It is
// intentionally not closed by dispose; browsers reclaim it with the page and
// this also lets the user gesture that starts a run unlock the next screen.
let sharedContext: AudioContextLike | null = null;
let sharedContextFailed = false;

function createContext(factory: () => AudioContextLike | null): AudioContextLike | null {
  if (factory === browserContextFactory) {
    if (sharedContextFailed) return null;
    if (!sharedContext) {
      sharedContext = browserContextFactory();
      if (!sharedContext) sharedContextFailed = true;
    }
    return sharedContext;
  }
  return factory();
}

function existingContext(factory: () => AudioContextLike | null): AudioContextLike | null {
  return factory === browserContextFactory ? sharedContext : null;
}

function setParam(param: AudioParamLike, value: number, at: number): void {
  try {
    if (param.setValueAtTime) param.setValueAtTime(value, at);
    else param.value = value;
  } catch {
    // A browser with a partially implemented audio API should be silent.
  }
}

function rampParam(param: AudioParamLike, value: number, at: number): void {
  try {
    if (param.exponentialRampToValueAtTime) param.exponentialRampToValueAtTime(value, at);
    else param.value = value;
  } catch {
    // A browser with a partially implemented audio API should be silent.
  }
}

export class SoundController {
  private readonly contextFactory: () => AudioContextLike | null;
  private enabled: boolean;
  private context: AudioContextLike | null = null;
  private failed = false;
  private disposed = false;
  private generation = 0;
  private unlockPromise: Promise<boolean> | null = null;
  private readonly active = new Map<number, { oscillator: OscillatorLike; gain: GainLike; timer: ReturnType<typeof globalThis.setTimeout> }>();
  private serial = 0;

  constructor(options: SoundControllerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.contextFactory = options.contextFactory ?? browserContextFactory;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Muting is immediate and also stops already scheduled tones. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.generation += 1;
    if (!enabled) this.stopActive();
  }

  /** Invalidate pending resume callbacks and tones at a screen/question edge. */
  invalidate(): void {
    this.generation += 1;
    this.stopActive();
  }

  /**
   * Unlock audio in the same event turn as a click/tap/key gesture.  The
   * returned promise is always fulfilled with false on unsupported or blocked
   * audio, so callers do not need a rejection handler to keep the game alive.
   */
  async unlockFromGesture(): Promise<boolean> {
    if (!this.enabled || this.disposed || this.failed) return false;
    if (this.unlockPromise) return this.unlockPromise;
    this.unlockPromise = this.performUnlock();
    const current = this.unlockPromise;
    void current.finally(() => {
      if (this.unlockPromise === current) this.unlockPromise = null;
    });
    return current;
  }

  private async performUnlock(): Promise<boolean> {
    try {
      if (!this.context) this.context = createContext(this.contextFactory);
      if (!this.context) {
        this.failed = true;
        return false;
      }
      if (this.context.state === "suspended") await this.context.resume();
      if (this.context.state === "closed") {
        this.failed = true;
        return false;
      }
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  /** Play a short effect; unsupported/failed audio is intentionally silent. */
  play(name: SoundName): void {
    if (!this.enabled || this.disposed || this.failed) return;
    const capturedGeneration = this.generation;
    if (!this.context) this.context = existingContext(this.contextFactory);
    const pending = this.unlockPromise;
    if (pending) {
      void pending.then((ready) => {
        if (!ready || !this.enabled || this.disposed || capturedGeneration !== this.generation || !this.context) return;
        this.emit(name, this.context, capturedGeneration);
      }).catch(() => { /* a blocked context remains silent */ });
      return;
    }
    if (!this.context || this.context.state !== "running") return;
    this.emit(name, this.context, capturedGeneration);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.stopActive();
  }

  private emit(name: SoundName, context: AudioContextLike, capturedGeneration: number): void {
    const shape = SOUND_SHAPES[name];
    const serial = ++this.serial;
    let oscillator: OscillatorLike | null = null;
    let gain: GainLike | null = null;
    try {
      oscillator = context.createOscillator();
      gain = context.createGain();
      const startAt = context.currentTime;
      const endAt = startAt + shape.durationMs / 1_000;
      oscillator.type = shape.type;
      setParam(oscillator.frequency, shape.frequency, startAt);
      setParam(gain.gain, 0.0001, startAt);
      rampParam(gain.gain, shape.gain, startAt + 0.008);
      rampParam(gain.gain, 0.0001, endAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
      const timer = globalThis.setTimeout(() => {
        this.stopOne(serial);
        if (this.disposed || capturedGeneration !== this.generation) return;
      }, shape.durationMs + 40);
      this.active.set(serial, { oscillator, gain, timer });
      if (this.active.size > 16) {
        const oldest = this.active.keys().next().value;
        if (typeof oldest === "number") this.stopOne(oldest);
      }
    } catch {
      // create/connect/start can fail on a suspended or restricted browser.
      try { oscillator?.disconnect?.(); } catch { /* unsupported */ }
      try { gain?.disconnect?.(); } catch { /* unsupported */ }
    }
  }

  private stopActive(): void {
    for (const serial of [...this.active.keys()]) this.stopOne(serial);
  }

  private stopOne(serial: number): void {
    const active = this.active.get(serial);
    if (!active) return;
    this.active.delete(serial);
    globalThis.clearTimeout(active.timer);
    try { active.oscillator.stop(); } catch { /* already stopped */ }
    try { active.oscillator.disconnect?.(); } catch { /* unsupported */ }
    try { active.gain.disconnect?.(); } catch { /* unsupported */ }
  }
}

/** Test-only reset for an injected browser harness; never needed by the app. */
export function resetSharedAudioForTests(): void {
  sharedContext = null;
  sharedContextFailed = false;
}
