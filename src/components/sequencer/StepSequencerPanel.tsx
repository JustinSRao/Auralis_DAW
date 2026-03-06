import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSequencerStore } from '../../stores/sequencerStore';
import type { SequencerStep } from '../../stores/sequencerStore';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(n: number): string {
  return NOTE_NAMES[n % 12] + String(Math.floor(n / 12) - 1);
}

function StepPopover({ step, x, y, onChange, onClose }: {
  step: SequencerStep; x: number; y: number;
  onChange: (partial: Partial<SequencerStep>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed z-50 bg-[#2a2a2a] border border-[#4a4a4a] rounded px-3 py-2 flex flex-col gap-2 shadow-xl min-w-[160px]"
      style={{ top: y, left: x }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] text-[#666666] font-mono uppercase">Note</span>
        <div className="flex items-center gap-1">
          <input type="number" min={0} max={127} value={step.note}
            onChange={(e) => { const v = Math.max(0, Math.min(127, Number(e.target.value))); onChange({ note: v }); }}
            className="w-12 text-[10px] font-mono text-[#aaaaaa] bg-[#1e1e1e] border border-[#3a3a3a] rounded px-1 py-0.5 text-center"
            aria-label="Step note" />
          <span className="text-[10px] text-[#5b8def] font-mono">{midiToNoteName(step.note)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] text-[#666666] font-mono uppercase">Velocity: {step.velocity}</span>
        <input type="range" min={1} max={127} value={step.velocity}
          onChange={(e) => onChange({ velocity: Number(e.target.value) })}
          className="w-full" aria-label="Step velocity" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] text-[#666666] font-mono uppercase">Gate: {step.gate.toFixed(2)}</span>
        <input type="range" min={0.1} max={1.0} step={0.05} value={step.gate}
          onChange={(e) => onChange({ gate: Number(e.target.value) })}
          className="w-full" aria-label="Step gate" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] text-[#666666] font-mono uppercase">Probability: {step.probability}%</span>
        <input type="range" min={0} max={100} value={step.probability}
          onChange={(e) => onChange({ probability: Number(e.target.value) })}
          className="w-full" aria-label="Step probability" />
      </div>
      <button onClick={onClose} className="text-[9px] text-[#666666] hover:text-[#aaaaaa] font-mono self-end">Close</button>
    </div>
  );
}

function StepButton({ step, isCurrent, onToggle, onRightClick }: {
  step: SequencerStep; isCurrent: boolean;
  onToggle: () => void; onRightClick: (e: React.MouseEvent) => void;
}) {
  const opacity = step.enabled ? 0.4 + (step.velocity / 127) * 0.6 : 1;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={onToggle}
        onContextMenu={(e) => { e.preventDefault(); onRightClick(e); }}
        className={[
          'w-7 h-7 rounded-sm border transition-colors',
          isCurrent ? 'ring-2 ring-white/40' : '',
          step.enabled ? 'border-[#5b8def] hover:bg-[#4a7de0]' : 'bg-[#2a2a2a] border-[#3a3a3a] hover:border-[#5b8def]',
        ].join(' ')}
        style={step.enabled ? { backgroundColor: 'rgba(91, 141, 239, ' + String(opacity) + ')' } : undefined}
        aria-label={'Step ' + (step.enabled ? 'on' : 'off') + ', note ' + midiToNoteName(step.note)}
        aria-pressed={step.enabled}
      />
      <span className="text-[8px] font-mono text-[#555555] select-none">{midiToNoteName(step.note)}</span>
    </div>
  );
}

function StepGrid({ steps, patternLength, currentStep, onToggle, onRightClick }: {
  steps: SequencerStep[]; patternLength: 16 | 32 | 64; currentStep: number;
  onToggle: (idx: number) => void; onRightClick: (idx: number, e: React.MouseEvent) => void;
}) {
  const visibleSteps = steps.slice(0, patternLength);
  if (patternLength === 64) {
    return (
      <div className="flex flex-col gap-1">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-1">
            {visibleSteps.slice(row * 16, row * 16 + 16).map((step, col) => {
              const idx = row * 16 + col;
              return (
                <StepButton key={idx} step={step} isCurrent={idx === currentStep}
                  onToggle={() => onToggle(idx)} onRightClick={(e) => onRightClick(idx, e)} />
              );
            })}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {visibleSteps.map((step, idx) => (
        <StepButton key={idx} step={step} isCurrent={idx === currentStep}
          onToggle={() => onToggle(idx)} onRightClick={(e) => onRightClick(idx, e)} />
      ))}
    </div>
  );
}

/**
 * Step sequencer panel.
 *
 * Renders a melodic step sequencer grid with per-step note, velocity, gate,
 * and probability controls. Supports 16, 32, or 64 step patterns with
 * selectable time divisions and semitone transpose.
 */
export function StepSequencerPanel() {
  const store = useSequencerStore();
  const { state, initialized, error } = store;
  const [popover, setPopover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    listen<number>('sequencer-step-changed', (event) => {
      if (active) store.setCurrentStep(event.payload);
    }).then((unlisten) => { unlistenRef.current = unlisten; });
    return () => { active = false; unlistenRef.current?.(); };
  }, [store.setCurrentStep]);

  useEffect(() => {
    if (!initialized) { void store.initialize(); }
  }, [initialized, store.initialize]);

  useEffect(() => {
    if (!popover) return;
    const handler = () => setPopover(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover]);

  const btnBase = 'px-2 py-1 rounded text-[10px] font-mono border transition-colors';
  const { playing, current_step, pattern_length, time_div, transpose, steps } = state;
  const divOptions: { div: 4 | 8 | 16 | 32; label: string }[] = [
    { div: 4, label: '1/4' },
    { div: 8, label: '1/8' },
    { div: 16, label: '1/16' },
    { div: 32, label: '1/32' },
  ];

  return (
    <div className="bg-[#1e1e1e] border-t border-[#3a3a3a] px-4 py-2 flex flex-col gap-2 overflow-auto flex-shrink-0" style={{ minHeight: 120 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => void store.play()} disabled={playing}
          className={btnBase + ' ' + (playing ? 'border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10' : 'border-[#3a3a3a] text-[#aaaaaa] hover:border-[#5b8def]')}
          aria-label="Play">Play</button>
        <button onClick={() => void store.stop()} disabled={!playing}
          className={btnBase + ' border-[#3a3a3a] text-[#aaaaaa] hover:border-[#888888]'}
          aria-label="Stop">Stop</button>
        <button onClick={() => void store.reset()}
          className={btnBase + ' border-[#3a3a3a] text-[#aaaaaa] hover:border-[#888888]'}
          aria-label="Reset">Reset</button>
        <div className="w-px h-5 bg-[#3a3a3a]" />
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#666666] font-mono uppercase">Length</span>
          {([16, 32, 64] as const).map((len) => (
            <button key={len} onClick={() => void store.setLength(len)}
              className={['px-2 py-0.5 rounded text-[10px] font-mono border transition-colors',
                pattern_length === len ? 'border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10' : 'border-[#3a3a3a] text-[#666666] hover:border-[#5b8def]',
              ].join(' ')}
              aria-label={'Length ' + String(len)} aria-pressed={pattern_length === len}>
              {len}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-[#3a3a3a]" />
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#666666] font-mono uppercase">Div</span>
          {divOptions.map(({ div, label }) => (
            <button key={div} onClick={() => void store.setTimeDiv(div)}
              className={['px-2 py-0.5 rounded text-[10px] font-mono border transition-colors',
                time_div === div ? 'border-[#5b8def] text-[#5b8def] bg-[#5b8def]/10' : 'border-[#3a3a3a] text-[#666666] hover:border-[#5b8def]',
              ].join(' ')}
              aria-label={'Div ' + label} aria-pressed={time_div === div}>
              {label}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-[#3a3a3a]" />
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#666666] font-mono uppercase">Transpose</span>
          <input type="range" min={-24} max={24} value={transpose}
            onChange={(e) => void store.setTranspose(Number(e.target.value))}
            className="w-24" aria-label="Transpose" />
          <span className="text-[10px] font-mono text-[#aaaaaa] w-8 text-right">
            {transpose > 0 ? '+' + String(transpose) : transpose}
          </span>
        </div>
      </div>
      <StepGrid
        steps={steps} patternLength={pattern_length} currentStep={current_step}
        onToggle={(idx) => { const step = steps[idx]; if (step) { void store.setStep(idx, { enabled: !step.enabled }); } }}
        onRightClick={(idx, e) => { setPopover({ idx, x: e.clientX, y: e.clientY }); }}
      />
      {error && <div className="text-[10px] text-red-400 font-mono">{error}</div>}
      {popover !== null && steps[popover.idx] && (
        <StepPopover
          step={steps[popover.idx] as SequencerStep}
          x={popover.x} y={popover.y}
          onChange={(partial) => void store.setStep(popover.idx, partial)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
