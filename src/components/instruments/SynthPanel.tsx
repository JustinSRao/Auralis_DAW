import { useEffect, useRef, useState } from "react";
import { Knob } from "./Knob";
import { LfoPanel } from "./LfoPanel";
import { useSynthStore } from "../../stores/synthStore";
import { useAutomationStore } from "../../stores/automationStore";
import { useTransportStore } from "../../stores/transportStore";
import type { SynthParamName } from "../../lib/ipc";
import { PresetBar } from "../daw/PresetBar";
import { PresetBrowser } from "../daw/PresetBrowser";
import { usePresets } from "../../hooks/usePresets";

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** Maps a value from [inMin, inMax] to [0, 1] linearly. */
function normLinear(v: number, min: number, max: number): number {
  return (v - min) / (max - min);
}

/** Maps a normalised value to [min, max] linearly. */
function denormLinear(n: number, min: number, max: number): number {
  return min + n * (max - min);
}

/** Maps cutoff Hz [20, 20000] to [0,1] using a logarithmic scale. */
function normCutoff(hz: number): number {
  return (Math.log(hz) - Math.log(20)) / (Math.log(20000) - Math.log(20));
}

/** Maps [0,1] to cutoff Hz [20, 20000] using a logarithmic scale. */
function denormCutoff(n: number): number {
  return 20 * Math.exp(n * (Math.log(20000) - Math.log(20)));
}

// ─── Waveform selector ───────────────────────────────────────────────────────

const WAVEFORMS = ["SAW", "SQR", "SIN", "TRI"] as const;

interface WaveformSelectorProps {
  value: number; // 0–3 float
  onChange: (index: number) => void;
}

function WaveformSelector({ value, onChange }: WaveformSelectorProps) {
  const active = Math.round(value) % 4;
  return (
    <div className="flex gap-1">
      {WAVEFORMS.map((label, i) => (
        <button
          key={label}
          onClick={() => onChange(i)}
          className={[
            "px-2 py-0.5 text-[10px] font-mono rounded border",
            i === active
              ? "bg-[#5b8def] border-[#5b8def] text-white"
              : "bg-transparent border-[#4a4a4a] text-[#888888] hover:border-[#5b8def] hover:text-[#aaaaaa]",
          ].join(" ")}
          aria-pressed={i === active}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] text-[#666666] uppercase tracking-widest font-mono">
        {title}
      </span>
      <div className="flex gap-3 flex-wrap">{children}</div>
    </div>
  );
}

// ─── SynthPanel ───────────────────────────────────────────────────────────────

/**
 * Full synthesizer control panel.
 *
 * Mounts in the DAW layout as a bottom strip. Initialises the synth instrument
 * on first mount (idempotent — safe to call multiple times).
 *
 * All parameter values are stored normalised [0,1] in the knobs; denormalisation
 * happens at the IPC call site.
 */
export function SynthPanel() {
  const { params, isInitialized, isLoading, error, initialize, setParam } =
    useSynthStore();

  const recordEnabled = useAutomationStore((s) => s.recordEnabled);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Preset state ────────────────────────────────────────────────────────
  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { captureAndSave, loadAndApply } = usePresets('synth');

  useEffect(() => {
    if (!isInitialized && !isLoading) {
      void initialize();
    }
  }, [isInitialized, isLoading, initialize]);

  // 100 ms flush interval for automation record events
  useEffect(() => {
    if (recordEnabled) {
      flushIntervalRef.current = setInterval(() => {
        void useAutomationStore.getState().flushRecordBatch();
      }, 100);
    } else {
      if (flushIntervalRef.current !== null) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
    }
    return () => {
      if (flushIntervalRef.current !== null) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
    };
  }, [recordEnabled]);

  /** Wraps setParam with automation record event capture. */
  function setParamWithRecord(name: SynthParamName, value: number) {
    void setParam(name, value);
    const { recordEnabled: recOn, recordPatternId, pushRecordEvent } =
      useAutomationStore.getState();
    if (!recOn || !recordPatternId) return;
    const snap = useTransportStore.getState().snapshot;
    if (snap.state !== 'playing') return;
    const bpm = snap.bpm > 0 ? snap.bpm : 120;
    const samplesPerBeat = (60 / bpm) * 44100;
    const tick = Math.round((snap.position_samples / samplesPerBeat) * 480);
    pushRecordEvent({ parameterId: `synth.${name}`, value, tick });
  }

  // Wrapper that handles normalisation for a given parameter
  function knob(
    name: SynthParamName,
    label: string,
    norm: number,
    denorm: (n: number) => number,
    formatDisplay: (raw: number) => string,
    unit?: string,
    nativeMin?: number,
    nativeMax?: number,
  ) {
    return (
      <Knob
        key={name}
        label={label}
        value={norm}
        unit={unit}
        displayValue={formatDisplay(denorm(norm))}
        onValue={(n) => setParamWithRecord(name, denorm(n))}
        paramId={`synth.${name}`}
        minValue={nativeMin}
        maxValue={nativeMax}
      />
    );
  }

  const p = params;

  async function handleSavePreset(name: string) {
    await captureAndSave(name);
    setCurrentPresetName(name);
  }

  async function handleLoadPreset(meta: import('../../lib/ipc').PresetMeta) {
    const preset = await loadAndApply(meta);
    setCurrentPresetName(preset.name);
    // Refresh the store so the UI reflects the new param values
    await initialize();
    setShowBrowser(false);
  }

  return (
    <div className="flex flex-col bg-[#1e1e1e] border-t border-[#3a3a3a] flex-shrink-0">
      {/* Preset bar */}
      <PresetBar
        presetType="synth"
        currentPresetName={currentPresetName}
        onSave={(name) => { void handleSavePreset(name); }}
        onBrowse={() => setShowBrowser((v) => !v)}
      />

      {/* Inline preset browser (toggle) */}
      {showBrowser && (
        <div className="absolute z-50 mt-8">
          <PresetBrowser
            presetType="synth"
            onLoad={(meta) => { void handleLoadPreset(meta); }}
            onClose={() => setShowBrowser(false)}
          />
        </div>
      )}

      {/* Panel controls */}
      <div
        className="px-4 py-2 flex gap-6 items-start overflow-x-auto"
        style={{ minHeight: 100 }}
      >
      {/* Oscillator section */}
      <Section title="Oscillator">
        <div className="flex flex-col gap-2">
          <WaveformSelector
            value={p.waveform}
            onChange={(i) => void setParam("waveform", i)}
          />
          <div className="flex gap-3">
            {knob(
              "pulse_width",
              "PW",
              normLinear(p.pulse_width, 0.05, 0.95),
              (n) => denormLinear(n, 0.05, 0.95),
              (v) => `${Math.round(v * 100)}%`,
            )}
            {knob(
              "detune",
              "Detune",
              normLinear(p.detune, -100, 100),
              (n) => denormLinear(n, -100, 100),
              (v) => `${Math.round(v)}ct`,
            )}
          </div>
        </div>
      </Section>

      {/* Envelope section */}
      <Section title="Envelope">
        {knob(
          "attack",
          "Attack",
          normLinear(p.attack, 0.001, 4.0),
          (n) => denormLinear(n, 0.001, 4.0),
          (v) => `${v.toFixed(2)}s`,
          undefined,
          0.001,
          4.0,
        )}
        {knob(
          "decay",
          "Decay",
          normLinear(p.decay, 0.001, 4.0),
          (n) => denormLinear(n, 0.001, 4.0),
          (v) => `${v.toFixed(2)}s`,
          undefined,
          0.001,
          4.0,
        )}
        {knob(
          "sustain",
          "Sustain",
          p.sustain,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
          undefined,
          0,
          1,
        )}
        {knob(
          "release",
          "Release",
          normLinear(p.release, 0.001, 8.0),
          (n) => denormLinear(n, 0.001, 8.0),
          (v) => `${v.toFixed(2)}s`,
          undefined,
          0.001,
          8.0,
        )}
      </Section>

      {/* Filter section */}
      <Section title="Filter">
        {knob(
          "cutoff",
          "Cutoff",
          normCutoff(p.cutoff),
          denormCutoff,
          (v) => `${Math.round(v)}Hz`,
          undefined,
          20,
          20000,
        )}
        {knob(
          "resonance",
          "Res",
          p.resonance,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
        )}
        {knob(
          "env_amount",
          "Env",
          p.env_amount,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
        )}
      </Section>

      {/* Output section */}
      <Section title="Output">
        {knob(
          "volume",
          "Volume",
          p.volume,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
        )}
      </Section>

      {/* Status / error feedback */}
      {error && (
        <div className="flex items-center text-[10px] text-red-400 max-w-xs">
          {error}
        </div>
      )}
      {isLoading && (
        <div className="flex items-center text-[10px] text-[#888888]">
          Initialising...
        </div>
      )}

      {/* Automation record toggle */}
      <div className="flex flex-col gap-2 ml-auto flex-shrink-0">
        <span className="text-[9px] text-[#666666] uppercase tracking-widest font-mono">
          Automation
        </span>
        <button
          onClick={() => useAutomationStore.getState().setRecordEnabled(!recordEnabled)}
          className={[
            'px-2 py-0.5 text-[10px] font-mono rounded border',
            recordEnabled
              ? 'bg-red-700 border-red-600 text-white'
              : 'bg-transparent border-[#4a4a4a] text-[#888888] hover:border-red-500 hover:text-[#aaaaaa]',
          ].join(' ')}
          title={recordEnabled ? 'Stop recording automation' : 'Record automation'}
        >
          {recordEnabled ? '● REC' : '○ REC'}
        </button>
      </div>

      {/* LFO modulation section */}
      <LfoPanel slot={1} />
      <LfoPanel slot={2} />
    </div>
    </div>
  );
}
