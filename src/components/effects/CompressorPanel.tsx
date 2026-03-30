import React, { useEffect } from 'react';
import { useCompressorStore } from '../../stores/compressorStore';
import { Knob } from '../instruments/Knob';

interface CompressorPanelProps {
  channelId: string;
}

function norm(v: number, min: number, max: number) { return Math.max(0, Math.min(1, (v - min) / (max - min))); }
function denorm(n: number, min: number, max: number) { return min + Math.max(0, Math.min(1, n)) * (max - min); }

const CompressorPanel: React.FC<CompressorPanelProps> = ({ channelId }) => {
  const channel = useCompressorStore((s) => s.channels[channelId]);
  const loadChannel = useCompressorStore((s) => s.loadChannel);
  const setParam = useCompressorStore((s) => s.setParam);

  useEffect(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  if (!channel) {
    return (
      <div className="compressor-panel compressor-panel--loading" aria-label="Compressor panel loading">
        <span>Loading…</span>
      </div>
    );
  }

  const grPct = Math.min(100, (channel.gain_reduction_db / 30) * 100);

  return (
    <div className="compressor-panel" aria-label={`Compressor panel for channel ${channelId}`}>
      <h3 className="compressor-panel__title">Compressor</h3>

      <div className="compressor-panel__knobs">
        <Knob label="Thresh" value={norm(channel.threshold_db, -60, 0)}
          onValue={(v) => setParam(channelId, 'threshold_db', denorm(v, -60, 0))}
          displayValue={`${channel.threshold_db.toFixed(0)}dB`} />
        <Knob label="Ratio" value={norm(channel.ratio, 1, 20)}
          onValue={(v) => setParam(channelId, 'ratio', denorm(v, 1, 20))}
          displayValue={`${channel.ratio.toFixed(1)}:1`} />
        <Knob label="Attack" value={norm(channel.attack_ms, 0.1, 300)}
          onValue={(v) => setParam(channelId, 'attack_ms', denorm(v, 0.1, 300))}
          displayValue={`${channel.attack_ms.toFixed(0)}ms`} />
        <Knob label="Release" value={norm(channel.release_ms, 10, 3000)}
          onValue={(v) => setParam(channelId, 'release_ms', denorm(v, 10, 3000))}
          displayValue={`${channel.release_ms.toFixed(0)}ms`} />
        <Knob label="Knee" value={norm(channel.knee_db, 0, 12)}
          onValue={(v) => setParam(channelId, 'knee_db', denorm(v, 0, 12))}
          displayValue={`${channel.knee_db.toFixed(1)}dB`} />
        <Knob label="Makeup" value={norm(channel.makeup_db, -12, 24)}
          onValue={(v) => setParam(channelId, 'makeup_db', denorm(v, -12, 24))}
          displayValue={`${channel.makeup_db > 0 ? '+' : ''}${channel.makeup_db.toFixed(1)}dB`} />
      </div>

      <div className="compressor-panel__meter" aria-label="Gain reduction meter">
        <span className="compressor-panel__meter-label">GR</span>
        <div className="compressor-panel__meter-track">
          <div
            className="compressor-panel__meter-bar"
            style={{ height: `${grPct}%` }}
            aria-valuenow={channel.gain_reduction_db}
            aria-valuemin={0}
            aria-valuemax={30}
          />
        </div>
        <span className="compressor-panel__meter-value">
          {channel.gain_reduction_db > 0 ? `-${channel.gain_reduction_db.toFixed(1)}` : '0'}dB
        </span>
      </div>
    </div>
  );
};

export default CompressorPanel;
