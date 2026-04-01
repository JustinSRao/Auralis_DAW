/**
 * PluginBrowser tests — Sprint 24
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PluginBrowser from '../PluginBrowser';
import { useVst3Store } from '../../../stores/vst3Store';

// ── Mock the store ────────────────────────────────────────────────────────────

vi.mock('../../../stores/vst3Store', () => ({
  useVst3Store: vi.fn(),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const instrumentPlugin = {
  id: '{AAAA-1111}',
  name: 'TestSynth',
  vendor: 'Acme Audio',
  version: '1.0.0',
  category: 'Instrument|Synth',
  bundle_path: 'C:\\VST3\\TestSynth.vst3',
  dll_path: 'C:\\VST3\\TestSynth.vst3\\Contents\\x86_64-win\\TestSynth.dll',
  is_instrument: true,
};

const effectPlugin = {
  id: '{BBBB-2222}',
  name: 'TestReverb',
  vendor: 'Acme Audio',
  version: '1.0.0',
  category: 'Fx|Reverb',
  bundle_path: 'C:\\VST3\\TestReverb.vst3',
  dll_path: 'C:\\VST3\\TestReverb.vst3\\Contents\\x86_64-win\\TestReverb.dll',
  is_instrument: false,
};

const loadedPlugin = {
  instance_id: 'uuid-abc',
  name: 'TestSynth',
  vendor: 'Acme Audio',
  is_instrument: true,
  params: [],
};

const defaultStore = {
  scanResults: [],
  loadedPlugins: {},
  openGuis: new Set<string>(),
  presets: {},
  isScanning: false,
  error: null,
  scanPlugins: vi.fn(),
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  openGui: vi.fn(),
  closeGui: vi.fn(),
  clearError: vi.fn(),
  fetchPresets: vi.fn(),
  applyPreset: vi.fn(),
};

function setupStore(overrides: Partial<typeof defaultStore> = {}) {
  const store = { ...defaultStore, ...overrides };
  (useVst3Store as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof store) => unknown) => selector(store),
  );
  return store;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PluginBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  it('renders scan button', () => {
    render(<PluginBrowser />);
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
  });

  it('clicking scan calls scanPlugins', () => {
    const store = setupStore();
    render(<PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /scan/i }));
    expect(store.scanPlugins).toHaveBeenCalledOnce();
  });

  it('renders plugins grouped by category', () => {
    setupStore({ scanResults: [instrumentPlugin, effectPlugin] });
    render(<PluginBrowser />);
    expect(screen.getByText('TestSynth')).toBeInTheDocument();
    expect(screen.getByText('TestReverb')).toBeInTheDocument();
    expect(screen.getByText(/Instruments/i)).toBeInTheDocument();
    expect(screen.getByText(/Effects/i)).toBeInTheDocument();
  });

  it('search input filters plugins by name', () => {
    setupStore({ scanResults: [instrumentPlugin, effectPlugin] });
    render(<PluginBrowser />);
    const searchInput = screen.getByRole('textbox', { name: /search/i });
    fireEvent.change(searchInput, { target: { value: 'Synth' } });
    expect(screen.getByText('TestSynth')).toBeInTheDocument();
    expect(screen.queryByText('TestReverb')).not.toBeInTheDocument();
  });

  it('drag start sets correct vst3/plugin data transfer', () => {
    setupStore({ scanResults: [instrumentPlugin] });
    render(<PluginBrowser />);
    const listItem = screen.getByText('TestSynth').closest('li')!;
    const setDataMock = vi.fn();
    const dataTransfer = {
      setData: setDataMock,
      effectAllowed: '',
    } as unknown as DataTransfer;
    fireEvent.dragStart(listItem, { dataTransfer });
    expect(setDataMock).toHaveBeenCalledWith(
      'vst3/plugin',
      JSON.stringify(instrumentPlugin),
    );
  });

  it('load button calls loadPlugin', () => {
    const store = setupStore({ scanResults: [instrumentPlugin] });
    render(<PluginBrowser />);
    const loadBtn = screen.getByRole('button', { name: /load TestSynth/i });
    fireEvent.click(loadBtn);
    expect(store.loadPlugin).toHaveBeenCalledWith(instrumentPlugin);
  });

  it('renders Open GUI button for loaded plugins', () => {
    setupStore({
      scanResults: [instrumentPlugin],
      loadedPlugins: { 'uuid-abc': loadedPlugin },
    });
    render(<PluginBrowser />);
    expect(
      screen.getByRole('button', { name: /open gui for TestSynth/i }),
    ).toBeInTheDocument();
  });

  it('Open GUI button calls openGui', () => {
    const store = setupStore({
      loadedPlugins: { 'uuid-abc': loadedPlugin },
    });
    render(<PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /open gui/i }));
    expect(store.openGui).toHaveBeenCalledWith('uuid-abc');
  });
});
