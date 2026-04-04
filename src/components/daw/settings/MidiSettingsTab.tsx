/**
 * MidiSettingsTab — wraps the existing MidiSettingsPanel for use inside
 * the SettingsPanel modal (Sprint 27).
 *
 * Syncs MIDI store state back into the settings draft so that "Save & Apply"
 * captures the user's current MIDI port selections.
 */

import { useEffect } from "react";
import { MidiSettingsPanel } from "@/components/midi/MidiSettingsPanel";
import { useMidiStore } from "@/stores/midiStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function MidiSettingsTab() {
  const activeInput = useMidiStore((s) => s.activeInput);
  const activeOutput = useMidiStore((s) => s.activeOutput);
  const updateMidi = useSettingsStore((s) => s.updateMidi);

  // Keep the settings draft in sync with MIDI store changes.
  useEffect(() => {
    updateMidi({ activeInput, activeOutput });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInput, activeOutput]);

  return (
    <div className="flex flex-col gap-3">
      <MidiSettingsPanel />
      <p className="text-[11px] text-[#666666] px-1">
        MIDI connection changes are applied when you click "Save &amp; Apply".
      </p>
    </div>
  );
}
