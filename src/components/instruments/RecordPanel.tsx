import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { useRecorderStore } from "@/stores/recorderStore";
import { Knob } from "./Knob";

// ── RecordPanel ────────────────────────────────────────────────────────────────

/**
 * Audio recording panel shown in the right settings panel.
 *
 * Handles:
 * - Input device selection
 * - RMS level meter (updated from `input-level-changed` Tauri event)
 * - Record / Stop button
 * - Input monitoring toggle + gain knob
 * - Displays output file path after finalization
 */
export function RecordPanel() {
  const {
    inputDevices,
    selectedDevice,
    isRecording,
    isFinalizing,
    inputLevel,
    monitoringEnabled,
    monitoringGain,
    outputPath,
    error,
    fetchInputDevices,
    selectInputDevice,
    startRecording,
    stopRecording,
    setMonitoring,
    setMonitoringGain,
    setInputLevel,
    setOutputPath,
    clearError,
  } = useRecorderStore();

  // Subscribe to real-time events on mount
  const unlistenRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    // Fetch input devices once on mount
    fetchInputDevices();

    // cancelled flag prevents leaked listeners when the component unmounts
    // before the listen() promises resolve.
    let cancelled = false;

    const levelPromise = listen<number>("input-level-changed", (event) => {
      setInputLevel(event.payload);
    });

    const finalizedPromise = listen<string>("recording-finalized", (event) => {
      setOutputPath(event.payload);
    });

    Promise.all([levelPromise, finalizedPromise]).then(([unLevel, unFinal]) => {
      if (cancelled) {
        unLevel();
        unFinal();
        return;
      }
      unlistenRefs.current = [unLevel, unFinal];
    });

    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecordToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Level meter color: green → yellow → red
  const levelPercent = Math.min(inputLevel * 100, 100);
  const meterColor =
    levelPercent > 85
      ? "bg-red-500"
      : levelPercent > 65
        ? "bg-yellow-400"
        : "bg-green-500";

  return (
    <div
      className="border-b border-[#3a3a3a] p-3"
      aria-label="Recording panel"
    >
      <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-2">
        Record
      </h3>

      {/* Input device selector */}
      <div className="mb-2">
        <label className="text-[10px] text-[#888] block mb-1">
          Input Device
        </label>
        <select
          aria-label="Input device"
          className="w-full bg-[#1a1a1a] border border-[#444] text-[#ccc] text-[11px] rounded px-1 py-0.5"
          value={selectedDevice ?? ""}
          onChange={(e) => selectInputDevice(e.target.value)}
        >
          <option value="">Default input</option>
          {(inputDevices ?? [])
            .filter((d) => d.is_input)
            .map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
        </select>
      </div>

      {/* Level meter */}
      <div className="mb-2">
        <label className="text-[10px] text-[#888] block mb-1">
          Input Level
        </label>
        <div
          role="meter"
          aria-label="Input level"
          aria-valuenow={Math.round(levelPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-full h-3 bg-[#333] rounded overflow-hidden"
        >
          <div
            className={`h-full transition-none ${meterColor}`}
            style={{ width: `${levelPercent}%` }}
          />
        </div>
      </div>

      {/* Record / Stop button */}
      <button
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        onClick={handleRecordToggle}
        disabled={isFinalizing}
        className={[
          "w-full py-1 rounded text-[11px] font-bold mb-2 transition-colors",
          isRecording
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-[#555] hover:bg-[#666] text-[#ddd]",
          isFinalizing ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {isFinalizing ? "Finalizing…" : isRecording ? "■ STOP" : "● REC"}
      </button>

      {/* Monitoring controls */}
      <div className="flex items-center gap-2 mb-2">
        <label className="flex items-center gap-1 text-[10px] text-[#888] cursor-pointer">
          <input
            type="checkbox"
            aria-label="Enable monitoring"
            checked={monitoringEnabled}
            onChange={(e) => setMonitoring(e.target.checked)}
            className="accent-green-500"
          />
          Monitor
        </label>
        <div className="flex items-center gap-1 ml-auto">
          <Knob
            label="Gain"
            value={monitoringGain}
            min={0}
            max={1}
            step={0.01}
            onValue={setMonitoringGain}
          />
        </div>
      </div>

      {/* Output path */}
      {outputPath && (
        <div className="text-[10px] text-[#666] break-all" aria-label="Output path">
          {outputPath.split(/[/\\]/).pop()}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="text-[10px] text-red-400 mt-1 cursor-pointer"
          onClick={clearError}
        >
          {error}
        </div>
      )}
    </div>
  );
}
