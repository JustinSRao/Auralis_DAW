/**
 * Unit tests for FadeCurveOverlay component (Sprint 45).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FadeCurveOverlay from '../FadeCurveOverlay';

describe('FadeCurveOverlay', () => {
  it('renders nothing when both fades are 0', () => {
    const { container } = render(
      <FadeCurveOverlay
        clipX={100} clipY={10} clipWidth={200} clipHeight={60}
        fadeInSamples={0} fadeOutSamples={0}
        totalSamples={44100}
        fadeInCurve="linear" fadeOutCurve="linear"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders SVG when fade-in > 0', () => {
    render(
      <FadeCurveOverlay
        clipX={100} clipY={10} clipWidth={200} clipHeight={60}
        fadeInSamples={4410} fadeOutSamples={0}
        totalSamples={44100}
        fadeInCurve="linear" fadeOutCurve="linear"
      />,
    );
    expect(screen.getByTestId('fade-curve-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('fade-in-curve')).toBeInTheDocument();
    expect(screen.queryByTestId('fade-out-curve')).toBeNull();
  });

  it('renders SVG when fade-out > 0', () => {
    render(
      <FadeCurveOverlay
        clipX={100} clipY={10} clipWidth={200} clipHeight={60}
        fadeInSamples={0} fadeOutSamples={4410}
        totalSamples={44100}
        fadeInCurve="linear" fadeOutCurve="linear"
      />,
    );
    expect(screen.getByTestId('fade-curve-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('fade-out-curve')).toBeInTheDocument();
    expect(screen.queryByTestId('fade-in-curve')).toBeNull();
  });

  it('renders both fade polygons when both are > 0', () => {
    render(
      <FadeCurveOverlay
        clipX={0} clipY={0} clipWidth={300} clipHeight={64}
        fadeInSamples={4410} fadeOutSamples={4410}
        totalSamples={44100}
        fadeInCurve="s_curve" fadeOutCurve="s_curve"
      />,
    );
    expect(screen.getByTestId('fade-in-curve')).toBeInTheDocument();
    expect(screen.getByTestId('fade-out-curve')).toBeInTheDocument();
  });

  it('fade-in polygon has a non-empty points attribute', () => {
    render(
      <FadeCurveOverlay
        clipX={50} clipY={10} clipWidth={200} clipHeight={60}
        fadeInSamples={2000} fadeOutSamples={0}
        totalSamples={10000}
        fadeInCurve="exponential_in" fadeOutCurve="linear"
      />,
    );
    const poly = screen.getByTestId('fade-in-curve');
    expect(poly.getAttribute('points')).toBeTruthy();
  });
});
