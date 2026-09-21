import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate } from "../src/core/engine.ts";
import type { LightResult, Puzzle as CorePuzzle } from "../src/core/types.ts";

type Viewport = { name: string; width: number; height: number };
type Puzzle = {
  id: string;
  targets: number[];
  rings: { parts: { kind: "emitter" | "blocker"; slot: number }[] }[];
  initialState: { rotations: [number, number, number] };
};

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
const SOLVING_PUZZLE_ID = "easy-v2-01-355098e2a030861f";
const BOARD_CENTER = 150;
const RING_MID_RADII = [43, 73, 103] as const;
const RECEIVER_RADIUS = 132;

function independentPoint(radius: number, slot: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (slot * Math.PI * 2) / 12;
  return {
    x: BOARD_CENTER + radius * Math.cos(angle),
    y: BOARD_CENTER + radius * Math.sin(angle),
  };
}

function expectedSegments(light: LightResult): { beamIndex: number; phase: "in" | "out"; tracePhase: string; sourceSlot: number; destinationSlot: number; start: { x: number; y: number }; end: { x: number; y: number } }[] {
  const segments: { beamIndex: number; phase: "in" | "out"; tracePhase: string; sourceSlot: number; destinationSlot: number; start: { x: number; y: number }; end: { x: number; y: number } }[] = [];
  light.beams.forEach((beam, beamIndex) => {
    const source = independentPoint(RING_MID_RADII[beam.sourceRing], beam.sourceSlot);
    const inwardEnd = beam.phase === "in" && beam.blockedRing !== null
      ? independentPoint(RING_MID_RADII[beam.blockedRing], beam.sourceSlot)
      : { x: BOARD_CENTER, y: BOARD_CENTER };
    segments.push({ beamIndex, phase: "in", tracePhase: beam.phase, sourceSlot: beam.sourceSlot, destinationSlot: beam.oppositeSlot, start: source, end: inwardEnd });
    if (beam.phase === "out" || beam.reachedRim) {
      const outerEnd = beam.reachedRim
        ? independentPoint(RECEIVER_RADIUS, beam.oppositeSlot)
        : independentPoint(RING_MID_RADII[beam.blockedRing ?? 0], beam.oppositeSlot);
      segments.push({ beamIndex, phase: "out", tracePhase: beam.phase, sourceSlot: beam.sourceSlot, destinationSlot: beam.oppositeSlot, start: { x: BOARD_CENTER, y: BOARD_CENTER }, end: outerEnd });
    }
  });
  return segments;
}

/**
 * The board implementation deliberately exposes only stable semantic data
 * attributes used for acceptance evidence. The tests do not set game state or
 * call engine functions in the page; all state changes below come from real
 * rendered controls and browser input.
 */
function board(page: Page): Locator {
  return page.locator("[data-board]").first();
}

function ringButtons(page: Page): Locator {
  return page.locator("[data-action='select-ring']");
}

function ringHitRegions(page: Page): Locator {
  return board(page).locator("[data-ring-hit]");
}

function rotateButton(page: Page, direction: "left" | "right"): Locator {
  const dataName = direction === "left" ? "left" : "right";
  const japanese = direction === "left" ? /左.*回/ : /右.*回/;
  const byData = page.locator(`[data-rotate="${dataName}"]`).first();
  return byData.or(page.getByRole("button", { name: japanese }).first()).first();
}

function movesStatus(page: Page): Locator {
  return page.locator("[data-moves], [data-field='move-count'], #moves").first();
}

function stateStatus(page: Page): Locator {
  return page.locator("[data-state], [data-field='state'], #state").first();
}

async function readMoves(page: Page): Promise<number> {
  const text = await movesStatus(page).innerText();
  const match = text.match(/\d+/);
  if (!match) throw new Error(`Could not read move count from ${text}`);
  return Number(match[0]);
}

async function openGame(page: Page, puzzleId?: string): Promise<void> {
  const query = puzzleId ? `?puzzleId=${encodeURIComponent(puzzleId)}` : "";
  await page.goto(`/${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "石板回し" })).toBeVisible();
  await expect(board(page)).toBeVisible();
  await expect(page.locator("[data-error], [role=alert]")).toHaveCount(0);
  if (puzzleId) {
    await expect(page.locator(`[data-puzzle-id="${puzzleId}"]`)).toHaveCount(1);
  }
}

async function directionMarkers(page: Page): Promise<Locator> {
  const root = board(page);
  const bySlot = root.locator("[data-direction-slot], [data-receiver-slot]");
  if ((await bySlot.count()) >= 12) return bySlot;
  const byLegacySlot = root.locator("[data-slot]");
  if ((await byLegacySlot.count()) >= 12) return byLegacySlot;
  throw new Error("Board must expose twelve rendered direction markers");
}

async function assertDirectionFrame(page: Page): Promise<void> {
  const svg = board(page).locator("svg.stone-board").first();
  const frame = await svg.boundingBox();
  if (!frame || frame.width <= 0 || frame.height <= 0 || Math.abs(frame.width - frame.height) > 1) {
    throw new Error("Board SVG has no square rendered bounding box");
  }
  const markers = await directionMarkers(page);
  const slots = await markers.evaluateAll((elements) =>
    elements.map((element) => {
      const value = element.getAttribute("data-direction-slot") ?? element.getAttribute("data-receiver-slot") ?? element.getAttribute("data-slot");
      return value === null ? null : Number(value);
    }),
  );
  expect(new Set(slots.filter((slot): slot is number => slot !== null))).toEqual(
    new Set(Array.from({ length: 12 }, (_, slot) => slot)),
  );
  for (const marker of await markers.all()) {
    const box = await marker.boundingBox();
    expect(box, "direction marker should be rendered").not.toBeNull();
    if (!box) continue;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 2);
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 2);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 2);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 2);
  }
}

async function assertBoardInViewport(page: Page, viewport: Viewport): Promise<void> {
  const svgBox = await board(page).locator("svg.stone-board").boundingBox();
  expect(svgBox).not.toBeNull();
  if (!svgBox) return;
  expect(Math.abs(svgBox.width - svgBox.height)).toBeLessThanOrEqual(1);
  if (viewport.width <= 430 && viewport.height > viewport.width) {
    expect(svgBox.y).toBeGreaterThanOrEqual(-1);
    expect(svgBox.y + svgBox.height).toBeLessThanOrEqual(viewport.height + 1);
    const status = await page.locator(".puzzle-status").boundingBox();
    expect(status).not.toBeNull();
    if (status) expect(svgBox.y).toBeGreaterThanOrEqual(status.y + status.height - 1);
  }
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal scrolling is not allowed").toBeLessThanOrEqual(1);
}

async function assertPrimaryControls(page: Page): Promise<void> {
  const rings = ringButtons(page);
  await expect(rings).toHaveCount(3);
  await expect(page.getByRole("button", { name: /左.*回/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /右.*回/ }).first()).toBeVisible();
  for (const button of await page.getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box, "visible controls need a hit target").not.toBeNull();
    if (!box) continue;
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
}

async function assertNoControlOverlap(page: Page): Promise<void> {
  const controls = page.locator("[data-action='select-ring'], [data-action='rotate-left'], [data-action='rotate-right'], [data-action='help'], [data-action='abort']");
  const boxes = [] as { x: number; y: number; width: number; height: number }[];
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box) boxes.push(box);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      expect(overlap, "primary control hit regions must not overlap").toBe(0);
    }
  }
}

async function screenshot(testInfo: TestInfo, page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test.describe("R3 board rendering", () => {
  test("V01/V04/V05 render all 90 puzzles with twelve directions and finite light paths", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const seenSourceSlots = new Set<number>();
    const seenDestinationSlots = new Set<number>();

    for (const [index, puzzle] of puzzles.entries()) {
      await openGame(page, puzzle.id);
      await assertDirectionFrame(page);
      expect(await page.locator("[data-puzzle-id]").getAttribute("data-puzzle-id")).toBe(puzzle.id);

      const expectedEmitters = puzzle.rings.reduce(
        (count, ring) => count + ring.parts.filter((part) => part.kind === "emitter").length,
        0,
      );
      const beams = board(page).locator("[data-beam], [data-beam-index]");
      const expectedLight = evaluate(puzzle as CorePuzzle, (puzzle as CorePuzzle).initialState);
      const expectedRenderSegments = expectedSegments(expectedLight);
      await expect(beams).toHaveCount(expectedRenderSegments.length);
      const beamData = await beams.evaluateAll((elements) =>
        elements.map((element) => ({
          phase: element.getAttribute("data-phase"),
          sourceSlot: Number(element.getAttribute("data-source-slot")),
          endSlot: Number(element.getAttribute("data-end-slot") ?? element.getAttribute("data-destination-slot")),
          beamIndex: Number(element.getAttribute("data-beam-index")),
          x1: Number(element.getAttribute("x1")),
          y1: Number(element.getAttribute("y1")),
          x2: Number(element.getAttribute("x2")),
          y2: Number(element.getAttribute("y2")),
        })),
      );
      expect(new Set(beamData.map((beam) => beam.beamIndex))).toEqual(new Set(Array.from({ length: expectedEmitters }, (_, beamIndex) => beamIndex)));
      for (const [segmentIndex, beam] of beamData.entries()) {
        const expectedSegment = expectedRenderSegments[segmentIndex];
        expect(beam.phase).toBe(expectedSegment.tracePhase);
        expect(beam.sourceSlot).toBe(expectedSegment.sourceSlot);
        expect(beam.endSlot).toBe(expectedSegment.destinationSlot);
        expect(beam.beamIndex).toBe(expectedSegment.beamIndex);
        expect(Math.abs(beam.x1 - expectedSegment.start.x)).toBeLessThan(0.01);
        expect(Math.abs(beam.y1 - expectedSegment.start.y)).toBeLessThan(0.01);
        expect(Math.abs(beam.x2 - expectedSegment.end.x)).toBeLessThan(0.01);
        expect(Math.abs(beam.y2 - expectedSegment.end.y)).toBeLessThan(0.01);
        expect(Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1)).toBeGreaterThan(0);
        seenSourceSlots.add(beam.sourceSlot);
        seenDestinationSlots.add(beam.endSlot);
      }

      const visualData = await board(page).locator("svg.stone-board").evaluate((svg) => {
        const children = Array.from(svg.children);
        const layerIndex = (selector: string): number => {
          const element = svg.querySelector(selector);
          return element ? children.indexOf(element) : -1;
        };
        const beamStyles = Array.from(svg.querySelectorAll<SVGLineElement>(".board-beams .beam")).map((element) => {
          const style = getComputedStyle(element);
          return {
            display: style.display,
            visibility: style.visibility,
            opacity: Number.parseFloat(style.opacity),
            stroke: style.stroke,
            strokeWidth: Number.parseFloat(style.strokeWidth),
          };
        });
        const filter = svg.querySelector("#beam-glow");
        return {
          layers: {
            beams: layerIndex(".board-beams"),
            parts: layerIndex(".board-parts"),
            stops: layerIndex(".beam-stops"),
            receivers: layerIndex(".board-receivers"),
            hits: layerIndex(".board-ring-hits"),
          },
          beamStyles,
          filter: filter ? {
            units: filter.getAttribute("filterUnits"),
            x: Number.parseFloat(filter.getAttribute("x") ?? "NaN"),
            y: Number.parseFloat(filter.getAttribute("y") ?? "NaN"),
            width: Number.parseFloat(filter.getAttribute("width") ?? "NaN"),
            height: Number.parseFloat(filter.getAttribute("height") ?? "NaN"),
          } : null,
        };
      });
      expect(visualData.layers.beams).toBeGreaterThanOrEqual(0);
      expect(visualData.layers.beams).toBeLessThan(visualData.layers.parts);
      expect(visualData.layers.parts).toBeLessThan(visualData.layers.stops);
      expect(visualData.layers.stops).toBeLessThan(visualData.layers.receivers);
      expect(visualData.layers.receivers).toBeLessThan(visualData.layers.hits);
      expect(visualData.beamStyles).toHaveLength(expectedRenderSegments.length);
      for (const style of visualData.beamStyles) {
        expect(style.display).not.toBe("none");
        expect(style.visibility).not.toBe("hidden");
        expect(style.opacity).toBeGreaterThan(0);
        expect(style.stroke).not.toBe("none");
        expect(style.stroke).not.toBe("transparent");
        expect(style.strokeWidth).toBeGreaterThan(0);
      }
      expect(visualData.filter).not.toBeNull();
      if (visualData.filter) {
        expect(visualData.filter.units).toBe("userSpaceOnUse");
        expect(visualData.filter.x).toBeLessThanOrEqual(-50);
        expect(visualData.filter.y).toBeLessThanOrEqual(-50);
        expect(visualData.filter.width).toBeGreaterThanOrEqual(200);
        expect(visualData.filter.height).toBeGreaterThanOrEqual(200);
      }

      const blockedBeamCount = expectedLight.beams.filter((beam) => beam.blockedRing !== null).length;
      await expect(board(page).locator("[data-stop-slot]")).toHaveCount(blockedBeamCount);

      // Keep a visual sample for every tenth puzzle in the CI artifact.
      if (index % 10 === 0) await screenshot(testInfo, page, `v01-${String(index + 1).padStart(2, "0")}-${puzzle.id}`);
    }
    for (const slot of [0, 3, 6, 9]) {
      expect(seenSourceSlots.has(slot), `source slot ${slot} must be rendered`).toBe(true);
      expect(seenDestinationSlots.has(slot), `destination slot ${slot} must be rendered`).toBe(true);
    }
    expect(seenSourceSlots).toEqual(new Set(Array.from({ length: 12 }, (_, slot) => slot)));
    expect(seenDestinationSlots).toEqual(new Set(Array.from({ length: 12 }, (_, slot) => slot)));
  });

  test("V01 rejects an unknown puzzle id without falling back to another board", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?puzzleId=not-a-puzzle", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "問題を読み込めません" })).toBeVisible();
    await expect(page.locator("[data-board]")).toHaveCount(0);
  });

  test("V02 covers every prescribed viewport at 200% root text without clipping controls", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openGame(page);
      // This is the deterministic root-font approximation available to a
      // browser runner; it is not a claim about iPhone Safari text zoom.
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const rootFontSize = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
      expect(rootFontSize).toBeGreaterThanOrEqual(30);
      await assertNoHorizontalOverflow(page);
      await assertDirectionFrame(page);
      await assertPrimaryControls(page);
      await assertNoControlOverlap(page);
      for (const button of await page.getByRole("button").all()) {
        if (!(await button.isVisible())) continue;
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
      }
      if ((viewport.width === 320 && viewport.height === 568) || (viewport.width === 844 && viewport.height === 390)) {
        for (const [openerName, closeName] of [["遊び方", "盤面へ戻る"], ["中断", "続ける"]] as const) {
          await page.getByRole("button", { name: openerName }).click();
          const dialog = page.locator("[role=dialog]:visible").first();
          await expect(dialog).toBeVisible();
          await assertNoHorizontalOverflow(page);
          await dialog.scrollIntoViewIfNeeded();
          for (const button of await dialog.getByRole("button").all()) {
            await button.scrollIntoViewIfNeeded();
            await expect(button).toBeVisible();
          }
          await dialog.getByRole("button", { name: closeName }).click();
          await expect(page.locator("[role=dialog]:visible")).toHaveCount(0);
        }
      }
      await screenshot(testInfo, page, `v02-${viewport.name}-200-percent`);
    }
  });

  test("V02 keeps the primary controls and board on every normal-text viewport", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openGame(page);
      await assertNoHorizontalOverflow(page);
      await assertDirectionFrame(page);
      await assertPrimaryControls(page);
      await assertNoControlOverlap(page);
      await assertBoardInViewport(page, viewport);
      if (viewport.width <= 430 && viewport.height > viewport.width) {
        for (const button of await page.locator("[data-action='select-ring'], [data-action^='rotate-']").all()) {
          const box = await button.boundingBox();
          expect(box).not.toBeNull();
          if (!box) continue;
          expect(box.y).toBeGreaterThanOrEqual(-1);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        }
      }
      await screenshot(testInfo, page, `v02-${viewport.name}-normal`);
    }
  });

  test("V03 separates all three ring hit regions and keeps selection at zero moves", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const rings = ringButtons(page);
    const hits = ringHitRegions(page);
    await expect(hits).toHaveCount(3);
    const radialExtents = await hits.evaluateAll((elements) => elements.map((element) => {
      const path = element as SVGGeometryElement;
      const length = path.getTotalLength();
      const radii: number[] = [];
      for (let index = 0; index <= 32; index += 1) {
        const point = path.getPointAtLength(length * index / 32);
        radii.push(Math.hypot(point.x - 150, point.y - 150));
      }
      return { min: Math.min(...radii), max: Math.max(...radii) };
    }));
    for (let index = 0; index < radialExtents.length; index += 1) {
      expect(radialExtents[index].max).toBeGreaterThan(radialExtents[index].min);
      if (index > 0) expect(radialExtents[index - 1].max).toBeLessThan(radialExtents[index].min);
    }
    const svgBox = await board(page).locator("svg").boundingBox();
    expect(svgBox).not.toBeNull();
    if (!svgBox) return;
    expect(Math.abs(svgBox.width - svgBox.height)).toBeLessThanOrEqual(1);
    const svgScale = svgBox.width / 300;
    for (let index = 0; index < 3; index += 1) {
      const radius = (radialExtents[index].min + radialExtents[index].max) / 2;
      await page.touchscreen.tap(svgBox.x + 150 * svgScale, svgBox.y + (150 - radius) * svgScale);
      await expect(rings.nth(index)).toHaveAttribute("aria-pressed", "true");
      expect(await readMoves(page)).toBe(0);
    }
  });
});

test.describe("R3 input contract", () => {
  test("I01 accepts one click, one touch tap, and one programmatic button activation as one move each", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, "hard-v2-01-fe30d6ec2ec65e81");
    const right = rotateButton(page, "right");
    expect(await readMoves(page)).toBe(0);

    await right.click();
    expect(await readMoves(page)).toBe(1);

    const rightBox = await right.boundingBox();
    expect(rightBox).not.toBeNull();
    if (!rightBox) return;
    await page.touchscreen.tap(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    expect(await readMoves(page)).toBe(2);

    await right.evaluate((element) => (element as HTMLButtonElement).click());
    expect(await readMoves(page)).toBe(3);
  });

  test("I03 does not duplicate compatibility clicks, multi-touch, cancelled pointers, or held input", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, "hard-v2-02-7e3bf8c1838d9760");
    const right = rotateButton(page, "right");
    const rightBox = await right.boundingBox();
    expect(rightBox).not.toBeNull();
    if (!rightBox) return;

    // A browser touch tap produces the compatibility click itself; it must be one move.
    await page.touchscreen.tap(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    expect(await readMoves(page)).toBe(1);

    // Playwright has no cross-browser simultaneous-touch fixture. This
    // synthetic pointer lifecycle supplements the real touch tap above; it
    // must not synthesize two rotations or leave the controller captured.
    await right.evaluate((element) => {
      for (const pointerId of [41, 42]) {
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId, pointerType: "touch", isPrimary: pointerId === 41 }));
      }
      for (const pointerId of [42, 41]) {
        element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, pointerType: "touch", isPrimary: pointerId === 41 }));
      }
    });
    expect(await readMoves(page)).toBe(1);

    // Explicit cancellation and lost capture must leave the next real click usable.
    await right.evaluate((element) => {
      const pointer = { bubbles: true, pointerId: 43, pointerType: "touch", isPrimary: true } as PointerEventInit;
      element.dispatchEvent(new PointerEvent("pointerdown", pointer));
      element.dispatchEvent(new PointerEvent("pointercancel", pointer));
      element.dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
    });
    expect(await readMoves(page)).toBe(1);
    await right.click();
    expect(await readMoves(page)).toBe(2);

    // Pointer cancellation and leaving the target must not block the next input.
    await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rightBox.x - 20, rightBox.y - 20);
    await page.mouse.up();
    expect(await readMoves(page)).toBe(2);
    await right.click();
    expect(await readMoves(page)).toBe(3);

    // A held native key produces one activation, not an interval of activations.
    await right.focus();
    const beforeEnter = await readMoves(page);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.waitForTimeout(800);
    await page.keyboard.up("Enter");
    expect(await readMoves(page)).toBe(beforeEnter + 1);
  });

  test("I04 keeps focus on the accessible HTML ring control after the SVG is replaced", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const control = ringButtons(page).nth(0);
    await control.focus();
    await expect(control).toBeFocused();
    expect(await readMoves(page)).toBe(0);

    // SVG paths are pointer-only; the equivalent HTML buttons are the
    // keyboard/assistive route and persist while the SVG is replaced.
    await page.keyboard.press("Enter");
    const replacement = ringHitRegions(page).nth(0);
    await expect(replacement).toHaveAttribute("aria-pressed", "true");
    await expect(replacement).toHaveAttribute("tabindex", "-1");
    await expect(replacement).toHaveAttribute("aria-hidden", "true");
    await expect(control).toBeFocused();
    expect(await readMoves(page)).toBe(0);
  });

  test("I04 does not prevent held Enter/Space in input, textarea, or contenteditable targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const before = await readMoves(page);
    await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.dataset.activationGuardFixture = "true";
      fixture.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:20;display:flex;gap:2px;background:#27282a;padding:2px";
      fixture.innerHTML = "<input aria-label='activation input' /><textarea aria-label='activation textarea'></textarea><div aria-label='activation editor' contenteditable='true' tabindex='0'></div>";
      document.body.append(fixture);
      const state = window as Window & { __activationEvents?: { key: string; repeat: boolean; defaultPrevented: boolean }[] };
      state.__activationEvents = [];
      window.addEventListener("keydown", (event) => {
        state.__activationEvents?.push({ key: event.key, repeat: event.repeat, defaultPrevented: event.defaultPrevented });
      });
    });

    for (const selector of [
      "[aria-label='activation input']",
      "[aria-label='activation textarea']",
      "[aria-label='activation editor']",
    ]) {
      const editable = page.locator(selector);
      await editable.focus();
      for (const key of ["Enter", "Space"]) {
        await page.evaluate(() => {
          const state = window as Window & { __activationEvents?: { key: string; repeat: boolean; defaultPrevented: boolean }[] };
          state.__activationEvents = [];
        });
        await page.keyboard.down(key);
        await page.keyboard.down(key);
        await page.keyboard.up(key);
        const events = await page.evaluate(() => (window as Window & { __activationEvents?: { key: string; repeat: boolean; defaultPrevented: boolean }[] }).__activationEvents ?? []);
        expect(events.filter((event) => event.key === (key === "Space" ? " " : key)).length).toBeGreaterThanOrEqual(1);
        expect(events.every((event) => !event.defaultPrevented), `${selector} ${key} must retain its default`).toBe(true);
        expect(await readMoves(page)).toBe(before);
      }
    }

    // A composing keydown is protected even when it carries repeat=true.
    const composingResults = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>("[aria-label='activation editor']");
      if (!target) return [];
      target.focus();
      const results: boolean[] = [];
      for (const key of ["Enter", " "]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, isComposing: true, repeat: true });
        target.dispatchEvent(event);
        results.push(event.defaultPrevented);
      }
      return results;
    });
    expect(composingResults).toEqual([false, false]);
    expect(await readMoves(page)).toBe(before);
  });

  test("I02/I04 keep the board fixed during dialogs and protect editable controls from shortcuts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const right = rotateButton(page, "right");
    const before = await readMoves(page);

    // R3 has no name field yet, so mount a small real form fixture to exercise
    // the shared guard for all editable target types before R4 adds its form.
    await page.evaluate(() => {
      const fixture = document.createElement("form");
      fixture.dataset.inputGuardFixture = "true";
      fixture.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:20;display:flex;gap:2px;background:#27282a;padding:2px";
      fixture.innerHTML = "<input aria-label='guard input' /><select aria-label='guard select'><option>A</option><option>B</option></select><textarea aria-label='guard textarea'></textarea><div aria-label='guard editor' contenteditable='true' tabindex='0'></div>";
      document.body.append(fixture);
    });
    for (const selector of [
      "[aria-label='guard input']",
      "[aria-label='guard select']",
      "[aria-label='guard textarea']",
      "[aria-label='guard editor']",
    ]) {
      const editable = page.locator(selector);
      await editable.focus();
      await page.evaluate(() => {
        (window as Window & { __guardDefaultPrevented?: boolean | undefined }).__guardDefaultPrevented = undefined;
        window.addEventListener("keydown", (event) => {
          (window as Window & { __guardDefaultPrevented?: boolean | undefined }).__guardDefaultPrevented = event.defaultPrevented;
        }, { once: true });
      });
      await page.keyboard.press("ArrowRight");
      expect(await readMoves(page)).toBe(before);
      expect(await page.evaluate(() => (window as Window & { __guardDefaultPrevented?: boolean | undefined }).__guardDefaultPrevented)).toBe(false);
      await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true, isComposing: true })));
      expect(await readMoves(page)).toBe(before);
    }

    const audio = page.locator('input[type="checkbox"]').first();
    if (await audio.count()) {
      await audio.focus();
      await page.keyboard.press("Space");
      expect(await readMoves(page)).toBe(before);
    }

    const helpOpener = page.getByRole("button", { name: /遊び方|説明|ヘルプ/ }).first();
    await expect(helpOpener).toBeVisible();
    await helpOpener.click();
    const dialog = page.locator("dialog[open], [role=dialog]:visible").first();
    await expect(dialog).toBeVisible();
    expect(await readMoves(page)).toBe(before);
    await page.keyboard.press("ArrowRight");
    await right.evaluate((element) => (element as HTMLButtonElement).click());
    expect(await readMoves(page)).toBe(before);
    await expect(right).toBeDisabled();

    const dialogButtons = dialog.getByRole("button");
    expect(await dialogButtons.count()).toBeGreaterThanOrEqual(1);
    await dialogButtons.first().focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialogButtons.last()).toBeFocused();
    await dialogButtons.last().focus();
    await page.keyboard.press("Tab");
    await expect(dialogButtons.first()).toBeFocused();
    for (let index = 0; index < Math.max(2, await dialogButtons.count() * 2); index += 1) {
      await page.keyboard.press(index % 2 === 0 ? "Tab" : "Shift+Tab");
      const inside = await page.evaluate(() => {
        const dialogElement = document.querySelector("dialog[open], [role=dialog]:not([aria-hidden=true])");
        return Boolean(dialogElement?.contains(document.activeElement));
      });
      expect(inside, "dialog focus must remain trapped").toBe(true);
    }
  });

  test("I05 closes the dialog with Escape and restores the opener focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const opener = page.getByRole("button", { name: /遊び方|説明|ヘルプ/ }).first();
    await opener.click();
    await expect(page.locator("dialog[open], [role=dialog]:visible").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open], [role=dialog]:visible")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent)).toMatch(/遊び方|説明|ヘルプ/);

    const abort = page.getByRole("button", { name: "中断" }).first();
    await abort.click();
    const abortDialog = page.locator("dialog[open], [role=dialog]:visible").first();
    await expect(abortDialog).toContainText("中断");
    await abortDialog.getByRole("button", { name: "続ける" }).click();
    await expect(page.locator("dialog[open], [role=dialog]:visible")).toHaveCount(0);
    await expect(abort).toBeFocused();
  });

  test("I04 supports arrows and held Space without changing the selected ring unexpectedly", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const rings = ringButtons(page);
    await rings.nth(0).click();
    await page.keyboard.press("ArrowDown");
    await expect(rings.nth(1)).toHaveAttribute("aria-pressed", "true");
    expect(await readMoves(page)).toBe(0);
    await page.keyboard.press("ArrowUp");
    await expect(rings.nth(0)).toHaveAttribute("aria-pressed", "true");
    expect(await readMoves(page)).toBe(0);

    const right = rotateButton(page, "right");
    await right.focus();
    await page.evaluate(() => {
      (window as Window & { __shortcutDefaultPrevented?: boolean | undefined }).__shortcutDefaultPrevented = undefined;
      window.addEventListener("keydown", (event) => {
        (window as Window & { __shortcutDefaultPrevented?: boolean | undefined }).__shortcutDefaultPrevented = event.defaultPrevented;
      }, { once: true });
    });
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => (window as Window & { __shortcutDefaultPrevented?: boolean | undefined }).__shortcutDefaultPrevented)).toBe(true);
    const beforeSpace = await readMoves(page);
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.waitForTimeout(800);
    await page.keyboard.up("Space");
    expect(await readMoves(page)).toBe(beforeSpace + 1);
  });

  test("I06 solves a known rendered official puzzle by touch and by keyboard, and freezes after success", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, SOLVING_PUZZLE_ID);
    const rings = ringButtons(page);
    const left = rotateButton(page, "left");
    const right = rotateButton(page, "right");
    await rings.nth(0).click();
    for (let index = 0; index < 4; index += 1) await right.click();
    await rings.nth(1).click();
    await left.click();
    await expect(stateStatus(page)).toContainText(/成功|完成|解決/);
    const solvedMoves = await readMoves(page);
    await expect(right).toBeDisabled();
    await right.evaluate((element) => (element as HTMLButtonElement).click());
    expect(await readMoves(page)).toBe(solvedMoves);

    await openGame(page, SOLVING_PUZZLE_ID);
    await page.keyboard.press("1");
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("2");
    await page.keyboard.press("ArrowLeft");
    await expect(stateStatus(page)).toContainText(/成功|完成|解決/);

    await openGame(page, SOLVING_PUZZLE_ID);
    const innerBox = await rings.nth(0).boundingBox();
    const middleBox = await rings.nth(1).boundingBox();
    const rightBox = await right.boundingBox();
    const leftBox = await left.boundingBox();
    expect(innerBox).not.toBeNull();
    expect(middleBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect(leftBox).not.toBeNull();
    if (!innerBox || !middleBox || !rightBox || !leftBox) return;
    await page.touchscreen.tap(innerBox.x + innerBox.width / 2, innerBox.y + innerBox.height / 2);
    for (let index = 0; index < 4; index += 1) await page.touchscreen.tap(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    await page.touchscreen.tap(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2);
    await page.touchscreen.tap(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
    await expect(stateStatus(page)).toContainText(/成功|完成|解決/);
  });
});
