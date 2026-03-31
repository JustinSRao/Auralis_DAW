import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SidechainHpfControl from '../SidechainHpfControl';

// Mock Knob so tests don't depend on canvas/complex knob internals
vi.mock('../../instruments/Knob', () => ({
  Knob: ({ label, displayValue, onValue }: { label: string; displayValue: string; onValue: (v: number) => void }) => (
    <div>
      <span>{label}</span>
      <span data-testid="knob-value">{displayValue}</span>
      <button onClick={() => onValue(0.5)}>{label}-midpoint</button>
    </div>
  ),
}));

describe('SidechainHpfControl', () => {
  it('renders with cutoff and enabled state', () => {
    render(
      <SidechainHpfControl
        cutoffHz={100}
        enabled={true}
        onCutoffChange={vi.fn()}
        onEnabledChange={vi.fn()}
      />,
    );
    expect(screen.getByText('100Hz')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('shows Off when HPF is disabled', () => {
    render(
      <SidechainHpfControl
        cutoffHz={200}
        enabled={false}
        onCutoffChange={vi.fn()}
        onEnabledChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('calls onEnabledChange when toggle is clicked', () => {
    const onEnabled = vi.fn();
    render(
      <SidechainHpfControl
        cutoffHz={100}
        enabled={true}
        onCutoffChange={vi.fn()}
        onEnabledChange={onEnabled}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onEnabled).toHaveBeenCalledWith(false);
  });

  it('calls onCutoffChange when knob moves', () => {
    const onCutoff = vi.fn();
    render(
      <SidechainHpfControl
        cutoffHz={100}
        enabled={true}
        onCutoffChange={onCutoff}
        onEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Cutoff-midpoint'));
    expect(onCutoff).toHaveBeenCalled();
    const hz = onCutoff.mock.calls[0][0] as number;
    expect(hz).toBeGreaterThan(20);
    expect(hz).toBeLessThan(500);
  });
});
