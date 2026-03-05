import { useEffect } from "react";
import { Knob } from "./Knob";
import { useLfoStore } from "../../stores/lfoStore";
import type { LfoParamName } from "../../lib/ipc";

// ─── Constants ────────────────────────────────────────────────────────────────

const WAVEFORM_LABELS = ["SINE", "TRI", "SAW\u2191", "SAW\u2193", "SQR", "S&H"] as const;
const DESTINATION_LABELS = ["CUTOFF", "PITCH", "AMP", "RES"] as const;
const DIVISION_LABELS = ["1/4", "1/8", "1/16", "1/32"] as const;

// ─── Helper: normalise rate logarithmically [0.01, 20.0] → [0, 1] ─────────────

const RATE_MIN = 0.01;
const RATE_MAX = 20.0;
const LOG_RATE_MIN = Math.log(RATE_MIN);
const LOG_RATE_MAX = Math.log(RATE_MAX);

function normRate(hz: number): number {
  return (Math.log(Math.max(RATE_MIN, hz)) - LOG_RATE_MIN) / (LOG_RATE_MAX - LOG_RATE_MIN);
}

function denormRate(n: number): number {
  return Math.exp(LOG_RATE_MIN + n * (LOG_RATE_MAX - LOG_RATE_MIN));
}

// ─── Shared button style helper ───────────────────────────────────────────────

function buttonClass(active: boolean): string {
  return [
    "px-2 py-0.5 text-[10px] font-mono rounded border",
    active
      ? "bg-[#5b8def] border-[#5b8def] text-white"
      : "bg-transparent border-[#4a4a4a] text-[#888888] hover:border-[#5b8def] hover:text-[#aaaaaa]",
  ].join(" ");
}

// ─── LfoPanel ─────────────────────────────────────────────────────────────────

interface LfoPanelProps {
  /** Which LFO slot this panel controls (1 or 2). */
  slot: 1 | 2;
}

/**
 * Control panel for a single LFO slot.
 *
 * Renders waveform selector, destination selector, rate/depth knobs,
 * BPM-sync toggle, phase-reset toggle, and (when synced) a beat-division
 * selector. Connects directly to `useLfoStore`.
 */
export function LfoPanel({ slot }: LfoPanelProps) {
  const { lfo1, lfo2, setLfoParam, fetchLfoState } = useLfoStore();
  const params = slot === 1 ? lfo1 : lfo2;

  // Sync with backend once on mount — only slot 1 fetches to avoid double IPC calls
  // when both LfoPanel instances mount simultaneously inside SynthPanel.
  useEffect(() => {
    if (slot === 1) {
      void fetchLfoState();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function set(name: LfoParamName, value: number) {
    void setLfoParam(slot, name, value);
  }

  const activeWaveform = Math.round(params.waveform) % WAVEFORM_LABELS.length;
  const activeDest = Math.round(params.destination) % DESTINATION_LABELS.length;
  const activeDiv = Math.round(params.division) % DIVISION_LABELS.length;
  const bpmSynced = params.bpm_sync >= 0.5;
  const phaseReset = params.phase_reset >= 0.5;

  return (
    <div
      className="bg-[#1a1a1a] border border-[#3a3a3a] rounded px-3 py-2 flex flex-col gap-2 flex-shrink-0"
      data-testid={`lfo-panel-${slot}`}
    >
      {/* Header */}
      <span className="text-[9px] text-[#aaaaaa] uppercase tracking-widest font-mono font-semibold">
        LFO {slot}
      </span>

      {/* Waveform selector */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-[#666666] uppercase tracking-widest font-mono">
          Waveform
        </span>
        <div className="flex gap-1 flex-wrap">
          {WAVEFORM_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => set("waveform", i)}
              className={buttonClass(i === activeWaveform)}
              aria-pressed={i === activeWaveform}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Destination selector */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-[#666666] uppercase tracking-widest font-mono">
          Dest
        </span>
        <div className="flex gap-1 flex-wrap">
          {DESTINATION_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => set("destination", i)}
              className={buttonClass(i === activeDest)}
              aria-pressed={i === activeDest}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Knobs + toggles row */}
      <div className="flex gap-3 items-end flex-wrap">
        <Knob
          label="RATE"
          value={normRate(params.rate)}
          displayValue={`${params.rate.toFixed(2)}Hz`}
          onValue={(n) => set("rate", denormRate(n))}
        />
        <Knob
          label="DEPTH"
          value={params.depth}
          displayValue={`${Math.round(params.depth * 100)}%`}
          onValue={(n) => set("depth", n)}
        />

        {/* Toggle buttons stacked vertically */}
        <div className="flex flex-col gap-1 pb-1">
          <button
            onClick={() => set("bpm_sync", bpmSynced ? 0 : 1)}
            className={buttonClass(bpmSynced)}
            aria-pressed={bpmSynced}
          >
            BPM SYNC
          </button>
          <button
            onClick={() => set("phase_reset", phaseReset ? 0 : 1)}
            className={buttonClass(phaseReset)}
            aria-pressed={phaseReset}
          >
            PHASE RST
          </button>
        </div>
      </div>

      {/* Division selector — only visible when BPM sync is on */}
      {bpmSynced && (
        <div className="flex flex-col gap-1" data-testid={`lfo-division-${slot}`}>
          <span className="text-[9px] text-[#666666] uppercase tracking-widest font-mono">
            Div
          </span>
          <div className="flex gap-1">
            {DIVISION_LABELS.map((label, i) => (
              <button
                key={label}
                onClick={() => set("division", i)}
                className={buttonClass(i === activeDiv)}
                aria-pressed={i === activeDiv}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
