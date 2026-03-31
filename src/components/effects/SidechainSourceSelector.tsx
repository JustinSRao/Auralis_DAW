/**
 * Dropdown for selecting a sidechain source channel (Sprint 39).
 *
 * Shows "None (Self)" plus all mixer channels by name.  When a source is
 * selected, calls `onSelect(sourceChannelId)`.  When "None" is selected,
 * calls `onRemove()`.  The active source name is highlighted in green.
 */
import React from 'react';

interface ChannelOption {
  id: string;
  name: string;
}

interface SidechainSourceSelectorProps {
  /** All mixer channels available as sidechain sources. */
  channels: ChannelOption[];
  /** Currently selected source channel ID, or null if self. */
  value: string | null;
  /** Called with the selected channel ID when a sidechain source is chosen. */
  onSelect: (sourceChannelId: string) => void;
  /** Called when "None (Self)" is selected. */
  onRemove: () => void;
}

const SidechainSourceSelector: React.FC<SidechainSourceSelectorProps> = ({
  channels,
  value,
  onSelect,
  onRemove,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === '__none__') {
      onRemove();
    } else {
      onSelect(v);
    }
  };

  return (
    <div className="sidechain-source-selector" aria-label="Sidechain source selector">
      <label className="sidechain-source-selector__label" htmlFor="sidechain-src">
        Sidechain
      </label>
      <select
        id="sidechain-src"
        className="sidechain-source-selector__select"
        value={value ?? '__none__'}
        onChange={handleChange}
        style={{ color: value != null ? '#4ade80' : undefined }}
      >
        <option value="__none__">None (Self)</option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SidechainSourceSelector;
