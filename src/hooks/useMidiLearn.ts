/**
 * useMidiLearn — global MIDI Learn event listener (Sprint 29).
 *
 * Mount this hook once (in DAWLayout) to bridge the Tauri `midi-learn-captured`
 * backend event into the `midiMappingStore`. All knobs that participate in MIDI
 * learn observe the store rather than this hook directly.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { MidiLearnCapturedPayload } from "@/lib/ipc";
import { useMidiMappingStore } from "@/stores/midiMappingStore";

export function useMidiLearn(): void {
  const onLearnCaptured = useMidiMappingStore((s) => s.onLearnCaptured);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<MidiLearnCapturedPayload>("midi-learn-captured", (event) => {
      const { param_id, cc, channel } = event.payload;
      onLearnCaptured(param_id, cc, channel);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [onLearnCaptured]);
}
