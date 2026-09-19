let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (master && ctx) {
    master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.02);
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain = 0.08,
  freqEnd?: number,
) {
  if (!enabled) return;
  const audio = getCtx();
  if (!audio || !master) return;
  if (audio.state === "suspended") void audio.resume();
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, audio.currentTime + dur);
  g.gain.setValueAtTime(gain, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(g);
  g.connect(master);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

export function sfxSelect() {
  tone(220, 0.05, "triangle", 0.04);
}

export function sfxRotate() {
  tone(140, 0.09, "sawtooth", 0.035, 90);
}

export function sfxToggle(on: boolean) {
  tone(on ? 420 : 240, 0.11, "square", 0.04, on ? 620 : 160);
}

export function sfxLit() {
  tone(520, 0.12, "sine", 0.05, 780);
}

export function sfxSolve() {
  tone(392, 0.18, "sine", 0.07, 523);
  setTimeout(() => tone(523, 0.22, "sine", 0.06, 659), 80);
  setTimeout(() => tone(784, 0.28, "triangle", 0.05), 160);
}

export function sfxTick() {
  tone(880, 0.04, "square", 0.03);
}

export function sfxError() {
  tone(180, 0.16, "square", 0.05, 90);
}
