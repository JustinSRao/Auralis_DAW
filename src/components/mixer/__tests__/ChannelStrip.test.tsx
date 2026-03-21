/**
 * Unit tests for ChannelStrip component (Sprint 17).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the mixer store — must be declared before the component import.
// ---------------------------------------------------------------------------

const mockSetChannelFader = vi.fn();
const mockSetChannelPan = vi.fn();
const mockSetChannelMute = vi.fn();
const mockSetChannelSolo = vi.fn();
const mockSetChannelSend = vi.fn();

interface MockChannel {
  id: string;
  name: string;
  fader: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  sends: [number, number, number, number];
  peakL: number;
  peakR: number;
}

let mockChannel: MockChannel = {
  id: 'ch-1',
  name: 'Kick',
  fader: 1.0,
  pan: 0,
  mute: false,
  solo: false,
  sends: [0, 0, 0, 0],
  peakL: 0,
  peakR: 0,
};

let mockBuses: { id: string; name: string; fader: number }[] = [];

vi.mock('../../../stores/mixerStore', () => ({
  useMixerStore: (selector: (s: unknown) => unknown) => {
    const state = {
      channels: { 'ch-1': mockChannel },
      buses: mockBuses,
      setChannelFader: mockSetChannelFader,
      setChannelPan: mockSetChannelPan,
      setChannelMute: mockSetChannelMute,
      setChannelSolo: mockSetChannelSolo,
      setChannelSend: mockSetChannelSend,
    };
    return selector(state);
  },
}));

import ChannelStrip from '../ChannelStrip';

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockChannel = {
    id: 'ch-1',
    name: 'Kick',
    fader: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    sends: [0, 0, 0, 0],
    peakL: 0,
    peakR: 0,
  };
  mockBuses = [];
});

describe('ChannelStrip', () => {
  it('renders the channel name', () => {
    render(<ChannelStrip channelId="ch-1" />);
    expect(screen.getByText('Kick')).toBeTruthy();
  });

  it('renders mute button', () => {
    render(<ChannelStrip channelId="ch-1" />);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('renders solo button', () => {
    render(<ChannelStrip channelId="ch-1" />);
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('mute button click calls setChannelMute with toggled value (false → true)', () => {
    mockChannel = { ...mockChannel, mute: false };
    render(<ChannelStrip channelId="ch-1" />);
    fireEvent.click(screen.getByText('M'));
    expect(mockSetChannelMute).toHaveBeenCalledOnce();
    expect(mockSetChannelMute).toHaveBeenCalledWith('ch-1', true);
  });

  it('mute button click calls setChannelMute with toggled value (true → false)', () => {
    mockChannel = { ...mockChannel, mute: true };
    render(<ChannelStrip channelId="ch-1" />);
    fireEvent.click(screen.getByText('M'));
    expect(mockSetChannelMute).toHaveBeenCalledWith('ch-1', false);
  });

  it('solo button click calls setChannelSolo with toggled value (false → true)', () => {
    mockChannel = { ...mockChannel, solo: false };
    render(<ChannelStrip channelId="ch-1" />);
    fireEvent.click(screen.getByText('S'));
    expect(mockSetChannelSolo).toHaveBeenCalledOnce();
    expect(mockSetChannelSolo).toHaveBeenCalledWith('ch-1', true);
  });

  it('solo button click calls setChannelSolo with toggled value (true → false)', () => {
    mockChannel = { ...mockChannel, solo: true };
    render(<ChannelStrip channelId="ch-1" />);
    fireEvent.click(screen.getByText('S'));
    expect(mockSetChannelSolo).toHaveBeenCalledWith('ch-1', false);
  });

  it('returns null when channelId is unknown', () => {
    const { container } = render(<ChannelStrip channelId="does-not-exist" />);
    expect(container.firstChild).toBeNull();
  });

  it('mute button has active style when muted', () => {
    mockChannel = { ...mockChannel, mute: true };
    render(<ChannelStrip channelId="ch-1" />);
    const muteBtn = screen.getByText('M');
    expect(muteBtn.className).toContain('bg-yellow-500');
  });

  it('solo button has active style when soloed', () => {
    mockChannel = { ...mockChannel, solo: true };
    render(<ChannelStrip channelId="ch-1" />);
    const soloBtn = screen.getByText('S');
    expect(soloBtn.className).toContain('bg-green-500');
  });

  it('renders send knobs for each bus', () => {
    mockBuses = [
      { id: 'bus-1', name: 'Reverb', fader: 1.0 },
      { id: 'bus-2', name: 'Delay', fader: 1.0 },
    ];
    render(<ChannelStrip channelId="ch-1" />);
    // Bus names are truncated to 3 chars in the label
    expect(screen.getByText('Rev')).toBeTruthy();
    expect(screen.getByText('Del')).toBeTruthy();
  });
});
