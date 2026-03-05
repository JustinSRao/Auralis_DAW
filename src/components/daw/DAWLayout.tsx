import { useState } from 'react';
import { AudioSettingsPanel } from '@/components/audio/AudioSettingsPanel';
import { MidiSettingsPanel } from '@/components/midi/MidiSettingsPanel';
import { TransportBar } from '@/components/daw/TransportBar';
import { HistoryPanel } from '@/components/daw/HistoryPanel';
import { MenuBar } from '@/components/daw/MenuBar';
import { TrackList } from '@/components/daw/TrackList';
import { DrumMachinePanel } from '@/components/instruments/DrumMachinePanel';
import { SamplerPanel } from '@/components/instruments/SamplerPanel';
import { SynthPanel } from '@/components/instruments/SynthPanel';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useKeyboardStore } from '@/stores/keyboardStore';

/**
 * Root layout component for the DAW shell.
 *
 * Mounts global hooks:
 * - `useUndoRedo`      — Sprint 26: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z shortcuts
 * - `useGlobalKeyboard` — Sprint 30: Space, R, M, S, F, L, Delete, Ctrl+S, Ctrl+N
 *
 * Layout (flex column):
 * ┌─────────────────────────────────────────────────┐
 * │ MenuBar                                  h-8    │
 * │ TransportBar                             h-auto │
 * ├─────┬──────────────────────────┬─────────────────┤
 * │     │ TrackList │ Timeline     │ Settings        │
 * │ Bro │           │ placeholder  │ (AudioSettings  │
 * │ wse │           │              │  MidiSettings)  │
 * │ r   ├───────────┴──────────────┤                 │
 * │     │ Mixer placeholder        │                 │
 * └─────┴──────────────────────────┴─────────────────┘
 */
export function DAWLayout() {
  // Sprint 26 — Ctrl+Z/Y/Shift+Z undo/redo. MUST remain here.
  useUndoRedo();

  // Sprint 30 — global DAW shortcuts (Space, M, S, R, F, L, Delete, Ctrl+S/N).
  useGlobalKeyboard();

  const { browserOpen, mixerOpen } = useKeyboardStore();
  const [activeInstrument, setActiveInstrument] = useState<'synth' | 'sampler' | 'drums'>('synth');

  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a] overflow-hidden">
      {/* Menu bar */}
      <MenuBar />

      {/* Transport bar */}
      <TransportBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — browser + history */}
        <div
          className="flex flex-col bg-[#242424] border-r border-[#3a3a3a] overflow-hidden transition-all duration-200 flex-shrink-0"
          style={{ width: browserOpen ? 240 : 0, minWidth: 0 }}
          aria-hidden={!browserOpen}
        >
          <HistoryPanel />
          <div className="flex-1 flex items-center justify-center p-4">
            <span className="text-[#888888] text-xs text-center">
              Sample Browser
              <br />
              (Sprint 28)
            </span>
          </div>
        </div>

        {/* Center column — track list + timeline + mixer */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Track list + timeline canvas row */}
          <div className="flex flex-1 overflow-hidden">
            {/* Track list (fixed width, scrollable) */}
            <TrackList />

            {/* Timeline canvas placeholder */}
            <div className="flex-1 bg-[#1e1e1e] flex items-center justify-center">
              <span className="text-[#555555] text-xs">
                Timeline (Sprint 13)
              </span>
            </div>
          </div>

          {/* Mixer panel (collapsible) */}
          <div
            className="bg-[#1a1a1a] border-t border-[#3a3a3a] overflow-hidden transition-all duration-200 flex-shrink-0"
            style={{ height: mixerOpen ? 192 : 0 }}
            aria-hidden={!mixerOpen}
          >
            <div className="flex items-center justify-center h-full">
              <span className="text-[#555555] text-xs">
                Mixer (Sprint 17)
              </span>
            </div>
          </div>

          {/* Instrument strip — Sprint 6/7: tabbed synth / sampler panel */}
          <div className="flex flex-col flex-shrink-0">
            {/* Tab bar */}
            <div className="flex bg-[#1a1a1a] border-t border-[#3a3a3a] px-4 gap-1 pt-1">
              {(['synth', 'sampler', 'drums'] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => setActiveInstrument(id)}
                  className={[
                    'px-3 py-0.5 text-[10px] font-mono rounded-t border-b-2 transition-colors',
                    activeInstrument === id
                      ? 'border-[#5b8def] text-[#aaaaaa]'
                      : 'border-transparent text-[#555555] hover:text-[#888888]',
                  ].join(' ')}
                >
                  {id === 'synth' ? 'SYNTH' : id === 'sampler' ? 'SAMPLER' : 'DRUMS'}
                </button>
              ))}
            </div>
            {activeInstrument === 'synth' ? (
              <SynthPanel />
            ) : activeInstrument === 'sampler' ? (
              <SamplerPanel />
            ) : (
              <DrumMachinePanel />
            )}
          </div>
        </div>

        {/* Right panel — settings (temporary until Sprint 9 instruments) */}
        <div className="w-64 bg-[#242424] border-l border-[#3a3a3a] flex flex-col overflow-y-auto flex-shrink-0">
          <AudioSettingsPanel />
          <MidiSettingsPanel />
        </div>

      </div>
    </div>
  );
}
