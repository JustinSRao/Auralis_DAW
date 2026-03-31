import React from 'react';
import { useMixerStore } from '../../stores/mixerStore';
import type { OutputTargetDto } from '../../lib/ipc';

interface Props {
  /** Current routing target */
  value: OutputTargetDto;
  /** Called when the user selects a new target */
  onChange: (target: OutputTargetDto) => void;
  /** Bus ID to exclude (prevents a bus routing to itself) */
  excludeBusId?: number;
}

/**
 * Dropdown that lets the user choose between Master and any available group bus
 * as an output routing destination.
 */
const OutputSelector: React.FC<Props> = ({ value, onChange, excludeBusId }) => {
  const groupBuses = useMixerStore((s) => s.groupBuses);

  const currentValue =
    value.kind === 'master' ? 'master' : `group:${value.group_id}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === 'master') {
      onChange({ kind: 'master' });
    } else {
      const id = parseInt(v.replace('group:', ''), 10);
      onChange({ kind: 'group', group_id: id });
    }
  };

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      className="text-xs bg-neutral-800 border border-neutral-600 rounded px-1 py-0.5 text-neutral-200 w-full"
      aria-label="Output routing"
    >
      <option value="master">Master</option>
      {groupBuses
        .filter((gb) => gb.id !== excludeBusId)
        .map((gb) => (
          <option key={gb.id} value={`group:${gb.id}`}>
            {gb.name}
          </option>
        ))}
    </select>
  );
};

export default OutputSelector;
