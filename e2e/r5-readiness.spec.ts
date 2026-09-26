import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzePuzzle } from "../src/puzzles/solver.ts";
import type { MoveType, Puzzle } from "../src/core/types.ts";

/**
 * R5 deliberately exercises the app through its public routes.  The R3/R4
 * specs own their historical acceptance checks; this file adds release
 * readiness checks for browser diagnostics, the complete state matrix, and
 * repeated runs.
 */

type Viewport = { name: string; width: number; height: number };
type RunMode = "challenge" | "practice";
type Move = { type: MoveType; ring: number };

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
// Keep the E2E runner independent of the runtime's TS module loader. This is
// intentionally read from the single publication config instead of copying a
// provisional URL into the test.
const siteConfigSource = readFileSync(resolve(process.cwd(), "site.config.ts"), "utf8");
const siteTitle = siteConfigSource.match(/title:\s*"([^"]+)"/u)?.[1];
const siteDescription = siteConfigSource.match(/description:\s*"([^"]+)"/u)?.[1];
const publicUrl = siteConfigSource.match(/publicUrl:\s*"([^"]+)"/u)?.[1];
const labUrl = siteConfigSource.match(/labUrl:\s*"([^"]+)"/u)?.[1];
if (!siteTitle || !siteDescription || !publicUrl || !labUrl) throw new Error("site.config.ts metadata is incomplete");
const PUBLIC_GAME_URL = publicUrl;
const LAB_URL = labUrl;
const SHARE_IMAGE_URL = siteConfigSource.match(/shareImageUrl:\s*"([^"]+)"/u)?.[1] ?? null;
const puzzleById = new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));

type BrowserDiagnostics = {
  pageErrors: string[];
  unhandledRejections: string[];
  consoleErrors: string[];
  failedRequests: string[];
  sameOrigin4xx: string[];
};

type ResourceSnapshot = {
  domNodes: number;
  timeouts: number;
  intervals: number;
  listeners: number;
  listenerDetails: Array<{ target: string; type: string; count: number; callers: string[] }>;
  audioContexts: number;
  audioNodes: number;
  audioProbeSupported: boolean;
  audioStops: number;
  audioDisconnects: number;
  activeAudioNodes: number;
  activeOscillators: number;
  resources: number;
};

function home(page: Page): Locator {
  return page.locator("[data-testid='home-screen']");
}

function game(page: Page): Locator {
  return page.locator("[data-testid='game-screen']");
}

function result(page: Page): Locator {
  return page.locator("[data-testid='result-screen']");
}

function visibleDialog(page: Page): Locator {
  return page.locator("[role='dialog']:visible, dialog[open]").first();
}

function startButton(page: Page, mode: RunMode): Locator {
  return page.locator(
    `[data-testid='home-screen'] form[data-mode='${mode}'] button[data-action='start-${mode}']`,
  );
}

function nameInput(page: Page): Locator {
  return page.locator("[data-testid='home-screen'] [data-field='player-name']");
}

function rotateButton(page: Page, direction: MoveType): Locator {
  return page.locator(
    `[data-testid='game-screen'] [data-action='rotate-${direction === "l" ? "left" : "right"}']`,
  );
}

function phase(page: Page, value: string): Locator {
  return page.locator(`[data-testid='game-screen'][data-phase='${value}']`);
}

function installDiagnostics(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    pageErrors: [],
    unhandledRejections: [],
    consoleErrors: [],
    failedRequests: [],
    sameOrigin4xx: [],
  };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400 || response.status() >= 500) return;
    try {
      const url = new URL(response.url());
      if (url.origin === new URL("http://127.0.0.1:5173/").origin) {
        diagnostics.sameOrigin4xx.push(`${response.status()} ${response.url()}`);
      }
    } catch {
      // A malformed third-party URL cannot be a same-origin app response.
    }
  });
  return diagnostics;
}

/** Install before the app boots so promise and DOM level errors are captured. */
async function installUnhandledProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as Window & {
      __r5Unhandled?: { rejections: string[]; errors: string[] };
    };
    state.__r5Unhandled = { rejections: [], errors: [] };
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      state.__r5Unhandled?.rejections.push(reason instanceof Error ? reason.message : String(reason));
    });
    window.addEventListener("error", (event) => {
      if (event.error instanceof Error) state.__r5Unhandled?.errors.push(event.error.message);
      else if (event.message) state.__r5Unhandled?.errors.push(event.message);
    });
  });
}

/**
 * Observe resources that can survive a run.  The probe uses browser APIs
 * rather than application internals: an implementation may replace its timer
 * or audio implementation without weakening the acceptance condition.
 */
async function installResourceProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type ListenerRecord = {
      target: EventTarget;
      type: string;
      listener: EventListenerOrEventListenerObject;
      active: boolean;
      caller: string;
    };
    type AudioRecord = {
      kind: "oscillator" | "gain";
      stopped: boolean;
      disconnected: boolean;
    };
    type Probe = {
      timeoutIds: Set<number>;
      intervalIds: Set<number>;
      listeners: ListenerRecord[];
      audioContexts: number;
      audioNodes: number;
      audioRecords: AudioRecord[];
      audioProbeSupported: boolean;
      audioStops: number;
      audioDisconnects: number;
    };
    const probe: Probe = {
      timeoutIds: new Set<number>(),
      intervalIds: new Set<number>(),
      listeners: [],
      audioContexts: 0,
      audioNodes: 0,
      audioRecords: [],
      audioProbeSupported: false,
      audioStops: 0,
      audioDisconnects: 0,
    };
    const target = window as Window & {
      __r5ResourceSnapshot?: () => ResourceSnapshot;
    };

    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      let id = 0;
      const wrapped = (...callbackArgs: unknown[]): void => {
        probe.timeoutIds.delete(id);
        if (typeof handler === "function") handler(...callbackArgs);
        else Function(handler)(...callbackArgs);
      };
      id = nativeSetTimeout(wrapped, timeout, ...args);
      probe.timeoutIds.add(id);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number): void => {
      if (id !== undefined) probe.timeoutIds.delete(id);
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = nativeSetInterval(handler, timeout, ...args);
      probe.intervalIds.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number): void => {
      if (id !== undefined) probe.intervalIds.delete(id);
      nativeClearInterval(id);
    }) as typeof window.clearInterval;

    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const describeListenerTarget = (value: EventTarget): string => {
      if (value === window) return "window";
      if (value === document) return "document";
      if (value instanceof Element) {
        const identity = [
          value.id ? `#${value.id}` : "",
          value.getAttribute("data-testid") ? `[data-testid=${value.getAttribute("data-testid")}]` : "",
          value.getAttribute("data-action") ? `[data-action=${value.getAttribute("data-action")}]` : "",
          value.getAttribute("data-screen") ? `[data-screen=${value.getAttribute("data-screen")}]` : "",
          value.getAttribute("data-modal") ? `[data-modal=${value.getAttribute("data-modal")}]` : "",
        ].join("");
        return `${value.tagName.toLowerCase()}${identity || `.${Array.from(value.classList).slice(0, 2).join(".")}`}`;
      }
      if (value instanceof Node) return value.nodeName;
      return value.constructor?.name ?? "EventTarget";
    };
    EventTarget.prototype.addEventListener = function addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      if (listener) {
        const caller = new Error().stack?.split("\n").slice(2, 4).map((line) => line.trim()).join(" <- ") ?? "unknown";
        const record: ListenerRecord = { target: this, type, listener, active: true, caller };
        probe.listeners.push(record);
        const signal = typeof options === "object" ? options.signal : undefined;
        if (signal) {
          // Use the native method to avoid counting this bookkeeping listener.
          nativeAdd.call(signal, "abort", () => { record.active = false; }, { once: true });
        }
      }
      nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean,
    ): void {
      for (const record of probe.listeners) {
        if (record.target === this && record.type === type && record.listener === listener) record.active = false;
      }
      nativeRemove.call(this, type, listener, options);
    };

    const connected = (value: EventTarget): boolean => {
      if (value === window || value === document) return true;
      return !(value instanceof Node) || value.isConnected;
    };
    const wrapAudioContext = (context: any): void => {
      probe.audioContexts += 1;
      const nativeCreateOscillator = typeof context.createOscillator === "function"
        ? context.createOscillator.bind(context) : null;
      if (nativeCreateOscillator) {
        context.createOscillator = (): any => {
          const oscillator = nativeCreateOscillator();
          const record: AudioRecord = { kind: "oscillator", stopped: false, disconnected: false };
          probe.audioRecords.push(record);
          probe.audioNodes += 1;
          if (typeof oscillator.stop === "function") {
            const nativeStop = oscillator.stop.bind(oscillator);
            oscillator.stop = (when?: number): void => {
              if (!record.stopped) { record.stopped = true; probe.audioStops += 1; }
              nativeStop(when);
            };
          }
          if (typeof oscillator.disconnect === "function") {
            const nativeDisconnect = oscillator.disconnect.bind(oscillator);
            oscillator.disconnect = (...args: unknown[]): void => {
              try { nativeDisconnect(...args); } finally {
                if (!record.disconnected) { record.disconnected = true; probe.audioDisconnects += 1; }
              }
            };
          }
          return oscillator;
        };
      }
      const nativeCreateGain = typeof context.createGain === "function"
        ? context.createGain.bind(context) : null;
      if (nativeCreateGain) {
        context.createGain = (): any => {
          const gain = nativeCreateGain();
          const record: AudioRecord = { kind: "gain", stopped: true, disconnected: false };
          probe.audioRecords.push(record);
          probe.audioNodes += 1;
          if (typeof gain.disconnect === "function") {
            const nativeDisconnect = gain.disconnect.bind(gain);
            gain.disconnect = (...args: unknown[]): void => {
              try { nativeDisconnect(...args); } finally {
                if (!record.disconnected) { record.disconnected = true; probe.audioDisconnects += 1; }
              }
            };
          }
          return gain;
        };
      }
    };
    const globals = window as Window & {
      AudioContext?: new (...args: any[]) => any;
      webkitAudioContext?: new (...args: any[]) => any;
    };
    for (const name of ["AudioContext", "webkitAudioContext"] as const) {
      const Native = globals[name];
      if (!Native) continue;
      try {
        class ProbedAudioContext extends Native {
          constructor(...args: any[]) {
            super(...args);
            wrapAudioContext(this);
          }
        }
        Object.defineProperty(globals, name, { configurable: true, writable: true, value: ProbedAudioContext });
        probe.audioProbeSupported = true;
      } catch {
        // Some WebKit builds expose a non-configurable constructor. The rest
        // of the timer/listener probe remains valid in that engine.
      }
    }

    target.__r5ResourceSnapshot = () => {
      const activeListeners = probe.listeners.filter((entry) => entry.active && connected(entry.target));
      const listenerGroups = new Map<string, { target: string; type: string; count: number; callers: Set<string> }>();
      for (const entry of activeListeners) {
        const listenerTarget = describeListenerTarget(entry.target);
        const key = `${listenerTarget}\u0000${entry.type}`;
        const group = listenerGroups.get(key) ?? { target: listenerTarget, type: entry.type, count: 0, callers: new Set<string>() };
        group.count += 1;
        if (group.callers.size < 3) group.callers.add(entry.caller);
        listenerGroups.set(key, group);
      }
      return {
        domNodes: document.querySelectorAll("*").length,
        timeouts: probe.timeoutIds.size,
        intervals: probe.intervalIds.size,
        listeners: activeListeners.length,
        listenerDetails: Array.from(listenerGroups.values()).map((group) => ({ ...group, callers: Array.from(group.callers) })),
        audioContexts: probe.audioContexts,
        audioNodes: probe.audioNodes,
        audioProbeSupported: probe.audioProbeSupported,
        audioStops: probe.audioStops,
        audioDisconnects: probe.audioDisconnects,
        activeAudioNodes: probe.audioRecords.filter((record) => !(record.stopped && record.disconnected)).length,
        activeOscillators: probe.audioRecords.filter((record) => record.kind === "oscillator" && !(record.stopped && record.disconnected)).length,
        resources: performance.getEntriesByType("resource").length,
      };
    };
  });
}

async function installPhaseProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as Window & { __r5PhaseHistory?: string[] };
    state.__r5PhaseHistory = [];
    const record = (element: Element): void => {
      const value = element.getAttribute("data-phase")
        ?? element.getAttribute("data-run-phase")
        ?? element.getAttribute("data-screen");
      if (value && state.__r5PhaseHistory?.at(-1) !== value) state.__r5PhaseHistory?.push(value);
    };
    const observer = new MutationObserver((records) => {
      for (const entry of records) {
        if (entry.type === "attributes" && entry.target instanceof Element) record(entry.target);
        if (entry.type === "childList") {
          for (const node of Array.from(entry.addedNodes)) {
            if (!(node instanceof Element)) continue;
            record(node);
            for (const nested of Array.from(node.querySelectorAll("[data-phase], [data-run-phase], [data-screen]"))) record(nested);
          }
        }
      }
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["data-phase", "data-run-phase", "data-screen"],
    });
  });
}

async function readPhaseHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as Window & { __r5PhaseHistory?: string[] };
    return [...(state.__r5PhaseHistory ?? [])];
  });
}

async function resetPhaseHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as Window & { __r5PhaseHistory?: string[] };
    state.__r5PhaseHistory = [];
  });
}

async function installAudioHarness(page: Page, blockResume: boolean): Promise<void> {
  await page.addInitScript((shouldBlock) => {
    const harness = {
      blockResume: shouldBlock,
      resumes: 0,
      starts: 0,
      stops: 0,
      frequencies: [] as number[],
      resumeResolvers: [] as Array<() => void>,
    };
    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume = (): Promise<void> => {
        harness.resumes += 1;
        if (!harness.blockResume) {
          this.state = "running";
          return Promise.resolve();
        }
        this.state = "suspended";
        return new Promise<void>((resolve) => {
          harness.resumeResolvers.push(() => {
            this.state = "running";
            resolve();
          });
        });
      };
      createOscillator = (): Record<string, unknown> => {
        const frequency = {
          value: 0,
          setValueAtTime: (value: number) => { harness.frequencies.push(value); frequency.value = value; },
          exponentialRampToValueAtTime: (value: number) => { frequency.value = value; },
        };
        return {
          type: "sine",
          frequency,
          connect: () => undefined,
          start: () => { harness.starts += 1; },
          stop: () => { harness.stops += 1; },
        };
      };
      createGain = (): Record<string, unknown> => ({
        gain: {
          value: 0,
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
      });
    }
    const globals = window as Window & { AudioContext?: unknown; webkitAudioContext?: unknown };
    Object.defineProperty(globals, "AudioContext", { configurable: true, writable: true, value: FakeAudioContext });
    Object.defineProperty(globals, "webkitAudioContext", { configurable: true, writable: true, value: FakeAudioContext });
    (window as Window & {
      __r5AudioHarness?: {
        snapshot: () => { resumes: number; starts: number; stops: number; frequencies: number[] };
        resolveResume: () => void;
      };
    }).__r5AudioHarness = {
      snapshot: () => ({
        resumes: harness.resumes,
        starts: harness.starts,
        stops: harness.stops,
        frequencies: [...harness.frequencies],
      }),
      resolveResume: () => {
        const pending = harness.resumeResolvers.splice(0);
        for (const resolve of pending) resolve();
        harness.blockResume = false;
      },
    };
  }, blockResume);
}

async function readAudioHarness(page: Page): Promise<{ resumes: number; starts: number; stops: number; frequencies: number[] }> {
  return page.evaluate(() => {
    const state = window as Window & {
      __r5AudioHarness?: { snapshot: () => { resumes: number; starts: number; stops: number; frequencies: number[] } };
    };
    return state.__r5AudioHarness?.snapshot() ?? { resumes: 0, starts: 0, stops: 0, frequencies: [] };
  });
}

async function readResourceSnapshot(page: Page): Promise<ResourceSnapshot> {
  return page.evaluate(() => {
    const state = window as Window & { __r5ResourceSnapshot?: () => ResourceSnapshot };
    return state.__r5ResourceSnapshot?.() ?? {
      domNodes: document.querySelectorAll("*").length,
      timeouts: -1,
      intervals: -1,
      listeners: -1,
      listenerDetails: [],
      audioContexts: -1,
      audioNodes: -1,
      audioProbeSupported: false,
      audioStops: -1,
      audioDisconnects: -1,
      activeAudioNodes: -1,
      activeOscillators: -1,
      resources: performance.getEntriesByType("resource").length,
    };
  });
}

async function readUnhandled(page: Page): Promise<{ rejections: string[]; errors: string[] }> {
  return page.evaluate(() => {
    const state = window as Window & { __r5Unhandled?: { rejections: string[]; errors: string[] } };
    return {
      rejections: [...(state.__r5Unhandled?.rejections ?? [])],
      errors: [...(state.__r5Unhandled?.errors ?? [])],
    };
  });
}

async function assertNoBrowserDiagnostics(page: Page, diagnostics: BrowserDiagnostics): Promise<void> {
  const unhandled = await readUnhandled(page);
  diagnostics.unhandledRejections.push(...unhandled.rejections);
  diagnostics.pageErrors.push(...unhandled.errors);
  expect(diagnostics.pageErrors, "pageerror/window error").toEqual([]);
  expect(diagnostics.unhandledRejections, "unhandled promise rejection").toEqual([]);
  expect(diagnostics.consoleErrors, "console.error").toEqual([]);
  expect(diagnostics.failedRequests, "requestfailed").toEqual([]);
  expect(diagnostics.sameOrigin4xx, "same-origin 4xx/5xx").toEqual([]);
}

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /石板回し|セキバンマワシ/ }).first()).toBeVisible();
  await expect(home(page)).toBeVisible();
  await expect(page.locator("[data-fatal-error], [data-error='fatal']")).toHaveCount(0);
}

async function begin(page: Page, mode: RunMode, name = "R5検査"): Promise<void> {
  await nameInput(page).fill(name);
  await startButton(page, mode).click();
  await expect(game(page)).toBeVisible();
}

async function waitForPlaying(page: Page): Promise<void> {
  await expect(game(page)).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
}

async function readPuzzleId(page: Page): Promise<string> {
  const id = await game(page).getAttribute("data-puzzle-id");
  if (!id) throw new Error("ゲーム画面が公開問題IDを提示していません");
  const normalized = id.match(/[a-z]+-v2-[a-z0-9-]+/i)?.[0] ?? id.trim();
  if (!puzzleById.has(normalized)) throw new Error(`公開問題ID ${normalized} は問題庫にありません`);
  return normalized;
}

async function readDifficulty(page: Page): Promise<string> {
  const field = page.locator("[data-testid='game-screen'] [data-field='difficulty']");
  const source = `${await field.getAttribute("data-difficulty") ?? ""} ${await field.textContent() ?? ""}`;
  if (/easy|初級/i.test(source)) return "easy";
  if (/normal|medium|中級/i.test(source)) return "normal";
  if (/hard|上級/i.test(source)) return "hard";
  return source.trim();
}

async function solveVisibleQuestion(page: Page): Promise<{ id: string; moves: number }> {
  await waitForPlaying(page);
  const id = await readPuzzleId(page);
  const puzzle = puzzleById.get(id);
  if (!puzzle) throw new Error(`問題 ${id} の検査用定義がありません`);
  const analysis = analyzePuzzle(puzzle);
  expect(analysis.truncated, `問題 ${id} の解探索が打ち切られていない`).toBe(false);
  expect(analysis.shortestMoves, `問題 ${id} に代表解がある`).not.toBeNull();
  const solution = analysis.representativeSolution as Move[];
  const moves = page.locator("[data-testid='game-screen'] [data-field='move-count']");
  let expectedMoves = Number(await moves.getAttribute("data-moves") ?? "0");
  expect(Number.isSafeInteger(expectedMoves)).toBe(true);
  const readCommittedMoves = async (): Promise<string | null> => {
    if (await result(page).isVisible().catch(() => false)) {
      const resultRow = page.locator(`[data-result-question][data-puzzle-id="${id}"]`).first();
      return resultRow.locator("[data-result-moves]").getAttribute("data-result-moves");
    }
    if (await moves.count() === 0) return null;
    return moves.getAttribute("data-moves");
  };
  for (const move of solution) {
    const ring = page.locator(`[data-testid='game-screen'] [data-action='select-ring'][data-ring='${move.ring}']`);
    await expect(ring).toBeVisible();
    await ring.click();
    await rotateButton(page, move.type).click();
    expectedMoves += 1;
    // The fifth question is committed by replacing the game DOM with the
    // result screen immediately. Read its authoritative result row in that
    // case; intermediate questions still assert the live game counter.
    await expect.poll(readCommittedMoves, { timeout: 12_000 }).toBe(String(expectedMoves));
  }
  await expect.poll(async () => {
    if (await result(page).isVisible().catch(() => false)) return "result";
    const current = await game(page).getAttribute("data-phase");
    return current === "intermission" || current === "solved" || current === "success" ? "success" : current ?? "unknown";
  }, { timeout: 12_000 }).toMatch(/result|success/);
  return { id, moves: expectedMoves };
}

async function runChallenge(page: Page, name = "R5検査"): Promise<{ ids: string[]; difficulties: string[]; totalMoves: number }> {
  await begin(page, "challenge", name);
  await expect(phase(page, "countdown")).toBeVisible();
  const ids: string[] = [];
  const difficulties: string[] = [];
  let totalMoves = 0;
  for (let index = 0; index < 5; index += 1) {
    await waitForPlaying(page);
    ids.push(await readPuzzleId(page));
    difficulties.push(await readDifficulty(page));
    const solved = await solveVisibleQuestion(page);
    totalMoves += solved.moves;
    if (index < 4) await expect(phase(page, "intermission")).toBeVisible();
  }
  await expect(result(page)).toBeVisible();
  await expect(page.locator("[data-result-question]")).toHaveCount(5);
  const resultIds = await page.locator("[data-result-question]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-puzzle-id")),
  );
  expect(resultIds).toEqual(ids);
  expect(new Set(ids).size, "one five-question run must not repeat a puzzle").toBe(5);
  expect(difficulties).toEqual(["easy", "easy", "normal", "normal", "hard"]);
  return { ids, difficulties, totalMoves };
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth - metrics.clientWidth, "horizontal overflow").toBeLessThanOrEqual(1);
}

async function assertHitTargets(page: Page): Promise<void> {
  for (const control of await page.locator("button:visible").all()) {
    const box = await control.boundingBox();
    expect(box, "visible button has a hit target").not.toBeNull();
    if (!box) continue;
    expect(box.width, "button width").toBeGreaterThanOrEqual(48);
    expect(box.height, "button height").toBeGreaterThanOrEqual(48);
  }
}

async function assertButtonsReachable(page: Page, viewport: Viewport): Promise<void> {
  for (const control of await page.locator("button:visible").all()) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box, "button remains reachable at every text scale").not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

async function assertLinksReachable(page: Page, viewport: Viewport): Promise<void> {
  for (const link of await page.locator("a:visible").all()) {
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box, "visible recovery link remains reachable").not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }
}

async function assertGameStatusReadableAt200(page: Page): Promise<void> {
  const status = await page.evaluate(() => {
    const measureText = (element: HTMLElement | null) => {
      if (!element) return { lines: 0, rects: [], clientWidth: 0, scrollWidth: 0, fontSize: "", whiteSpace: "" };
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).map((rect) => ({
        top: Math.round(rect.top * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      }));
      const style = getComputedStyle(element);
      const tops = new Set(rects.map((rect) => Math.round(rect.top * 10) / 10));
      return {
        lines: tops.size,
        rects,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: style.fontSize,
        whiteSpace: style.whiteSpace,
      };
    };
    return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='game-screen'] .status-card")).map((card) => {
      const cardRect = card.getBoundingClientRect();
      const cardStyle = getComputedStyle(card);
      const valueElement = card.querySelector<HTMLElement>("[data-field]");
      const value = valueElement?.textContent?.trim() ?? "";
      let longTimeText: ReturnType<typeof measureText> | null = null;
      if (valueElement?.dataset.field === "time") {
        const original = valueElement.textContent;
        valueElement.textContent = "900.00";
        longTimeText = measureText(valueElement);
        valueElement.textContent = original;
      }
      return {
        label: card.querySelector<HTMLElement>(".status-label")?.textContent?.trim() ?? "",
        labelText: measureText(card.querySelector<HTMLElement>(".status-label")),
        value,
        valueText: measureText(valueElement),
        longTimeText,
        cardRect: {
          top: Math.round(cardRect.top * 100) / 100,
          left: Math.round(cardRect.left * 100) / 100,
          width: Math.round(cardRect.width * 100) / 100,
          height: Math.round(cardRect.height * 100) / 100,
        },
        cardStyle: { paddingInline: cardStyle.paddingInline, display: cardStyle.display, gridTemplateColumns: cardStyle.gridTemplateColumns },
        cardScrollWidth: card.scrollWidth,
        cardClientWidth: card.clientWidth,
      };
    });
  });
  expect(status, "the four game status cards are present").toHaveLength(4);
  for (const card of status) {
    expect(card.label.length, "status labels remain visible").toBeGreaterThan(0);
    expect(card.labelText.lines, `${card.label} label geometry: ${JSON.stringify(card)}`).toBeLessThanOrEqual(2);
    expect(card.value.length, `${card.label} value remains visible`).toBeGreaterThan(0);
    expect(card.valueText.lines, `${card.label} value geometry: ${JSON.stringify(card)}`).toBe(1);
    expect(card.valueText.scrollWidth, `${card.label} value fits its content box: ${JSON.stringify(card)}`).toBeLessThanOrEqual(card.valueText.clientWidth);
    expect(card.cardScrollWidth, `${card.label} card has no horizontal overflow: ${JSON.stringify(card)}`).toBeLessThanOrEqual(card.cardClientWidth);
    if (card.longTimeText) {
      expect(card.longTimeText.lines, `900.00-second time remains on one line: ${JSON.stringify(card)}`).toBe(1);
      expect(card.longTimeText.scrollWidth, `900.00-second time fits its content box: ${JSON.stringify(card)}`).toBeLessThanOrEqual(card.longTimeText.clientWidth);
    }
  }
}

async function assertBoardVisible(page: Page): Promise<void> {
  const board = page.locator("[data-testid='game-screen'] svg.stone-board");
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  expect(box, "board bounding box").not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

async function assertNonColorControls(page: Page): Promise<void> {
  await expect(page.locator("[data-testid='game-screen'] [data-action='select-ring']")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /左へ回す/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /右へ回す/ })).toBeVisible();
  await expect(page.locator("[data-testid='game-screen'] figcaption")).toContainText(/受光紋|点灯/);
}

async function assertNoButtonOverlap(page: Page): Promise<void> {
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const control of await page.locator("button:visible").all()) {
    const box = await control.boundingBox();
    if (box) boxes.push(box);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      expect(width * height, "visible buttons do not overlap").toBe(0);
    }
  }
}

async function applyMonochrome(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((active) => {
    document.documentElement.classList.toggle("r5-monochrome", active);
    let style = document.getElementById("r5-monochrome-style");
    if (active && !style) {
      style = document.createElement("style");
      style.id = "r5-monochrome-style";
      style.textContent = "html.r5-monochrome, html.r5-monochrome * { filter: grayscale(1) !important; }";
      document.head.append(style);
    }
  }, enabled);
}

async function setFontScale(page: Page, scale: 100 | 200): Promise<void> {
  await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%`; }, scale);
}

async function closeAbort(page: Page): Promise<void> {
  await page.getByRole("button", { name: "中断" }).first().click();
  await expect(visibleDialog(page)).toBeVisible();
  await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
  await expect(home(page)).toBeVisible();
  await page.waitForTimeout(1_250);
  await expect(game(page)).toHaveCount(0);
}

test.describe("R5 release readiness", () => {
  test("Q02/U04: the normal app flow has metadata and no browser diagnostics", async ({ page }) => {
    test.setTimeout(180_000);
    const diagnostics = installDiagnostics(page);
    await installUnhandledProbe(page);
    await gotoHome(page);

    const metadata = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      description: document.querySelector<HTMLMetaElement>("meta[name='description']")?.content ?? "",
      icon: document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href ?? "",
      ogTitle: document.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content ?? "",
      ogDescription: document.querySelector<HTMLMetaElement>("meta[property='og:description']")?.content ?? "",
      ogUrl: document.querySelector<HTMLMetaElement>("meta[property='og:url']")?.content ?? "",
      ogImage: document.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content ?? null,
      heading: document.querySelector("[data-testid='home-screen'] h1")?.textContent?.trim() ?? "",
    }));
    expect(metadata.lang).toBe("ja");
    expect(metadata.title).toBe(siteTitle);
    expect(metadata.description).toBe(siteDescription);
    expect(metadata.ogTitle).toBe(siteTitle);
    expect(metadata.ogDescription).toBe(siteDescription);
    expect(metadata.heading).toBe(siteTitle);
    expect(metadata.icon, "a public page needs a resolvable favicon").toMatch(/^https?:\/\//);
    expect(metadata.ogUrl, "share URL metadata").toBe(PUBLIC_GAME_URL);
    if (SHARE_IMAGE_URL) expect(metadata.ogImage).toBe(SHARE_IMAGE_URL);
    else expect(metadata.ogImage, "share-image metadata must be absent while no image is approved").toBeNull();

    // Exercise the home share route with both browser sharing APIs disabled;
    // this reaches the selectable fallback and proves its URL is current.
    await page.evaluate(() => {
      const nav = navigator as Navigator & { share?: unknown; clipboard?: unknown };
      Object.defineProperty(nav, "share", { configurable: true, value: undefined });
      Object.defineProperty(nav, "clipboard", { configurable: true, value: undefined });
    });
    await page.locator("[data-action='home-share']").click();
    const shareText = page.locator("[data-home-share-area] [data-share-text], [data-home-share-area] textarea").first();
    await expect(shareText).toBeVisible();
    const shared = await shareText.evaluate((element) => element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? "");
    expect(shared).toContain(PUBLIC_GAME_URL);

    await page.locator("[data-action='home-share']").press("Escape").catch(() => undefined);
    await runChallenge(page, "診断検査");
    await assertNoBrowserDiagnostics(page, diagnostics);
  });

  test("startup fallback remains actionable when the entry module fails to load", async ({ page }) => {
    test.setTimeout(60_000);
    const failedRequests: string[] = [];
    page.on("requestfailed", (request) => failedRequests.push(request.url()));
    await page.route("**/src/app.ts", (route) => route.abort("failed"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const fallback = page.locator("#static-load-error-title");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveText(siteTitle);
    await expect(page.getByText(/ゲームを読み込んでいます|ゲームを読み込めませんでした/u)).toBeVisible();
    await expect(page.getByRole("link", { name: "もう一度読み込む" })).toHaveAttribute("href", /\/$/u);
    await expect(page.getByRole("link", { name: "ホームへ戻る" })).toHaveAttribute("href", /\/$/u);
    await expect(page.getByRole("link", { name: "実験場へ戻る" })).toHaveAttribute("href", LAB_URL);
    expect(failedRequests.some((url) => /\/src\/app\.ts(?:\?|$)/u.test(url)), "the induced entry failure was observed").toBe(true);
    await page.unroute("**/src/app.ts");
  });

  test("fatal boundary recovers and handles a second independent exception", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoHome(page);

    const triggerExpectedFailure = async (kind: "error" | "rejection", message: string): Promise<void> => {
      await page.evaluate(({ kind: failureKind, message: failureMessage }) => {
        if (failureKind === "error") {
          queueMicrotask(() => { throw new Error(failureMessage); });
        } else {
          void Promise.reject(new Error(failureMessage));
        }
      }, { kind, message });
    };
    const assertFatalActions = async (internalMessage: string): Promise<void> => {
      const fatal = page.locator("[data-fatal-error]");
      await expect(fatal).toBeVisible();
      await expect(fatal).toContainText("画面を表示できません");
      await expect(fatal).not.toContainText(internalMessage);
      await expect(fatal.getByRole("button", { name: "もう一度読み込む" })).toBeVisible();
      await expect(fatal.getByRole("link", { name: "ホームへ戻る" })).toHaveAttribute("href", /\/$/u);
      await expect(fatal.getByRole("link", { name: "実験場へ戻る" })).toHaveAttribute("href", LAB_URL);
    };

    const firstMessage = "R5 expected first exception";
    await triggerExpectedFailure("error", firstMessage);
    await assertFatalActions(firstMessage);
    await page.locator("[data-fatal-error] [data-action='retry']").click();
    await expect(home(page)).toBeVisible();
    await expect(page.locator("[data-fatal-error]")).toHaveCount(0);

    const secondMessage = "R5 expected second rejection";
    await triggerExpectedFailure("rejection", secondMessage);
    await assertFatalActions(secondMessage);
  });

  test("fatal recovery cancels live runs and rebuilds finalized-result actions", async ({ page }) => {
    test.setTimeout(360_000);
    await installUnhandledProbe(page);
    await installResourceProbe(page);
    await page.addInitScript(() => {
      const state = window as Window & { __r5ShareCalls?: string[] };
      state.__r5ShareCalls = [];
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; clipboard?: unknown };
      Object.defineProperty(nav, "share", {
        configurable: true,
        value: async (data: ShareData) => { state.__r5ShareCalls?.push(data.text ?? ""); },
      });
      Object.defineProperty(nav, "clipboard", { configurable: true, value: undefined });
    });
    await gotoHome(page);
    // Resolve Playwright's lazy main-world/hit-target listener helpers before
    // taking the baseline; this read-only DOM query does not start a run.
    expect(await home(page).evaluateAll((screens) => screens.length)).toBe(1);
    await page.waitForTimeout(350);
    const baseline = await readResourceSnapshot(page);

    const triggerFatal = async (message: string): Promise<void> => {
      await page.evaluate((failureMessage) => {
        queueMicrotask(() => { throw new Error(failureMessage); });
      }, message);
      await expect(page.locator("[data-fatal-error]")).toBeVisible();
    };
    const assertRunResourcesStopped = async (): Promise<void> => {
      const snapshot = await readResourceSnapshot(page);
      expect(snapshot.intervals, "fatal recovery clears run intervals").toBeLessThanOrEqual(baseline.intervals);
      expect(snapshot.timeouts, "fatal recovery clears run timeouts").toBeLessThanOrEqual(baseline.timeouts + 2);
      expect(snapshot.listeners, `fatal recovery clears run listeners: ${JSON.stringify(snapshot.listenerDetails)}`).toBeLessThanOrEqual(baseline.listeners + 2);
      expect(snapshot.activeAudioNodes, "fatal recovery stops active tones").toBeLessThanOrEqual(baseline.activeAudioNodes);
    };

    // A fatal screen must own the root after countdown callbacks have had time
    // to run; no stale callback may re-render the board underneath it.
    await begin(page, "challenge", "復旧カウントダウン");
    await expect(phase(page, "countdown")).toBeVisible();
    await triggerFatal("R5 fatal during countdown");
    await assertRunResourcesStopped();
    await page.waitForTimeout(3_300);
    await expect(page.locator("[data-fatal-error]")).toBeVisible();
    await expect(game(page)).toHaveCount(0);
    await expect(result(page)).toHaveCount(0);
    await page.locator("[data-fatal-error] [data-action='retry']").click();
    await expect(home(page)).toBeVisible();

    // Intermission has a scheduled transition instead of the countdown pair;
    // it must also be cancelled before the recovery screen is shown.
    await begin(page, "challenge", "復旧成功表示");
    await waitForPlaying(page);
    await solveVisibleQuestion(page);
    await expect(phase(page, "intermission")).toBeVisible();
    await triggerFatal("R5 fatal during intermission");
    await assertRunResourcesStopped();
    await page.waitForTimeout(1_300);
    await expect(page.locator("[data-fatal-error]")).toBeVisible();
    await expect(game(page)).toHaveCount(0);
    await expect(result(page)).toHaveCount(0);
    await page.locator("[data-fatal-error] [data-action='retry']").click();
    await expect(home(page)).toBeVisible();

    // Recover a committed result and exercise its freshly bound share and home
    // actions, then repeat for retry and practice so every result action is live.
    await runChallenge(page, "復旧共有とホーム");
    const firstIds = await page.locator("[data-result-question]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-puzzle-id")));
    const firstTotal = await page.locator("[data-total-time]").getAttribute("data-total-time-ms");
    await triggerFatal("R5 fatal after finalized result");
    const restore = page.locator("[data-fatal-error] [data-action='restore-finalized-result']");
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(result(page)).toBeVisible();
    await expect(page.locator("[data-result-question]")).toHaveCount(5);
    expect(await page.locator("[data-result-question]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-puzzle-id")))).toEqual(firstIds);
    await expect(page.locator("[data-total-time]")).toHaveAttribute("data-total-time-ms", firstTotal ?? "");
    await page.locator("[data-action='result-share']").click();
    await expect(page.locator("[data-share-area]")).toContainText("共有しました");
    expect(await page.evaluate(() => (window as Window & { __r5ShareCalls?: string[] }).__r5ShareCalls?.length ?? 0)).toBe(1);
    await page.locator("[data-action='result-home']").click();
    await expect(home(page)).toBeVisible();

    await runChallenge(page, "復旧リトライ");
    await triggerFatal("R5 retry recovery result");
    await page.locator("[data-fatal-error] [data-action='restore-finalized-result']").click();
    await expect(result(page)).toBeVisible();
    await page.locator("[data-action='retry']").click();
    await expect(game(page)).toBeVisible();
    await expect(phase(page, "countdown")).toBeVisible();
    await expect(page.locator("[data-field='move-count']")).toHaveText("0");
    await waitForPlaying(page);
    await page.locator("[data-action='abort']").click();
    await expect(visibleDialog(page)).toBeVisible();
    await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
    await expect(home(page)).toBeVisible();

    await runChallenge(page, "復旧練習");
    await triggerFatal("R5 practice recovery result");
    await page.locator("[data-fatal-error] [data-action='restore-finalized-result']").click();
    await expect(result(page)).toBeVisible();
    await page.locator("[data-action='result-practice']").click();
    await expect(game(page)).toBeVisible();
    await expect(game(page)).toHaveAttribute("data-mode", "practice");
    await expect(phase(page, "countdown")).toBeVisible();
    await expect(page.locator("[data-field='move-count']")).toHaveText("0");
  });

  for (const viewport of VIEWPORTS) {
    test(`R5 state matrix: all required screens at ${viewport.name} and 200% text`, async ({ page }, testInfo: TestInfo) => {
      test.setTimeout(300_000);
      const diagnostics = installDiagnostics(page);
      await installUnhandledProbe(page);
      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoHome(page);
      await applyMonochrome(page, true);
      await setFontScale(page, 100);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-home.png`), fullPage: true });

      await setFontScale(page, 200);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertButtonsReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-home-200.png`), fullPage: true });
      await setFontScale(page, 100);

      // Countdown and explanation are checked before the first question is
      // accepted. The modal must inert the underlying board and controls.
      await begin(page, "challenge", "状態確認");
      await expect(phase(page, "countdown")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-countdown.png`), fullPage: true });
      await page.getByRole("button", { name: /遊び方|説明/ }).first().click();
      await expect(visibleDialog(page)).toBeVisible();
      await expect(page.locator("[data-game-content]")).toHaveAttribute("aria-hidden", "true");
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-help.png`), fullPage: true });
      await visibleDialog(page).getByRole("button", { name: /盤面へ戻る|閉じる|続ける/ }).click();
      await expect(visibleDialog(page)).toHaveCount(0);
      await waitForPlaying(page);
      await assertBoardVisible(page);
      await assertNonColorControls(page);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertNoButtonOverlap(page);

      await setFontScale(page, 200);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertNonColorControls(page);
      await assertButtonsReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-game-200.png`), fullPage: true });
      await assertGameStatusReadableAt200(page);
      await setFontScale(page, 100);

      await page.getByRole("button", { name: "中断" }).first().click();
      await expect(visibleDialog(page)).toBeVisible();
      await expect(page.locator("[data-game-content]")).toHaveAttribute("aria-hidden", "true");
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-abort.png`), fullPage: true });
      await visibleDialog(page).getByRole("button", { name: "続ける" }).click();
      await expect(visibleDialog(page)).toHaveCount(0);

      // A successful question is a distinct intermission state. Abort it
      // after observing the state so scheduled transitions are also covered.
      await solveVisibleQuestion(page);
      await expect(phase(page, "intermission")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-success.png`), fullPage: true });
      await closeAbort(page);

      // Run a fresh complete challenge so result layout is measured at every
      // prescribed size, including both landscape and desktop dimensions.
      await setFontScale(page, 100);
      await applyMonochrome(page, true);
      await runChallenge(page, "結果確認");
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertNoButtonOverlap(page);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-result.png`), fullPage: true });
      await setFontScale(page, 200);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertButtonsReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-result-200.png`), fullPage: true });
      await setFontScale(page, 100);
      await applyMonochrome(page, false);
      await page.locator("[data-action='result-home']").click();
      await expect(home(page)).toBeVisible();
      await assertNoBrowserDiagnostics(page, diagnostics);
    });
  }

  test("load and save failures preserve usable recovery screens at every prescribed viewport", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(720_000);
    const diagnostics = installDiagnostics(page);
    await installUnhandledProbe(page);
    await page.addInitScript(() => {
      const originalSet = Storage.prototype.setItem;
      const state = window as Window & {
        __r5FailWrites?: boolean;
        __r5EnableWriteFailure?: () => void;
        __r5SetWriteFailure?: (enabled: boolean) => void;
      };
      state.__r5FailWrites = false;
      state.__r5EnableWriteFailure = () => { state.__r5FailWrites = true; };
      state.__r5SetWriteFailure = (enabled: boolean) => { state.__r5FailWrites = enabled; };
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (state.__r5FailWrites && /(sekibanmawashi|run|save|record|assignment|best)/i.test(key)) {
          throw new Error("R5 synthetic storage write failure");
        }
        originalSet.call(this, key, value);
      };
    });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/?puzzleId=r5-missing-puzzle-${viewport.name}`, { waitUntil: "networkidle" });
      const loadError = page.locator("[data-testid='load-error'], .load-error-screen, [role='alert']").first();
      await expect(loadError).toBeVisible();
      await expect(loadError).toContainText(/読み込めません|確認できません/);
      await expect(page.locator("[data-fatal-error], [data-error='fatal']")).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertLinksReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-load-error.png`), fullPage: true });
      await setFontScale(page, 200);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertLinksReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-load-error-200.png`), fullPage: true });
      await setFontScale(page, 100);

      // Retry is intentionally exercised on the failing route; the home link
      // must then perform a real recovery to the playable R4 home screen.
      const retry = page.getByRole("button", { name: /もう一度読み込む/ }).first();
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(page.locator(".load-error-screen, [role='alert']").first()).toBeVisible();
      const homeLink = page.getByRole("link", { name: "ホームへ戻る" }).first();
      await expect(homeLink).toBeVisible();
      await expect(homeLink).toHaveAttribute("href", /\/$/u);
      const labLink = page.getByRole("link", { name: "実験場へ戻る" }).first();
      await expect(labLink).toBeVisible();
      await expect(labLink).toHaveAttribute("href", LAB_URL);
      await homeLink.click();
      await expect(home(page)).toBeVisible();
      await assertNoHorizontalOverflow(page);

      // Enable the synthetic write failure only after assignment creation, so
      // the game can start and the in-memory final result can still render.
      await page.evaluate(() => (window as Window & { __r5SetWriteFailure?: (enabled: boolean) => void }).__r5SetWriteFailure?.(false));
      await begin(page, "challenge", `保存失敗${viewport.name}`);
      await page.evaluate(() => (window as Window & { __r5EnableWriteFailure?: () => void }).__r5EnableWriteFailure?.());
      await runChallengeAfterBegin(page);
      await expect(result(page)).toBeVisible();
      await expect(page.locator("[data-result-notice]")).toBeVisible();
      await expect(page.locator("[data-result-notice]")).toContainText(/保存できません|参考記録|保存/);
      await expect(page.getByRole("button", { name: /共有|シェア/ }).first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-save-error-result.png`), fullPage: true });
      await setFontScale(page, 200);
      await assertNoHorizontalOverflow(page);
      await assertHitTargets(page);
      await assertButtonsReachable(page, viewport);
      await page.screenshot({ path: testInfo.outputPath(`r5-${viewport.name}-save-error-result-200.png`), fullPage: true });
      await setFontScale(page, 100);
      await page.locator("[data-action='result-home']").click();
      await expect(home(page)).toBeVisible();
      await expect(page.locator("[data-fatal-error], [data-error='fatal']")).toHaveCount(0);
      await page.evaluate(() => (window as Window & { __r5SetWriteFailure?: (enabled: boolean) => void }).__r5SetWriteFailure?.(false));
    }
    await assertNoBrowserDiagnostics(page, diagnostics);
  });

  test("U05: audio off and audio resume failure never block a real run", async ({ page }) => {
    test.setTimeout(180_000);
    const diagnostics = installDiagnostics(page);
    await installUnhandledProbe(page);
    await page.addInitScript(() => {
      const probe = { resumeAttempts: 0 };
      class BlockedAudioContext {
        state = "suspended";
        currentTime = 0;
        destination = {};
        resume = (): Promise<void> => {
          probe.resumeAttempts += 1;
          return Promise.reject(new Error("R5 synthetic audio resume failure"));
        };
        createOscillator = (): Record<string, unknown> => ({
          type: "sine",
          frequency: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
          disconnect: () => undefined,
        });
        createGain = (): Record<string, unknown> => ({
          gain: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
          disconnect: () => undefined,
        });
      };
      const globals = window as Window & { AudioContext?: unknown; webkitAudioContext?: unknown };
      Object.defineProperty(globals, "AudioContext", { configurable: true, writable: true, value: BlockedAudioContext });
      Object.defineProperty(globals, "webkitAudioContext", { configurable: true, writable: true, value: BlockedAudioContext });
      (window as Window & { __r5ResumeProbe?: () => { resumeAttempts: number } }).__r5ResumeProbe = () => ({
        resumeAttempts: probe.resumeAttempts,
      });
    });
    await gotoHome(page);
    const audio = page.locator("[data-testid='home-screen'] [data-action='audio']");
    await expect(audio).toBeChecked();
    const readResumeAttempts = async (): Promise<number> => page.evaluate(() => (
      (window as Window & { __r5ResumeProbe?: () => { resumeAttempts: number } }).__r5ResumeProbe?.().resumeAttempts ?? 0
    ));
    const beforeAudioOnRun = await readResumeAttempts();
    await runChallenge(page, "音声再開失敗");
    const afterAudioOnRun = await readResumeAttempts();
    expect(afterAudioOnRun).toBeGreaterThan(beforeAudioOnRun);
    await expect(result(page)).toBeVisible();
    await page.locator("[data-action='result-home']").click();
    await expect(home(page)).toBeVisible();
    const audioAfterRecovery = page.locator("[data-testid='home-screen'] [data-action='audio']");
    await audioAfterRecovery.uncheck();
    await expect(audioAfterRecovery).not.toBeChecked();
    const beforeAudioOffRun = await readResumeAttempts();
    await runChallenge(page, "無音検査");
    expect(await readResumeAttempts()).toBe(beforeAudioOffRun);
    await expect(result(page)).toBeVisible();
    await assertNoBrowserDiagnostics(page, diagnostics);
  });

  test("U05: a delayed audio resume cannot play after abort, and action sounds remain distinct", async ({ page }) => {
    test.setTimeout(240_000);
    const diagnostics = installDiagnostics(page);
    await installUnhandledProbe(page);
    await installAudioHarness(page, true);
    await gotoHome(page);
    await begin(page, "challenge", "遅延音検査");
    await expect(phase(page, "countdown")).toBeVisible();
    await page.getByRole("button", { name: "中断" }).first().click();
    await expect(visibleDialog(page)).toBeVisible();
    await visibleDialog(page).getByRole("button", { name: "中断する" }).click();
    await expect(home(page)).toBeVisible();
    await page.evaluate(() => {
      try { Object.defineProperty(document, "hidden", { configurable: true, value: true }); } catch { /* WebKit may seal it. */ }
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      try { Object.defineProperty(document, "hidden", { configurable: true, value: false }); } catch { /* WebKit may seal it. */ }
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      (window as Window & { __r5AudioHarness?: { resolveResume: () => void } }).__r5AudioHarness?.resolveResume();
    });
    await page.waitForTimeout(350);
    expect((await readAudioHarness(page)).starts, "disposed run must not emit delayed audio").toBe(0);

    // Resolve the harness for the next home render and exercise every
    // semantic sound path that is observable without depending on a device.
    await page.evaluate(() => (window as Window & { __r5AudioHarness?: { resolveResume: () => void } }).__r5AudioHarness?.resolveResume());
    await nameInput(page).fill("   ");
    await startButton(page, "challenge").click();
    await expect(page.locator("[data-field='name-error'], [role='alert']").first()).toBeVisible();
    await runChallenge(page, "音区別検査");
    await page.waitForTimeout(350);
    const audio = await readAudioHarness(page);
    expect(audio.resumes).toBeGreaterThan(0);
    expect(audio.starts).toBeGreaterThan(0);
    // Frequencies are the harness' stable representation of each action's
    // effect. They also ensure the implementation does not collapse all
    // actions into one generic click sound.
    expect(new Set(audio.frequencies).size).toBeGreaterThanOrEqual(4);
    expect(audio.frequencies).toContain(420); // start
    expect(audio.frequencies).toContain(190); // rotate
    expect(audio.frequencies).toContain(280); // select
    expect(audio.frequencies).toContain(520); // light
    expect(audio.frequencies).toContain(760); // success
    expect(audio.frequencies).toContain(120); // validation/error
    await assertNoBrowserDiagnostics(page, diagnostics);
  });

  test("Q03: twenty consecutive five-question challenges have no duplicate progress, best regression, or persistent resource growth", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(1_200_000);
    const diagnostics = installDiagnostics(page);
    await installUnhandledProbe(page);
    await installResourceProbe(page);
    await installPhaseProbe(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoHome(page);
    // Playwright injects its global-listener and pointer hit-target observers
    // on first main-world locator evaluation. Prime them without interaction so
    // Q03 measures only persistent application-resource changes.
    expect(await home(page).evaluateAll((screens) => screens.length)).toBe(1);
    const audio = page.locator("[data-testid='home-screen'] [data-action='audio']");
    // Audio remains ON here on purpose. Q03 must observe context/node
    // creation and cleanup in addition to the no-audio path covered by U05.
    await expect(audio).toBeChecked();
    await page.waitForTimeout(350);
    const baseline = await readResourceSnapshot(page);
    expect(baseline.audioProbeSupported, "AudioContext instrumentation must be available in the acceptance browser").toBe(true);
    let previous = baseline;
    let bestMs: number | null = null;
    let audioContextObserved = baseline.audioContexts > 0;

    for (let run = 0; run < 20; run += 1) {
      const challenge = await runChallenge(page, `連続検査${run + 1}`);
      expect(challenge.ids).toHaveLength(5);
      expect(new Set(challenge.ids).size).toBe(5);
      expect(challenge.totalMoves).toBeGreaterThan(0);
      const history = await readPhaseHistory(page);
      expect(history.filter((value) => value === "countdown"), "one preparation countdown").toHaveLength(1);
      expect(history.filter((value) => value === "intermission"), "four success boundaries").toHaveLength(4);
      expect(history.filter((value) => value === "result"), "one final result transition").toHaveLength(1);
      const resultRows = page.locator("[data-testid='result-screen'] [data-result-question]");
      await expect(resultRows).toHaveCount(5);
      const rowNumbers = await resultRows.evaluateAll((elements) => elements.map((element) => {
        const match = element.textContent?.match(/問題\s*(\d+)/u);
        return Number(match?.[1] ?? NaN);
      }));
      expect(rowNumbers).toEqual([1, 2, 3, 4, 5]);
      const total = Number(await page.locator("[data-total-time]").getAttribute("data-total-time-ms"));
      expect(Number.isSafeInteger(total)).toBe(true);

      const homeAction = page.locator("[data-action='result-home']");
      await expect(homeAction).toBeVisible();
      await homeAction.click();
      await expect(home(page)).toBeVisible();
      await resetPhaseHistory(page);
      const best = page.locator("[data-testid='home-screen'] [data-best-time]").first();
      await expect(best).toBeVisible();
      const bestAttribute = await best.getAttribute("data-best-time-ms");
      const bestRaw = bestAttribute ?? await best.textContent() ?? "";
      const currentBest = bestAttribute === null
        ? Number(bestRaw.match(/\d+(?:\.\d+)?/u)?.[0] ?? NaN) * 1_000
        : Number(bestRaw);
      expect(Number.isFinite(currentBest) && currentBest >= 0).toBe(true);
      if (bestMs !== null) expect(currentBest, "a slower run cannot move self-best backwards").toBeLessThanOrEqual(bestMs);
      bestMs = bestMs === null ? currentBest : Math.min(bestMs, currentBest);

      await page.waitForTimeout(500);
      const snapshot = await readResourceSnapshot(page);
      const resourceEvidence = {
        run: run + 1,
        baseline,
        previous,
        settled: snapshot,
      };
      await testInfo.attach(`q03-resources-run-${run + 1}`, {
        body: JSON.stringify(resourceEvidence, null, 2),
        contentType: "application/json",
      });
      // Browser-owned lazy listener hooks have already been primed, so all
      // app listeners and intervals must return to the exact home baseline.
      expect(snapshot.intervals).toBeLessThanOrEqual(baseline.intervals);
      expect(snapshot.timeouts).toBeLessThanOrEqual(baseline.timeouts + 2);
      expect(
        snapshot.listeners,
        `Q03 active connected listeners after run ${run + 1}: ${JSON.stringify(resourceEvidence)}`,
      ).toBeLessThanOrEqual(baseline.listeners);
      expect(snapshot.audioContexts).toBeLessThanOrEqual(baseline.audioContexts + 1);
      expect(snapshot.audioProbeSupported).toBe(true);
      expect(snapshot.audioContexts).toBeGreaterThanOrEqual(baseline.audioContexts);
      audioContextObserved ||= snapshot.audioContexts > 0;
      expect(snapshot.audioDisconnects, "every oscillator and gain must be disconnected").toBeGreaterThanOrEqual(snapshot.audioStops * 2);
      expect(snapshot.activeAudioNodes, "stopped tones must also be disconnected").toBeLessThanOrEqual(baseline.activeAudioNodes);
      expect(snapshot.activeOscillators).toBeLessThanOrEqual(baseline.activeOscillators);
      expect(snapshot.domNodes).toBeLessThanOrEqual(baseline.domNodes + 28);
      expect(snapshot.resources).toBeLessThanOrEqual(baseline.resources + 3);
      // Compare consecutive settled snapshots as well, which catches a slow
      // monotonic leak that could hide behind one large initial allowance.
      expect(snapshot.domNodes).toBeLessThanOrEqual(previous.domNodes + 8);
      expect(snapshot.listeners).toBeLessThanOrEqual(previous.listeners);
      expect(snapshot.timeouts).toBeLessThanOrEqual(previous.timeouts + 1);
      expect(snapshot.activeOscillators).toBeLessThanOrEqual(previous.activeOscillators);
      expect(snapshot.activeAudioNodes).toBeLessThanOrEqual(previous.activeAudioNodes);
      previous = snapshot;
    }
    expect(audioContextObserved, "audio ON must create an observable AudioContext").toBe(true);
    await assertNoBrowserDiagnostics(page, diagnostics);
  });
});

/** Finish a run whose home start was already used to inject the save failure. */
async function runChallengeAfterBegin(page: Page): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await waitForPlaying(page);
    await solveVisibleQuestion(page);
    if (index < 4) await expect(phase(page, "intermission")).toBeVisible();
  }
  await expect(result(page)).toBeVisible();
}
