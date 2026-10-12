import { expect, test, type ElementHandle, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { evaluate } from "../src/core/engine.ts";
import type { BoardState, Puzzle } from "../src/core/types.ts";
import { analyzePuzzle } from "../src/puzzles/solver.ts";

const puzzles = JSON.parse(readFileSync("content/puzzles-v2.json", "utf8")) as Puzzle[];
const radii = [43, 73, 103] as const;
type Point = { x: number; y: number };
type Pixel = { r: number; g: number; b: number };

function point(radius: number, slot: number): Point {
  const angle = -Math.PI / 2 + slot * Math.PI / 6;
  return { x: 150 + Math.cos(angle) * radius, y: 150 + Math.sin(angle) * radius };
}

async function openBoard(page: Page, puzzle: Puzzle): Promise<void> {
  await page.goto(`/?puzzleId=${encodeURIComponent(puzzle.id)}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
  await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
  await expect(page.locator("canvas.stone-board-canvas")).toBeVisible();
}

/** Decode an actual compositor screenshot; never sample the semantic SVG. */
async function sampleCanvas(page: Page, positions: Point[]): Promise<Pixel[]> {
  const png = await page.locator("canvas.stone-board-canvas").screenshot({ scale: "css" });
  return page.evaluate(async ({ bytes, points }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot decoder is unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return points.map(({ x, y }) => {
      const px = Math.round(x / 300 * (canvas.width - 1));
      const py = Math.round(y / 300 * (canvas.height - 1));
      const data = context.getImageData(Math.max(0, px - 1), Math.max(0, py - 1), 3, 3).data;
      let r = 0, g = 0, b = 0;
      for (let index = 0; index < data.length; index += 4) {
        r += data[index]!;
        g += data[index + 1]!;
        b += data[index + 2]!;
      }
      return { r: r / 9, g: g / 9, b: b / 9 };
    });
  }, { bytes: Array.from(png), points: positions });
}

type GpuSnapshot = { contexts: number; contextsCreated: number; contextListeners: number; buffers: number; textures: number; programs: number; framebuffers: number };
type DrawSnapshot = { calls: number; instancedCalls: number; instances: number; triangles: number };

/** Count actual browser-owned GPU objects, including detached live contexts. */
async function installGpuProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type ContextListener = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean };
    type GpuRecord = { listeners: ContextListener[]; buffers: Set<unknown>; textures: Set<unknown>; programs: Set<unknown>; framebuffers: Set<unknown> };
    const records = new Map<WebGL2RenderingContext, GpuRecord>();
    const draws = new Map<WebGL2RenderingContext, DrawSnapshot>();
    const canvasRecords = new Map<HTMLCanvasElement, GpuRecord>();
    const add = HTMLCanvasElement.prototype.addEventListener;
    const remove = HTMLCanvasElement.prototype.removeEventListener;
    HTMLCanvasElement.prototype.addEventListener = function (this: HTMLCanvasElement, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (!listener) return;
      add.call(this, type, listener, options);
      const record = canvasRecords.get(this);
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      if (record && type.startsWith("webglcontext") && !record.listeners.some((entry) => entry.type === type && entry.listener === listener && entry.capture === capture)) {
        record.listeners.push({ type, listener, capture });
      }
    } as typeof HTMLCanvasElement.prototype.addEventListener;
    HTMLCanvasElement.prototype.removeEventListener = function (this: HTMLCanvasElement, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      if (!listener) return;
      remove.call(this, type, listener, options);
      const record = canvasRecords.get(this);
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      if (record) record.listeners = record.listeners.filter((entry) => entry.type !== type || entry.listener !== listener || entry.capture !== capture);
    } as typeof HTMLCanvasElement.prototype.removeEventListener;
    const recordFor = (context: WebGL2RenderingContext): GpuRecord => {
      let record = records.get(context);
      if (!record) {
        record = { listeners: [], buffers: new Set(), textures: new Set(), programs: new Set(), framebuffers: new Set() };
        records.set(context, record);
        draws.set(context, { calls: 0, instancedCalls: 0, instances: 0, triangles: 0 });
        if (context.canvas instanceof HTMLCanvasElement) canvasRecords.set(context.canvas, record);
        const owned = record;
        context.canvas.addEventListener("webglcontextlost", () => {
          // Native loss destroys these objects, even without delete calls. The
          // context handle itself deliberately stays in the lifetime count.
          for (const kind of ["buffers", "textures", "programs", "framebuffers"] as const) owned[kind].clear();
        });
      }
      return record;
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...arguments_: unknown[]) {
      const context = Reflect.apply(getContext, this, [contextId, ...arguments_]) as RenderingContext | null;
      if (contextId === "webgl2" && context) recordFor(context as WebGL2RenderingContext);
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
    const clear = prototype.clear;
    if (typeof clear !== "function") throw new Error("GPU draw probe is unavailable");
    prototype.clear = function (this: WebGL2RenderingContext, ...arguments_: unknown[]): unknown {
      const draw = draws.get(this);
      if (draw) { draw.calls = 0; draw.instancedCalls = 0; draw.instances = 0; draw.triangles = 0; }
      return Reflect.apply(clear, this, arguments_);
    };
    for (const [method, countIndex, instanceIndex] of [
      ["drawArrays", 2, -1], ["drawElements", 1, -1],
      ["drawArraysInstanced", 2, 3], ["drawElementsInstanced", 1, 4],
    ] as const) {
      const drawNative = prototype[method];
      if (typeof drawNative !== "function") throw new Error("GPU draw method is unavailable");
      prototype[method] = function (this: WebGL2RenderingContext, ...arguments_: unknown[]): unknown {
        const result: unknown = Reflect.apply(drawNative, this, arguments_);
        const draw = draws.get(this);
        const count = Number(arguments_[countIndex]);
        const instances = instanceIndex < 0 ? 1 : Number(arguments_[instanceIndex]);
        if (draw && count > 0 && instances > 0) {
          draw.calls += 1;
          if (instanceIndex >= 0) { draw.instancedCalls += 1; draw.instances += instances; }
          if (arguments_[0] === this.TRIANGLES) draw.triangles += count / 3 * instances;
        }
        return result;
      };
    }
    for (const [create, remove, kind] of [
      ["createBuffer", "deleteBuffer", "buffers"],
      ["createTexture", "deleteTexture", "textures"],
      ["createProgram", "deleteProgram", "programs"],
      ["createFramebuffer", "deleteFramebuffer", "framebuffers"],
    ] as const) {
      const factory = prototype[create];
      const destroy = prototype[remove];
      if (typeof factory !== "function" || typeof destroy !== "function") throw new Error("GPU probe method is unavailable");
      prototype[create] = function (this: WebGL2RenderingContext, ...arguments_: unknown[]): unknown {
        const value: unknown = Reflect.apply(factory, this, arguments_);
        if (value) recordFor(this)[kind].add(value);
        return value;
      };
      prototype[remove] = function (this: WebGL2RenderingContext, ...arguments_: unknown[]): unknown {
        records.get(this)?.[kind].delete(arguments_[0]);
        return Reflect.apply(destroy, this, arguments_);
      };
    }
    (window as Window & { __threeGpuSnapshot?: () => GpuSnapshot }).__threeGpuSnapshot = () => {
      const total: GpuSnapshot = { contexts: 0, contextsCreated: records.size, contextListeners: 0, buffers: 0, textures: 0, programs: 0, framebuffers: 0 };
      for (const [context, record] of records) {
        total.contextListeners += record.listeners.length;
        if (context.isContextLost()) continue;
        total.contexts += 1;
        for (const kind of ["buffers", "textures", "programs", "framebuffers"] as const) total[kind] += record[kind].size;
      }
      return total;
    };
    (window as Window & { __threeDrawSnapshot?: () => DrawSnapshot }).__threeDrawSnapshot = () => {
      const total: DrawSnapshot = { calls: 0, instancedCalls: 0, instances: 0, triangles: 0 };
      for (const [context, draw] of draws) {
        if (context.isContextLost()) continue;
        for (const key of ["calls", "instancedCalls", "instances", "triangles"] as const) total[key] += draw[key];
      }
      return total;
    };
  });
}

async function gpuSnapshot(page: Page): Promise<GpuSnapshot> {
  return page.evaluate(() => {
    const snapshot = (window as Window & { __threeGpuSnapshot?: () => GpuSnapshot }).__threeGpuSnapshot;
    if (!snapshot) throw new Error("GPU probe was not installed");
    return snapshot();
  });
}

async function drawSnapshot(page: Page): Promise<DrawSnapshot> {
  return page.evaluate(() => {
    const snapshot = (window as Window & { __threeDrawSnapshot?: () => DrawSnapshot }).__threeDrawSnapshot;
    if (!snapshot) throw new Error("GPU draw probe was not installed");
    return snapshot();
  });
}

async function beginPractice(page: Page): Promise<void> {
  await page.locator("[data-field='player-name']").fill("石板検査");
  await page.locator("[data-action='start-practice']").click();
  await expect(page.locator("[data-testid='game-screen']")).toHaveAttribute("data-phase", "playing");
}

async function abortPractice(page: Page): Promise<void> {
  await page.locator("[data-action='abort']").click();
  await page.locator("[data-action='confirm-abort']").click();
  await expect(page.locator("[data-testid='home-screen']")).toBeVisible();
}

test.describe("Three stone and light acceptance", () => {
  test("THREE01: generated stone is loaded into a real canvas with the same accessible controls", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 402, height: 874 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openBoard(page, puzzles[0]!);
    const frame = await page.locator("canvas.stone-board-canvas").boundingBox();
    const semantics = await page.locator("svg.stone-board").boundingBox();
    expect(frame).not.toBeNull();
    expect(semantics).toEqual(frame);
    await expect(page.locator("[data-receiver-slot]")).toHaveCount(12);
    await expect(page.locator("[data-ring-hit]")).toHaveCount(3);
    const canvas = await page.locator("canvas.stone-board-canvas").evaluate((node) => ({
      width: (node as HTMLCanvasElement).width,
      height: (node as HTMLCanvasElement).height,
      hidden: node.getAttribute("aria-hidden"),
      pointerEvents: getComputedStyle(node).pointerEvents,
    }));
    expect(canvas.width).toBeGreaterThan(100);
    expect(canvas.width).toBe(canvas.height);
    expect(canvas.hidden).toBe("true");
    expect(canvas.pointerEvents).toBe("none");
    if (frame) expect(canvas.width).toBeLessThanOrEqual(frame.width * 2 + 2);
    const pixels = await sampleCanvas(page, [point(73, 1), point(73, 2), point(73, 3)]);
    expect(pixels.some((pixel) => pixel.r + pixel.g + pixel.b > 70), "the three-dimensional image is not blank").toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("three-402-portrait.png"), fullPage: true });
  });

  test("THREE02: actual canvas light remains visible in all twelve directions", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 402, height: 874 });
    const candidates = new Map<number, { puzzle: Puzzle; radius: number }>();
    for (const puzzle of puzzles) {
      const light = evaluate(puzzle, puzzle.initialState);
      for (const beam of light.beams) {
        const from = radii[beam.sourceRing]!;
        const to = beam.phase === "in" && beam.blockedRing !== null ? radii[beam.blockedRing]! : 0;
        if (from - to >= 30 && !candidates.has(beam.sourceSlot)) {
          candidates.set(beam.sourceSlot, { puzzle, radius: to + (from - to) * 0.55 });
        }
      }
    }
    expect([...candidates.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, slot) => slot));
    const evidence: { slot: number; puzzleId: string; pixel: Pixel }[] = [];
    for (const [slot, candidate] of candidates) {
      await openBoard(page, candidate.puzzle);
      const pixel = (await sampleCanvas(page, [point(candidate.radius, slot)]))[0]!;
      evidence.push({ slot, puzzleId: candidate.puzzle.id, pixel });
      expect(pixel.r, `source direction ${slot}: warm light reaches its logical path`).toBeGreaterThan(pixel.b + 14);
      expect(pixel.g, `source direction ${slot}: visible light core`).toBeGreaterThan(pixel.b + 8);
      expect(pixel.r + pixel.g, `source direction ${slot}: visible image`).toBeGreaterThan(150);
    }
    await testInfo.attach("twelve-directions-canvas-pixels", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });

  test("THREE03: real black sectors remain dark away from the terminating light core", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 402, height: 874 });
    const puzzle = puzzles.find((candidate) => evaluate(candidate, candidate.initialState).beams.some((beam) => {
      if (beam.blockedRing === null || beam.blockedSlot === null) return false;
      return candidate.rings[beam.blockedRing]!.parts.some((part) => part.kind === "blocker"
        && (part.slot + candidate.initialState.rotations[beam.blockedRing!]!) % 12 === beam.blockedSlot);
    }));
    expect(puzzle, "the adopted pool includes a light stopped by a black sector").toBeDefined();
    if (!puzzle) return;
    await openBoard(page, puzzle);
    const beam = evaluate(puzzle, puzzle.initialState).beams.find((candidate) => candidate.blockedRing !== null
      && puzzle.rings[candidate.blockedRing]!.parts.some((part) => part.kind === "blocker"
        && (part.slot + puzzle.initialState.rotations[candidate.blockedRing!]!) % 12 === candidate.blockedSlot));
    expect(beam).toBeDefined();
    if (!beam || beam.blockedRing === null || beam.blockedSlot === null) return;
    const sample = point(radii[beam.blockedRing]!, beam.blockedSlot + 0.3);
    const pixel = (await sampleCanvas(page, [sample]))[0]!;
    expect((pixel.r + pixel.g + pixel.b) / 3, "black sector is distinguishable from its stone ring").toBeLessThan(100);
    await page.screenshot({ path: testInfo.outputPath("three-black-light-stop.png"), fullPage: true });
  });

  test("THREE09: actual light ends at the first inward and outward blocker", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 402, height: 874 });
    const evidence: { phase: string; puzzleId: string; before: Pixel; after: Pixel }[] = [];
    for (const phase of ["in", "out"] as const) {
      let candidate: { puzzle: Puzzle; before: Point; after: Point } | undefined;
      for (const puzzle of puzzles) {
        const light = evaluate(puzzle, puzzle.initialState);
        const routes = light.beams.flatMap((beam) => {
          const source = point(radii[beam.sourceRing]!, beam.sourceSlot);
          const inwardEnd = beam.phase === "in" && beam.blockedRing !== null
            ? point(radii[beam.blockedRing]!, beam.sourceSlot) : { x: 150, y: 150 };
          const result = [{ start: source, end: inwardEnd }];
          if (beam.phase !== "in") result.push({ start: { x: 150, y: 150 },
            end: point(beam.reachedRim ? 132 : radii[beam.blockedRing!]!, beam.oppositeSlot) });
          return result;
        });
        for (const beam of light.beams) {
          if (beam.phase !== phase || beam.blockedRing === null || beam.blockedSlot === null) continue;
          const black = puzzle.rings[beam.blockedRing]!.parts.some((part) => part.kind === "blocker"
            && (part.slot + puzzle.initialState.rotations[beam.blockedRing!]!) % 12 === beam.blockedSlot);
          if (!black) continue;
          const slot = phase === "in" ? beam.sourceSlot : beam.oppositeSlot;
          const radius = radii[beam.blockedRing]!;
          const before = point(radius + (phase === "in" ? 16 : -16), slot);
          const after = point(radius + (phase === "in" ? -16 : 16), slot);
          const covered = routes.some(({ start, end }) => {
            const dx = end.x - start.x, dy = end.y - start.y;
            const along = ((after.x - start.x) * dx + (after.y - start.y) * dy) / (dx * dx + dy * dy);
            return along >= 0 && along <= 1 && Math.hypot(after.x - start.x - along * dx, after.y - start.y - along * dy) < 8;
          });
          if (!covered && radius < 100) { candidate = { puzzle, before, after }; break; }
        }
        if (candidate) break;
      }
      expect(candidate, `an isolated ${phase}ward first-blocker fixture is available`).toBeDefined();
      if (!candidate) throw new Error("No isolated blocker fixture");
      await openBoard(page, candidate.puzzle);
      const [before, after] = await sampleCanvas(page, [candidate.before, candidate.after]);
      if (!before || !after) throw new Error("Missing screenshot pixel");
      expect(before.r - before.b, `${phase}ward beam ends instead of continuing`).toBeGreaterThan(after.r - after.b + 20);
      expect(before.r + before.g, `${phase}ward light is brighter before the blocker`).toBeGreaterThan(after.r + after.g + 50);
      evidence.push({ phase, puzzleId: candidate.puzzle.id, before, after });
    }
    await testInfo.attach("first-blocker-canvas-pixels", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });

  test("THREE04: one canvas is reused across rotations, resize, dialogs and context loss/restore", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await openBoard(page, puzzles.find((puzzle) => puzzle.difficulty === "hard")!);
    const original = await page.locator("canvas.stone-board-canvas").elementHandle();
    expect(original).not.toBeNull();
    for (let index = 0; index < 12; index += 1) await page.locator("[data-action='rotate-right']").click();
    expect(await original?.evaluate((node) => node === document.querySelector("canvas.stone-board-canvas"))).toBe(true);
    await expect(page.locator("[data-moves]")).toHaveText("12");
    await page.locator("[data-action='help']").click();
    await expect(page.locator("[role='dialog']:visible")).toBeVisible();
    await page.locator("[data-action='close-help']").click();
    await expect(page.locator("[data-moves]")).toHaveText("12");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    const box = await page.locator("canvas.stone-board-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.y + box.height).toBeLessThanOrEqual(391);
    }
    const canLose = await page.locator("canvas.stone-board-canvas").evaluate((node) => {
      const gl = (node as HTMLCanvasElement).getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension) return false;
      (node as HTMLCanvasElement & { __testContextLoss?: WEBGL_lose_context }).__testContextLoss = extension;
      extension.loseContext();
      return true;
    });
    expect(canLose, "the browser must support the real context-loss exercise").toBe(true);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "svg");
    await page.locator("[data-action='rotate-right']").click();
    await expect(page.locator("[data-moves]")).toHaveText("13");
    await original?.evaluate((node) => {
      // getExtension returns null while a context is lost. Retain the real
      // extension acquired before loss, as required by the browser API.
      (node as HTMLCanvasElement & { __testContextLoss?: WEBGL_lose_context }).__testContextLoss?.restoreContext();
    });
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    await expect(page.locator("[data-moves]")).toHaveText("13");
    expect(await original?.evaluate((node) => node === document.querySelector("canvas.stone-board-canvas"))).toBe(true);
    const pixel = (await sampleCanvas(page, [point(100, 1), point(70, 4)]));
    expect(pixel.some((sample) => sample.r + sample.g + sample.b > 70), "context restore redraws the actual stone").toBe(true);
  });

  test("THREE05: unavailable WebGL preserves the playable SVG and one input per rotation", async ({ page }) => {
    await page.addInitScript(() => {
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...arguments_: unknown[]) {
        if (contextId.startsWith("webgl")) return null;
        return Reflect.apply(native, this, [contextId, ...arguments_]) as RenderingContext | null;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto(`/?puzzleId=${encodeURIComponent(puzzles[0]!.id)}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "svg");
    await expect(page.locator("svg.stone-board")).toBeVisible();
    await page.locator("[data-action='rotate-right']").click();
    await expect(page.locator("[data-moves]")).toHaveText("1");
    await page.locator("[data-action='help']").click();
    await expect(page.locator("[role='dialog']:visible")).toBeVisible();
    await expect(page.locator("[data-moves]")).toHaveText("1");
  });

  test("THREE06: a failed texture leaves the game usable", async ({ page }) => {
    await page.route("**/textures/stone-slate-v1.webp", (route) => route.abort());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?puzzleId=${encodeURIComponent(puzzles[0]!.id)}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "failed");
    await page.locator("[data-action='rotate-right']").click();
    await expect(page.locator("[data-moves]")).toHaveText("1");
    expect(errors).toEqual([]);
  });

  test("THREE07: rotations stay bounded and twenty abort/restarts reuse one native context with zero idle GPU", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await installGpuProbe(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page, puzzles.find((puzzle) => puzzle.difficulty === "hard")!);
    const baseline = await gpuSnapshot(page);
    expect(baseline.contexts).toBe(1);
    expect(baseline.contextsCreated).toBe(1);
    expect(baseline.buffers).toBeGreaterThan(0);
    expect(baseline.textures).toBeGreaterThan(0);
    const baselineDraw = await drawSnapshot(page);
    expect(baselineDraw.calls, "the real native frame remains nonblank").toBeGreaterThan(0);
    expect(baselineDraw.calls, "the fixed hard fixture batches 184 original draw calls into 72").toBe(72);
    expect(baselineDraw.triangles, "every original polygon in the fixed hard fixture is retained").toBe(170_284);
    expect(baselineDraw.instancedCalls).toBeGreaterThan(0);
    expect(baselineDraw.instances).toBe(125);
    const cycles: GpuSnapshot[] = [];
    const cycleDraws: DrawSnapshot[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let index = 0; index < 12; index += 1) await page.locator("[data-action='rotate-right']").click();
      const snapshot = await gpuSnapshot(page);
      expect(snapshot).toEqual(baseline);
      cycles.push(snapshot);
      const draw = await drawSnapshot(page);
      expect(draw).toEqual(baselineDraw);
      cycleDraws.push(draw);
    }
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("[data-action='audio']").uncheck();
    // A navigation resets the document lifetime count. Hold the first native
    // canvas across the following runs, so GC cannot hide context replacement.
    let practiceCanvas: ElementHandle<SVGElement | HTMLElement> | null = null;
    const released: GpuSnapshot[] = [];
    for (let run = 0; run < 20; run += 1) {
      await beginPractice(page);
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
      practiceCanvas ??= await page.locator("canvas.stone-board-canvas").elementHandle();
      expect(await practiceCanvas?.evaluate((node) => node === document.querySelector("canvas.stone-board-canvas")), `run ${run + 1}: same native canvas`).toBe(true);
      const active = await gpuSnapshot(page);
      expect(active.contexts, `run ${run + 1}: restored three-dimensional view`).toBe(1);
      expect(active.contextsCreated, `run ${run + 1}: lifetime contexts, including lost handles`).toBe(1);
      expect(active.buffers).toBeGreaterThan(0);
      expect(active.textures).toBeGreaterThan(0);
      await page.locator("[data-action='rotate-right']").click();
      await expect(page.locator("[data-moves]")).toHaveText("1");
      await abortPractice(page);
      await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
      await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
      released.push(await gpuSnapshot(page));
    }
    expect(errors, "native quota and context API errors must remain visible to acceptance").toEqual([]);
    await testInfo.attach("gpu-resource-lifecycle", { body: JSON.stringify({ baseline, baselineDraw, cycles, cycleDraws, released }, null, 2), contentType: "application/json" });
  });

  test("THREE08: a texture arriving after abort cannot revive the old canvas or resources", async ({ page }) => {
    await installGpuProbe(page);
    let releaseImage: (() => void) | undefined;
    let started = false;
    const gate = new Promise<void>((resolve) => { releaseImage = resolve; });
    await page.route("**/textures/stone-slate-v1.webp", async (route) => {
      started = true;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/", { waitUntil: "networkidle" });
    await beginPractice(page);
    await expect.poll(() => started).toBe(true);
    await abortPractice(page);
    releaseImage?.();
    await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
    await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-testid='home-screen']")).toBeVisible();
    expect(errors).toEqual([]);
    await beginPractice(page);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
  });

  test("THREE10: a restore completing after abort stays idle and the next owner reuses the canvas", async ({ page }) => {
    await installGpuProbe(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/", { waitUntil: "networkidle" });
    await beginPractice(page);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    const canvas = await page.locator("canvas.stone-board-canvas").elementHandle();
    expect(canvas).not.toBeNull();
    const canRestore = await canvas?.evaluate((node) => {
      const canvasNode = node as HTMLCanvasElement;
      const extension = canvasNode.getContext("webgl2")?.getExtension("WEBGL_lose_context");
      if (!extension) return false;
      const restore = extension.restoreContext;
      (window as Window & { __lateRestoreCompleted?: boolean }).__lateRestoreCompleted = false;
      const restored = (): void => {
        canvasNode.removeEventListener("webglcontextrestored", restored);
        (window as Window & { __lateRestoreCompleted?: boolean }).__lateRestoreCompleted = true;
      };
      canvasNode.addEventListener("webglcontextrestored", restored);
      extension.restoreContext = function (this: WEBGL_lose_context): void {
        extension.restoreContext = restore;
        restore.call(this);
        // The native restore is queued now, but the view is destroyed before
        // its event arrives. This exercises the otherwise narrow lease race.
        document.querySelector<HTMLButtonElement>("[data-action='abort']")?.click();
        document.querySelector<HTMLButtonElement>("[data-action='confirm-abort']")?.click();
      };
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
      return true;
    });
    expect(canRestore, "the real native restore race must be exercised").toBe(true);
    await expect.poll(() => page.evaluate(() => (window as Window & { __lateRestoreCompleted?: boolean }).__lateRestoreCompleted)).toBe(true);
    await expect(page.locator("[data-testid='home-screen']")).toBeVisible();
    await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
    await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
    await beginPractice(page);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
    expect(await canvas?.evaluate((node) => node === document.querySelector("canvas.stone-board-canvas"))).toBe(true);
    await page.locator("[data-action='rotate-right']").click();
    await expect(page.locator("[data-moves]")).toHaveText("1");
    await abortPractice(page);
    await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
    expect(errors).toEqual([]);
  });

  test("THREE11: partial renderer and stone-scene construction roll back before reusing the native context", async ({ page }, testInfo) => {
    await installGpuProbe(page);
    await page.addInitScript(() => {
      type Failure = { stage: "renderer" | "scene" | null; armed: boolean; fired: number };
      const failure: Failure = { stage: null, armed: false, fired: 0 };
      (window as Window & { __threeConstructionFailure?: Failure }).__threeConstructionFailure = failure;
      const getParameter = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, parameter: number): unknown {
        if (failure.stage && !failure.armed) {
          failure.armed = true;
          if (failure.stage === "renderer") {
            failure.fired += 1;
            throw new Error("Injected renderer-construction failure");
          }
          // The first circle geometry follows a successfully constructed
          // renderer and allocated scene materials. Fail inside that geometry.
          const cosine = Math.cos;
          Math.cos = () => {
            Math.cos = cosine;
            failure.fired += 1;
            throw new Error("Injected stone-scene-construction failure");
          };
        }
        return Reflect.apply(getParameter, this, [parameter]) as unknown;
      };
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const evidence: { stage: string; rolledBack: GpuSnapshot; restored: GpuSnapshot; released: GpuSnapshot }[] = [];
    for (const stage of ["renderer", "scene"] as const) {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.evaluate((value) => {
        const failure = (window as Window & { __threeConstructionFailure?: { stage: string | null; fired: number } }).__threeConstructionFailure;
        if (!failure) throw new Error("Construction-failure probe was not installed");
        failure.stage = value;
      }, stage);
      await beginPractice(page);
      await expect.poll(() => page.evaluate(() => (window as Window & { __threeConstructionFailure?: { fired: number } }).__threeConstructionFailure?.fired)).toBe(1);
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "svg");
      await expect(page.locator("svg.stone-board")).toBeVisible();
      await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
      await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
      const rolledBack = await gpuSnapshot(page);
      await page.locator("[data-action='rotate-right']").click();
      await expect(page.locator("[data-moves]")).toHaveText("1");
      await abortPractice(page);
      await beginPractice(page);
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
      const restored = await gpuSnapshot(page);
      expect(restored.contexts).toBe(1);
      expect(restored.contextsCreated).toBe(1);
      expect(restored.contextListeners, `${stage}: no abandoned renderer listens to restore`).toBe(6);
      expect(restored.buffers).toBeGreaterThan(0);
      expect(restored.textures).toBeGreaterThan(0);
      await page.locator("[data-action='rotate-right']").click();
      await expect(page.locator("[data-moves]")).toHaveText("1");
      await abortPractice(page);
      await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, contextsCreated: 1, contextListeners: 3, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
      evidence.push({ stage, rolledBack, restored, released: await gpuSnapshot(page) });
    }
    expect(errors).toEqual([]);
    await testInfo.attach("gpu-construction-rollback", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });

  test("THREE12: repeated SVG states are reused but inactive, reset and prior-question hits cannot control the current board", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/", { waitUntil: "networkidle" });
    await beginPractice(page);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    const firstId = await page.locator("[data-testid='game-screen']").getAttribute("data-puzzle-id");
    const firstPuzzle = puzzles.find((candidate) => candidate.id === firstId);
    if (!firstPuzzle) throw new Error("The active adopted puzzle is unavailable");
    // A longer one-ring solution can exist even when every shortest solution
    // uses two rings. Prove this full twelve-state cycle cannot solve first.
    const safeRing = [0, 1, 2].find((ring) => Array.from({ length: 12 }, (_, delta) => {
      const state: BoardState = { rotations: [...firstPuzzle.initialState.rotations] };
      state.rotations[ring] = (state.rotations[ring]! + delta) % 12;
      return !evaluate(firstPuzzle, state).solved;
    }).every(Boolean));
    if (safeRing === undefined) throw new Error("The adopted first puzzle has no unsolved twelve-state ring cycle");
    await page.locator(`[data-action='select-ring'][data-ring='${safeRing}']`).click();
    const initialSvg = await page.locator("svg.stone-board").elementHandle();
    const initialHit = await page.locator(`[data-ring-hit='${(safeRing + 1) % 3}']`).elementHandle();
    expect(initialSvg).not.toBeNull();
    expect(initialHit).not.toBeNull();
    await page.locator("[data-action='rotate-right']").click();
    expect(await initialSvg?.evaluate((node) => node.isConnected)).toBe(false);
    await initialHit?.evaluate((node) => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await expect(page.locator(`[data-ring-hit='${safeRing}']`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-moves]")).toHaveText("1");
    for (let turn = 1; turn < 12; turn += 1) await page.locator("[data-action='rotate-right']").click();
    await expect(page.locator("[data-moves]")).toHaveText("12");
    expect(await initialSvg?.evaluate((node) => node === document.querySelector("svg.stone-board")), "the twelve-state cycle reuses its exact semantic/fallback SVG").toBe(true);
    expect(await initialHit?.evaluate((node) => node.isConnected)).toBe(false);
    await initialHit?.evaluate((node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect(page.locator(`[data-ring-hit='${safeRing}']`)).toHaveAttribute("aria-pressed", "true");
    const beforeResetHit = await page.locator("[data-ring-hit='0']").elementHandle();
    await page.locator("[data-action='reset-question']").click();
    await expect(page.locator("[data-moves]")).toHaveText("0");
    await expect(page.locator("[data-testid='game-screen']")).toHaveAttribute("data-puzzle-id", firstId!);
    await beforeResetHit?.evaluate((node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect(page.locator("[data-ring-hit='1']")).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-ring-hit='0']").dispatchEvent("click");
    await expect(page.locator("[data-ring-hit='0']")).toHaveAttribute("aria-pressed", "true");
    const priorQuestionHit = await page.locator("[data-ring-hit='0']").elementHandle();
    for (const move of analyzePuzzle(firstPuzzle).representativeSolution) {
      await page.locator(`[data-action='select-ring'][data-ring='${move.ring}']`).click();
      await page.locator(`[data-action='rotate-${move.type === "r" ? "right" : "left"}']`).click();
    }
    await expect(page.locator("[data-testid='game-screen']")).toHaveAttribute("data-question-index", "1");
    await expect(page.locator("[data-testid='game-screen']")).toHaveAttribute("data-phase", "playing");
    await priorQuestionHit?.evaluate((node) => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    await expect(page.locator("[data-ring-hit='1']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-moves]")).toHaveText("0");
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
    expect(errors).toEqual([]);
  });
});
