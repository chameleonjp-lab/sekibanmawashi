import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzePuzzle } from "../src/puzzles/solver.ts";
import type { MoveType, Puzzle } from "../src/core/types.ts";
import { applyRotation, evaluate } from "../src/core/engine.ts";

/**
 * R4 acceptance tests intentionally solve the public board with an oracle
 * loaded from the repository's puzzle JSON.  The oracle is only test code;
 * the application must not expose a solution path in its rendered DOM.
 */

type Viewport = { name: string; width: number; height: number };
type RunMode = "challenge" | "practice";

const VIEWPORTS: Viewport[] = [
  { name: "w320-h568", width: 320, height: 568 },
  { name: "w375-h667", width: 375, height: 667 },
  { name: "w390-h844", width: 390, height: 844 },
  { name: "w402-h874", width: 402, height: 874 },
  { name: "w430-h932", width: 430, height: 932 },
  { name: "w844-h390", width: 844, height: 390 },
  { name: "w1280-h720", width: 1280, height: 720 },
  { name: "w393-h852", width: 393, height: 852 },
  { name: "w852-h393", width: 852, height: 393 },
  { name: "w1440-h900", width: 1440, height: 900 },
];

const puzzles = JSON.parse(
  readFileSync(resolve(process.cwd(), "content/puzzles-v2.json"), "utf8"),
) as Puzzle[];
const puzzleById = new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));

const TEST_CLOCK_INSTALL = () => {
  const state = {
    wall: 1_700_000_000_000,
    mono: 10_000,
  };
  const target = window as Window & {
    __r4TestClock?: {
      now: () => { wall: number; mono: number };
      advance: (wallMs: number, monoMs?: number) => void;
      set: (wall: number, mono: number) => void;
    };
  };
  // This is a browser-test clock. The app still calls the platform clocks
  // normally; only this test page's Date/performance values are controlled.
  Date.now = () => state.wall;
  const fakePerformanceNow = () => state.mono;
  try {
    Object.defineProperty(performance, "now", {
      configurable: true,
      writable: true,
      value: fakePerformanceNow,
    });
  } catch {
    // Some WebKit builds keep the instance method non-configurable. Try the
    // prototype before falling back to wall-only assertions in that engine.
    try {
      Object.defineProperty(Object.getPrototypeOf(performance), "now", {
        configurable: true,
        writable: true,
        value: fakePerformanceNow,
      });
    } catch {
      // Date.now remains controlled if both browser descriptors are sealed;
      // the timing assertions will then expose the unsupported engine.
    }
  }
  target.__r4TestClock = {
    now: () => ({ ...state }),
    advance: (wallMs, monoMs = wallMs) => {
      state.wall += wallMs;
      state.mono += monoMs;
    },
    set: (wall, mono) => {
      state.wall = wall;
      state.mono = mono;
    },
  };
};

/** Install before the app boots. This test-only object is never read by the app. */
async function installClock(page: Page): Promise<void> {
  await page.addInitScript(TEST_CLOCK_INSTALL);
}

function home(page: Page): Locator {
  return page.locator("[data-testid='home-screen']");
}

function game(page: Page): Locator {
  return page.locator("[data-testid='game-screen']");
}

function result(page: Page): Locator {
  return page.locator("[data-testid='result-screen']");
}

function nameInput(page: Page): Locator {
  return page.locator("[data-testid='home-screen'] [data-field='player-name']");
}

function startButton(page: Page, mode: RunMode): Locator {
  return page.locator(`[data-testid='home-screen'] form[data-mode='${mode}'] button[data-action='start-${mode}']`);
}

function rotateButton(page: Page, direction: MoveType): Locator {
  const dataName = direction === "l" ? "left" : "right";
  return page.locator(`[data-testid='game-screen'] [data-action='rotate-${dataName}']`);
}

function phaseLocator(page: Page, phase: string): Locator {
  return page.locator(`[data-testid='game-screen'][data-phase='${phase}']`);
}

function visibleDialog(page: Page): Locator {
  return page.locator("[role='dialog']:visible, dialog[open]").first();
}

function currentPuzzleShell(page: Page): Locator {
  return page.locator("[data-testid='game-screen'][data-puzzle-id]");
}

/** Exercise the same lifecycle targets used by the application. */
async function dispatchLifecycle(page: Page, hidden: boolean, duplicate = false): Promise<void> {
  await page.evaluate(({ hidden: nextHidden, duplicate: repeat }) => {
    try {
      Object.defineProperty(document, "hidden", { configurable: true, value: nextHidden });
    } catch {
      // A browser may expose a non-configurable visibility property. The
      // document event still verifies that the listener is attached to the
      // document rather than incorrectly to window.
    }
    const send = (): void => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event(nextHidden ? "pagehide" : "pageshow"));
    };
    send();
    if (repeat) send();
  }, { hidden, duplicate });
}

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /石板回し/ })).toBeVisible();
  await expect(home(page)).toBeVisible();
  await expect(page.locator("[data-error='fatal'], [data-fatal-error]")).toHaveCount(0);
}

async function fillName(page: Page, value: string): Promise<void> {
  const input = nameInput(page);
  await expect(input).toBeVisible();
  await input.fill(value);
}

async function begin(page: Page, mode: RunMode, name = "Luna"): Promise<void> {
  await fillName(page, name);
  await startButton(page, mode).click();
  await expect(game(page)).toBeVisible();
}

async function readAssignmentPuzzleIds(page: Page): Promise<unknown[] | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => /assignment/i.test(entry));
    if (!key) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as { puzzleIds?: unknown };
      return Array.isArray(parsed?.puzzleIds) ? parsed.puzzleIds : null;
    } catch {
      return null;
    }
  });
}

async function installIntervalProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalSet = window.setInterval.bind(window);
    const originalClear = window.clearInterval.bind(window);
    const active = new Set<number>();
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = originalSet(handler, timeout, ...args);
      active.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      if (id !== undefined) active.delete(id);
      originalClear(id);
    }) as typeof window.clearInterval;
    (window as Window & { __r4ActiveIntervals?: () => number }).__r4ActiveIntervals = () => active.size;
  });
}

async function readPuzzleId(page: Page): Promise<string> {
  const shell = currentPuzzleShell(page);
  await expect(shell).toBeVisible();
  const id = await shell.getAttribute("data-puzzle-id");
  if (!id) throw new Error("The current question does not expose its public puzzle id");
  const matched = id.match(/[a-z]+-v2-[a-z0-9-]+/i)?.[0] ?? id.trim();
  if (!puzzleById.has(matched)) throw new Error(`Unknown public puzzle id: ${matched}`);
  return matched;
}

async function readDifficulty(page: Page): Promise<string> {
  const field = page.locator("[data-testid='game-screen'] [data-field='difficulty']");
  const value = await field.getAttribute("data-difficulty");
  const text = await field.textContent();
  const source = `${value ?? ""} ${text ?? ""}`;
  if (/上級|hard/i.test(source)) return "hard";
  if (/中級|normal|medium/i.test(source)) return "normal";
  if (/初級|easy/i.test(source)) return "easy";
  return String(value ?? text ?? "").trim();
}

async function waitForPlaying(page: Page): Promise<void> {
  await expect(game(page)).toBeVisible();
  await expect(game(page)).toHaveAttribute("data-phase", "playing", { timeout: 12_000 });
}

async function solveVisibleQuestion(page: Page): Promise<void> {
  await waitForPlaying(page);
  const id = await readPuzzleId(page);
  const puzzle = puzzleById.get(id);
  if (!puzzle) throw new Error(`No fixture for puzzle ${id}`);
  const analysis = analyzePuzzle(puzzle);
  expect(analysis.truncated, `offline oracle must fully inspect ${id}`).toBe(false);
  expect(analysis.shortestMoves, `public puzzle ${id} must be solvable`).not.toBeNull();

  for (const move of analysis.representativeSolution) {
    const ring = page.locator(
      `[data-action='select-ring'][data-ring='${move.ring}'], [data-action='ring-select'][data-ring='${move.ring}'], [data-ring-button='${move.ring}']`,
    ).first();
    await expect(ring).toBeVisible();
    await ring.click();
    await rotateButton(page, move.type).click();
  }

  await expect.poll(async () => {
    if (await result(page).isVisible().catch(() => false)) return "result";
    const phase = await game(page).getAttribute("data-phase");
    if (phase === "solved" || phase === "success" || phase === "intermission") return "solved";
    return "playing";
  }, { timeout: 10_000 }).toMatch(/solved|result/);
}

/** Leave a question one legal move short of its offline-oracle solution. */
async function prepareImmediatelyBeforeSuccess(page: Page): Promise<void> {
  await waitForPlaying(page);
  const id = await readPuzzleId(page);
  const puzzle = puzzleById.get(id);
  if (!puzzle) throw new Error(`No fixture for puzzle ${id}`);
  const analysis = analyzePuzzle(puzzle);
  expect(analysis.truncated).toBe(false);
  expect(analysis.representativeSolution.length).toBeGreaterThan(0);
  let state = puzzle.initialState;
  const prefix = analysis.representativeSolution.slice(0, -1);
  for (const move of prefix) {
    state = applyRotation(state, move.type, move.ring);
    expect(evaluate(puzzle, state).solved).toBe(false);
    await page.locator(`[data-action='select-ring'][data-ring='${move.ring}']`).click();
    await rotateButton(page, move.type).click();
  }
  await expect(game(page)).toHaveAttribute("data-phase", "playing");
  await expect(page.locator("[data-testid='game-screen'] [data-field='move-count']")).toHaveAttribute("data-moves", String(prefix.length));
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "R4 screen must not horizontally scroll").toBeLessThanOrEqual(1);
}

async function assertControls(page: Page): Promise<void> {
  for (const control of await page.getByRole("button").all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box, "visible controls need a hit target").not.toBeNull();
    if (!box) continue;
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
}

async function assertPrimaryControlsInViewport(page: Page, viewport: Viewport): Promise<void> {
  const compactPortrait = viewport.width <= 430 && viewport.height > viewport.width;
  if (compactPortrait) await page.evaluate(() => window.scrollTo(0, 0));
  if (compactPortrait) {
    const board = page.locator("[data-testid='game-screen'] [data-board] svg.stone-board");
    const boardBox = await board.boundingBox();
    expect(boardBox).not.toBeNull();
    if (boardBox) {
      expect(boardBox.y).toBeGreaterThanOrEqual(-1);
      expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
  for (const control of await page.locator("[data-testid='game-screen'] [data-action='select-ring'], [data-testid='game-screen'] [data-action^='rotate-']").all()) {
    if (!compactPortrait) await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

async function assertNoControlOverlap(page: Page): Promise<void> {
  // The SVG annulus hit regions intentionally have overlapping rectangular
  // bounding boxes even though their radial hit areas are disjoint. R3 owns
  // that geometry assertion; R4 checks the actual interactive controls.
  const controls = page.locator("button:visible");
  const boxes = [] as { x: number; y: number; width: number; height: number }[];
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    if (box && box.width > 0 && box.height > 0) boxes.push(box);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      expect(overlap, "visible R4 controls must not overlap").toBe(0);
    }
  }
}

async function phaseHistory(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const state = window as Window & { __r4PhaseHistory?: string[] };
    return [...(state.__r4PhaseHistory ?? [])];
  });
}

async function installPhaseObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as Window & { __r4PhaseHistory?: string[] };
    state.__r4PhaseHistory = [];
    const record = (element: Element): void => {
      const phase = element.getAttribute("data-phase")
        ?? element.getAttribute("data-run-phase")
        ?? element.getAttribute("data-screen");
      if (phase && state.__r4PhaseHistory?.at(-1) !== phase) state.__r4PhaseHistory?.push(phase);
    };
    const observer = new MutationObserver((records) => {
      for (const recordEntry of records) {
        if (recordEntry.type === "attributes" && recordEntry.target instanceof Element) record(recordEntry.target);
        if (recordEntry.type === "childList") {
          for (const node of Array.from(recordEntry.addedNodes)) {
            if (!(node instanceof Element)) continue;
            record(node);
            for (const nested of Array.from(node.querySelectorAll("[data-phase], [data-run-phase], [data-screen]"))) record(nested);
          }
        }
      }
    });
    // addInitScript runs before the parser necessarily creates <html>; the
    // Document itself is always available and observes the eventual root.
    observer.observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["data-phase", "data-run-phase", "data-screen"],
    });
  });
}

async function startAndSolveChallenge(
  page: Page,
  options: { reducedMotion?: boolean; audioOff?: boolean } = {},
): Promise<{ ids: string[]; difficulties: string[] }> {
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoHome(page);
  if (options.audioOff) {
    const audio = page.locator("[data-testid='home-screen'] [data-action='audio']");
    if (await audio.isVisible().catch(() => false) && await audio.isChecked().catch(() => false)) await audio.uncheck();
  }
  await begin(page, "challenge");
  const ids: string[] = [];
  const difficulties: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    await waitForPlaying(page);
    ids.push(await readPuzzleId(page));
    difficulties.push(await readDifficulty(page));
    await solveVisibleQuestion(page);
    if (index < 4) {
      await expect.poll(async () =>
        (await phaseLocator(page, "intermission").count()) > 0,
        { timeout: 4_000 },
      ).toBe(true);
    }
  }
  await expect(result(page)).toBeVisible();
  return { ids, difficulties };
}

test.describe("R4 run, timer, and storage acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await installClock(page);
    await installPhaseObserver(page);
  });

  test("F01/F02: challenge has five fixed questions, one countdown, four intermissions, and a result", async ({ page }) => {
    test.setTimeout(180_000);
    const run = await startAndSolveChallenge(page, { reducedMotion: true, audioOff: true });
    expect(run.ids).toHaveLength(5);
    expect(new Set(run.ids).size, "one challenge must not repeat a puzzle").toBe(5);
    expect(run.difficulties).toEqual(["easy", "easy", "normal", "normal", "hard"]);
    const history = await phaseHistory(page);
    expect(history.filter((phase) => phase === "countdown")).toHaveLength(1);
    expect(history.filter((phase) => phase === "intermission")).toHaveLength(4);
    await expect(page.getByRole("heading", { name: "結果", exact: true })).toBeVisible();
    await expect(page.locator("[data-testid='result-screen'] [data-result-question]")).toHaveCount(5);
    const total = page.locator("[data-testid='result-screen'] [data-total-time]");
    await expect(total).toBeVisible();
    const times = await page.locator("[data-result-time-ms]").evaluateAll((elements) => elements.map((element) => {
      const raw = element.getAttribute("data-result-time-ms") ?? "";
      return Number(raw);
    }));
    expect(times).toHaveLength(5);
    expect(times.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    await expect(total).toHaveAttribute("data-total-time-ms");
    const totalMs = Number(await total.getAttribute("data-total-time-ms"));
    expect(totalMs).toBe(times.reduce((sum, value) => sum + value, 0));
  });

  test("F03/F04/T02/T03: dialogs and lifecycle events keep the same question and avoid duplicate moves", async ({ page }) => {
    await gotoHome(page);
    await fillName(page, "Luna");
    // Two synchronous activations must create one run and one countdown.
    await startButton(page, "challenge").evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect(game(page)).toBeVisible();
    await waitForPlaying(page);
    expect((await phaseHistory(page)).filter((phase) => phase === "countdown")).toHaveLength(1);
    const puzzleBefore = await readPuzzleId(page);
    const moveCount = page.locator("[data-testid='game-screen'] [data-field='move-count']");
    const beforeMoves = await moveCount.textContent();

    const help = page.getByRole("button", { name: /遊び方|説明|ヘルプ/ }).first();
    await help.click();
    await expect(visibleDialog(page)).toBeVisible();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect(moveCount).toHaveText(beforeMoves ?? "");
    await visibleDialog(page).getByRole("button", { name: /盤面へ戻る|閉じる|続ける/ }).click();
    await expect(visibleDialog(page)).toHaveCount(0);
    expect(await readPuzzleId(page)).toBe(puzzleBefore);

    const beforeOrientationMoves = await moveCount.textContent();
    const beforeOrientationTime = await page.locator("[data-testid='game-screen'] [data-field='time']").getAttribute("data-time-ms");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(game(page)).toBeVisible();
    expect(await readPuzzleId(page)).toBe(puzzleBefore);
    await expect(moveCount).toHaveText(beforeOrientationMoves ?? "");
    await expect(page.locator("[data-testid='game-screen'] [data-field='time']")).toHaveAttribute("data-time-ms", beforeOrientationTime ?? "0");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(game(page)).toBeVisible();
    expect(await readPuzzleId(page)).toBe(puzzleBefore);
    await expect(moveCount).toHaveText(beforeOrientationMoves ?? "");

    const abort = page.getByRole("button", { name: "中断" }).first();
    await abort.click();
    const abortDialog = visibleDialog(page);
    await expect(abortDialog).toBeVisible();
    await abortDialog.getByRole("button", { name: "続ける" }).click();
    await expect(visibleDialog(page)).toHaveCount(0);
    expect(await readPuzzleId(page)).toBe(puzzleBefore);

    // A burst of native activations is one operation.  Solve afterwards so a
    // success callback that was queued before the burst cannot advance twice.
    const right = rotateButton(page, "r");
    await right.focus();
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    const afterBurst = Number((await moveCount.textContent())?.match(/\d+/)?.[0] ?? -1);
    expect(afterBurst).toBe(Number(beforeMoves?.match(/\d+/)?.[0] ?? 0) + 1);
  });

  test("F03: abort during countdown or intermission cancels stale callbacks", async ({ page }) => {
    await gotoHome(page);
    await begin(page, "challenge");
    await expect(phaseLocator(page, "countdown")).toBeVisible();
    const assignmentBeforeAbort = await readAssignmentPuzzleIds(page);
    expect(assignmentBeforeAbort).toHaveLength(5);
    const abortDuringCountdown = page.getByRole("button", { name: "中断" }).first();
    await abortDuringCountdown.click();
    await expect(visibleDialog(page)).toBeVisible();
    await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
    await expect(home(page)).toBeVisible();
    expect(await readAssignmentPuzzleIds(page)).toEqual(assignmentBeforeAbort);
    await page.waitForTimeout(1_200);
    await expect(game(page)).toHaveCount(0);

    await begin(page, "challenge");
    await waitForPlaying(page);
    await solveVisibleQuestion(page);
    await expect(phaseLocator(page, "intermission")).toBeVisible();
    const abortDuringIntermission = page.getByRole("button", { name: "中断" }).first();
    await abortDuringIntermission.click();
    await expect(visibleDialog(page)).toBeVisible();
    await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
    await expect(home(page)).toBeVisible();
    await page.waitForTimeout(1_200);
    await expect(game(page)).toHaveCount(0);
  });

  test("F03/F04: every question boundary cancels stale work before and after success", async ({ page }) => {
    test.setTimeout(300_000);
    const abortAndWait = async (): Promise<void> => {
      await page.getByRole("button", { name: "中断" }).first().click();
      await expect(visibleDialog(page)).toBeVisible();
      await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
      await expect(home(page)).toBeVisible();
      await page.waitForTimeout(1_200);
      await expect(game(page)).toHaveCount(0);
    };
    const solveThrough = async (targetIndex: number): Promise<void> => {
      for (let index = 0; index < targetIndex; index += 1) await solveVisibleQuestion(page);
      await waitForPlaying(page);
    };

    for (let targetIndex = 0; targetIndex < 5; targetIndex += 1) {
      // Cancel immediately before the target question succeeds.
      await gotoHome(page);
      await begin(page, "challenge");
      await solveThrough(targetIndex);
      await prepareImmediatelyBeforeSuccess(page);
      const assignmentBefore = await readAssignmentPuzzleIds(page);
      expect(assignmentBefore).toHaveLength(5);
      await abortAndWait();
      expect(await readAssignmentPuzzleIds(page)).toEqual(assignmentBefore);

      // Re-start the held ticket, solve through the same target, and cancel
      // immediately after success (intermission), except the fifth question,
      // where result -> retry is the stale-transition boundary.
      await begin(page, "challenge");
      await solveThrough(targetIndex);
      await solveVisibleQuestion(page);
      if (targetIndex < 4) {
        await expect(phaseLocator(page, "intermission")).toBeVisible();
        await abortAndWait();
      } else {
        await expect(result(page)).toBeVisible();
        await page.locator("[data-action='retry']").click();
        await expect(game(page)).toBeVisible();
        await abortAndWait();
      }
    }
  });

  test("F05: reload reports an unfinished run, keeps its assignment, and practice resets only the current puzzle", async ({ page }) => {
    await installIntervalProbe(page);
    await gotoHome(page);
    await begin(page, "challenge");
    await waitForPlaying(page);
    const assigned = await readPuzzleId(page);
    const assignmentBeforeReload = await readAssignmentPuzzleIds(page);
    expect(assignmentBeforeReload).toHaveLength(5);
    await page.reload({ waitUntil: "networkidle" });
    const assignmentAfterReload = await readAssignmentPuzzleIds(page);
    expect(assignmentAfterReload).toEqual(assignmentBeforeReload);
    await expect(page.getByText(/中断されました|前回の挑戦/)).toBeVisible();
    await expect(page.getByRole("button", { name: /新しい|再開|チャレンジ/ }).first()).toBeVisible();

    await gotoHome(page);
    await begin(page, "practice");
    await waitForPlaying(page);
    const moves = page.locator("[data-testid='game-screen'] [data-field='move-count']");
    const reset = page.locator("[data-testid='game-screen'] [data-action='reset-question']");
    const safeMoveFor = (puzzleId: string): { type: MoveType; ring: number } => {
      const definition = puzzleById.get(puzzleId);
      if (!definition) throw new Error(`No fixture for practice puzzle ${puzzleId}`);
      const safeMove = (["l", "r"] as const).flatMap((type) => [0, 1, 2].map((ring) => ({ type, ring }))).find(({ type, ring }) =>
        !evaluate(definition, applyRotation(definition.initialState, type, ring)).solved,
      );
      if (!safeMove) throw new Error(`No non-solving practice move for ${puzzleId}`);
      return safeMove;
    };

    const practiceQuestionOne = await readPuzzleId(page);
    await solveVisibleQuestion(page);
    await expect(phaseLocator(page, "intermission")).toBeVisible();
    const questionOneMoves = Number((await moves.getAttribute("data-moves")) ?? "NaN");
    expect(Number.isSafeInteger(questionOneMoves)).toBe(true);
    // Reset is not available during the success/intermission display. An
    // adversarial activation of the hidden control must still be a no-op.
    await expect(reset).toBeHidden();
    await reset.evaluate((element) => (element as HTMLButtonElement).click());
    expect(await moves.getAttribute("data-moves")).toBe(String(questionOneMoves));
    await expect(phaseLocator(page, "intermission")).toBeVisible();

    await waitForPlaying(page);
    const practiceQuestionTwo = await readPuzzleId(page);
    const secondSafeMove = safeMoveFor(practiceQuestionTwo);
    await page.locator(`[data-action='select-ring'][data-ring='${secondSafeMove.ring}']`).click();
    await rotateButton(page, secondSafeMove.type).click();
    await expect(moves).toHaveAttribute("data-moves", "1");
    const assignmentDuringPractice = await readAssignmentPuzzleIds(page);
    expect(assignmentDuringPractice).toEqual(assignmentBeforeReload);
    const activeBeforeReset = await page.evaluate(() => (window as Window & { __r4ActiveIntervals?: () => number }).__r4ActiveIntervals?.() ?? -1);
    expect(activeBeforeReset).toBeGreaterThan(0);
    await reset.click();
    const activeAfterReset = await page.evaluate(() => (window as Window & { __r4ActiveIntervals?: () => number }).__r4ActiveIntervals?.() ?? -1);
    expect(activeAfterReset).toBe(activeBeforeReset);
    await expect(moves).toHaveAttribute("data-moves", "0");
    expect(await readPuzzleId(page)).toBe(practiceQuestionTwo);
    expect(await readAssignmentPuzzleIds(page)).toEqual(assignmentBeforeReload);

    await solveVisibleQuestion(page);
    for (let index = 2; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    const resultPuzzleIds = await page.locator("[data-result-question]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-puzzle-id")));
    const resultMoves = await page.locator("[data-result-moves]").evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-result-moves"))));
    expect(resultPuzzleIds[0]).toBe(practiceQuestionOne);
    expect(resultMoves[0]).toBe(questionOneMoves);
    expect(await page.locator("[data-result-question]")).toHaveCount(5);
    expect(assigned).not.toBe("");
  });

  test("T01/T02/T03: countdown and intermissions are excluded while help, abort, and background time count exactly", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoHome(page);

    const advance = async (wall: number, mono = wall): Promise<void> => {
      await page.evaluate(({ wallMs, monoMs }) => {
        const state = window as Window & { __r4TestClock?: { advance: (wall: number, mono?: number) => void } };
        state.__r4TestClock?.advance(wallMs, monoMs);
      }, { wallMs: wall, monoMs: mono });
    };
    const clock = page.locator("[data-testid='game-screen'] [data-field='time']");
    const readClock = async (): Promise<number> => Number(await clock.getAttribute("data-time-ms"));

    await begin(page, "challenge");
    await expect(phaseLocator(page, "countdown")).toBeVisible();
    // Advancing the test clocks before the first timer starts must not charge
    // the three-second preparation countdown.
    await advance(5_000, 5_000);
    await dispatchLifecycle(page, false, true);
    expect(await readClock()).toBe(0);
    await waitForPlaying(page);
    await advance(100, 100);
    await dispatchLifecycle(page, false, true);
    expect(await readClock()).toBe(100);

    const help = page.getByRole("button", { name: /遊び方|説明|ヘルプ/ }).first();
    await help.click();
    await expect(visibleDialog(page)).toBeVisible();
    await advance(400, 400);
    await dispatchLifecycle(page, false, true);
    await visibleDialog(page).getByRole("button", { name: /盤面へ戻る|閉じる|続ける/ }).click();
    expect(await readClock()).toBe(500);

    const abort = page.getByRole("button", { name: "中断" }).first();
    await abort.click();
    await expect(visibleDialog(page)).toBeVisible();
    await advance(300, 300);
    await dispatchLifecycle(page, false, true);
    await visibleDialog(page).getByRole("button", { name: "続ける" }).click();
    expect(await readClock()).toBe(800);

    // visibilitychange is a document event; duplicate hidden/pagehide and
    // visible/pageshow notifications must not count the boundary twice.
    await dispatchLifecycle(page, true, true);
    await advance(700, 700);
    await dispatchLifecycle(page, false, true);
    expect(await readClock()).toBe(1_500);

    const expectedTimes = [1_500, 200, 300, 400, 500];
    await solveVisibleQuestion(page);
    for (const duration of expectedTimes.slice(1)) {
      // The one-second intermission is not owned by a question timer. Advance
      // it deliberately and sample the stopped display before the next timer
      // starts, so a test clock cannot accidentally charge the next record.
      const intermissionBefore = await readClock();
      await advance(1_000, 1_000);
      await dispatchLifecycle(page, false, true);
      expect(await readClock()).toBe(intermissionBefore);
      await waitForPlaying(page);
      await advance(duration, duration);
      await solveVisibleQuestion(page);
    }
    await expect(result(page)).toBeVisible();
    const times = await page.locator("[data-result-time-ms]").evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-result-time-ms"))));
    expect(times).toEqual(expectedTimes);
    const total = page.locator("[data-total-time]");
    await expect(total).toHaveAttribute("data-total-time-ms", String(expectedTimes.reduce((sum, value) => sum + value, 0)));
  });

  test("T04: a backward wall clock marks the result as reference data without erasing it", async ({ page }) => {
    await gotoHome(page);
    await begin(page, "challenge");
    await waitForPlaying(page);
    await page.evaluate(() => {
      const state = window as Window & { __r4TestClock?: { set: (wall: number, mono: number) => void } };
      state.__r4TestClock?.set(1_699_000_000_000, 10_001);
    });
    await dispatchLifecycle(page, false);
    await solveVisibleQuestion(page);
    for (let index = 1; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await expect(page.locator("[data-result-notice]")).toContainText(/時計|異常|参考/);
    await expect(page.locator("[data-result-question]")).toHaveCount(5);
  });

  test("T04/F05: more than 300 moves stays operable and finalizes as reference data", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoHome(page);
    await begin(page, "challenge");
    await waitForPlaying(page);
    const puzzleId = await readPuzzleId(page);
    const puzzle = puzzleById.get(puzzleId);
    if (!puzzle) throw new Error(`No fixture for puzzle ${puzzleId}`);
    const safeMove = (["l", "r"] as const).flatMap((type) => [0, 1, 2].map((ring) => ({ type, ring }))).find(({ type, ring }) =>
      !evaluate(puzzle, applyRotation(puzzle.initialState, type, ring)).solved,
    );
    if (!safeMove) throw new Error(`No non-solving move for ${puzzleId}`);
    const inverse: MoveType = safeMove.type === "l" ? "r" : "l";
    await page.locator(`[data-action='select-ring'][data-ring='${safeMove.ring}']`).click();
    // Each pair returns to the original unsolved board, so no accidental
    // intermediate solution can terminate the question before the cap.
    for (let pair = 0; pair < 150; pair += 1) {
      await rotateButton(page, safeMove.type).click();
      await rotateButton(page, inverse).click();
    }
    await rotateButton(page, safeMove.type).click();
    await rotateButton(page, inverse).click();
    await expect(page.locator("[data-field='move-count']")).toHaveAttribute("data-moves", "302");
    await solveVisibleQuestion(page);
    for (let index = 1; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await expect(page.locator("[data-result-notice]")).toContainText(/参考|上限|時計/);
    await expect(page.locator("[data-result-question]")).toHaveCount(5);
  });

  test("S01/S03: malformed, typed-bad, null, and throwing storage leave a usable home screen", async ({ page }) => {
    await page.addInitScript(() => {
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      const state = window as Window & {
        __r4StorageFixture?: { value?: string | null; throwGet?: boolean; throwSet?: boolean };
        __r4StorageFixtureCalls?: { get: number; set: number };
      };
      state.__r4StorageFixtureCalls = { get: 0, set: 0 };
      const fixture = (): { value?: string | null; throwGet?: boolean; throwSet?: boolean } | undefined => {
        const value = new URLSearchParams(window.location.search).get("r4Storage");
        if (value === null) return state.__r4StorageFixture;
        if (value === "throw") return { throwGet: true, throwSet: true };
        return { value };
      };
      Storage.prototype.getItem = function getItem(key: string): string | null {
        const current = fixture();
        if (current && /(run|save|setting|record|stone|sekiban)/i.test(key)) {
          if (state.__r4StorageFixtureCalls) state.__r4StorageFixtureCalls.get += 1;
          if (current.throwGet) throw new Error("synthetic storage read failure");
          return current.value ?? null;
        }
        return originalGet.call(this, key);
      };
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        const current = fixture();
        if (current?.throwSet && /(run|save|setting|record|stone|sekiban)/i.test(key)) {
          if (state.__r4StorageFixtureCalls) state.__r4StorageFixtureCalls.set += 1;
          throw new Error("synthetic storage write failure");
        }
        originalSet.call(this, key, value);
      };
    });
    for (const value of ["{", "null", "[null]", "{}", '{"name":123,"best":{"timeMs":-1}}']) {
      await page.goto(`/?r4Storage=${encodeURIComponent(value)}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: /石板回し/ })).toBeVisible();
      await expect(home(page)).toBeVisible();
      await expect(page.locator("[data-fatal-error], [data-error='fatal']")).toHaveCount(0);
    }

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?r4Storage=throw", { waitUntil: "networkidle" });
    await expect(home(page)).toBeVisible();
    await begin(page, "challenge");
    await waitForPlaying(page);
    const gameNote = page.locator("[data-testid='game-screen'] [data-game-note]");
    await expect(gameNote).toBeVisible();
    await expect(gameNote).toHaveAttribute("data-storage-warning", "true");
    await expect(gameNote).toContainText(/保存|記録/);
    const fixtureCalls = await page.evaluate(() => (window as Window & {
      __r4StorageFixtureCalls?: { get: number; set: number };
    }).__r4StorageFixtureCalls ?? { get: 0, set: 0 });
    expect(fixtureCalls.get).toBeGreaterThan(0);
    expect(fixtureCalls.set).toBeGreaterThan(0);
    await page.getByRole("button", { name: "中断" }).click();
    await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
    await expect(home(page)).toBeVisible();
  });

  test("S03: a second tab observes a completed best and cannot move it backwards", async ({ page, context }) => {
    const second = await context.newPage();
    try {
      await installClock(second);
      await installPhaseObserver(second);
      await gotoHome(second);
      const firstRun = await startAndSolveChallenge(page);
      expect(firstRun.ids).toHaveLength(5);
      await second.reload({ waitUntil: "networkidle" });
      const best = second.locator("[data-testid='home-screen'] [data-best-time]");
      await expect(best).toBeVisible();
      const readBestMs = async (): Promise<number> => {
        const raw = await best.getAttribute("data-best-time-ms") ?? await best.textContent() ?? "";
        const clock = raw.match(/(\d+):(\d+)(?:\.(\d+))?/);
        if (clock) return Number(clock[1]) * 60_000 + Number(clock[2]) * 1_000 + Number((clock[3] ?? "0").padEnd(3, "0").slice(0, 3));
        return Number(raw.match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
      };
      const bestBefore = await readBestMs();
      expect(Number.isFinite(bestBefore)).toBe(true);

      // Deliberately make the second tab slower. The first tab's frozen test
      // clock records zero, so this proves a worse concurrent candidate cannot
      // replace the existing best rather than merely comparing equal values.
      await gotoHome(second);
      await begin(second, "challenge");
      await waitForPlaying(second);
      await second.evaluate(() => {
        const state = window as Window & { __r4TestClock?: { advance: (wall: number, mono?: number) => void } };
        state.__r4TestClock?.advance(10_000, 10_000);
      });
      await solveVisibleQuestion(second);
      for (let index = 1; index < 5; index += 1) await solveVisibleQuestion(second);
      await second.getByRole("button", { name: /ホーム/ }).first().click();
      await expect(home(second)).toBeVisible();
      const bestAfter = await readBestMs();
      expect(Number.isFinite(bestAfter)).toBe(true);
      expect(bestAfter).toBeLessThanOrEqual(bestBefore);
    } finally {
      await second.close();
    }
  });

  test("S02/U03: a final write failure keeps results and share fallback/cancel semantics", async ({ page }) => {
    await page.addInitScript(() => {
      const originalSet = Storage.prototype.setItem;
      const state = window as Window & { __r4FailFinalSave?: boolean };
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (state.__r4FailFinalSave && /(run|save|record|stone|sekiban)/i.test(key)) {
          throw new Error("synthetic final save failure");
        }
        originalSet.call(this, key, value);
      };
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        clipboard?: { writeText: (value: string) => Promise<void> };
      };
      Object.defineProperty(nav, "share", {
        configurable: true,
        value: async () => { throw new DOMException("cancelled", "AbortError"); },
      });
      Object.defineProperty(nav, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            (window as Window & { __r4ClipboardWrites?: number }).__r4ClipboardWrites =
              ((window as Window & { __r4ClipboardWrites?: number }).__r4ClipboardWrites ?? 0) + 1;
          },
        },
      });
    });
    await gotoHome(page);
    await begin(page, "challenge");
    await waitForPlaying(page);
    await page.evaluate(() => { (window as Window & { __r4FailFinalSave?: boolean }).__r4FailFinalSave = true; });
    await solveVisibleQuestion(page);
    for (let index = 1; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await expect(page.getByText(/保存できません|保存に失敗/)).toBeVisible();
    const share = page.getByRole("button", { name: /共有|シェア/ }).first();
    await expect(share).toBeVisible();
    await share.click();
    await expect(page.getByText(/取消|キャンセル/).first()).toHaveCount(0);
    await expect(page.locator("[data-share-status], [data-share-message]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { __r4ClipboardWrites?: number }).__r4ClipboardWrites ?? 0)).toBe(0);
  });

  test("U03: unsupported share falls back to copy, copy failure leaves selectable text, and cancel does not copy", async ({ page }) => {
    await gotoHome(page);
    await page.evaluate(() => {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        clipboard?: { writeText: (value: string) => Promise<void> };
      };
      Object.defineProperty(nav, "share", { configurable: true, value: undefined });
      Object.defineProperty(nav, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("synthetic home clipboard failure"); } },
      });
    });
    await page.locator("[data-action='home-share']").click();
    const homeFallback = page.locator("[data-home-share-area] [data-share-text]");
    await expect(homeFallback).toBeVisible();
    const homeFallbackData = await homeFallback.evaluate((element) => ({
      userSelect: getComputedStyle(element).userSelect,
      text: element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? "",
    }));
    expect(homeFallbackData.userSelect).not.toBe("none");
    expect(homeFallbackData.text).toMatch(/https?:\/\//);

    // Continue on a fresh home render so the result-share path is exercised
    // independently of the home fallback area.
    await gotoHome(page);
    await begin(page, "challenge");
    for (let index = 0; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();

    const share = page.getByRole("button", { name: /共有|シェア/ }).first();
    await page.evaluate(() => {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      const state = window as Window & { __r4ShareResolvers?: Array<() => void> };
      state.__r4ShareResolvers = [];
      Object.defineProperty(nav, "share", {
        configurable: true,
        value: () => new Promise<void>((resolve) => state.__r4ShareResolvers?.push(resolve)),
      });
    });
    await share.click();
    const shareArea = page.locator("[data-testid='result-screen'] [data-share-area]");
    await expect.poll(() => page.evaluate(() => (window as Window & { __r4ShareResolvers?: unknown[] }).__r4ShareResolvers?.length ?? 0)).toBe(1);
    if (await share.isDisabled()) {
      // A disabled control is a valid duplicate-submit defense.
      await page.evaluate(() => (window as Window & { __r4ShareResolvers?: Array<() => void> }).__r4ShareResolvers?.[0]?.());
      await expect(shareArea).toBeVisible();
      await expect(shareArea).toContainText(/共有しました/);
    } else {
      // Otherwise an attempt token must prevent the first completion from
      // restoring stale UI after a second share is already pending.
      await share.click();
      await expect.poll(() => page.evaluate(() => (window as Window & { __r4ShareResolvers?: unknown[] }).__r4ShareResolvers?.length ?? 0)).toBe(2);
      await page.evaluate(() => (window as Window & { __r4ShareResolvers?: Array<() => void> }).__r4ShareResolvers?.[0]?.());
      await expect(shareArea).toBeHidden();
      await page.evaluate(() => (window as Window & { __r4ShareResolvers?: Array<() => void> }).__r4ShareResolvers?.[1]?.());
      await expect(shareArea).toBeVisible();
      await expect(shareArea).toContainText(/共有しました/);
    }

    // A later cancellation must clear the previous success/selectable state;
    // otherwise a stale result can falsely report that the second share won.
    await page.evaluate(() => {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      Object.defineProperty(nav, "share", {
        configurable: true,
        value: async () => { throw new DOMException("cancelled", "AbortError"); },
      });
    });
    await share.click();
    await expect(shareArea).toBeHidden();
    await expect(shareArea).toHaveText("");

    await page.evaluate(() => {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        clipboard?: { writeText: (value: string) => Promise<void> };
      };
      Object.defineProperty(nav, "share", { configurable: true, value: undefined });
      Object.defineProperty(nav, "clipboard", {
        configurable: true,
        value: { writeText: async () => undefined },
      });
    });
    await share.click();
    await expect(page.locator("[data-share-status], [data-share-message]").first()).toContainText(/コピー|共有/);

    await page.evaluate(() => {
      const nav = navigator as Navigator & { clipboard?: { writeText: (value: string) => Promise<void> } };
      Object.defineProperty(nav, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("synthetic clipboard failure"); } },
      });
    });
    await share.click();
    const fallback = page.locator("[data-share-text], [data-share-textarea], textarea[readonly], [data-share-message]").first();
    await expect(fallback).toBeVisible();
    const fallbackData = await fallback.evaluate((element) => ({
      userSelect: getComputedStyle(element).userSelect,
      text: element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? "",
    }));
    expect(fallbackData.userSelect).not.toBe("none");
    expect(fallbackData.text).toMatch(/https?:\/\//);
  });

  test("U01/U02: name validation and result links expose challenge, practice, home, and experiment routes", async ({ page }) => {
    await gotoHome(page);
    const input = nameInput(page);
    for (const invalid of ["", "   ", "abcdefghijklmnopq", "bad\u0007name", "\u0007Luna", "Luna\u0007"]) {
      await input.fill(invalid);
      await startButton(page, "challenge").click();
      await expect(page.locator("[role='alert'], [data-error], [data-field='name-error']").first()).toBeVisible();
      await expect(home(page)).toBeVisible();
    }
    await begin(page, "challenge", "<img src=x>");
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    await solveVisibleQuestion(page);
    for (let index = 1; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /再挑戦|もう一度/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /練習/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /ホーム/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /実験場/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /実験場/ }).first()).toHaveAttribute("href", /./);
    await expect(result(page)).toContainText("<img src=x>");

    // Exercise the result actions as real transitions, not only as visible
    // labels: retry -> challenge, practice -> practice, and home -> home.
    await page.locator("[data-action='retry']").click();
    await expect(game(page)).toHaveAttribute("data-mode", "challenge");
    for (let index = 0; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await page.locator("[data-action='result-practice']").click();
    await expect(game(page)).toHaveAttribute("data-mode", "practice");
    for (let index = 0; index < 5; index += 1) await solveVisibleQuestion(page);
    await expect(result(page)).toBeVisible();
    await page.locator("[data-action='result-home']").click();
    await expect(home(page)).toBeVisible();
  });

  test("R4 responsive acceptance: home, game, and result have no horizontal overflow at every prescribed viewport", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(240_000);
    for (const viewport of VIEWPORTS) {
      const representative = viewport.name === "w390-h844" || viewport.name === "w375-h667";
      const capture200 = viewport.name === "w390-h844";
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoHome(page);
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      if (representative) await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-home-normal.png`), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      if (capture200) await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-home-200.png`), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });

      // Start one real challenge at each viewport. Check both text scales on
      // the live game, then check the result at 200% and normal text without
      // replacing it with a synthetic placeholder.
      await begin(page, "challenge", "画面確認");
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      await assertNoControlOverlap(page);
      await waitForPlaying(page);
      await assertPrimaryControlsInViewport(page, viewport);
      if (representative) await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-game-normal.png`), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      await assertNoControlOverlap(page);
      if (capture200) await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-game-200.png`), fullPage: true });
      for (let index = 0; index < 5; index += 1) await solveVisibleQuestion(page);
      await expect(result(page)).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      await assertNoControlOverlap(page);
      await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-result.png`), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
      await assertNoHorizontalOverflow(page);
      await assertControls(page);
      await assertNoControlOverlap(page);
      if (representative) await page.screenshot({ path: testInfo.outputPath(`r4-${viewport.name}-result-normal.png`), fullPage: true });
    }
  });
});
