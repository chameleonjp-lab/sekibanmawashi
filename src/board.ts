import { evaluate, partWorldSlots } from "./core/engine.ts";
import {
  RING_COUNT,
  SLOT_COUNT,
  type BoardState,
  type BeamTrace,
  type BeamPhase,
  type LightResult,
  type Puzzle,
} from "./core/types.ts";

/**
 * The board is deliberately kept in one SVG coordinate system.  Keeping the
 * receiver margin in the same viewBox as the rings prevents the outer glyphs
 * from being clipped when the board is resized by CSS.
 */
export const BOARD_VIEWBOX = Object.freeze({ minX: 0, minY: 0, width: 300, height: 300 });
export const BOARD_CENTER = Object.freeze({ x: 150, y: 150 });
export const RING_RADII: readonly (readonly [number, number])[] = Object.freeze([
  [31, 55],
  [61, 85],
  [91, 115],
]);
export const RECEIVER_RADIUS = 132;
export const OUTER_DISC_RADIUS = 127;

export type BoardPoint = { x: number; y: number };

export type BoardBeamSegment = {
  beamIndex: number;
  phase: "in" | "out";
  tracePhase: BeamPhase;
  sourceSlot: number;
  destinationSlot: number;
  start: BoardPoint;
  end: BoardPoint;
  reachedRim: boolean;
  blockedRing: number | null;
  blockedSlot: number | null;
};

export type BoardPart = {
  ring: number;
  kind: "emitter" | "blocker";
  slot: number;
  emitting: boolean;
};

export type BoardRenderModel = {
  light: LightResult;
  parts: BoardPart[];
  beams: BoardBeamSegment[];
  targets: number[];
};

const SVG_NS = "http://www.w3.org/2000/svg";

const RING_LABELS = ["内環", "中環", "外環"] as const;

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new RangeError("slot must be an integer from 0 through 11");
  }
}

function assertRing(ring: number): void {
  if (!Number.isInteger(ring) || ring < 0 || ring >= RING_COUNT) {
    throw new RangeError("ring must be an integer from 0 through 2");
  }
}

/** Return the slot angle in radians, with slot 0 pointing up. */
export function slotAngle(slot: number): number {
  assertSlot(slot);
  return -Math.PI / 2 + (slot * Math.PI * 2) / SLOT_COUNT;
}

export function polarPoint(radius: number, slot: number): BoardPoint {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError("radius must be non-negative");
  const angle = slotAngle(slot);
  return {
    x: BOARD_CENTER.x + radius * Math.cos(angle),
    y: BOARD_CENTER.y + radius * Math.sin(angle),
  };
}

export function ringMidRadius(ring: number): number {
  assertRing(ring);
  const [inner, outer] = RING_RADII[ring];
  return (inner + outer) / 2;
}

export function ringPath(inner: number, outer: number): string {
  if (!(inner > 0) || !(outer > inner)) throw new RangeError("ring radii must be positive and ordered");
  const { x: cx, y: cy } = BOARD_CENTER;
  return [
    `M ${cx} ${cy - outer}`,
    `A ${outer} ${outer} 0 1 1 ${cx - 0.01} ${cy - outer}`,
    `L ${cx - 0.01} ${cy - inner}`,
    `A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner}`,
    "Z",
  ].join(" ");
}

function beamStart(beam: BeamTrace): BoardPoint {
  return polarPoint(ringMidRadius(beam.sourceRing), beam.sourceSlot);
}

function beamInnerEnd(beam: BeamTrace): BoardPoint {
  if (beam.phase === "in" && beam.blockedRing !== null) {
    return polarPoint(ringMidRadius(beam.blockedRing), beam.sourceSlot);
  }
  return BOARD_CENTER;
}

function beamOuterEnd(beam: BeamTrace): BoardPoint {
  if (beam.reachedRim) return polarPoint(RECEIVER_RADIUS, beam.oppositeSlot);
  if (beam.blockedRing !== null) return polarPoint(ringMidRadius(beam.blockedRing), beam.oppositeSlot);
  return polarPoint(RECEIVER_RADIUS, beam.oppositeSlot);
}

/**
 * Convert the core's first-blocker traces to drawable line segments.
 *
 * The core intentionally reports the first blocker rather than pixel
 * coordinates.  This function therefore creates no alternate collision
 * logic: a blocked inward trace has only an inward segment, an outward trace
 * has the centre-to-blocker segment, and a clear trace reaches the receiver.
 */
export function beamSegments(beams: readonly BeamTrace[]): BoardBeamSegment[] {
  const segments: BoardBeamSegment[] = [];
  beams.forEach((beam, beamIndex) => {
    const start = beamStart(beam);
    const inwardEnd = beamInnerEnd(beam);
    segments.push({
      beamIndex,
      phase: "in",
      tracePhase: beam.phase,
      sourceSlot: beam.sourceSlot,
      destinationSlot: beam.oppositeSlot,
      start,
      end: inwardEnd,
      reachedRim: beam.reachedRim,
      blockedRing: beam.phase === "in" ? beam.blockedRing : null,
      blockedSlot: beam.phase === "in" ? beam.blockedSlot : null,
    });
    if (beam.phase === "out" || beam.reachedRim) {
      segments.push({
        beamIndex,
        phase: "out",
        tracePhase: beam.phase,
        sourceSlot: beam.sourceSlot,
        destinationSlot: beam.oppositeSlot,
        start: BOARD_CENTER,
        end: beamOuterEnd(beam),
        reachedRim: beam.reachedRim,
        blockedRing: beam.phase === "out" ? beam.blockedRing : null,
        blockedSlot: beam.phase === "out" ? beam.blockedSlot : null,
      });
    }
  });
  return segments;
}

export function createBoardRenderModel(puzzle: Puzzle, state: BoardState): BoardRenderModel {
  const light = evaluate(puzzle, state);
  return {
    light,
    parts: partWorldSlots(puzzle, state),
    beams: beamSegments(light.beams),
    targets: [...puzzle.targets],
  };
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function setAttributes(element: Element, attributes: Record<string, string>): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}

function appendCircle(parent: Element, point: BoardPoint, radius: number, className: string): SVGCircleElement {
  const circle = svgElement("circle");
  setAttributes(circle, { cx: String(point.x), cy: String(point.y), r: String(radius), class: className });
  parent.append(circle);
  return circle;
}

function emitterGlyph(parent: Element, point: BoardPoint, radius: number): void {
  const group = svgElement("g");
  group.setAttribute("class", "board-emitter");
  appendCircle(group, point, radius * 0.44, "emitter-core");
  appendCircle(group, point, radius * 0.15, "emitter-centre");
  const rays: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI / 4;
    const inner = radius * 0.52;
    const outer = radius;
    const halfWidth = 0.18;
    const x1 = point.x + Math.cos(angle - halfWidth) * inner;
    const y1 = point.y + Math.sin(angle - halfWidth) * inner;
    const x2 = point.x + Math.cos(angle) * outer;
    const y2 = point.y + Math.sin(angle) * outer;
    const x3 = point.x + Math.cos(angle + halfWidth) * inner;
    const y3 = point.y + Math.sin(angle + halfWidth) * inner;
    rays.push(`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} Z`);
  }
  const raysPath = svgElement("path");
  setAttributes(raysPath, { d: rays.join(" "), class: "emitter-rays" });
  group.append(raysPath);
  parent.append(group);
}

function blockerGlyph(parent: Element, point: BoardPoint, radius: number): void {
  const group = svgElement("g");
  group.setAttribute("class", "board-blocker");
  appendCircle(group, point, radius * 0.88, "blocker-body");
  const diamond = svgElement("path");
  const half = radius * 0.58;
  setAttributes(diamond, {
    d: `M ${point.x} ${point.y - half} L ${point.x + half} ${point.y} L ${point.x} ${point.y + half} L ${point.x - half} ${point.y} Z`,
    class: "blocker-mark",
  });
  group.append(diamond);
  parent.append(group);
}

function receiverGlyph(parent: Element, point: BoardPoint, slot: number, required: boolean, lit: boolean): void {
  const group = svgElement("g");
  group.setAttribute("data-receiver-slot", String(slot));
  group.setAttribute("aria-label", required ? `受光紋 ${slot + 1}${lit ? "（点灯）" : "（未点灯）"}` : `方向 ${slot + 1}`);
  group.setAttribute("class", required ? (lit ? "receiver receiver-required receiver-lit" : "receiver receiver-required") : "receiver receiver-idle");
  if (required) {
    appendCircle(group, point, 8, "receiver-ring");
    appendCircle(group, point, 4.2, "receiver-core");
    const cross = svgElement("path");
    setAttributes(cross, {
      d: `M ${point.x - 5} ${point.y} H ${point.x + 5} M ${point.x} ${point.y - 5} V ${point.y + 5}`,
      class: "receiver-cross",
    });
    group.append(cross);
  } else {
    appendCircle(group, point, 2.3, "receiver-idle-dot");
  }
  parent.append(group);
}

export type BoardSvgOptions = {
  selectedRing: number;
  disabled?: boolean;
  onSelectRing?: (ring: number) => void;
};

/** Create an accessible, self-contained board SVG from the core state. */
export function createBoardSvg(
  puzzle: Puzzle,
  state: BoardState,
  options: BoardSvgOptions,
): SVGSVGElement {
  assertRing(options.selectedRing);
  const model = createBoardRenderModel(puzzle, state);
  const svg = svgElement("svg");
  setAttributes(svg, {
    viewBox: `${BOARD_VIEWBOX.minX} ${BOARD_VIEWBOX.minY} ${BOARD_VIEWBOX.width} ${BOARD_VIEWBOX.height}`,
    role: "img",
    "aria-label": "石板の盤面。三本の環と十二方向の受光紋",
    class: "stone-board",
    focusable: "false",
  });
  if (options.disabled) svg.setAttribute("aria-disabled", "true");
  svg.setAttribute("data-rotation-mode", "immediate");
  svg.addEventListener("contextmenu", (event) => event.preventDefault());
  svg.addEventListener("dragstart", (event) => event.preventDefault());

  const defs = svgElement("defs");
  const filter = svgElement("filter");
  setAttributes(filter, {
    id: "beam-glow",
    x: "0",
    y: "0",
    width: String(BOARD_VIEWBOX.width),
    height: String(BOARD_VIEWBOX.height),
    filterUnits: "userSpaceOnUse",
  });
  const blur = svgElement("feGaussianBlur");
  setAttributes(blur, { stdDeviation: "2.3", result: "blur" });
  const merge = svgElement("feMerge");
  const mergeBlur = svgElement("feMergeNode");
  const mergeSource = svgElement("feMergeNode");
  setAttributes(mergeBlur, { in: "blur" });
  setAttributes(mergeSource, { in: "SourceGraphic" });
  merge.append(mergeBlur, mergeSource);
  filter.append(blur, merge);
  defs.append(filter);
  svg.append(defs);

  appendCircle(svg, BOARD_CENTER, OUTER_DISC_RADIUS, "board-disc");
  appendCircle(svg, BOARD_CENTER, OUTER_DISC_RADIUS - 4, "board-edge");
  const tickGroup = svgElement("g");
  tickGroup.setAttribute("class", "board-ticks");
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const from = polarPoint(OUTER_DISC_RADIUS - 2, slot);
    const to = polarPoint(117, slot);
    const line = svgElement("line");
    setAttributes(line, {
      x1: String(from.x), y1: String(from.y), x2: String(to.x), y2: String(to.y),
      class: slot % 3 === 0 ? "board-tick board-tick-major" : "board-tick",
    });
    tickGroup.append(line);
  }
  svg.append(tickGroup);

  const ringGroup = svgElement("g");
  ringGroup.setAttribute("class", "board-rings");
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    const [inner, outer] = RING_RADII[ring];
    const group = svgElement("g");
    setAttributes(group, {
      class: options.selectedRing === ring ? "board-ring board-ring-selected" : "board-ring",
      "data-ring": String(ring),
      "data-rotation": String(state.rotations[ring]),
    });
    const ringShape = svgElement("path");
    setAttributes(ringShape, { d: ringPath(inner, outer), class: "ring-surface" });
    group.append(ringShape);
    ringGroup.append(group);
  }
  svg.append(ringGroup);

  const centre = svgElement("g");
  centre.setAttribute("class", "board-centre");
  appendCircle(centre, BOARD_CENTER, 12, "centre-body");
  appendCircle(centre, BOARD_CENTER, 4, "centre-mark");
  svg.append(centre);

  const beamGroup = svgElement("g");
  beamGroup.setAttribute("class", "board-beams");
  for (const segment of model.beams) {
    const line = svgElement("line");
    setAttributes(line, {
      x1: String(segment.start.x), y1: String(segment.start.y),
      x2: String(segment.end.x), y2: String(segment.end.y),
      class: segment.reachedRim ? "beam beam-reached" : "beam beam-blocked",
      "data-beam": String(segment.beamIndex),
      "data-beam-index": String(segment.beamIndex),
      "data-phase": segment.tracePhase,
      "data-source-slot": String(segment.sourceSlot),
      "data-end-slot": String(segment.destinationSlot),
      "data-destination-slot": String(segment.destinationSlot),
    });
    line.setAttribute("filter", "url(#beam-glow)");
    beamGroup.append(line);
  }
  svg.append(beamGroup);

  const partsGroup = svgElement("g");
  partsGroup.setAttribute("class", "board-parts");
  for (const part of model.parts) {
    const partGroup = svgElement("g");
    const point = polarPoint(ringMidRadius(part.ring), part.slot);
    setAttributes(partGroup, {
      class: `board-part board-part-${part.kind}`,
      "data-ring": String(part.ring),
      "data-kind": part.kind,
      "data-slot": String(part.slot),
    });
    if (part.kind === "emitter") emitterGlyph(partGroup, point, 8.5);
    else blockerGlyph(partGroup, point, 8.5);
    partsGroup.append(partGroup);
  }
  svg.append(partsGroup);

  const stopGroup = svgElement("g");
  stopGroup.setAttribute("class", "beam-stops");
  for (const segment of model.beams) {
    if (segment.blockedRing === null || segment.blockedSlot === null) continue;
    const angle = slotAngle(segment.phase === "in" ? segment.sourceSlot : segment.destinationSlot);
    const dx = Math.sin(angle) * 5;
    const dy = -Math.cos(angle) * 5;
    const stop = svgElement("line");
    setAttributes(stop, {
      x1: String(segment.end.x - dx),
      y1: String(segment.end.y - dy),
      x2: String(segment.end.x + dx),
      y2: String(segment.end.y + dy),
      class: "beam-stop",
      "data-beam-stop": String(segment.beamIndex),
      "data-stop-slot": String(segment.blockedSlot),
      "data-stop-ring": String(segment.blockedRing),
    });
    stopGroup.append(stop);
  }
  svg.append(stopGroup);

  const receivers = svgElement("g");
  receivers.setAttribute("class", "board-receivers");
  const targetSet = new Set(model.targets);
  const litSet = new Set(model.light.litSlots);
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    receiverGlyph(receivers, polarPoint(RECEIVER_RADIUS, slot), slot, targetSet.has(slot), litSet.has(slot));
  }
  svg.append(receivers);

  const hitGroup = svgElement("g");
  hitGroup.setAttribute("class", "board-ring-hits");
  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    const [inner, outer] = RING_RADII[ring];
    const hit = svgElement("path");
    setAttributes(hit, {
      d: ringPath(inner, outer),
      class: "ring-hit",
      tabindex: "-1",
      "aria-hidden": "true",
      "aria-label": `${RING_LABELS[ring]}を選ぶ`,
      "aria-pressed": String(options.selectedRing === ring),
      "data-ring-hit": String(ring),
    });
    if (!options.disabled && options.onSelectRing) {
      hit.addEventListener("click", () => options.onSelectRing?.(ring));
      hit.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onSelectRing?.(ring);
        }
      });
    }
    hitGroup.append(hit);
  }
  svg.append(hitGroup);

  return svg;
}
