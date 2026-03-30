import React, { useEffect, useRef } from 'react';
import { useEffectChainStore } from '../../stores/effectChainStore';
import { Knob } from '../instruments/Knob';
import type { SlotStateSnapshot } from '../../lib/ipc';

interface EffectChainPanelProps {
  channelId: string;
}

function effectLabel(type: SlotStateSnapshot['effect_type']): string {
  switch (type) {
    case 'eq_8_band':  return '8-Band EQ';
    case 'reverb':     return 'Reverb';
    case 'delay':      return 'Delay';
    case 'compressor': return 'Compressor';
    case 'limiter':    return 'Limiter';
    case 'gate':       return 'Noise Gate';
  }
}

interface SlotRowProps {
  channelId: string;
  slot: SlotStateSnapshot;
  index: number;
  total: number;
}

const SlotRow: React.FC<SlotRowProps> = ({ channelId, slot, index, total }) => {
  const setBypass  = useEffectChainStore((s) => s.setBypass);
  const setWetDry  = useEffectChainStore((s) => s.setWetDry);
  const removeEffect = useEffectChainStore((s) => s.removeEffect);
  const moveEffect = useEffectChainStore((s) => s.moveEffect);

  return (
    <div
      className={`effect-slot${slot.bypass ? ' effect-slot--bypassed' : ''}`}
      aria-label={`Effect slot ${effectLabel(slot.effect_type)}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(fromIndex) && fromIndex !== index) {
          moveEffect(channelId, fromIndex, index);
        }
      }}
    >
      <span className="effect-slot__drag-handle" aria-hidden="true">⠿</span>

      <button
        className={`effect-slot__move-up`}
        onClick={() => moveEffect(channelId, index, index - 1)}
        disabled={index === 0}
        aria-label="Move effect up"
      >
        ▲
      </button>
      <button
        className={`effect-slot__move-down`}
        onClick={() => moveEffect(channelId, index, index + 1)}
        disabled={index === total - 1}
        aria-label="Move effect down"
      >
        ▼
      </button>

      <span className="effect-slot__label">{effectLabel(slot.effect_type)}</span>

      <label className="effect-slot__bypass" aria-label="Bypass toggle">
        <input
          type="checkbox"
          checked={slot.bypass}
          onChange={(e) => setBypass(channelId, slot.slot_id, e.target.checked)}
        />
        Bypass
      </label>

      <Knob
        label="W/D"
        value={slot.wet_dry}
        onValue={(v) => setWetDry(channelId, slot.slot_id, v)}
        displayValue={`${Math.round(slot.wet_dry * 100)}%`}
      />

      <button
        className="effect-slot__remove"
        onClick={() => removeEffect(channelId, slot.slot_id)}
        aria-label={`Remove ${effectLabel(slot.effect_type)}`}
      >
        ✕
      </button>
    </div>
  );
};

const EffectChainPanel: React.FC<EffectChainPanelProps> = ({ channelId }) => {
  const chain     = useEffectChainStore((s) => s.chains[channelId]);
  const loadChain = useEffectChainStore((s) => s.loadChain);

  useEffect(() => { loadChain(channelId); }, [channelId, loadChain]);

  return (
    <div className="effect-chain-panel" aria-label={`Effect chain for channel ${channelId}`}>
      <h3 className="effect-chain-panel__title">Effect Chain</h3>

      {!chain || chain.slots.length === 0 ? (
        <div className="effect-chain-panel__empty" aria-label="No effects in chain">
          No effects — add from the browser below
        </div>
      ) : (
        <div className="effect-chain-panel__slots">
          {chain.slots.map((slot, i) => (
            <SlotRow
              key={slot.slot_id}
              channelId={channelId}
              slot={slot}
              index={i}
              total={chain.slots.length}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default EffectChainPanel;
