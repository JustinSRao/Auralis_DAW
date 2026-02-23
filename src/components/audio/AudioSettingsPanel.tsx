import { useEffect } from "react";
import { useAudioStore } from "@/stores/audioStore";

const SAMPLE_RATES = [44100, 48000];
const BUFFER_SIZES = [128, 256, 512, 1024];

export function AudioSettingsPanel() {
  const {
    devices,
    engineState,
    config,
    activeHost,
    testToneActive,
    error,
    isLoading,
    refreshDevices,
    refreshStatus,
    start,
    stop,
    selectDevice,
    updateConfig,
    toggleTestTone,
    clearError,
  } = useAudioStore();

  const isStopped = engineState === "stopped";
  const isRunning = engineState === "running";

  useEffect(() => {
    refreshDevices();
    refreshStatus();
  }, [refreshDevices, refreshStatus]);

  const deviceList = devices ?? [];
  const outputDevices = deviceList.filter((d) => d.is_output);
  const inputDevices = deviceList.filter((d) => d.is_input);

  return (
    <div className="p-4 bg-[#2d2d2d] rounded-lg space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-[#e0e0e0] font-semibold">Audio Settings</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isRunning
                ? "bg-green-500"
                : isStopped
                  ? "bg-gray-500"
                  : "bg-yellow-500"
            }`}
          />
          <span className="text-[#888888] text-xs uppercase">{engineState}</span>
          {activeHost && (
            <span className="text-[#6c63ff] text-xs ml-1">({activeHost})</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-3 py-2 rounded text-xs flex justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-400 hover:text-red-200 ml-2">
            ×
          </button>
        </div>
      )}

      {/* Output Device */}
      <div>
        <label htmlFor="output-device" className="block text-[#888888] text-xs mb-1">Output Device</label>
        <select
          id="output-device"
          value={config.output_device ?? ""}
          onChange={(e) => selectDevice(e.target.value, false)}
          disabled={!isStopped || isLoading}
          className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">System Default</option>
          {outputDevices.map((d) => (
            <option key={`out-${d.name}`} value={d.name}>
              {d.name} ({d.host_type})
            </option>
          ))}
        </select>
      </div>

      {/* Input Device */}
      <div>
        <label htmlFor="input-device" className="block text-[#888888] text-xs mb-1">Input Device</label>
        <select
          id="input-device"
          value={config.input_device ?? ""}
          onChange={(e) => selectDevice(e.target.value, true)}
          disabled={!isStopped || isLoading}
          className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">System Default</option>
          {inputDevices.map((d) => (
            <option key={`in-${d.name}`} value={d.name}>
              {d.name} ({d.host_type})
            </option>
          ))}
        </select>
      </div>

      {/* Sample Rate & Buffer Size */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label htmlFor="sample-rate" className="block text-[#888888] text-xs mb-1">Sample Rate</label>
          <select
            id="sample-rate"
            value={config.sample_rate}
            onChange={(e) => updateConfig(Number(e.target.value), undefined)}
            disabled={!isStopped || isLoading}
            className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
          >
            {SAMPLE_RATES.map((sr) => (
              <option key={sr} value={sr}>
                {sr} Hz
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="buffer-size" className="block text-[#888888] text-xs mb-1">Buffer Size</label>
          <select
            id="buffer-size"
            value={config.buffer_size}
            onChange={(e) => updateConfig(undefined, Number(e.target.value))}
            disabled={!isStopped || isLoading}
            className="w-full bg-[#1a1a1a] text-[#e0e0e0] border border-[#3a3a3a] rounded px-2 py-1 text-xs disabled:opacity-50"
          >
            {BUFFER_SIZES.map((bs) => (
              <option key={bs} value={bs}>
                {bs} samples
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 pt-2">
        {isStopped ? (
          <button
            onClick={start}
            disabled={isLoading}
            className="bg-[#6c63ff] hover:bg-[#5a52e0] text-white px-4 py-1.5 rounded text-xs font-medium disabled:opacity-50"
          >
            Start Engine
          </button>
        ) : isRunning ? (
          <button
            onClick={stop}
            disabled={isLoading}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded text-xs font-medium disabled:opacity-50"
          >
            Stop Engine
          </button>
        ) : (
          <span className="text-yellow-500 text-xs">
            {engineState}...
          </span>
        )}

        <label className="flex items-center gap-2 text-[#888888] text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={testToneActive}
            onChange={(e) => toggleTestTone(e.target.checked)}
            disabled={!isRunning}
            className="accent-[#6c63ff]"
          />
          Test Tone (440 Hz)
        </label>

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
