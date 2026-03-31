import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SidechainSourceSelector from '../SidechainSourceSelector';

const channels = [
  { id: 'kick', name: 'Kick' },
  { id: 'snare', name: 'Snare' },
];

describe('SidechainSourceSelector', () => {
  it('renders None option and all channel options', () => {
    render(
      <SidechainSourceSelector
        channels={channels}
        value={null}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'None (Self)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kick' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Snare' })).toBeTruthy();
  });

  it('shows __none__ selected when value is null', () => {
    render(
      <SidechainSourceSelector
        channels={channels}
        value={null}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('__none__');
  });

  it('shows source channel selected when value is set', () => {
    render(
      <SidechainSourceSelector
        channels={channels}
        value="kick"
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('kick');
  });

  it('calls onSelect when a channel is chosen', () => {
    const onSelect = vi.fn();
    render(
      <SidechainSourceSelector
        channels={channels}
        value={null}
        onSelect={onSelect}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'kick' } });
    expect(onSelect).toHaveBeenCalledWith('kick');
  });

  it('calls onRemove when None is selected', () => {
    const onRemove = vi.fn();
    render(
      <SidechainSourceSelector
        channels={channels}
        value="kick"
        onSelect={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__none__' } });
    expect(onRemove).toHaveBeenCalled();
  });
});
