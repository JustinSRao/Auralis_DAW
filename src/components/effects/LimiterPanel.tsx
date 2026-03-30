import React, { useEffect } from 'react';
import { useLimiterStore } from '../../stores/limiterStore';
import { Knob } from '../instruments/Knob';

interface LimiterPanelProps {
  channelId: string;
}

function norm(v: number, min: number, max: number) { return Math.max(0, Math.min(1, (v - min) / (max - min))); }
function denorm(n: number, min: number, max: number) { return min + Math.max(0, Math.min(1, n)) * (max - min); }

const LimiterPanel: React.FC<LimiterPanelProps> = ({ channelId }) => {
  const channel = useLimiterStore((s) => s.channels[channelId]);
  const loadChannel = useLimiterStore((s) => s.loadChannel);
  const setParam = useLimiterStore((s) => s.setParam);

  useEffect(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  if (!channel) {
    return (
      <div className="limiter-panel limiter-panel--loading" aria-label="Limiter panel loading">
        <span>Loading…</span>
      </div>
    );
  }

  const grPct = Math.min(100, (channel.gain_reduction_db / 12) * 100);

  return (
    <div className="limiter-panel" aria-label={`Limiter panel for channel ${channelId}`}>
      <h3 className="limiter-panel__title">Limiter</h3>

      <div className="limiter-panel__knobs">
        <Knob label="Ceiling" value={norm(channel.ceiling_db, -12, 0)}
          onValue={(v) => setParam(channelId, 'ceiling_db', denorm(v, -12, 0))}
          displayValue={`${channel.ceiling_db.toFixed(1)}dB`} />
        <Knob label="Release" value={norm(channel.release_ms, 1, 1000)}
          onValue={(v) => setParam(channelId, 'release_ms', denorm(v, 1, 1000))}
          displayValue={`${channel.release_ms.toFixed(0)}ms`} />
      </div>

      <div className="limiter-panel__meter" aria-label="Limiter gain reduction meter">
        <span className="limiter-panel__meter-label">GR</span>
        <div className="limiter-panel__meter-track">
          <div
            className="limiter-panel__meter-bar"
            style={{ height: `${grPct}%` }}
            aria-valuenow={channel.gain_reduction_db}
            aria-valuemin={0}
            aria-valuemax={12}
          />
        </div>
        <span className="limiter-panel__meter-value">
          {channel.gain_reduction_db > 0 ? `-${channel.gain_reduction_db.toFixed(1)}` : '0'}dB
        </span>
      </div>
    </div>
  );
};

export default LimiterPanel;
