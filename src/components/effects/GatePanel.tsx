import React, { useEffect } from 'react';
import { useGateStore } from '../../stores/gateStore';
import { Knob } from '../instruments/Knob';

interface GatePanelProps {
  channelId: string;
}

function norm(v: number, min: number, max: number) { return Math.max(0, Math.min(1, (v - min) / (max - min))); }
function denorm(n: number, min: number, max: number) { return min + Math.max(0, Math.min(1, n)) * (max - min); }

const GatePanel: React.FC<GatePanelProps> = ({ channelId }) => {
  const channel = useGateStore((s) => s.channels[channelId]);
  const loadChannel = useGateStore((s) => s.loadChannel);
  const setParam = useGateStore((s) => s.setParam);

  useEffect(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  if (!channel) {
    return (
      <div className="gate-panel gate-panel--loading" aria-label="Gate panel loading">
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className="gate-panel" aria-label={`Gate panel for channel ${channelId}`}>
      <h3 className="gate-panel__title">Noise Gate</h3>

      <div className="gate-panel__knobs">
        <Knob label="Thresh" value={norm(channel.threshold_db, -80, 0)}
          onValue={(v) => setParam(channelId, 'threshold_db', denorm(v, -80, 0))}
          displayValue={`${channel.threshold_db.toFixed(0)}dB`} />
        <Knob label="Attack" value={norm(channel.attack_ms, 0.1, 100)}
          onValue={(v) => setParam(channelId, 'attack_ms', denorm(v, 0.1, 100))}
          displayValue={`${channel.attack_ms.toFixed(0)}ms`} />
        <Knob label="Hold" value={norm(channel.hold_ms, 0, 2000)}
          onValue={(v) => setParam(channelId, 'hold_ms', denorm(v, 0, 2000))}
          displayValue={`${channel.hold_ms.toFixed(0)}ms`} />
        <Knob label="Release" value={norm(channel.release_ms, 10, 4000)}
          onValue={(v) => setParam(channelId, 'release_ms', denorm(v, 10, 4000))}
          displayValue={`${channel.release_ms.toFixed(0)}ms`} />
        <Knob label="Range" value={norm(channel.range_db, -90, 0)}
          onValue={(v) => setParam(channelId, 'range_db', denorm(v, -90, 0))}
          displayValue={`${channel.range_db.toFixed(0)}dB`} />
      </div>
    </div>
  );
};

export default GatePanel;
