import { PLAYER_TAG_MAX, PLAYER_TAG_MIN } from "./config.ts";

export function formatTime(ms: number): string {
  const hundredths = Math.floor(Math.max(0, ms) / 10);
  const seconds = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return `${seconds}.${String(frac).padStart(2, "0")}`;
}

export function sanitizePlayerTag(raw: string): string | null {
  const trimmed = raw.replace(/[\r\n\t]/g, "").trim();
  if (trimmed.length < PLAYER_TAG_MIN || trimmed.length > PLAYER_TAG_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function makeClientInstanceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
