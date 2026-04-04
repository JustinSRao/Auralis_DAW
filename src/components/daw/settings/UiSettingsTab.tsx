/**
 * UiSettingsTab — panel visibility, follow-playhead, and theme (Sprint 27).
 */

import { useSettingsStore } from "@/stores/settingsStore";

const checkboxRowCls = "flex items-center gap-3 py-1.5";
const checkboxCls =
  "w-4 h-4 rounded border border-[#3a3a3a] bg-[#2a2a2a] " +
  "accent-[#5b8def] cursor-pointer";
const checkboxLabelCls = "text-[#cccccc] text-xs cursor-pointer select-none";
const sectionLabelCls = "text-[#aaaaaa] text-xs mb-2 block";
const selectCls =
  "w-full bg-[#2a2a2a] border border-[#3a3a3a] text-[#cccccc] text-xs rounded px-2 py-1.5 " +
  "focus:outline-none focus:border-[#5b8def]";

export function UiSettingsTab() {
  const draft = useSettingsStore((s) => s.draft);
  const updateUi = useSettingsStore((s) => s.updateUi);

  if (!draft) {
    return (
      <p className="text-[#666666] text-xs p-4">Loading settings...</p>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Panel visibility */}
      <div>
        <span className={sectionLabelCls}>Startup panel visibility</span>
        <div className={checkboxRowCls}>
          <input
            id="browser-open"
            type="checkbox"
            className={checkboxCls}
            checked={draft.ui.browserOpen}
            onChange={(e) => updateUi({ browserOpen: e.target.checked })}
          />
          <label htmlFor="browser-open" className={checkboxLabelCls}>
            Open browser panel on startup
          </label>
        </div>
        <div className={checkboxRowCls}>
          <input
            id="mixer-open"
            type="checkbox"
            className={checkboxCls}
            checked={draft.ui.mixerOpen}
            onChange={(e) => updateUi({ mixerOpen: e.target.checked })}
          />
          <label htmlFor="mixer-open" className={checkboxLabelCls}>
            Open mixer panel on startup
          </label>
        </div>
      </div>

      {/* Playback */}
      <div>
        <span className={sectionLabelCls}>Playback</span>
        <div className={checkboxRowCls}>
          <input
            id="follow-playhead"
            type="checkbox"
            className={checkboxCls}
            checked={draft.ui.followPlayhead}
            onChange={(e) => updateUi({ followPlayhead: e.target.checked })}
          />
          <label htmlFor="follow-playhead" className={checkboxLabelCls}>
            Follow playhead during playback
          </label>
        </div>
      </div>

      {/* Theme */}
      <div>
        <label htmlFor="theme-select" className={sectionLabelCls}>
          Theme
        </label>
        <select
          id="theme-select"
          className={selectCls}
          value={draft.ui.theme}
          onChange={(e) => updateUi({ theme: e.target.value })}
        >
          <option value="dark">Dark</option>
          <option value="light" disabled>
            Light (coming soon)
          </option>
        </select>
      </div>
    </div>
  );
}
