import { useRef, useCallback } from "react";

interface KnobProps {
  /** Human-readable label displayed below the knob. */
  label: string;
  /** Normalised value in [0.0, 1.0]. */
  value: number;
  /** Called with the new normalised value whenever the user drags. */
  onValue: (v: number) => void;
  /** Optional display unit suffix, e.g. "Hz", "s", "%". */
  unit?: string;
  /** Display value override. When provided, shown instead of the raw normalised value. */
  displayValue?: string;
}

/** Total sweep angle of the knob arc in degrees (−135° to +135°). */
const SWEEP_DEG = 270;
/** Start angle relative to the bottom of the circle (pointing down = 0°). */
const START_DEG = -135;

/** Converts a normalised value [0,1] to a rotation angle in degrees. */
function valueToAngle(v: number): number {
  return START_DEG + v * SWEEP_DEG;
}

/** Converts polar coordinates to Cartesian, for SVG arc drawing. */
function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Builds an SVG arc path string. */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const [sx, sy] = polarToCartesian(cx, cy, r, startAngle);
  const [ex, ey] = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

/**
 * SVG rotary knob with a 270° sweep.
 *
 * Dragging upward increases the value; dragging downward decreases it.
 * Uses `setPointerCapture` for reliable cross-platform drag handling.
 */
export function Knob({
  label,
  value,
  onValue,
  unit,
  displayValue,
}: KnobProps) {
  const SIZE = 48;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const TRACK_R = 18;
  const INDICATOR_R = 12;
  const STROKE = 3;

  const dragStartY = useRef<number | null>(null);
  const dragStartValue = useRef<number>(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartY.current = e.clientY;
      dragStartValue.current = value;
    },
    [value],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragStartY.current === null) return;
      // 200px drag = full range sweep
      const delta = (dragStartY.current - e.clientY) / 200;
      const next = Math.max(0, Math.min(1, dragStartValue.current + delta));
      onValue(next);
    },
    [onValue],
  );

  const handlePointerUp = useCallback(() => {
    dragStartY.current = null;
  }, []);

  const angle = valueToAngle(value);
  const trackStart = START_DEG;
  const trackEnd = START_DEG + SWEEP_DEG;

  const [indX, indY] = polarToCartesian(CX, CY, INDICATOR_R, angle);

  // Formatted display value
  const formattedValue =
    displayValue ?? (unit ? `${value.toFixed(2)}${unit}` : value.toFixed(2));

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <svg
        width={SIZE}
        height={SIZE}
        className="cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label={`${label} knob`}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
      >
        {/* Background track arc */}
        <path
          d={describeArc(CX, CY, TRACK_R, trackStart, trackEnd)}
          stroke="#3a3a3a"
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
        />

        {/* Value arc (filled portion) */}
        {value > 0 && (
          <path
            d={describeArc(CX, CY, TRACK_R, trackStart, angle)}
            stroke="#5b8def"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Center circle (knob body) */}
        <circle cx={CX} cy={CY} r={10} fill="#2e2e2e" />

        {/* Indicator dot */}
        <circle cx={indX} cy={indY} r={2} fill="#5b8def" />
      </svg>

      {/* Numeric value */}
      <span className="text-[9px] text-[#888888] font-mono leading-none">
        {formattedValue}
      </span>

      {/* Label */}
      <span className="text-[9px] text-[#aaaaaa] leading-none">{label}</span>
    </div>
  );
}
