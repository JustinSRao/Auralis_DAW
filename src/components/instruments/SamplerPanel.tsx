import { useEffect, useState } from "react";
import { Knob } from "./Knob";
import { useSamplerStore } from "../../stores/samplerStore";
import type { SampleZoneSnapshot, SamplerParamName } from "../../lib/ipc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normLinear(v: number, min: number, max: number): number {
  return (v - min) / (max - min);
}

function denormLinear(n: number, min: number, max: number): number {
  return min + n * (max - min);
}

function noteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
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

// ─── Zone row ─────────────────────────────────────────────────────────────────

function ZoneRow({
  zone,
  onRemove,
}: {
  zone: SampleZoneSnapshot;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-0.5 bg-[#2a2a2a] rounded text-[10px] font-mono">
      <span className="text-[#aaaaaa] truncate max-w-[100px]" title={zone.name}>
        {zone.name}
      </span>
      <span className="text-[#666666]">root</span>
      <span className="text-[#5b8def]">{noteName(zone.root_note)}</span>
      <span className="text-[#666666]">
        {noteName(zone.min_note)}–{noteName(zone.max_note)}
      </span>
      <button
        onClick={() => onRemove(zone.id)}
        className="text-[#555555] hover:text-red-400 transition-colors leading-none"
        aria-label={`Remove zone ${zone.name}`}
      >
        ×
      </button>
    </div>
  );
}

// ─── Drop target ──────────────────────────────────────────────────────────────

function DropTarget({ onFileDrop }: { onFileDrop: (path: string) => void }) {
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
    // In Tauri's webview, dropped files expose a `.path` property
    const path = (file as File & { path?: string }).path ?? file.name;
    onFileDrop(path);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        "flex items-center justify-center w-32 h-10 rounded border-2 border-dashed",
        "text-[10px] font-mono transition-colors cursor-copy select-none",
        isDragging
          ? "border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10"
          : "border-[#4a4a4a] text-[#666666] hover:border-[#5b8def] hover:text-[#888888]",
      ].join(" ")}
      aria-label="Drop audio file to load as zone"
    >
      Drop WAV / MP3 / FLAC
    </div>
  );
}

// ─── SamplerPanel ─────────────────────────────────────────────────────────────

/**
 * Sampler control panel.
 *
 * Mounts in the DAW layout as an always-visible bottom strip alongside the
 * SynthPanel. Initialises the sampler instrument on first mount (idempotent).
 * Supports drag-and-drop audio file loading into zones.
 */
export function SamplerPanel() {
  const {
    params,
    zones,
    isInitialized,
    isLoading,
    error,
    initialize,
    setParam,
    loadZone,
    removeZone,
  } = useSamplerStore();

  useEffect(() => {
    if (!isInitialized && !isLoading) {
      void initialize();
    }
  }, [isInitialized, isLoading, initialize]);

  function knob(
    name: SamplerParamName,
    label: string,
    norm: number,
    denorm: (n: number) => number,
    formatDisplay: (raw: number) => string,
    unit?: string,
  ) {
    return (
      <Knob
        key={name}
        label={label}
        value={norm}
        unit={unit}
        displayValue={formatDisplay(denorm(norm))}
        onValue={(n) => void setParam(name, denorm(n))}
      />
    );
  }

  const p = params;

  return (
    <div
      className="bg-[#1e1e1e] border-t border-[#3a3a3a] px-4 py-2 flex gap-6 items-start overflow-x-auto flex-shrink-0"
      style={{ minHeight: 100 }}
    >
      {/* Zone loader */}
      <Section title="Load Zone">
        <div className="flex flex-col gap-1">
          <DropTarget onFileDrop={(path) => void loadZone(path)} />
          <span className="text-[9px] text-[#555555] font-mono">
            {zones.length === 0
              ? "No zones"
              : `${zones.length} zone${zones.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </Section>

      {/* Zone list */}
      {zones.length > 0 && (
        <Section title="Zones">
          <div className="flex flex-col gap-1 max-h-14 overflow-y-auto">
            {zones.map((z) => (
              <ZoneRow key={z.id} zone={z} onRemove={(id) => void removeZone(id)} />
            ))}
          </div>
        </Section>
      )}

      {/* Envelope */}
      <Section title="Envelope">
        {knob(
          "attack",
          "Attack",
          normLinear(p.attack, 0.001, 4.0),
          (n) => denormLinear(n, 0.001, 4.0),
          (v) => `${v.toFixed(2)}s`,
        )}
        {knob(
          "decay",
          "Decay",
          normLinear(p.decay, 0.001, 4.0),
          (n) => denormLinear(n, 0.001, 4.0),
          (v) => `${v.toFixed(2)}s`,
        )}
        {knob(
          "sustain",
          "Sustain",
          p.sustain,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
        )}
        {knob(
          "release",
          "Release",
          normLinear(p.release, 0.001, 8.0),
          (n) => denormLinear(n, 0.001, 8.0),
          (v) => `${v.toFixed(2)}s`,
        )}
      </Section>

      {/* Output */}
      <Section title="Output">
        {knob(
          "volume",
          "Volume",
          p.volume,
          (n) => n,
          (v) => `${Math.round(v * 100)}%`,
        )}
      </Section>

      {/* Status feedback */}
      {error && (
        <div className="flex items-center text-[10px] text-red-400 max-w-xs">
          {error}
        </div>
      )}
      {isLoading && (
        <div className="flex items-center text-[10px] text-[#888888]">
          Loading…
        </div>
      )}
    </div>
  );
}
