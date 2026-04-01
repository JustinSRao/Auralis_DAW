import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Vst3PluginBrowser from '../Vst3PluginBrowser';
import { useVst3Store } from '../../../stores/vst3Store';

// ─── Mock the store ──────────────────────────────────────────────────────────

vi.mock('../../../stores/vst3Store', () => ({
  useVst3Store: vi.fn(),
}));

// ─── Test data ───────────────────────────────────────────────────────────────

const mockPlugin = {
  id: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
  name: 'TestSynth',
  vendor: 'Acme Audio',
  version: '1.0.0',
  category: 'Instrument|Synth',
  bundle_path: 'C:\\VST3\\TestSynth.vst3',
  dll_path: 'C:\\VST3\\TestSynth.vst3\\Contents\\x86_64-win\\TestSynth.vst3',
  is_instrument: true,
};

const mockLoadedView = {
  instance_id: 'uuid-1234',
  name: 'TestSynth',
  vendor: 'Acme Audio',
  is_instrument: true,
  params: [],
};

// ─── Store mock factory ──────────────────────────────────────────────────────

const mockScanPlugins = vi.fn();
const mockLoadPlugin   = vi.fn();
const mockUnloadPlugin = vi.fn();
const mockClearError   = vi.fn();

function makeStoreMock(overrides: Record<string, unknown> = {}) {
  const state = {
    scanResults:   [] as typeof mockPlugin[],
    loadedPlugins: {} as Record<string, typeof mockLoadedView>,
    isScanning:    false,
    error:         null as string | null,
    scanPlugins:   mockScanPlugins,
    loadPlugin:    mockLoadPlugin,
    unloadPlugin:  mockUnloadPlugin,
    clearError:    mockClearError,
    setParam:      vi.fn(),
    refreshParams: vi.fn(),
    saveState:     vi.fn(),
    loadState:     vi.fn(),
    ...overrides,
  };
  (useVst3Store as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  makeStoreMock();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Vst3PluginBrowser', () => {
  it('renders the scan button', () => {
    render(<Vst3PluginBrowser />);
    expect(screen.getByRole('button', { name: /scan for vst3 plugins/i })).toBeDefined();
  });

  it('shows "Scanning…" text while scanning', () => {
    makeStoreMock({ isScanning: true });
    render(<Vst3PluginBrowser />);
    expect(screen.getByText('Scanning…')).toBeDefined();
  });

  it('calls scanPlugins when scan button is clicked', () => {
    mockScanPlugins.mockResolvedValue(undefined);
    render(<Vst3PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /scan for vst3 plugins/i }));
    expect(mockScanPlugins).toHaveBeenCalledTimes(1);
  });

  it('shows empty state message when no scan results', () => {
    render(<Vst3PluginBrowser />);
    expect(screen.getByText(/click scan to discover/i)).toBeDefined();
  });

  it('renders scan results with load buttons', () => {
    makeStoreMock({ scanResults: [mockPlugin] });
    render(<Vst3PluginBrowser />);
    expect(screen.getByText('TestSynth')).toBeDefined();
    expect(screen.getByRole('button', { name: /load TestSynth/i })).toBeDefined();
  });

  it('calls loadPlugin when load button is clicked', async () => {
    mockLoadPlugin.mockResolvedValue(mockLoadedView);
    makeStoreMock({ scanResults: [mockPlugin] });
    render(<Vst3PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /load TestSynth/i }));
    await waitFor(() => expect(mockLoadPlugin).toHaveBeenCalledWith(mockPlugin));
  });

  it('fires onPluginLoaded callback after successful load', async () => {
    mockLoadPlugin.mockResolvedValue(mockLoadedView);
    makeStoreMock({ scanResults: [mockPlugin] });
    const onLoaded = vi.fn();
    render(<Vst3PluginBrowser onPluginLoaded={onLoaded} />);
    fireEvent.click(screen.getByRole('button', { name: /load TestSynth/i }));
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(mockLoadedView));
  });

  it('shows loaded plugin in the Loaded section', () => {
    makeStoreMock({ loadedPlugins: { 'uuid-1234': mockLoadedView } });
    render(<Vst3PluginBrowser />);
    const loaded = screen.getAllByText('TestSynth');
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /unload TestSynth/i })).toBeDefined();
  });

  it('calls unloadPlugin when unload button is clicked', async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    makeStoreMock({ loadedPlugins: { 'uuid-1234': mockLoadedView } });
    render(<Vst3PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /unload TestSynth/i }));
    await waitFor(() =>
      expect(mockUnloadPlugin).toHaveBeenCalledWith('uuid-1234'),
    );
  });

  it('renders an error banner when error is set', () => {
    makeStoreMock({ error: 'Plugin failed to load' });
    render(<Vst3PluginBrowser />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Plugin failed to load')).toBeDefined();
  });

  it('calls clearError when dismiss button is clicked', () => {
    makeStoreMock({ error: 'oops' });
    render(<Vst3PluginBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(mockClearError).toHaveBeenCalledTimes(1);
  });

  it('shows vendor name in the scan results list', () => {
    makeStoreMock({ scanResults: [mockPlugin] });
    render(<Vst3PluginBrowser />);
    expect(screen.getByText('Acme Audio')).toBeDefined();
  });

  it('shows "Instr" badge for instrument plugins', () => {
    makeStoreMock({ scanResults: [mockPlugin] });
    render(<Vst3PluginBrowser />);
    expect(screen.getByText('Instr')).toBeDefined();
  });
});
