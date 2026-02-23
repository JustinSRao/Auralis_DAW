import { useEffect } from "react";
import { useMidiStore } from "@/stores/midiStore";

export function MidiSettingsPanel() {
  const {
    devices,
    activeInput,
    activeOutput,
    error,
    isLoading,
    refreshDevices,
    refreshStatus,
    connectInput,
    disconnectInput,
    connectOutput,
    disconnectOutput,
    clearError,
  } = useMidiStore();

  useEffect(() => {
    refreshDevices();
    refreshStatus();
  }, [refreshDevices, refreshStatus]);

  const inputDevices = (devices ?? []).filter((d) => d.is_input);
  const outputDevices = (devices ?? []).filter((d) => d.is_output);

  const handleInputChange = (value: string) => {
    if (value === "") {
      disconnectInput();
    } else {
      connectInput(value);
    }
  };

  const handleOutputChange = (value: string) => {
    if (value === "") {
      disconnectOutput();
    } else {
      connectOutput(value);
    }
  };

  return (
    <div className="p-4 bg-[#2d2d2d] rounded-lg space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-[#e0e0e0] font-semibold">MIDI Settings</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              activeInput || activeOutput ? "bg-green-500" : "bg-gray-500"
            }`}
          />
          <span className="text-[#888888] text-xs uppercase">
            {activeInput || activeOutput ? "connected" : "disconnected"}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-3 py-2 rounded text-xs flex justify-between">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-red-400 hover:text-red-200 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* MIDI Input */}
      <div>
        <label
          htmlFor="midi-input"
          className="block text-[#888888] text-xs mb-1"
        >
          MIDI Input
        </label>
        <select
          id="midi-input"
          value={activeInput ?? ""}
          onChange={(e) => handleInputChange(e.target.value)}
          disabled={isLoading}
          className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">None</option>
          {inputDevices.map((d) => (
            <option key={`midi-in-${d.name}`} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* MIDI Output */}
      <div>
        <label
          htmlFor="midi-output"
          className="block text-[#888888] text-xs mb-1"
        >
          MIDI Output
        </label>
        <select
          id="midi-output"
          value={activeOutput ?? ""}
          onChange={(e) => handleOutputChange(e.target.value)}
          disabled={isLoading}
          className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">None</option>
          {outputDevices.map((d) => (
            <option key={`midi-out-${d.name}`} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* Controls */}
      <div className="flex items-center pt-2">
        <button
          onClick={refreshDevices}
          disabled={isLoading}
          className="text-[#888888] hover:text-[#e0e0e0] text-xs ml-auto disabled:opacity-50"
        >
          Refresh Devices
        </button>
      </div>
    </div>
  );
}
