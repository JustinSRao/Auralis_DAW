import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { TransportSnapshot, RecordQuantize, RecordingStartedEvent, RecordingStoppedEvent, RecordedNoteEvent } from "@/lib/ipc";
import { useTransportStore } from "@/stores/transportStore";
import { usePatternStore } from "@/stores/patternStore";

// ---------------------------------------------------------------------------
// Time signature denominator options
// ---------------------------------------------------------------------------

const DENOMINATOR_OPTIONS = [2, 4, 8, 16] as const;
type TimeSigDenominator = (typeof DENOMINATOR_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Record quantize options
// ---------------------------------------------------------------------------

const QUANTIZE_OPTIONS: { value: RecordQuantize; label: string }[] = [
  { value: 'off', label: 'Q: Off' },
  { value: 'quarter', label: 'Q: 1/4' },
  { value: 'eighth', label: 'Q: 1/8' },
  { value: 'sixteenth', label: 'Q: 1/16' },
  { value: 'thirtySecond', label: 'Q: 1/32' },
];

// ---------------------------------------------------------------------------
// TransportBar
// ---------------------------------------------------------------------------

/**
 * DAW transport bar component.
 *
 * Renders play/stop/pause controls, BPM input, time signature selector,
 * loop toggle, metronome toggle, and a BBT position display.
 *
 * Subscribes to the `transport-state` Tauri event (emitted at ~60 fps by
 * the backend poller) and calls `applySnapshot` on each update to keep the
 * UI in sync with the audio thread's position without polling.
 */
export function TransportBar() {
  const store = useTransportStore();
  const { snapshot } = store;
  const addRecordedNote = usePatternStore((s) => s.addRecordedNote);
  const [isRecording, setIsRecording] = useState(false);

  // Local BPM input state — allows typing without firing an IPC call per keystroke
  const [bpmInput, setBpmInput] = useState(String(snapshot.bpm));
  // Track whether the BPM input is focused to avoid overwriting mid-type
  const bpmFocused = useRef(false);
  // Prevents commitBpm from firing on the blur that follows an Escape keydown
  const bpmEscaped = useRef(false);

  // Subscribe to transport-state and MIDI recording Tauri events
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<TransportSnapshot>("transport-state", (event) => {
      store.applySnapshot(event.payload);
    })
      .then((fn) => unlisteners.push(fn))
      .catch((err) => console.error("Failed to subscribe to transport-state event:", err));

    listen<RecordingStartedEvent>("recording-started", () => {
      setIsRecording(true);
    })
      .then((fn) => unlisteners.push(fn))
      .catch((err) => console.error("Failed to subscribe to recording-started:", err));

    listen<RecordingStoppedEvent>("recording-stopped", () => {
      setIsRecording(false);
    })
      .then((fn) => unlisteners.push(fn))
      .catch((err) => console.error("Failed to subscribe to recording-stopped:", err));

    listen<RecordedNoteEvent>("midi-recorded-note", (event) => {
      addRecordedNote(event.payload.patternId, event.payload.note);
    })
      .then((fn) => unlisteners.push(fn))
      .catch((err) => console.error("Failed to subscribe to midi-recorded-note:", err));

    // Fetch initial state
    store.refreshState();

    return () => {
      for (const fn of unlisteners) fn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync BPM input with backend when not focused
  useEffect(() => {
    if (!bpmFocused.current) {
      setBpmInput(snapshot.bpm.toFixed(1));
    }
  }, [snapshot.bpm]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handlePlay() {
    void store.play();
  }

  function handleStop() {
    void store.stop();
  }

  function handlePause() {
    void store.pause();
  }

  function handleBpmKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      commitBpm();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      bpmEscaped.current = true;
      setBpmInput(snapshot.bpm.toFixed(1));
      e.currentTarget.blur();
    }
  }

  function commitBpm() {
    const parsed = parseFloat(bpmInput);
    if (!isNaN(parsed) && parsed >= 20 && parsed <= 300) {
      void store.setBpm(parsed);
    } else {
      // Revert to current BPM on invalid input
      setBpmInput(snapshot.bpm.toFixed(1));
    }
  }

  function handleTimeSigNumerator(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 32) {
      void store.setTimeSignature(val, snapshot.time_sig_denominator);
    }
  }

  function handleTimeSigDenominator(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = parseInt(e.target.value, 10) as TimeSigDenominator;
    void store.setTimeSignature(snapshot.time_sig_numerator, val);
  }

  function handleLoopToggle() {
    void store.toggleLoop(!snapshot.loop_enabled);
  }

  function handleMetronomeToggle() {
    void store.toggleMetronome(!snapshot.metronome_enabled);
  }

  // -------------------------------------------------------------------------
  // Derived display values
  // -------------------------------------------------------------------------

  const { bar, beat, tick } = snapshot.bbt;
  const positionDisplay = `${bar}.${beat}.${String(tick).padStart(3, "0")}`;

  const isPlaying =
    snapshot.state === "playing" || snapshot.state === "recording";
  const isPaused = snapshot.state === "paused";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="flex items-center gap-3 px-3 py-1 bg-[#2d2d2d] border-b border-[#3a3a3a] select-none"
      aria-label="Transport controls"
    >
      {/* --- Playback controls --- */}
      <div className="flex items-center gap-1">
        {/* Play */}
        <button
          onClick={handlePlay}
          disabled={isPlaying}
          aria-label="Play"
          className="w-7 h-7 flex items-center justify-center rounded text-[#c8c8c8]
                     hover:bg-[#3a3a3a] disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          {/* Play triangle */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="2,1 11,6 2,11" />
          </svg>
        </button>

        {/* Pause */}
        <button
          onClick={handlePause}
          disabled={!isPlaying}
          aria-label="Pause"
          className="w-7 h-7 flex items-center justify-center rounded text-[#c8c8c8]
                     hover:bg-[#3a3a3a] disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          {/* Pause bars */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="1" width="3" height="10" />
            <rect x="7" y="1" width="3" height="10" />
          </svg>
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          disabled={snapshot.state === "stopped"}
          aria-label="Stop"
          className="w-7 h-7 flex items-center justify-center rounded text-[#c8c8c8]
                     hover:bg-[#3a3a3a] disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
        >
          {/* Stop square */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1" y="1" width="10" height="10" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#3a3a3a]" />

      {/* --- Position display (BBT) --- */}
      <div
        className="font-mono text-sm text-[#6c63ff] bg-[#1a1a1a] px-2 py-0.5 rounded
                   min-w-[80px] text-center tabular-nums"
        aria-label="Playhead position"
        title="Bar.Beat.Tick"
      >
        {positionDisplay}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#3a3a3a]" />

      {/* --- BPM input --- */}
      <div className="flex items-center gap-1.5">
        <label
          htmlFor="bpm-input"
          className="text-[10px] text-[#888888] uppercase tracking-wide"
        >
          BPM
        </label>
        <input
          id="bpm-input"
          type="text"
          inputMode="decimal"
          value={bpmInput}
          onChange={(e) => setBpmInput(e.target.value)}
          onKeyDown={handleBpmKeyDown}
          onFocus={() => {
            bpmFocused.current = true;
            bpmEscaped.current = false;
          }}
          onBlur={() => {
            bpmFocused.current = false;
            if (!bpmEscaped.current) {
              commitBpm();
            }
            bpmEscaped.current = false;
          }}
          aria-label="BPM"
          className="w-16 text-center text-sm font-mono bg-[#1a1a1a] text-[#e0e0e0]
                     border border-[#3a3a3a] rounded px-1 py-0.5
                     focus:outline-none focus:border-[#6c63ff]"
        />
      </div>

      {/* --- Time signature --- */}
      <div className="flex items-center gap-1" aria-label="Time signature">
        <label className="text-[10px] text-[#888888] uppercase tracking-wide">
          SIG
        </label>
        <input
          type="number"
          min={1}
          max={32}
          value={snapshot.time_sig_numerator}
          onChange={handleTimeSigNumerator}
          aria-label="Time signature numerator"
          className="w-8 text-center text-sm font-mono bg-[#1a1a1a] text-[#e0e0e0]
                     border border-[#3a3a3a] rounded px-1 py-0.5
                     focus:outline-none focus:border-[#6c63ff]
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[#888888] text-sm">/</span>
        <select
          value={snapshot.time_sig_denominator}
          onChange={handleTimeSigDenominator}
          aria-label="Time signature denominator"
          className="w-10 text-center text-sm bg-[#1a1a1a] text-[#e0e0e0]
                     border border-[#3a3a3a] rounded px-0.5 py-0.5
                     focus:outline-none focus:border-[#6c63ff]"
        >
          {DENOMINATOR_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#3a3a3a]" />

      {/* --- Loop toggle --- */}
      <button
        onClick={handleLoopToggle}
        aria-label={snapshot.loop_enabled ? "Disable loop" : "Enable loop"}
        aria-pressed={snapshot.loop_enabled}
        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          snapshot.loop_enabled
            ? "bg-[#6c63ff] text-white"
            : "text-[#888888] hover:bg-[#3a3a3a] hover:text-[#c8c8c8]"
        }`}
      >
        LOOP
      </button>

      {/* --- Metronome toggle --- */}
      <button
        onClick={handleMetronomeToggle}
        aria-label={
          snapshot.metronome_enabled ? "Disable metronome" : "Enable metronome"
        }
        aria-pressed={snapshot.metronome_enabled}
        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          snapshot.metronome_enabled
            ? "bg-[#6c63ff] text-white"
            : "text-[#888888] hover:bg-[#3a3a3a] hover:text-[#c8c8c8]"
        }`}
      >
        CLICK
      </button>

      {/* --- Record arm indicator --- */}
      {snapshot.record_armed && (
        <div
          aria-label="Record armed"
          data-testid="record-arm-indicator"
          className={`w-2.5 h-2.5 rounded-full ${
            isRecording
              ? "bg-red-500 animate-pulse"
              : "bg-red-400"
          }`}
        />
      )}

      {/* --- Recording controls (quantize + overdub) --- */}
      <div className="flex items-center gap-1.5">
        {/* Quantize selector */}
        <select
          value={store.recordQuantize}
          onChange={(e) => void store.setRecordQuantize(e.target.value as RecordQuantize)}
          aria-label="Record quantize"
          data-testid="record-quantize-select"
          className="text-[9px] bg-[#1a1a1a] text-[#888888] border border-[#3a3a3a]
                     rounded px-1 py-0.5 focus:outline-none focus:border-[#6c63ff]
                     font-mono"
        >
          {QUANTIZE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Overdub toggle */}
        <button
          onClick={() => store.setRecordOverdub(!store.recordOverdub)}
          aria-label={store.recordOverdub ? "Switch to replace mode" : "Switch to overdub mode"}
          aria-pressed={store.recordOverdub}
          data-testid="record-overdub-toggle"
          className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
            store.recordOverdub
              ? "bg-[#ff4444] text-white"
              : "text-[#888888] hover:bg-[#3a3a3a] hover:text-[#c8c8c8]"
          }`}
        >
          OVR
        </button>
      </div>

      {/* --- State badge (paused indicator) --- */}
      {isPaused && (
        <span className="text-[10px] text-[#ffaa00] uppercase tracking-wide">
          PAUSED
        </span>
      )}

      {/* --- Error display --- */}
      {store.error && (
        <span
          className="text-[10px] text-red-400 truncate max-w-[200px]"
          title={store.error}
        >
          {store.error}
        </span>
      )}
    </div>
  );
}
