import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PresetBrowser from '../PresetBrowser';
import { useEffectChainStore } from '../../../stores/effectChainStore';

vi.mock('../../../stores/effectChainStore', () => ({
  useEffectChainStore: vi.fn(),
}));

const mockSavePreset    = vi.fn();
const mockLoadPreset    = vi.fn();
const mockRefreshPresets = vi.fn();

function setupStore(presetNames: string[] = []) {
  (useEffectChainStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) =>
      selector({
        presetNames,
        savePreset:     mockSavePreset,
        loadPreset:     mockLoadPreset,
        refreshPresets: mockRefreshPresets,
      })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupStore();
});

describe('PresetBrowser', () => {
  it('renders preset browser', () => {
    render(<PresetBrowser channelId="ch1" />);
    expect(screen.getByLabelText('Preset browser')).toBeDefined();
  });

  it('calls refreshPresets on mount', () => {
    render(<PresetBrowser channelId="ch1" />);
    expect(mockRefreshPresets).toHaveBeenCalled();
  });

  it('shows empty state when no presets', () => {
    render(<PresetBrowser channelId="ch1" />);
    expect(screen.getByText('No presets saved')).toBeDefined();
  });

  it('renders preset list when presets exist', () => {
    setupStore(['my-preset', 'another']);
    render(<PresetBrowser channelId="ch1" />);
    expect(screen.getByText('my-preset')).toBeDefined();
    expect(screen.getByText('another')).toBeDefined();
  });

  it('calls loadPreset when Load button clicked', () => {
    setupStore(['my-preset']);
    render(<PresetBrowser channelId="ch1" />);
    fireEvent.click(screen.getByLabelText('Load preset my-preset'));
    expect(mockLoadPreset).toHaveBeenCalledWith('ch1', 'my-preset');
  });

  it('calls savePreset when Save button clicked with valid name', () => {
    render(<PresetBrowser channelId="ch1" />);
    const input = screen.getByLabelText('Preset name input');
    fireEvent.change(input, { target: { value: 'my-chain' } });
    fireEvent.click(screen.getByLabelText('Save preset'));
    expect(mockSavePreset).toHaveBeenCalledWith('ch1', 'my-chain');
  });

  it('disables Save button when name is empty', () => {
    render(<PresetBrowser channelId="ch1" />);
    expect((screen.getByLabelText('Save preset') as HTMLButtonElement).disabled).toBe(true);
  });
});
