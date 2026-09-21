import { GAME_TITLE } from "./core/index.ts";
import { formatTimeMs, type FinalRunResult } from "./run.ts";

/** Planned v2 URL; publication remains a later, explicitly approved stage. */
export const PUBLIC_GAME_URL = "https://chameleonjp-lab.github.io/sekibanmawashi/";
/** The experiment home, not the old ranking endpoint. */
export const LAB_URL = "https://chameleonjp-lab.github.io/chameleonjp_lab/";

export type SharePayload = {
  title?: string;
  text: string;
  url?: string;
};

export type ShareNavigator = {
  share?: (data: SharePayload) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

export type ShareResult =
  | { status: "shared" }
  | { status: "copied" }
  | { status: "cancelled" }
  | { status: "selectable"; text: string }
  | { status: "failed"; text: string };

export function shareText(options: { title?: string; result?: Pick<FinalRunResult, "totalTimeMs" | "totalMoves">; url?: string } = {}): string {
  const title = options.title ?? GAME_TITLE;
  const url = options.url ?? PUBLIC_GAME_URL;
  const result = options.result;
  if (!result) return `${title}を遊んでみてください。\n${url}`;
  return `${title}で5問を解きました。合計 ${formatTimeMs(result.totalTimeMs)} / ${result.totalMoves}手\n${url}`;
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException ? error.name === "AbortError" :
    typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Web Share cancellation is a user decision, not a failed share.  In that
 * case this function intentionally does not attempt clipboard fallback.
 */
export async function shareOrCopy(
  text: string,
  navigatorLike: ShareNavigator | null = typeof navigator === "undefined" ? null : navigator,
  options: { title?: string; url?: string } = {},
): Promise<ShareResult> {
  const payload: SharePayload = { title: options.title ?? GAME_TITLE, text, url: options.url ?? PUBLIC_GAME_URL };
  if (navigatorLike?.share) {
    try {
      await navigatorLike.share(payload);
      return { status: "shared" };
    } catch (error) {
      if (isAbortError(error)) return { status: "cancelled" };
    }
  }
  if (navigatorLike?.clipboard?.writeText) {
    try {
      await navigatorLike.clipboard.writeText(text);
      return { status: "copied" };
    } catch {
      // Fall through to a selectable, non-destructive fallback.
    }
  }
  return { status: "selectable", text };
}
