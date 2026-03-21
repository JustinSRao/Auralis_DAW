/**
 * Unit tests for BiquadBandControl component (Sprint 18).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BiquadBandControl from '../BiquadBandControl';
import type { EqBandParams } from '../../../lib/ipc';

const peakingBand: EqBandParams = {
  filter_type: 'peaking',
  frequency: 1000,
  gain_db: 6,
  q: 1.0,
  enabled: true,
};

const hpBand: EqBandParams = {
  filter_type: 'high_pass',
  frequency: 80,
  gain_db: 0,
  q: 1.0,
  enabled: true,
};

const lsBand: EqBandParams = {
  filter_type: 'low_shelf',
  frequency: 200,
  gain_db: 3,
  q: 1.0,
  enabled: true,
};

describe('BiquadBandControl', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let onEnableToggle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    onEnableToggle = vi.fn();
  });

  it('renders the filter type label for a peaking band', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={peakingBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('PK')).toBeTruthy();
  });

  it('renders HP label for high-pass band', () => {
    render(
      <BiquadBandControl
        bandIndex={0}
        params={hpBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('HP')).toBeTruthy();
  });

  it('renders LS label for low-shelf band', () => {
    render(
      <BiquadBandControl
        bandIndex={1}
        params={lsBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('LS')).toBeTruthy();
  });

  it('enable toggle calls onEnableToggle with inverted value (true → false)', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: true }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /disable band/i }));
    expect(onEnableToggle).toHaveBeenCalledOnce();
    expect(onEnableToggle).toHaveBeenCalledWith(3, false);
  });

  it('enable toggle calls onEnableToggle with inverted value (false → true)', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: false }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /enable band/i }));
    expect(onEnableToggle).toHaveBeenCalledWith(3, true);
  });

  it('enable toggle button has active style when band is enabled', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: true }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('PK').className).toContain('bg-blue-600');
  });

  it('enable toggle button has inactive style when band is disabled', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: false }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('PK').className).toContain('bg-gray-700');
  });

  it('renders frequency knob with aria-label', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={peakingBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByLabelText('frequency knob')).toBeTruthy();
  });

  it('renders gain knob for peaking band', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={peakingBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByLabelText('gain knob')).toBeTruthy();
  });

  it('renders Q knob for peaking band', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={peakingBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByLabelText('Q knob')).toBeTruthy();
  });

  it('does NOT render gain knob for HP band', () => {
    render(
      <BiquadBandControl
        bandIndex={0}
        params={hpBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.queryByLabelText('gain knob')).toBeNull();
  });

  it('does NOT render Q knob for low-shelf band', () => {
    render(
      <BiquadBandControl
        bandIndex={1}
        params={lsBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.queryByLabelText('Q knob')).toBeNull();
  });

  it('renders gain knob for low-shelf band', () => {
    render(
      <BiquadBandControl
        bandIndex={1}
        params={lsBand}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByLabelText('gain knob')).toBeTruthy();
  });

  it('displays frequency label in kHz when >= 1000 Hz', () => {
    render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, frequency: 4000 }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('4.0k')).toBeTruthy();
  });

  it('displays frequency label in Hz when < 1000 Hz', () => {
    render(
      <BiquadBandControl
        bandIndex={0}
        params={{ ...hpBand, frequency: 80 }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    expect(screen.getByText('80')).toBeTruthy();
  });

  it('applies reduced opacity when band is disabled', () => {
    const { container } = render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: false }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe('0.45');
  });

  it('has full opacity when band is enabled', () => {
    const { container } = render(
      <BiquadBandControl
        bandIndex={3}
        params={{ ...peakingBand, enabled: true }}
        onChange={onChange}
        onEnableToggle={onEnableToggle}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe('1');
  });
});
