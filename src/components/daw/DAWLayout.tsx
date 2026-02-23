// Placeholder — DAW shell, populated sprint by sprint
export function DAWLayout() {
  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      {/* Top toolbar */}
      <div className="h-12 bg-[#2d2d2d] border-b border-[#3a3a3a] flex items-center px-4">
        <span className="text-[#6c63ff] font-bold mr-4">MusicApp</span>
        <span className="text-[#888888] text-xs">DAW under construction — see sprint plan</span>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — instruments/browser */}
        <div className="w-64 bg-[#242424] border-r border-[#3a3a3a] flex items-center justify-center">
          <span className="text-[#888888] text-xs">Instrument Browser</span>
        </div>

        {/* Center — Timeline / Piano Roll */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-[#1a1a1a] flex items-center justify-center">
            <span className="text-[#888888] text-xs">Song Timeline</span>
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
