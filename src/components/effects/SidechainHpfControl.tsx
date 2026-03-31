/**
 * Sidechain high-pass filter control (Sprint 39).
 *
 * Shows a logarithmic-scale frequency knob (20–500 Hz) and an enable/disable
 * toggle.  Only rendered when a sidechain source is active.
 */
import React from 'react';
import { Knob } from '../instruments/Knob';

const HPF_MIN = 20;
const HPF_MAX = 500;

/** Maps a linear knob position [0,1] to a log-scaled Hz value. */
function normToHz(n: number): number {
  return HPF_MIN * Math.pow(HPF_MAX / HPF_MIN, Math.max(0, Math.min(1, n)));
}

/** Maps Hz to a linear knob position [0,1]. */
function hzToNorm(hz: number): number {
  return Math.log(hz / HPF_MIN) / Math.log(HPF_MAX / HPF_MIN);
}

interface SidechainHpfControlProps {
  cutoffHz: number;
  enabled: boolean;
  onCutoffChange: (hz: number) => void;
  onEnabledChange: (enabled: boolean) => void;
}

const SidechainHpfControl: React.FC<SidechainHpfControlProps> = ({
  cutoffHz,
  enabled,
  onCutoffChange,
  onEnabledChange,
}) => (
  <div className="sidechain-hpf" aria-label="Sidechain HPF control">
    <span className="sidechain-hpf__label">SC HPF</span>
    <Knob
      label="Cutoff"
      value={hzToNorm(cutoffHz)}
      onValue={(n) => onCutoffChange(normToHz(n))}
      displayValue={`${Math.round(cutoffHz)}Hz`}
    />
    <label className="sidechain-hpf__toggle" aria-label="HPF enabled">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onEnabledChange(e.target.checked)}
      />
      <span>{enabled ? 'On' : 'Off'}</span>
    </label>
  </div>
);

export default SidechainHpfControl;
