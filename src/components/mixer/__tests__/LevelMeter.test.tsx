/**
 * Unit tests for LevelMeter component (Sprint 17).
 */

import { describe, it, expect } from 'vitest';
import { render, container } from '@testing-library/react';
import LevelMeter from '../LevelMeter';

describe('LevelMeter', () => {
  it('renders without crashing', () => {
    const { container: c } = render(<LevelMeter peakL={0} peakR={0} />);
    expect(c.firstChild).toBeTruthy();
  });

  it('shows red clip indicator for left channel when peakL exceeds 1.0', () => {
    const { container: c } = render(<LevelMeter peakL={1.2} peakR={0.5} />);
    // The left clip indicator has bg-red-500 when clipping
    const redDivs = c.querySelectorAll('.bg-red-500');
    expect(redDivs.length).toBeGreaterThanOrEqual(1);
  });

  it('shows red clip indicator for right channel when peakR exceeds 1.0', () => {
    const { container: c } = render(<LevelMeter peakL={0.5} peakR={1.5} />);
    const redDivs = c.querySelectorAll('.bg-red-500');
    expect(redDivs.length).toBeGreaterThanOrEqual(1);
  });

  it('shows red clip indicators for both channels when both exceed 1.0', () => {
    const { container: c } = render(<LevelMeter peakL={1.1} peakR={1.3} />);
    const redDivs = c.querySelectorAll('.bg-red-500');
    expect(redDivs.length).toBe(2);
  });

  it('does not show red clip indicator when peakL is at exactly 1.0', () => {
    const { container: c } = render(<LevelMeter peakL={1.0} peakR={0} />);
    const redDivs = c.querySelectorAll('.bg-red-500');
    expect(redDivs.length).toBe(0);
  });

  it('does not show red clip indicator when peakL is below 1.0', () => {
    const { container: c } = render(<LevelMeter peakL={0.8} peakR={0.6} />);
    const redDivs = c.querySelectorAll('.bg-red-500');
    expect(redDivs.length).toBe(0);
  });

  it('renders two channel meter columns', () => {
    const { container: c } = render(<LevelMeter peakL={0.5} peakR={0.5} />);
    // The outer flex div has two column children (left + right channels)
    const outerDiv = c.firstChild as HTMLElement;
    expect(outerDiv.children.length).toBe(2);
  });

  it('accepts a custom height prop', () => {
    const { container: c } = render(<LevelMeter peakL={0} peakR={0} height={120} />);
    const outerDiv = c.firstChild as HTMLElement;
    expect(outerDiv.style.height).toBe('120px');
  });
});
