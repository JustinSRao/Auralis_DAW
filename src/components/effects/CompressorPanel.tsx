import React, { useEffect, useMemo, useState } from 'react';
import { useCompressorStore } from '../../stores/compressorStore';
import { useSidechainStore } from '../../stores/sidechainStore';
import { useMixerStore } from '../../stores/mixerStore';
import { Knob } from '../instruments/Knob';
import SidechainSourceSelector from './SidechainSourceSelector';
import SidechainHpfControl from './SidechainHpfControl';
import { PresetBar } from '../daw/PresetBar';
import { PresetBrowser } from '../daw/PresetBrowser';
import { usePresets } from '../../hooks/usePresets';
import type { PresetMeta } from '../../lib/ipc';

interface CompressorPanelProps {
  channelId: string;
  /** Effect slot ID — used to key sidechain routing. Defaults to "default". */
  slotId?: string;
}

function norm(v: number, min: number, max: number) { return Math.max(0, Math.min(1, (v - min) / (max - min))); }
function denorm(n: number, min: number, max: number) { return min + Math.max(0, Math.min(1, n)) * (max - min); }

const CompressorPanel: React.FC<CompressorPanelProps> = ({ channelId, slotId = 'default' }) => {
  const channel = useCompressorStore((s) => s.channels[channelId]);
  const loadChannel = useCompressorStore((s) => s.loadChannel);
  const setParam = useCompressorStore((s) => s.setParam);

  const scKey = `${channelId}::${slotId}`;
  const scSlot = useSidechainStore((s) => s.slots[scKey]);
  const setScSource = useSidechainStore((s) => s.setSource);
  const removeScSource = useSidechainStore((s) => s.removeSource);
  const setScFilter = useSidechainStore((s) => s.setFilter);

  const allMixerChannels = useMixerStore((s) => s.channels);
  const mixerChannels = useMemo(
    () =>
      Object.values(allMixerChannels)
        .filter((c) => c.id !== channelId)
        .map((c) => ({ id: c.id, name: c.name })),
    [allMixerChannels, channelId],
  );

  const hpfCutoff = scSlot?.hpfCutoffHz ?? 100;
  const hpfEnabled = scSlot?.hpfEnabled ?? true;
  const scSource = scSlot?.sourceChannelId ?? null;

  useEffect(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { captureAndSave, loadAndApply } = usePresets('compressor', channelId);

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
      <PresetBar
        presetType="compressor"
        currentPresetName={currentPresetName}
        onSave={(name) => { void handleSavePreset(name); }}
        onBrowse={() => setShowBrowser((v) => !v)}
      />
      {showBrowser && (
        <div className="absolute z-50">
          <PresetBrowser
            presetType="compressor"
            onLoad={(meta) => { void handleLoadPreset(meta); }}
            onClose={() => setShowBrowser(false)}
            channelId={channelId}
          />
        </div>
      )}
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

      <div className="compressor-panel__sidechain">
        <SidechainSourceSelector
          channels={mixerChannels}
          value={scSource}
          onSelect={(srcId) => setScSource(channelId, slotId, srcId, hpfCutoff, hpfEnabled)}
          onRemove={() => removeScSource(channelId, slotId)}
        />
        {scSource != null && (
          <SidechainHpfControl
            cutoffHz={hpfCutoff}
            enabled={hpfEnabled}
            onCutoffChange={(hz) => setScFilter(channelId, slotId, hz, hpfEnabled)}
            onEnabledChange={(en) => setScFilter(channelId, slotId, hpfCutoff, en)}
          />
        )}
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
