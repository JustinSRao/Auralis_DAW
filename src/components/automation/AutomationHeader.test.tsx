/**
 * Tests for AutomationHeader (Sprint 14).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationHeader } from './AutomationHeader';

describe('AutomationHeader', () => {
  function setup(overrides = {}) {
    const props = {
      parameterId: 'synth.cutoff',
      enabled: true,
      activeInterp: 'Linear' as const,
      onToggleEnabled: vi.fn(),
      onInterpChange: vi.fn(),
      onDeleteLane: vi.fn(),
      ...overrides,
    };
    render(<AutomationHeader {...props} />);
    return props;
  }

  it('renders the parameter id', () => {
    setup();
    expect(screen.getByText('synth.cutoff')).toBeDefined();
  });

  it('calls onToggleEnabled when the enable toggle is clicked', () => {
    const { onToggleEnabled } = setup();
    const btn = screen.getByRole('button', { name: /Toggle synth.cutoff/i });
    fireEvent.click(btn);
    expect(onToggleEnabled).toHaveBeenCalledOnce();
  });

  it('calls onDeleteLane when the × button is clicked', () => {
    const { onDeleteLane } = setup();
    const btn = screen.getByRole('button', { name: /Remove synth.cutoff/i });
    fireEvent.click(btn);
    expect(onDeleteLane).toHaveBeenCalledOnce();
  });

  it('calls onInterpChange with Exponential when EXP is clicked', () => {
    const { onInterpChange } = setup();
    fireEvent.click(screen.getByTitle('Interpolation: Exponential'));
    expect(onInterpChange).toHaveBeenCalledWith('Exponential');
  });

  it('calls onInterpChange with Step when STP is clicked', () => {
    const { onInterpChange } = setup();
    fireEvent.click(screen.getByTitle('Interpolation: Step'));
    expect(onInterpChange).toHaveBeenCalledWith('Step');
  });

  it('shows enable button as pressed when lane is enabled', () => {
    setup({ enabled: true });
    const btn = screen.getByRole('button', { name: /Toggle synth.cutoff/i });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows enable button as not pressed when lane is disabled', () => {
    setup({ enabled: false });
    const btn = screen.getByRole('button', { name: /Toggle synth.cutoff/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});
