const INPUT_SURFACE_SELECTOR = [
  "[data-board-host]",
  ".ring-controls",
  ".rotate-controls",
  "[data-action='reset-question']",
].join(",");

/** Prevent a blocked game-input tap from triggering browser double-tap zoom. */
export function preventBlockedGameInputTouchZoom(event: TouchEvent, inputAllowed: boolean): void {
  if (inputAllowed || !event.cancelable) return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(INPUT_SURFACE_SELECTOR)) return;
  event.preventDefault();
}
