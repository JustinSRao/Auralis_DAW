/**
 * AudioSettingsTab — wraps the existing AudioSettingsPanel for use inside
 * the SettingsPanel modal (Sprint 27).
 *
 * The AudioSettingsPanel manages its own state via useAudioStore.  Changes
 * the user makes there (device selection, sample rate, buffer size) are
 * reflected in the store immediately.  We sync those values back into the
 * settings draft on every render so that "Save & Apply" includes the latest
 * audio config.
 */

import { useEffect } from "react";
import { AudioSettingsPanel } from "@/components/audio/AudioSettingsPanel";
import { useAudioStore } from "@/stores/audioStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function AudioSettingsTab() {
  const audioConfig = useAudioStore((s) => s.config);
  const updateAudio = useSettingsStore((s) => s.updateAudio);

  // Keep the settings draft in sync with audio store changes.
  useEffect(() => {
    updateAudio({
      outputDevice: audioConfig.output_device,
      inputDevice: audioConfig.input_device,
      sampleRate: audioConfig.sample_rate,
      bufferSize: audioConfig.buffer_size,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    audioConfig.output_device,
    audioConfig.input_device,
    audioConfig.sample_rate,
    audioConfig.buffer_size,
  ]);

  return (
    <div className="flex flex-col gap-3">
      <AudioSettingsPanel />
      <p className="text-[11px] text-[#666666] px-1">
        Audio device changes are applied when you click "Save &amp; Apply".
      </p>
    </div>
  );
}
