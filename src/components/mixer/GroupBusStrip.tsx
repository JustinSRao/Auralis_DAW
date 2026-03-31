import React, { useCallback, useRef } from 'react';
import LevelMeter from './LevelMeter';
import OutputSelector from './OutputSelector';
import { useMixerStore } from '../../stores/mixerStore';

interface Props {
  busId: number;
}

const FADER_HEIGHT = 120; // px drag range for 0.0–2.0

const GroupBusStrip = React.memo(function GroupBusStrip({ busId }: Props) {
  const gb = useMixerStore((s) => s.groupBuses.find((b) => b.id === busId));
  const setFader = useMixerStore((s) => s.setGroupBusFader);
  const setPan = useMixerStore((s) => s.setGroupBusPan);
  const setMute = useMixerStore((s) => s.setGroupBusMute);
  const setSolo = useMixerStore((s) => s.setGroupBusSolo);
  const setOutput = useMixerStore((s) => s.setGroupBusOutput);

  const faderStartY = useRef<number | null>(null);
  const faderStartVal = useRef<number>(1.0);

  const onFaderPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    faderStartY.current = e.clientY;
    faderStartVal.current = gb?.fader ?? 1.0;
  }, [gb?.fader]);

  const onFaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (faderStartY.current === null) return;
    const delta = (faderStartY.current - e.clientY) / FADER_HEIGHT;
    const newVal = Math.max(0, Math.min(2.0, faderStartVal.current + delta * 2.0));
    setFader(busId, newVal);
  }, [busId, setFader]);

  const onFaderPointerUp = useCallback(() => {
    faderStartY.current = null;
  }, []);

  const panStartX = useRef<number | null>(null);
  const panStartVal = useRef<number>(0);

  const onPanPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    panStartX.current = e.clientX;
    panStartVal.current = gb?.pan ?? 0;
  }, [gb?.pan]);

  const onPanPointerMove = useCallback((e: React.PointerEvent) => {
    if (panStartX.current === null) return;
    const delta = (e.clientX - panStartX.current) / 60;
    const newVal = Math.max(-1.0, Math.min(1.0, panStartVal.current + delta));
    setPan(busId, newVal);
  }, [busId, setPan]);

  const onPanPointerUp = useCallback(() => { panStartX.current = null; }, []);

  if (!gb) return null;

  const faderPct = (gb.fader / 2.0) * 100;

  return (
    <div className="flex flex-col items-center gap-1 px-2 py-2 border-r border-purple-900 bg-neutral-900 min-w-[64px] select-none">
      {/* Group bus label */}
      <span className="text-[8px] text-purple-400 font-semibold uppercase tracking-wide">GRP</span>

      {/* Level meter */}
      <LevelMeter peakL={gb.peakL} peakR={gb.peakR} height={80} />

      {/* Fader */}
      <div
        className="relative w-4 bg-gray-700 rounded cursor-ns-resize"
        style={{ height: FADER_HEIGHT }}
        onPointerDown={onFaderPointerDown}
        onPointerMove={onFaderPointerMove}
        onPointerUp={onFaderPointerUp}
      >
        <div
          className="absolute left-0 right-0 h-1 bg-purple-400 rounded"
          style={{ bottom: `${faderPct}%` }}
        />
      </div>

      {/* Fader value label */}
      <span className="text-[9px] text-gray-400">
        {gb.fader.toFixed(2)}
      </span>

      {/* Pan knob */}
      <div
        className="w-7 h-7 rounded-full bg-gray-600 border border-gray-500 cursor-ew-resize flex items-center justify-center"
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        title={`Pan: ${gb.pan.toFixed(2)}`}
      >
        <div
          className="w-0.5 h-2.5 bg-purple-300 rounded origin-bottom"
          style={{ transform: `rotate(${gb.pan * 135}deg)` }}
        />
      </div>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          className={`text-[9px] px-1 py-0.5 rounded font-bold ${gb.mute ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-gray-300'}`}
          onClick={() => setMute(busId, !gb.mute)}
        >
          M
        </button>
        <button
          className={`text-[9px] px-1 py-0.5 rounded font-bold ${gb.solo ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-300'}`}
          onClick={() => setSolo(busId, !gb.solo)}
        >
          S
        </button>
      </div>

      {/* Output routing */}
      <div className="w-full mt-1">
        <OutputSelector
          value={gb.outputTarget}
          onChange={(target) => void setOutput(busId, target)}
          excludeBusId={busId}
        />
      </div>

      {/* Bus name */}
      <span className="text-[10px] text-purple-300 truncate max-w-[52px] mt-0.5" title={gb.name}>
        {gb.name}
      </span>
    </div>
  );
});

export default GroupBusStrip;
