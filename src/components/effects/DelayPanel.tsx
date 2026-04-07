import React, { useEffect, useState } from 'react';
import { useDelayStore } from '../../stores/delayStore';
import { useTempoMapStore } from '../../stores/tempoMapStore';
import { Knob } from '../instruments/Knob';
import type { NoteDivision, PresetMeta } from '../../lib/ipc';
import { PresetBar } from '../daw/PresetBar';
import { PresetBrowser } from '../daw/PresetBrowser';
import { usePresets } from '../../hooks/usePresets';

interface DelayPanelProps {
  channelId: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_DIVISIONS: { label: string; value: NoteDivision }[] = [
  { label: '1/1',  value: 'whole' },
  { label: '1/2',  value: 'half' },
  { label: '1/4',  value: 'quarter' },
  { label: '1/8',  value: 'eighth' },
  { label: '1/16', value: 'sixteenth' },
  { label: '1/32', value: 'thirty_second' },
];

const NOTE_DIV_BEATS: Record<NoteDivision, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirty_second: 0.125,
};

// ─── Normalisation helpers ────────────────────────────────────────────────────

function norm(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function denorm(n: number, min: number, max: number): number {
  return min + Math.max(0, Math.min(1, n)) * (max - min);
}

/** Converts a note division to milliseconds at the given BPM. */
function divToMs(div: NoteDivision, bpm: number): number {
  return (60000 / bpm) * NOTE_DIV_BEATS[div];
}

// ─── DelayPanel ───────────────────────────────────────────────────────────────

const DelayPanel: React.FC<DelayPanelProps> = ({ channelId }) => {
  const channel = useDelayStore((s) => s.channels[channelId]);
  const loadChannel = useDelayStore((s) => s.loadChannel);
  const setParam = useDelayStore((s) => s.setParam);
  const setDelayMode = useDelayStore((s) => s.setDelayMode);
  const setPingPong = useDelayStore((s) => s.setPingPong);

  const bpm = useTempoMapStore((s) => (s.points.length > 0 ? s.points[0].bpm : 120));

  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { captureAndSave, loadAndApply } = usePresets('delay', channelId);

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
      <div className="delay-panel delay-panel--loading" aria-label="Delay panel loading">
        <span className="delay-panel__loading-text">Loading…</span>
      </div>
    );
  }

  const isSyncMode = channel.delay_mode.mode === 'sync';
  const currentDiv = isSyncMode ? (channel.delay_mode as { mode: 'sync'; div: NoteDivision }).div : 'quarter';
  const currentMs = isSyncMode
    ? divToMs(currentDiv, bpm)
    : (channel.delay_mode as { mode: 'ms'; ms: number }).ms;

  const handleModeToggle = () => {
    if (isSyncMode) {
      setDelayMode(channelId, { mode: 'ms', ms: currentMs }, bpm);
    } else {
      setDelayMode(channelId, { mode: 'sync', div: 'quarter' }, bpm);
    }
  };

  const handleDivChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const div = e.target.value as NoteDivision;
    setDelayMode(channelId, { mode: 'sync', div }, bpm);
  };

  return (
    <div className="delay-panel" aria-label={`Delay panel for channel ${channelId}`}>
      <PresetBar
        presetType="delay"
        currentPresetName={currentPresetName}
        onSave={(name) => { void handleSavePreset(name); }}
        onBrowse={() => setShowBrowser((v) => !v)}
      />
      {showBrowser && (
        <div className="absolute z-50">
          <PresetBrowser
            presetType="delay"
            onLoad={(meta) => { void handleLoadPreset(meta); }}
            onClose={() => setShowBrowser(false)}
            channelId={channelId}
          />
        </div>
      )}
      <h3 className="delay-panel__title">Delay</h3>

      <div className="delay-panel__time-row">
        <button
          className={`delay-panel__mode-btn ${isSyncMode ? 'delay-panel__mode-btn--active' : ''}`}
          onClick={handleModeToggle}
          aria-pressed={isSyncMode}
          title="Toggle between free ms and tempo-sync mode"
        >
          {isSyncMode ? 'Sync' : 'ms'}
        </button>

        {isSyncMode ? (
          <>
            <select
              className="delay-panel__div-select"
              value={currentDiv}
              onChange={handleDivChange}
              aria-label="Note division"
            >
              {NOTE_DIVISIONS.map(({ label, value }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="delay-panel__ms-display" aria-label="Computed delay in ms">
              {currentMs.toFixed(0)}ms
            </span>
          </>
        ) : (
          <Knob
            label="Time"
            value={norm(currentMs, 1, 2000)}
            onValue={(v) => setParam(channelId, 'delay_ms', denorm(v, 1, 2000))}
            displayValue={`${currentMs.toFixed(0)}ms`}
          />
        )}
      </div>

      <div className="delay-panel__knobs">
        <Knob
          label="Feedback"
          value={norm(channel.feedback, 0, 0.99)}
          onValue={(v) => setParam(channelId, 'feedback', denorm(v, 0, 0.99))}
          displayValue={`${(channel.feedback * 100).toFixed(0)}%`}
        />
        <Knob
          label="Hi-Cut"
          value={norm(channel.hicut_hz, 500, 20000)}
          onValue={(v) => setParam(channelId, 'hicut_hz', denorm(v, 500, 20000))}
          displayValue={`${(channel.hicut_hz / 1000).toFixed(1)}kHz`}
        />
        <Knob
          label="Wet"
          value={norm(channel.wet, 0, 1)}
          onValue={(v) => setParam(channelId, 'wet', denorm(v, 0, 1))}
          displayValue={`${(channel.wet * 100).toFixed(0)}%`}
        />
      </div>

      <div className="delay-panel__toggle-row">
        <label className="delay-panel__ping-pong-label">
          <input
            type="checkbox"
            checked={channel.ping_pong}
            onChange={(e) => setPingPong(channelId, e.target.checked)}
            aria-label="Ping-pong mode"
          />
          Ping-Pong
        </label>
      </div>
    </div>
  );
};

export default DelayPanel;
