/**
 * Unit tests for FadeHandle component (Sprint 45).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ClipFadeState } from '../../../stores/fadeStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetFadeIn = vi.fn();
const mockSetFadeOut = vi.fn();
const mockSetCurveType = vi.fn();

let mockFade: ClipFadeState = {
  fadeInSamples: 0,
  fadeOutSamples: 0,
  fadeInCurve: 'linear',
  fadeOutCurve: 'linear',
  crossfadePartnerId: null,
  crossfadeSamples: 0,
};

vi.mock('../../../stores/fadeStore', () => ({
  useFadeStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      fades: { 'c1': mockFade },
      setFadeIn: mockSetFadeIn,
      setFadeOut: mockSetFadeOut,
      setCurveType: mockSetCurveType,
    }),
}));

import FadeHandle from '../FadeHandle';

describe('FadeHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFade = {
      fadeInSamples: 0,
      fadeOutSamples: 0,
      fadeInCurve: 'linear',
      fadeOutCurve: 'linear',
      crossfadePartnerId: null,
      crossfadeSamples: 0,
    };
  });

  it('renders a fade-in handle', () => {
    render(
      <FadeHandle
        clipId="c1" kind="in"
        x={100} y={10} height={60}
        fadeSamples={0}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    expect(screen.getByTestId('fade-handle-in')).toBeInTheDocument();
  });

  it('renders a fade-out handle', () => {
    render(
      <FadeHandle
        clipId="c1" kind="out"
        x={200} y={10} height={60}
        fadeSamples={0}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    expect(screen.getByTestId('fade-handle-out')).toBeInTheDocument();
  });

  it('double-click resets fade-in to 0', () => {
    mockFade.fadeInSamples = 1000;
    render(
      <FadeHandle
        clipId="c1" kind="in"
        x={100} y={10} height={60}
        fadeSamples={1000}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    fireEvent.dblClick(screen.getByTestId('fade-handle-in'));
    expect(mockSetFadeIn).toHaveBeenCalledWith('c1', 0, 'linear');
  });

  it('double-click resets fade-out to 0', () => {
    mockFade.fadeOutSamples = 2000;
    render(
      <FadeHandle
        clipId="c1" kind="out"
        x={200} y={10} height={60}
        fadeSamples={2000}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    fireEvent.dblClick(screen.getByTestId('fade-handle-out'));
    expect(mockSetFadeOut).toHaveBeenCalledWith('c1', 0, 'linear');
  });

  it('right-click opens curve type context menu', () => {
    render(
      <FadeHandle
        clipId="c1" kind="in"
        x={100} y={10} height={60}
        fadeSamples={500}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('fade-handle-in'));
    expect(screen.getByTestId('fade-curve-menu-in')).toBeInTheDocument();
  });

  it('selecting a curve calls setCurveType', () => {
    render(
      <FadeHandle
        clipId="c1" kind="in"
        x={100} y={10} height={60}
        fadeSamples={500}
        pixelsPerBar={80} samplesPerBar={44100}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('fade-handle-in'));
    fireEvent.click(screen.getByTestId('fade-curve-option-s_curve'));
    expect(mockSetCurveType).toHaveBeenCalledWith('c1', 'in', 's_curve');
  });
});
