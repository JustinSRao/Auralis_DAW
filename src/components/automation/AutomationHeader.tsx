/**
 * Header row for a single automation lane.
 *
 * Shows the parameter ID label, enable/disable toggle, interpolation selector,
 * and a delete-lane button.
 */

import type { AutomationInterp } from '../../lib/ipc';

const INTERP_OPTIONS: { value: AutomationInterp; label: string }[] = [
  { value: 'Linear', label: 'LIN' },
  { value: 'Exponential', label: 'EXP' },
  { value: 'Step', label: 'STP' },
];

interface Props {
  parameterId: string;
  enabled: boolean;
  activeInterp: AutomationInterp;
  onToggleEnabled: () => void;
  onInterpChange: (interp: AutomationInterp) => void;
  onDeleteLane: () => void;
}

export function AutomationHeader({
  parameterId,
  enabled,
  activeInterp,
  onToggleEnabled,
  onInterpChange,
  onDeleteLane,
}: Props) {
  return (
    <div
      className="flex items-center gap-2 px-2 bg-[#1a1a1a] border-b border-[#2a2a2a] flex-shrink-0"
      style={{ height: 24 }}
    >
      {/* Enable toggle */}
      <button
        onClick={onToggleEnabled}
        title={enabled ? 'Disable lane' : 'Enable lane'}
        className={[
          'w-3 h-3 rounded-full border flex-shrink-0',
          enabled ? 'bg-[#5b8def] border-[#5b8def]' : 'bg-transparent border-[#555]',
        ].join(' ')}
        aria-pressed={enabled}
        aria-label={`Toggle ${parameterId} automation`}
      />

      {/* Parameter name */}
      <span
        className="text-[10px] font-mono flex-1 truncate"
        style={{ color: enabled ? '#aaaaaa' : '#555' }}
      >
        {parameterId}
      </span>

      {/* Interpolation selector */}
      <div className="flex gap-0.5">
        {INTERP_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onInterpChange(value)}
            className={[
              'px-1 text-[8px] font-mono rounded',
              activeInterp === value
                ? 'bg-[#3a3a3a] text-[#aaaaaa]'
                : 'text-[#555] hover:text-[#888]',
            ].join(' ')}
            title={`Interpolation: ${value}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Delete lane */}
      <button
        onClick={onDeleteLane}
        title="Remove automation lane"
        className="text-[10px] font-mono text-[#555] hover:text-red-400 flex-shrink-0"
        aria-label={`Remove ${parameterId} automation lane`}
      >
        ×
      </button>
    </div>
  );
}
