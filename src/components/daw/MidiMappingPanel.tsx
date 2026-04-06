/**
 * MIDI Mapping Panel (Sprint 29).
 *
 * Displays all active CC → parameter bindings and lets the user delete them.
 * Rendered as a tab inside SettingsPanel under "MIDI Map".
 */

import { useMidiMappingStore } from "@/stores/midiMappingStore";

export function MidiMappingPanel() {
  const { mappings, deleteMapping } = useMidiMappingStore();

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[#aaaaaa] uppercase tracking-wider mb-1">
        MIDI CC Mappings
      </div>

      {mappings.length === 0 ? (
        <p className="text-xs text-[#666666] italic">
          No mappings yet. Right-click a knob and move a CC controller to assign
          it.
        </p>
      ) : (
        <table className="w-full text-xs text-[#cccccc] border-collapse">
          <thead>
            <tr className="text-[#888888] border-b border-[#333333]">
              <th className="text-left py-1 pr-2 font-normal">Parameter</th>
              <th className="text-left py-1 pr-2 font-normal">CC</th>
              <th className="text-left py-1 pr-2 font-normal">Channel</th>
              <th className="text-left py-1 pr-2 font-normal">Range</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr
                key={m.param_id}
                className="border-b border-[#222222] hover:bg-[#1e1e1e]"
              >
                <td className="py-1 pr-2 font-mono">{m.param_id}</td>
                <td className="py-1 pr-2">{m.cc}</td>
                <td className="py-1 pr-2">
                  {m.channel === null ? "Any" : m.channel + 1}
                </td>
                <td className="py-1 pr-2 font-mono">
                  {m.min_value.toFixed(2)} – {m.max_value.toFixed(2)}
                </td>
                <td className="py-1">
                  <button
                    onClick={() => deleteMapping(m.param_id)}
                    className="text-[#ef4444] hover:text-red-300 text-xs px-1"
                    aria-label={`Delete mapping for ${m.param_id}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-[10px] text-[#555555] mt-1">
        Tip: Right-click any knob to enter Learn mode. Move a CC on your
        controller to capture the mapping.
      </p>
    </div>
  );
}
