import { describe, it, expect } from 'vitest';
import { MidiImporter } from '../midiImportUtils';

describe('MidiImporter.snapLengthBars', () => {
  it('rounds up 0 to 1', () => {
    expect(MidiImporter.snapLengthBars(0)).toBe(1);
  });

  it('keeps exactly 1 as 1', () => {
    expect(MidiImporter.snapLengthBars(1)).toBe(1);
  });

  it('rounds 1.1 up to 2', () => {
    expect(MidiImporter.snapLengthBars(1.1)).toBe(2);
  });

  it('keeps exactly 2 as 2', () => {
    expect(MidiImporter.snapLengthBars(2)).toBe(2);
  });

  it('rounds 3 up to 4', () => {
    expect(MidiImporter.snapLengthBars(3)).toBe(4);
  });

  it('keeps exactly 4 as 4', () => {
    expect(MidiImporter.snapLengthBars(4)).toBe(4);
  });

  it('rounds 4.1 up to 8', () => {
    expect(MidiImporter.snapLengthBars(4.1)).toBe(8);
  });

  it('keeps exactly 8 as 8', () => {
    expect(MidiImporter.snapLengthBars(8)).toBe(8);
  });

  it('rounds 9 up to 16', () => {
    expect(MidiImporter.snapLengthBars(9)).toBe(16);
  });

  it('keeps exactly 16 as 16', () => {
    expect(MidiImporter.snapLengthBars(16)).toBe(16);
  });

  it('rounds 17 up to 32', () => {
    expect(MidiImporter.snapLengthBars(17)).toBe(32);
  });

  it('keeps exactly 32 as 32', () => {
    expect(MidiImporter.snapLengthBars(32)).toBe(32);
  });

  it('clamps values above 32 to 32', () => {
    expect(MidiImporter.snapLengthBars(33)).toBe(32);
    expect(MidiImporter.snapLengthBars(100)).toBe(32);
  });
});
