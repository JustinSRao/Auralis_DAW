import React, { useCallback, useRef } from 'react';
import LevelMeter from './LevelMeter';
import { useMixerStore } from '../../stores/mixerStore';

const FADER_HEIGHT = 120;

export default function MasterStrip() {
  const masterFader = useMixerStore((s) => s.masterFader);
  const masterPeakL = useMixerStore((s) => s.masterPeakL);
  const masterPeakR = useMixerStore((s) => s.masterPeakR);
  const setMasterFader = useMixerStore((s) => s.setMasterFader);

  const faderStartY = useRef<number | null>(null);
  const faderStartVal = useRef<number>(1.0);

  const onFaderPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    faderStartY.current = e.clientY;
    faderStartVal.current = masterFader;
  }, [masterFader]);

  const onFaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (faderStartY.current === null) return;
    const delta = (faderStartY.current - e.clientY) / FADER_HEIGHT;
    const newVal = Math.max(0, Math.min(2.0, faderStartVal.current + delta * 2.0));
    setMasterFader(newVal);
  }, [setMasterFader]);

  const onFaderPointerUp = useCallback(() => { faderStartY.current = null; }, []);

  const faderPct = (masterFader / 2.0) * 100;

  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2 border-l-2 border-blue-500 min-w-[64px] bg-gray-800 select-none">
      <LevelMeter peakL={masterPeakL} peakR={masterPeakR} height={80} />

      <div
        className="relative w-4 bg-gray-700 rounded cursor-ns-resize"
        style={{ height: FADER_HEIGHT }}
        onPointerDown={onFaderPointerDown}
        onPointerMove={onFaderPointerMove}
        onPointerUp={onFaderPointerUp}
      >
        <div
          className="absolute left-0 right-0 h-1 bg-blue-400 rounded"
          style={{ bottom: `${faderPct}%` }}
        />
      </div>

      <span className="text-[9px] text-gray-400">{masterFader.toFixed(2)}</span>

      <span className="text-[10px] text-blue-300 font-bold mt-1">MASTER</span>
    </div>
  );
}
