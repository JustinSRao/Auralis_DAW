/**
 * Unit tests for OutputSelector component (Sprint 42).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupBusState } from '../../../stores/mixerStore';

// ---------------------------------------------------------------------------
// Mock mixer store
// ---------------------------------------------------------------------------

let mockGroupBuses: GroupBusState[] = [];

vi.mock('../../../stores/mixerStore', () => ({
  useMixerStore: (sel: (s: { groupBuses: GroupBusState[] }) => unknown) =>
    sel({ groupBuses: mockGroupBuses }),
}));

import OutputSelector from '../OutputSelector';

describe('OutputSelector', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
    mockGroupBuses = [
      {
        id: 0, name: 'Drums', outputTarget: { kind: 'master' },
        fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0,
      },
      {
        id: 1, name: 'Synths', outputTarget: { kind: 'master' },
        fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0,
      },
    ];
  });

  it('renders Master option', () => {
    render(
      <OutputSelector value={{ kind: 'master' }} onChange={onChange} />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
  });

  it('renders group bus options', () => {
    render(
      <OutputSelector value={{ kind: 'master' }} onChange={onChange} />,
    );
    expect(screen.getByText('Drums')).toBeInTheDocument();
    expect(screen.getByText('Synths')).toBeInTheDocument();
  });

  it('excludes the bus with excludeBusId', () => {
    render(
      <OutputSelector value={{ kind: 'master' }} onChange={onChange} excludeBusId={0} />,
    );
    expect(screen.queryByText('Drums')).toBeNull();
    expect(screen.getByText('Synths')).toBeInTheDocument();
  });

  it('calls onChange with master target when Master selected', () => {
    render(
      <OutputSelector value={{ kind: 'group', group_id: 0 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'master' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'master' });
  });

  it('calls onChange with group target when a bus is selected', () => {
    render(
      <OutputSelector value={{ kind: 'master' }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'group:1' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'group', group_id: 1 });
  });
});
