import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Knob } from "./Knob";
import { useDrumMachineStore } from "../../stores/drumMachineStore";

// ── Velocity popover ──────────────────────────────────────────────────────────

function VelocityPopover({
  velocity,
  onVelocity,
  onClose,
}: {
  velocity: number;
  onVelocity: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-50 bg-[#2a2a2a] border border-[#4a4a4a] rounded px-2 py-1 flex flex-col gap-1 shadow-lg"
      style={{ top: "100%", left: 0, minWidth: 80 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="text-[9px] text-[#666666] font-mono uppercase">Velocity</span>
      <input
        type="range"
        min={1}
        max={127}
        value={velocity}
        onChange={(e) => onVelocity(Number(e.target.value))}
        className="w-full"
        aria-label="Step velocity"
      />
      <span className="text-[10px] text-[#aaaaaa] font-mono text-center">{velocity}</span>
      <button
        onClick={onClose}
        className="text-[9px] text-[#666666] hover:text-[#aaaaaa] font-mono"
      >
        Close
      </button>
    </div>
  );
}

// ── Step button ───────────────────────────────────────────────────────────────

function StepButton({
  active,
  velocity,
  isCurrent,
  onToggle,
  onVelocityChange,
}: {
  active: boolean;
  velocity: number;
  isCurrent: boolean;
  onToggle: () => void;
  onVelocityChange: (v: number) => void;
}) {
  const [showPopover, setShowPopover] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowPopover((p) => !p);
  };

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        className={[
          "w-7 h-7 rounded-sm border transition-colors",
          isCurrent ? "ring-1 ring-[#ffffff40]" : "",
          active
            ? "bg-[#5b8def] border-[#5b8def] hover:bg-[#4a7de0]"
            : "bg-[#2a2a2a] border-[#3a3a3a] hover:border-[#5b8def]",
        ].join(" ")}
        aria-label={`Step ${active ? "on" : "off"}, velocity ${velocity}`}
        aria-pressed={active}
      />
      {showPopover && (
        <VelocityPopover
          velocity={velocity}
          onVelocity={onVelocityChange}
          onClose={() => setShowPopover(false)}
        />
      )}
    </div>
  );
}

// ── Pad row ───────────────────────────────────────────────────────────────────

function PadRow({
  padIdx,
  name,
  hasSample,
  steps,
  currentStep,
  patternLength,
  onToggleStep,
  onVelocityChange,
  onFileDrop,
}: {
  padIdx: number;
  name: string;
  hasSample: boolean;
  steps: { active: boolean; velocity: number }[];
  currentStep: number;
  patternLength: number;
  onToggleStep: (stepIdx: number) => void;
  onVelocityChange: (stepIdx: number, v: number) => void;
  onFileDrop: (filePath: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = (file as File & { path?: string }).path ?? file.name;
    onFileDrop(path);
  };

  return (
    <div className="flex items-center gap-1">
      {/* Pad label — drag target */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "w-16 h-7 flex items-center justify-center rounded text-[9px] font-mono truncate",
          "border cursor-copy select-none transition-colors",
          isDragging
            ? "border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10"
            : hasSample
              ? "border-[#3a5a8f] text-[#aaaaaa] bg-[#1e2a3a]"
              : "border-[#3a3a3a] text-[#555555] bg-[#1e1e1e] hover:border-[#5b8def]",
        ].join(" ")}
        aria-label={`Drop sample onto pad ${padIdx + 1}`}
        title={hasSample ? name : "Drop sample here"}
      >
        {hasSample ? name : `Pad ${padIdx + 1}`}
      </div>

      {/* Step grid */}
      {steps.slice(0, patternLength).map((step, si) => (
        <StepButton
          key={si}
          active={step.active}
          velocity={step.velocity}
          isCurrent={si === currentStep}
          onToggle={() => onToggleStep(si)}
          onVelocityChange={(v) => onVelocityChange(si, v)}
        />
      ))}
    </div>
  );
}

// ── Transport row ─────────────────────────────────────────────────────────────

function TransportRow({
  playing,
  bpm,
  swing,
  patternLength,
  onPlay,
  onStop,
  onReset,
  onBpmChange,
  onSwingChange,
  onLengthChange,
}: {
  playing: boolean;
  bpm: number;
  swing: number;
  patternLength: number;
  onPlay: () => void;
  onStop: () => void;
  onReset: () => void;
  onBpmChange: (v: number) => void;
  onSwingChange: (v: number) => void;
  onLengthChange: (v: 16 | 32) => void;
}) {
  const btnBase =
    "px-2 py-1 rounded text-[10px] font-mono border transition-colors";

  return (
    <div className="flex items-center gap-3 pt-1 border-t border-[#3a3a3a] mt-1">
      {/* Play/Stop/Reset */}
      <button
        onClick={onPlay}
        disabled={playing}
        className={`${btnBase} ${playing ? "border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10" : "border-[#3a3a3a] text-[#aaaaaa] hover:border-[#5b8def]"}`}
        aria-label="Play"
      >
        ▶ Play
      </button>
      <button
        onClick={onStop}
        disabled={!playing}
        className={`${btnBase} border-[#3a3a3a] text-[#aaaaaa] hover:border-[#888888]`}
        aria-label="Stop"
      >
        ■ Stop
      </button>
      <button
        onClick={onReset}
        className={`${btnBase} border-[#3a3a3a] text-[#aaaaaa] hover:border-[#888888]`}
        aria-label="Reset"
      >
        ↺ Reset
      </button>

      {/* BPM */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-[#666666] font-mono uppercase">BPM</span>
        <input
          type="text"
          inputMode="decimal"
          value={bpm}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 1 && v <= 300) onBpmChange(v);
          }}
          className="w-12 text-[10px] font-mono text-[#aaaaaa] bg-[#2a2a2a] border border-[#3a3a3a] rounded px-1 py-0.5 text-center"
          aria-label="BPM"
        />
      </div>

      {/* Swing */}
      <div className="flex flex-col items-center gap-0.5">
        <Knob
          label="Swing"
          value={swing / 0.5}
          displayValue={`${Math.round(swing * 100)}%`}
          onValue={(n) => onSwingChange(n * 0.5)}
        />
      </div>

      {/* Pattern length */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-[#666666] font-mono uppercase">Steps</span>
        <select
          value={patternLength}
          onChange={(e) =>
            onLengthChange(Number(e.target.value) as 16 | 32)
          }
          className="text-[10px] font-mono text-[#aaaaaa] bg-[#2a2a2a] border border-[#3a3a3a] rounded px-1 py-0.5"
          aria-label="Pattern length"
        >
          <option value={16}>16</option>
          <option value={32}>32</option>
        </select>
      </div>
    </div>
  );
}

// ── DrumMachinePanel ──────────────────────────────────────────────────────────

/**
 * Drum machine control panel.
 *
 * Renders a 16-pad × N-step grid. Each pad label is a drag target for loading
 * sample files. Steps toggle on click; right-click opens a velocity popover.
 * The active step column is highlighted via a Tauri event listener.
 */
export function DrumMachinePanel() {
  const {
    snapshot,
    isInitialized,
    isLoading,
    error,
    initialize,
    toggleStep,
    setStepVelocity,
    loadPadSample,
    setSwing,
    setBpm,
    setPatternLength,
    play,
    stop,
    reset,
    setCurrentStep,
  } = useDrumMachineStore();

  // Listen for step-changed events and update the highlighted column
  const unlistenRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true;
    listen<number>("drum-step-changed", (event) => {
      if (active) setCurrentStep(event.payload);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      active = false;
      unlistenRef.current?.();
    };
  }, [setCurrentStep]);

  useEffect(() => {
    if (!isInitialized && !isLoading) {
      void initialize();
    }
  }, [isInitialized, isLoading, initialize]);

  if (isLoading && !isInitialized) {
    return (
      <div className="bg-[#1e1e1e] border-t border-[#3a3a3a] px-4 py-3 flex items-center text-[10px] text-[#888888] font-mono">
        Loading drum machine…
      </div>
    );
  }

  const { pads, bpm, swing, pattern_length, playing, current_step } = snapshot;

  return (
    <div
      className="bg-[#1e1e1e] border-t border-[#3a3a3a] px-4 py-2 flex flex-col gap-1 overflow-auto flex-shrink-0"
      style={{ minHeight: 120 }}
    >
      {/* Step grid */}
      <div className="flex flex-col gap-0.5">
        {/* Step number header */}
        <div className="flex items-center gap-1">
          <div className="w-16" />
          {Array.from({ length: pattern_length }, (_, i) => (
            <div
              key={i}
              className={[
                "w-7 text-center text-[8px] font-mono",
                i === current_step && playing
                  ? "text-[#5b8def]"
                  : i % 4 === 0
                    ? "text-[#555555]"
                    : "text-[#333333]",
              ].join(" ")}
            >
              {i % 4 === 0 ? i + 1 : "·"}
            </div>
          ))}
        </div>

        {/* Pad rows */}
        {pads.map((pad) => (
          <PadRow
            key={pad.idx}
            padIdx={pad.idx}
            name={pad.name}
            hasSample={pad.has_sample}
            steps={pad.steps}
            currentStep={current_step}
            patternLength={pattern_length}
            onToggleStep={(si) => void toggleStep(pad.idx, si)}
            onVelocityChange={(si, v) => void setStepVelocity(pad.idx, si, v)}
            onFileDrop={(path) => void loadPadSample(pad.idx, path)}
          />
        ))}
      </div>

      {/* Transport + controls */}
      <TransportRow
        playing={playing}
        bpm={bpm}
        swing={swing}
        patternLength={pattern_length}
        onPlay={() => void play()}
        onStop={() => void stop()}
        onReset={() => void reset()}
        onBpmChange={(v) => void setBpm(v)}
        onSwingChange={(v) => void setSwing(v)}
        onLengthChange={(v) => void setPatternLength(v)}
      />

      {/* Error feedback */}
      {error && (
        <div className="text-[10px] text-red-400 font-mono">{error}</div>
      )}
    </div>
  );
}
