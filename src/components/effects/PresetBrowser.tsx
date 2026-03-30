import React, { useEffect, useState } from 'react';
import { useEffectChainStore } from '../../stores/effectChainStore';

interface PresetBrowserProps {
  channelId: string;
}

const PresetBrowser: React.FC<PresetBrowserProps> = ({ channelId }) => {
  const presetNames   = useEffectChainStore((s) => s.presetNames);
  const savePreset    = useEffectChainStore((s) => s.savePreset);
  const loadPreset    = useEffectChainStore((s) => s.loadPreset);
  const refreshPresets = useEffectChainStore((s) => s.refreshPresets);
  const [newName, setNewName] = useState('');

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    savePreset(channelId, name);
    setNewName('');
  };

  return (
    <div className="preset-browser" aria-label="Preset browser">
      <h4 className="preset-browser__title">Presets</h4>

      <div className="preset-browser__save">
        <input
          className="preset-browser__name-input"
          type="text"
          placeholder="Preset name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="Preset name input"
        />
        <button
          className="preset-browser__save-btn"
          onClick={handleSave}
          disabled={!newName.trim()}
          aria-label="Save preset"
        >
          Save
        </button>
      </div>

      <div className="preset-browser__list" aria-label="Preset list">
        {presetNames.length === 0 ? (
          <span className="preset-browser__empty">No presets saved</span>
        ) : (
          presetNames.map((name) => (
            <div key={name} className="preset-browser__entry">
              <span className="preset-browser__entry-name">{name}</span>
              <button
                className="preset-browser__load-btn"
                onClick={() => loadPreset(channelId, name)}
                aria-label={`Load preset ${name}`}
              >
                Load
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PresetBrowser;
