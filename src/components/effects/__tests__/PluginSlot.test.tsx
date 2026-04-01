/**
 * PluginSlot tests — Sprint 24
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PluginSlot from '../PluginSlot';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const defaultProps = {
  instanceId: 'uuid-abc',
  pluginName: 'TestSynth',
  isBypassed: false,
  onOpenGui: vi.fn(),
  onBypassToggle: vi.fn(),
  onRemove: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PluginSlot', () => {
  it('renders the plugin name', () => {
    render(<PluginSlot {...defaultProps} />);
    expect(screen.getByText('TestSynth')).toBeInTheDocument();
  });

  it('Open GUI button calls onOpenGui', () => {
    const onOpenGui = vi.fn();
    render(<PluginSlot {...defaultProps} onOpenGui={onOpenGui} />);
    fireEvent.click(screen.getByRole('button', { name: /open gui/i }));
    expect(onOpenGui).toHaveBeenCalledOnce();
  });

  it('bypass toggle calls onBypassToggle', () => {
    const onBypassToggle = vi.fn();
    render(<PluginSlot {...defaultProps} onBypassToggle={onBypassToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /bypass/i }));
    expect(onBypassToggle).toHaveBeenCalledOnce();
  });

  it('remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(<PluginSlot {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('drop target fires onDrop with parsed plugin info', () => {
    const onDrop = vi.fn();
    const pluginInfo = {
      id: '{AAAA-1111}',
      name: 'TestSynth',
      vendor: 'Acme Audio',
      version: '1.0.0',
      category: 'Instrument|Synth',
      bundle_path: 'C:\\VST3\\TestSynth.vst3',
      dll_path: 'C:\\VST3\\TestSynth.vst3\\x64\\TestSynth.dll',
      is_instrument: true,
    };
    render(<PluginSlot {...defaultProps} onDrop={onDrop} />);
    const slot = screen.getByRole('listitem');
    // Simulate dragover then drop.
    fireEvent.dragOver(slot, {
      dataTransfer: { types: ['vst3/plugin'] },
    });
    fireEvent.drop(slot, {
      dataTransfer: {
        getData: (key: string) =>
          key === 'vst3/plugin' ? JSON.stringify(pluginInfo) : '',
      },
    });
    expect(onDrop).toHaveBeenCalledWith(pluginInfo);
  });

  it('shows bypass state is Off when not bypassed', () => {
    render(<PluginSlot {...defaultProps} isBypassed={false} />);
    expect(screen.getByRole('button', { name: /bypass/i })).toHaveTextContent('Off');
  });

  it('shows bypass state as On when bypassed', () => {
    render(<PluginSlot {...defaultProps} isBypassed={true} />);
    expect(screen.getByRole('button', { name: /enable/i })).toHaveTextContent('On');
  });
});
