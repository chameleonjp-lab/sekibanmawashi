import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { evaluate } from "../src/core/engine.ts";
import type { Puzzle } from "../src/core/types.ts";

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

type GpuSnapshot = { contexts: number; buffers: number; textures: number; programs: number; framebuffers: number };

/** Count actual browser-owned GPU objects, including detached live contexts. */
async function installGpuProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type GpuRecord = { buffers: Set<unknown>; textures: Set<unknown>; programs: Set<unknown>; framebuffers: Set<unknown> };
    const records = new Map<WebGL2RenderingContext, GpuRecord>();
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
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
        let record = records.get(this);
        if (!record) {
          record = { buffers: new Set(), textures: new Set(), programs: new Set(), framebuffers: new Set() };
          records.set(this, record);
        }
        if (value) record[kind].add(value);
        return value;
      };
      prototype[remove] = function (this: WebGL2RenderingContext, ...arguments_: unknown[]): unknown {
        records.get(this)?.[kind].delete(arguments_[0]);
        return Reflect.apply(destroy, this, arguments_);
      };
    }
    (window as Window & { __threeGpuSnapshot?: () => GpuSnapshot }).__threeGpuSnapshot = () => {
      const total: GpuSnapshot = { contexts: 0, buffers: 0, textures: 0, programs: 0, framebuffers: 0 };
      for (const [context, record] of records) {
        if (context.isContextLost()) continue;
        total.contexts += 1;
        for (const kind of ["buffers", "textures", "programs", "framebuffers"] as const) total[kind] += record[kind].size;
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

  test("THREE07: rotations keep bounded GPU objects and abort releases every live context", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await installGpuProbe(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page, puzzles.find((puzzle) => puzzle.difficulty === "hard")!);
    const baseline = await gpuSnapshot(page);
    expect(baseline.contexts).toBe(1);
    expect(baseline.buffers).toBeGreaterThan(0);
    expect(baseline.textures).toBeGreaterThan(0);
    const cycles: GpuSnapshot[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let index = 0; index < 12; index += 1) await page.locator("[data-action='rotate-right']").click();
      const snapshot = await gpuSnapshot(page);
      expect(snapshot).toEqual(baseline);
      cycles.push(snapshot);
    }
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("[data-action='audio']").uncheck();
    const released: GpuSnapshot[] = [];
    for (let run = 0; run < 3; run += 1) {
      await beginPractice(page);
      await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
      await abortPractice(page);
      await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
      await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
      released.push(await gpuSnapshot(page));
    }
    await testInfo.attach("gpu-resource-lifecycle", { body: JSON.stringify({ baseline, cycles, released }, null, 2), contentType: "application/json" });
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
    await expect.poll(() => gpuSnapshot(page)).toEqual({ contexts: 0, buffers: 0, textures: 0, programs: 0, framebuffers: 0 });
    await expect(page.locator("canvas.stone-board-canvas")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-testid='home-screen']")).toBeVisible();
    expect(errors).toEqual([]);
    await beginPractice(page);
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-renderer", "three");
    await expect(page.locator("[data-board-host]")).toHaveAttribute("data-board-texture", "ready");
  });
});
