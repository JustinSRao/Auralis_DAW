import { AudioSettingsPanel } from "@/components/audio/AudioSettingsPanel";
import { MidiSettingsPanel } from "@/components/midi/MidiSettingsPanel";
import { ProjectToolbar } from "@/components/daw/ProjectToolbar";
import { TransportBar } from "@/components/daw/TransportBar";
import { HistoryPanel } from "@/components/daw/HistoryPanel";
import { useUndoRedo } from "@/hooks/useUndoRedo";

export function DAWLayout() {
  useUndoRedo();

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      {/* Top toolbar */}
      <div className="h-12 bg-[#2d2d2d] border-b border-[#3a3a3a] flex items-center px-4">
        <span className="text-[#6c63ff] font-bold mr-4">MusicApp</span>
        <ProjectToolbar />
      </div>

      {/* Transport bar */}
      <TransportBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — history + instruments/browser */}
        <div className="w-64 bg-[#242424] border-r border-[#3a3a3a] flex flex-col">
          <HistoryPanel />
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[#888888] text-xs">Instrument Browser</span>
          </div>
        </div>

        {/* Center — Timeline / Piano Roll */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-[#1a1a1a] p-4 overflow-y-auto space-y-4">
            <AudioSettingsPanel />
            <MidiSettingsPanel />
          </div>
          {/* Bottom — Mixer */}
          <div className="h-48 bg-[#242424] border-t border-[#3a3a3a] flex items-center justify-center">
            <span className="text-[#888888] text-xs">Mixer</span>
          </div>
        </div>
      </div>
    </div>
  );
}
