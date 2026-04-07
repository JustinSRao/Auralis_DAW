import React, { useEffect, useState } from 'react';
import { useReverbStore } from '../../stores/reverbStore';
import { Knob } from '../instruments/Knob';
import { PresetBar } from '../daw/PresetBar';
import { PresetBrowser } from '../daw/PresetBrowser';
import { usePresets } from '../../hooks/usePresets';
import type { PresetMeta } from '../../lib/ipc';

interface ReverbPanelProps {
  channelId: string;
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

function norm(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function denorm(n: number, min: number, max: number): number {
  return min + Math.max(0, Math.min(1, n)) * (max - min);
}

// ─── ReverbPanel ──────────────────────────────────────────────────────────────

const ReverbPanel: React.FC<ReverbPanelProps> = ({ channelId }) => {
  const channel = useReverbStore((s) => s.channels[channelId]);
  const loadChannel = useReverbStore((s) => s.loadChannel);
  const setParam = useReverbStore((s) => s.setParam);

  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { captureAndSave, loadAndApply } = usePresets('reverb', channelId);

  async function handleSavePreset(name: string) {
    await captureAndSave(name);
    setCurrentPresetName(name);
  }

  async function handleLoadPreset(meta: PresetMeta) {
    const preset = await loadAndApply(meta);
    setCurrentPresetName(preset.name);
    loadChannel(channelId);
    setShowBrowser(false);
  }

  useEffect(() => {
    loadChannel(channelId);
  }, [channelId, loadChannel]);

  if (!channel) {
    return (
      <div className="reverb-panel reverb-panel--loading" aria-label="Reverb panel loading">
        <span className="reverb-panel__loading-text">Loading…</span>
      </div>
    );
  }

  return (
    <div className="reverb-panel" aria-label={`Reverb panel for channel ${channelId}`}>
      <PresetBar
        presetType="reverb"
        currentPresetName={currentPresetName}
        onSave={(name) => { void handleSavePreset(name); }}
        onBrowse={() => setShowBrowser((v) => !v)}
      />
      {showBrowser && (
        <div className="absolute z-50">
          <PresetBrowser
            presetType="reverb"
            onLoad={(meta) => { void handleLoadPreset(meta); }}
            onClose={() => setShowBrowser(false)}
            channelId={channelId}
          />
        </div>
      )}
      <h3 className="reverb-panel__title">Reverb</h3>
      <div className="reverb-panel__knobs">
        <Knob
          label="Room"
          value={norm(channel.room_size, 0, 1)}
          onValue={(v) => setParam(channelId, 'room_size', denorm(v, 0, 1))}
          displayValue={`${(channel.room_size * 100).toFixed(0)}%`}
        />
        <Knob
          label="Decay"
          value={norm(channel.decay, 0.1, 10)}
          onValue={(v) => setParam(channelId, 'decay', denorm(v, 0.1, 10))}
          displayValue={`${channel.decay.toFixed(1)}s`}
        />
        <Knob
          label="Pre-Dly"
          value={norm(channel.pre_delay_ms, 0, 100)}
          onValue={(v) => setParam(channelId, 'pre_delay_ms', denorm(v, 0, 100))}
          displayValue={`${channel.pre_delay_ms.toFixed(0)}ms`}
        />
        <Knob
          label="Damp"
          value={norm(channel.damping, 0, 1)}
          onValue={(v) => setParam(channelId, 'damping', denorm(v, 0, 1))}
          displayValue={`${(channel.damping * 100).toFixed(0)}%`}
        />
        <Knob
          label="Width"
          value={norm(channel.width, 0, 1)}
          onValue={(v) => setParam(channelId, 'width', denorm(v, 0, 1))}
          displayValue={`${(channel.width * 100).toFixed(0)}%`}
        />
        <Knob
          label="Wet"
          value={norm(channel.wet, 0, 1)}
          onValue={(v) => setParam(channelId, 'wet', denorm(v, 0, 1))}
          displayValue={`${(channel.wet * 100).toFixed(0)}%`}
        />
      </div>
    </div>
  );
};

export default ReverbPanel;
