import { RING_LABELS, SLOT_COUNT } from "../game/config.ts";
import { evaluate } from "../game/engine.ts";
import type { BoardState, Puzzle } from "../game/types.ts";

const CX = 100;
const CY = 100;
const RING_R: [number, number][] = [
  [26, 44],
  [48, 66],
  [70, 88],
];
const RECEIVER_R = 102;
const DISC_R = 118;

function slotAngle(slot: number): number {
  return -Math.PI / 2 + (slot * Math.PI * 2) / SLOT_COUNT;
}

function polar(r: number, slot: number, frac = 0): { x: number; y: number } {
  const a = slotAngle(slot + frac);
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

function donutPath(inner: number, outer: number): string {
  return [
    `M ${CX} ${CY - outer}`,
    `A ${outer} ${outer} 0 1 1 ${CX - 0.01} ${CY - outer}`,
    `L ${CX - 0.01} ${CY - inner}`,
    `A ${inner} ${inner} 0 1 0 ${CX} ${CY - inner}`,
    "Z",
  ].join(" ");
}

function SunGlyph({ x, y, r, on }: { x: number; y: number; r: number; on: boolean }) {
  const rays: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const inner = r * 0.42;
    const outer = r;
    const w = 0.22;
    const x1 = x + Math.cos(a - w) * inner;
    const y1 = y + Math.sin(a - w) * inner;
    const x2 = x + Math.cos(a) * outer;
    const y2 = y + Math.sin(a) * outer;
    const x3 = x + Math.cos(a + w) * inner;
    const y3 = y + Math.sin(a + w) * inner;
    rays.push(`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} Z`);
  }
  return (
    <g>
      <circle cx={x} cy={y} r={r * 0.38} className={on ? "fill-ember" : "fill-stone-2"} />
      <path d={rays.join(" ")} className={on ? "fill-ember" : "fill-ink-soft"} />
      <circle cx={x} cy={y} r={r * 0.16} className={on ? "fill-parchment" : "fill-muted"} />
    </g>
  );
}

function BlockerGlyph({ x, y, r }: { x: number; y: number; r: number }) {
  const t = r * 0.22;
  return (
    <g>
      <circle cx={x} cy={y} r={r * 0.92} className="fill-ink" />
      <rect
        x={x - r * 0.72}
        y={y - t / 2}
        width={r * 1.44}
        height={t}
        rx={t / 2}
        transform={`rotate(45 ${x} ${y})`}
        className="fill-muted"
      />
      <rect
        x={x - r * 0.72}
        y={y - t / 2}
        width={r * 1.44}
        height={t}
        rx={t / 2}
        transform={`rotate(-45 ${x} ${y})`}
        className="fill-muted"
      />
    </g>
  );
}

type Props = {
  puzzle: Puzzle;
  state: BoardState;
  displayRotations: [number, number, number];
  selectedRing: number;
  onSelectRing: (ring: number) => void;
  reducedMotion: boolean;
};

export function StoneBoard({
  puzzle,
  state,
  displayRotations,
  selectedRing,
  onSelectRing,
  reducedMotion,
}: Props) {
  const light = evaluate(puzzle, state);
  const targetSet = new Set(puzzle.targets);

  return (
    <svg
      viewBox="0 0 200 200"
      className="stone-board h-auto w-full max-h-[min(58dvh,420px)] select-none"
      role="img"
      aria-label="石板の盤面"
    >
      <defs>
        <radialGradient id="discFill" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="var(--color-stone-2)" />
          <stop offset="55%" stopColor="var(--color-stone)" />
          <stop offset="100%" stopColor="var(--color-ink)" />
        </radialGradient>
        <radialGradient id="beamGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-beam)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--color-ember)" stopOpacity="0.15" />
        </radialGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx={CX} cy={CY} r={DISC_R} fill="url(#discFill)" />
      <circle cx={CX} cy={CY} r={DISC_R - 3} className="fill-none stroke-edge" strokeWidth="1.2" />
      <circle cx={CX} cy={CY} r={DISC_R - 7} className="fill-none stroke-edge-soft" strokeWidth="0.6" />

      {Array.from({ length: SLOT_COUNT }, (_, slot) => {
        const a = polar(DISC_R - 2.5, slot);
        const b = polar(92, slot);
        return (
          <line
            key={`tick-${slot}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-edge-soft"
            strokeWidth={slot % 3 === 0 ? 1.1 : 0.5}
          />
        );
      })}

      {light.beams.map((beam, i) => {
        const srcR = (RING_R[beam.sourceRing][0] + RING_R[beam.sourceRing][1]) / 2;
        const start = polar(srcR, beam.sourceSlot);
        const endR = beam.reachedRim
          ? RECEIVER_R
          : beam.phase === "in" && beam.blockedRing !== null
            ? (RING_R[beam.blockedRing][0] + RING_R[beam.blockedRing][1]) / 2
            : beam.blockedRing !== null
              ? (RING_R[beam.blockedRing][0] + RING_R[beam.blockedRing][1]) / 2
              : RECEIVER_R;
        const far = polar(endR, beam.reachedRim || beam.phase === "out" ? beam.oppositeSlot : beam.sourceSlot);
        const inEnd = polar(12, beam.sourceSlot);
        const outStart = polar(12, beam.oppositeSlot);
        const opacity = beam.reachedRim ? 0.9 : 0.45;
        return (
          <g key={`beam-${i}`} filter="url(#glow)" opacity={opacity}>
            <line
              x1={start.x}
              y1={start.y}
              x2={inEnd.x}
              y2={inEnd.y}
              stroke="url(#beamGrad)"
              strokeWidth={beam.reachedRim ? 2.4 : 1.6}
              strokeLinecap="round"
            />
            {(beam.reachedRim || beam.phase === "out") && (
              <line
                x1={outStart.x}
                y1={outStart.y}
                x2={far.x}
                y2={far.y}
                stroke="url(#beamGrad)"
                strokeWidth={beam.reachedRim ? 2.4 : 1.6}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}

      {RING_R.map(([inner, outer], ring) => {
        const selected = selectedRing === ring;
        const deg = displayRotations[ring] * 30;
        return (
          <g key={`ring-${ring}`}>
            <path
              d={donutPath(inner, outer)}
              className={selected ? "fill-stone-3" : "fill-stone-2"}
              opacity={0.92}
            />
            <path
              d={donutPath(inner, outer)}
              className={selected ? "stroke-parchment" : "stroke-edge"}
              fill="none"
              strokeWidth={selected ? 1.8 : 0.9}
            />
            <g
              style={{
                transform: `rotate(${deg}deg)`,
                transformOrigin: "100px 100px",
                transition: reducedMotion ? "none" : "transform 120ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {puzzle.rings[ring].parts.map((part) => {
                const p = polar((inner + outer) / 2, part.slot);
                const emitting = part.kind === "emitter" && state.emissionEnabled[ring];
                return part.kind === "emitter" ? (
                  <SunGlyph
                    key={`${ring}-${part.kind}-${part.slot}`}
                    x={p.x}
                    y={p.y}
                    r={(outer - inner) * 0.38}
                    on={emitting}
                  />
                ) : (
                  <BlockerGlyph
                    key={`${ring}-${part.kind}-${part.slot}`}
                    x={p.x}
                    y={p.y}
                    r={(outer - inner) * 0.34}
                  />
                );
              })}
            </g>
            <path
              d={donutPath(inner, outer)}
              fill="transparent"
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.preventDefault();
                onSelectRing(ring);
              }}
              role="button"
              tabIndex={0}
              aria-label={`${RING_LABELS[ring]}を選ぶ`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRing(ring);
                }
              }}
            />
          </g>
        );
      })}

      {Array.from({ length: SLOT_COUNT }, (_, slot) => {
        const p = polar(RECEIVER_R, slot);
        const required = targetSet.has(slot);
        if (!required) {
          return (
            <circle
              key={`idle-${slot}`}
              cx={p.x}
              cy={p.y}
              r={2.1}
              className="fill-edge-soft"
            />
          );
        }
        const lit = light.litSlots.includes(slot);
        return (
          <g key={`recv-${slot}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={6.4}
              className={lit ? "fill-moss stroke-moss-bright" : "fill-stone-2 stroke-moss"}
              strokeWidth="1.3"
              filter={lit ? "url(#glow)" : undefined}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={3.1}
              className={lit ? "fill-moss-bright" : "fill-none stroke-moss"}
              strokeWidth="1.1"
            />
          </g>
        );
      })}

      <circle cx={CX} cy={CY} r={11} className="fill-ink stroke-ember" strokeWidth="1.4" />
      <circle cx={CX} cy={CY} r={4.2} className="fill-ember" />
    </svg>
  );
}
