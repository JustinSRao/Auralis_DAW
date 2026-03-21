import React, { useCallback, useRef } from 'react';
import LevelMeter from './LevelMeter';
import { useMixerStore } from '../../stores/mixerStore';

interface Props {
  channelId: string;
}

const FADER_HEIGHT = 120; // px drag range for 0.0–2.0

const ChannelStrip = React.memo(function ChannelStrip({ channelId }: Props) {
  const channel = useMixerStore((s) => s.channels[channelId]);
  const buses = useMixerStore((s) => s.buses);
  const setFader = useMixerStore((s) => s.setChannelFader);
  const setPan = useMixerStore((s) => s.setChannelPan);
  const setMute = useMixerStore((s) => s.setChannelMute);
  const setSolo = useMixerStore((s) => s.setChannelSolo);
  const setSend = useMixerStore((s) => s.setChannelSend);

  const faderStartY = useRef<number | null>(null);
  const faderStartVal = useRef<number>(1.0);

  const onFaderPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    faderStartY.current = e.clientY;
    faderStartVal.current = channel?.fader ?? 1.0;
  }, [channel?.fader]);

  const onFaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (faderStartY.current === null) return;
    const delta = (faderStartY.current - e.clientY) / FADER_HEIGHT;
    const newVal = Math.max(0, Math.min(2.0, faderStartVal.current + delta * 2.0));
    setFader(channelId, newVal);
  }, [channelId, setFader]);

  const onFaderPointerUp = useCallback(() => {
    faderStartY.current = null;
  }, []);

  const panStartX = useRef<number | null>(null);
  const panStartVal = useRef<number>(0);

  const onPanPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    panStartX.current = e.clientX;
    panStartVal.current = channel?.pan ?? 0;
  }, [channel?.pan]);

  const onPanPointerMove = useCallback((e: React.PointerEvent) => {
    if (panStartX.current === null) return;
    const delta = (e.clientX - panStartX.current) / 60;
    const newVal = Math.max(-1.0, Math.min(1.0, panStartVal.current + delta));
    setPan(channelId, newVal);
  }, [channelId, setPan]);

  const onPanPointerUp = useCallback(() => { panStartX.current = null; }, []);

  if (!channel) return null;

  const faderPct = (channel.fader / 2.0) * 100;

  return (
    <div className="flex flex-col items-center gap-1 px-2 py-2 border-r border-gray-700 min-w-[60px] select-none">
      {/* Level meter */}
      <LevelMeter peakL={channel.peakL} peakR={channel.peakR} height={80} />

      {/* Fader */}
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

      {/* Fader value label */}
      <span className="text-[9px] text-gray-400">
        {channel.fader.toFixed(2)}
      </span>

      {/* Pan knob */}
      <div
        className="w-7 h-7 rounded-full bg-gray-600 border border-gray-500 cursor-ew-resize flex items-center justify-center"
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        title={`Pan: ${channel.pan.toFixed(2)}`}
      >
        <div
          className="w-0.5 h-2.5 bg-blue-300 rounded origin-bottom"
          style={{ transform: `rotate(${channel.pan * 135}deg)` }}
        />
      </div>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          className={`text-[9px] px-1 py-0.5 rounded font-bold ${channel.mute ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-gray-300'}`}
          onClick={() => setMute(channelId, !channel.mute)}
        >
          M
        </button>
        <button
          className={`text-[9px] px-1 py-0.5 rounded font-bold ${channel.solo ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-300'}`}
          onClick={() => setSolo(channelId, !channel.solo)}
        >
          S
        </button>
      </div>

      {/* Send knobs */}
      {buses.map((bus, idx) => (
        <div key={bus.id} className="flex flex-col items-center gap-0.5">
          <div
            className="w-5 h-5 rounded-full bg-gray-700 border border-gray-600 cursor-ew-resize"
            title={`${bus.name}: ${channel.sends[idx].toFixed(2)}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              (e.currentTarget as HTMLElement).dataset.startX = String(e.clientX);
              (e.currentTarget as HTMLElement).dataset.startVal = String(channel.sends[idx]);
            }}
            onPointerMove={(e) => {
              const startX = Number((e.currentTarget as HTMLElement).dataset.startX);
              const startVal = Number((e.currentTarget as HTMLElement).dataset.startVal);
              if (isNaN(startX)) return;
              const delta = (e.clientX - startX) / 60;
              const newVal = Math.max(0, Math.min(1.0, startVal + delta));
              setSend(channelId, idx, newVal);
            }}
            onPointerUp={(e) => {
              delete (e.currentTarget as HTMLElement).dataset.startX;
            }}
          />
          <span className="text-[8px] text-gray-500">{bus.name.slice(0, 3)}</span>
        </div>
      ))}

      {/* Channel name */}
      <span className="text-[10px] text-gray-300 truncate max-w-[52px] mt-1" title={channel.name}>
        {channel.name}
      </span>
    </div>
  );
});

export default ChannelStrip;
