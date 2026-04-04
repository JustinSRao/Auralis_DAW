/**
 * GeneralSettingsTab — autosave interval and recent-projects limit (Sprint 27).
 */

import { useSettingsStore } from "@/stores/settingsStore";

const AUTOSAVE_OPTIONS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
];

const RECENT_PROJECTS_OPTIONS: { label: string; value: number }[] = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
];

const labelCls = "text-[#aaaaaa] text-xs mb-1 block";
const selectCls =
  "w-full bg-[#2a2a2a] border border-[#3a3a3a] text-[#cccccc] text-xs rounded px-2 py-1.5 " +
  "focus:outline-none focus:border-[#5b8def]";

export function GeneralSettingsTab() {
  const draft = useSettingsStore((s) => s.draft);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);

  if (!draft) {
    return (
      <p className="text-[#666666] text-xs p-4">Loading settings...</p>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Autosave interval */}
      <div>
        <label htmlFor="autosave-interval" className={labelCls}>
          Auto-save interval
        </label>
        <select
          id="autosave-interval"
          className={selectCls}
          value={draft.general.autosaveIntervalSecs}
          onChange={(e) =>
            updateGeneral({ autosaveIntervalSecs: Number(e.target.value) })
          }
        >
          {AUTOSAVE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Recent projects limit */}
      <div>
        <label htmlFor="recent-projects-limit" className={labelCls}>
          Recent projects list size
        </label>
        <select
          id="recent-projects-limit"
          className={selectCls}
          value={draft.general.recentProjectsLimit}
          onChange={(e) =>
            updateGeneral({ recentProjectsLimit: Number(e.target.value) })
          }
        >
          {RECENT_PROJECTS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
