import React from 'react';
import { useEffectChainStore } from '../../stores/effectChainStore';
import type { EffectType } from '../../lib/ipc';

interface EffectBrowserProps {
  channelId: string;
}

const EFFECT_CATEGORIES: { label: string; effects: { type: EffectType; label: string }[] }[] = [
  {
    label: 'Dynamics',
    effects: [
      { type: 'compressor', label: 'Compressor' },
      { type: 'limiter',    label: 'Limiter' },
      { type: 'gate',       label: 'Noise Gate' },
    ],
  },
  {
    label: 'EQ',
    effects: [
      { type: 'eq_8_band', label: '8-Band EQ' },
    ],
  },
  {
    label: 'Time/Space',
    effects: [
      { type: 'reverb', label: 'Reverb' },
      { type: 'delay',  label: 'Delay' },
    ],
  },
];

const EffectBrowser: React.FC<EffectBrowserProps> = ({ channelId }) => {
  const addEffect = useEffectChainStore((s) => s.addEffect);

  return (
    <div className="effect-browser" aria-label="Effect browser">
      <h4 className="effect-browser__title">Effects</h4>
      {EFFECT_CATEGORIES.map((cat) => (
        <div key={cat.label} className="effect-browser__category">
          <span className="effect-browser__category-label">{cat.label}</span>
          <div className="effect-browser__items">
            {cat.effects.map((eff) => (
              <button
                key={eff.type}
                className="effect-browser__item"
                aria-label={`Add ${eff.label}`}
                onClick={() => addEffect(channelId, eff.type)}
              >
                {eff.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default EffectBrowser;
