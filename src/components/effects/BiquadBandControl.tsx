import React, { useCallback, useRef } from 'react';
import type { EqBandParams, FilterType } from '../../lib/ipc';
import { BAND_COLORS } from './eqCanvas';

interface Props {
  bandIndex: number;
  params: EqBandParams;
  onChange: (bandIndex: number, params: EqBandParams) => void;
  onEnableToggle: (bandIndex: number, enabled: boolean) => void;
}

const FILTER_LABELS: Record<FilterType, string> = {
  bypass:     'BYP',
  high_pass:  'HP',
  low_pass:   'LP',
  low_shelf:  'LS',
  high_shelf: 'HS',
  peaking:    'PK',
};

/** Drag-knob: returns a delta [-1, +1] per 100 px of vertical drag. */
function useKnobDrag(
  getValue: () => number,
  setValue: (v: number) => void,
  min: number,
  max: number,
  sensitivity = 100,
) {
  const startY = useRef<number | null>(null);
  const startVal = useRef<number>(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startVal.current = getValue();
  }, [getValue]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null) return;
    const delta = (startY.current - e.clientY) / sensitivity;
    const newVal = Math.max(min, Math.min(max, startVal.current + delta * (max - min)));
    setValue(newVal);
  }, [setValue, min, max, sensitivity]);

  const onPointerUp = useCallback(() => { startY.current = null; }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}

const BiquadBandControl = React.memo(function BiquadBandControl({
  bandIndex,
  params,
  onChange,
  onEnableToggle,
}: Props) {
  const color = BAND_COLORS[bandIndex];

  // ── Frequency knob (log scale, 20–20000 Hz) ────────────────────────────────
  const freqHandlers = useKnobDrag(
    () => Math.log10(params.frequency),
    (logVal) => {
      const freq = Math.pow(10, logVal);
      onChange(bandIndex, { ...params, frequency: Math.round(freq * 10) / 10 });
    },
    Math.log10(20),
    Math.log10(20000),
    120,
  );

  // ── Gain knob (−18 to +18 dB) ─────────────────────────────────────────────
  const gainHandlers = useKnobDrag(
    () => params.gain_db,
    (v) => onChange(bandIndex, { ...params, gain_db: Math.round(v * 10) / 10 }),
    -18,
    18,
    100,
  );

  // ── Q knob (0.1–10) ───────────────────────────────────────────────────────
  const qHandlers = useKnobDrag(
    () => params.q,
    (v) => onChange(bandIndex, { ...params, q: Math.round(v * 100) / 100 }),
    0.1,
    10,
    100,
  );

  const showGain = params.filter_type !== 'bypass' &&
    params.filter_type !== 'low_pass' &&
    params.filter_type !== 'high_pass';
  const showQ = params.filter_type === 'peaking';

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 border-r border-gray-700 min-w-[88px]"
      style={{ opacity: params.enabled ? 1 : 0.45 }}
    >
      {/* Band index + colour swatch */}
      <div className="flex flex-col items-center gap-0.5">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-label={`band ${bandIndex} color`}
        />
        <span className="text-[8px] text-gray-500">{bandIndex + 1}</span>
      </div>

      {/* Enable toggle */}
      <button
        className={`text-[9px] px-1 py-0.5 rounded font-bold ${params.enabled ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
        onClick={() => onEnableToggle(bandIndex, !params.enabled)}
        aria-label={params.enabled ? 'disable band' : 'enable band'}
        aria-pressed={params.enabled}
      >
        {FILTER_LABELS[params.filter_type]}
      </button>

      {/* Frequency knob */}
      <div className="flex flex-col items-center gap-0.5">
        <div
          className="w-6 h-6 rounded-full bg-gray-700 border border-gray-600 cursor-ns-resize flex items-center justify-center select-none"
          aria-label="frequency knob"
          {...freqHandlers}
        >
          <div
            className="w-0.5 h-2.5 rounded origin-bottom"
            style={{
              backgroundColor: color,
              transform: `rotate(${((Math.log10(params.frequency) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * 270 - 135}deg)`,
            }}
          />
        </div>
        <span className="text-[8px] text-gray-400 w-10 text-center">
          {params.frequency >= 1000
            ? `${(params.frequency / 1000).toFixed(1)}k`
            : `${Math.round(params.frequency)}`}
        </span>
      </div>

      {/* Gain knob — only for shelf and peaking */}
      {showGain && (
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="w-6 h-6 rounded-full bg-gray-700 border border-gray-600 cursor-ns-resize flex items-center justify-center select-none"
            aria-label="gain knob"
            {...gainHandlers}
          >
            <div
              className="w-0.5 h-2.5 rounded origin-bottom"
              style={{
                backgroundColor: color,
                transform: `rotate(${(params.gain_db / 18) * 135}deg)`,
              }}
            />
          </div>
          <span className="text-[8px] text-gray-400 w-8 text-center">
            {params.gain_db > 0 ? `+${params.gain_db.toFixed(1)}` : params.gain_db.toFixed(1)}
          </span>
        </div>
      )}

      {/* Q knob — only for peaking */}
      {showQ && (
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="w-6 h-6 rounded-full bg-gray-700 border border-gray-600 cursor-ns-resize flex items-center justify-center select-none"
            aria-label="Q knob"
            {...qHandlers}
          >
            <div
              className="w-0.5 h-2.5 rounded origin-bottom"
              style={{
                backgroundColor: color,
                transform: `rotate(${((params.q - 0.1) / 9.9) * 270 - 135}deg)`,
              }}
            />
          </div>
          <span className="text-[8px] text-gray-400 w-6 text-center">
            {params.q.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
});

export default BiquadBandControl;
