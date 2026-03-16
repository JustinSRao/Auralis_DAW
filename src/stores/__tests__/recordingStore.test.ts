/**
 * Unit tests for Sprint 36 recording state in transportStore and patternStore.
 *
 * Tests: recordQuantize / recordOverdub state, setters, and addRecordedNote.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTransportStore } from '../transportStore';
import { usePatternStore } from '../patternStore';
import type { PatternData } from '../../lib/ipc';

// ---------------------------------------------------------------------------
// Mock IPC
// ---------------------------------------------------------------------------

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc');
  return {
    ...actual,
    ipcSetRecordQuantize: vi.fn().mockResolvedValue(undefined),
    ipcCreatePattern: vi.fn(),
    ipcRenamePattern: vi.fn(),
    ipcDuplicatePattern: vi.fn(),
    ipcDeletePattern: vi.fn(),
    ipcSetPatternLength: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: 'pat-001',
    name: 'Test',
    trackId: 'track-1',
    lengthBars: 4,
    content: { type: 'Midi', notes: [] },
    ...overrides,
  };
}

const TRANSPORT_INITIAL = {
  recordQuantize: 'off' as const,
  recordOverdub: false,
  isLoading: false,
  error: null,
};

const PATTERN_INITIAL = {
  patterns: {} as Record<string, PatternData>,
  selectedPatternId: null as string | null,
  isLoading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Transport store — recording options
// ---------------------------------------------------------------------------

describe('transportStore — recording options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTransportStore.setState(TRANSPORT_INITIAL);
  });

  it('has off/false defaults', () => {
    const s = useTransportStore.getState();
    expect(s.recordQuantize).toBe('off');
    expect(s.recordOverdub).toBe(false);
  });

  it('setRecordOverdub toggles to true', () => {
    useTransportStore.getState().setRecordOverdub(true);
    expect(useTransportStore.getState().recordOverdub).toBe(true);
  });

  it('setRecordOverdub toggles back to false', () => {
    useTransportStore.setState({ recordOverdub: true });
    useTransportStore.getState().setRecordOverdub(false);
    expect(useTransportStore.getState().recordOverdub).toBe(false);
  });

  it('setRecordQuantize updates store to quarter', async () => {
    await useTransportStore.getState().setRecordQuantize('quarter');
    expect(useTransportStore.getState().recordQuantize).toBe('quarter');
  });

  it('setRecordQuantize updates store to sixteenth', async () => {
    await useTransportStore.getState().setRecordQuantize('sixteenth');
    expect(useTransportStore.getState().recordQuantize).toBe('sixteenth');
  });

  it('setRecordQuantize calls ipcSetRecordQuantize', async () => {
    const { ipcSetRecordQuantize } = await import('../../lib/ipc');
    await useTransportStore.getState().setRecordQuantize('eighth');
    expect(vi.mocked(ipcSetRecordQuantize)).toHaveBeenCalledWith('eighth');
  });
});

// ---------------------------------------------------------------------------
// Pattern store — addRecordedNote
// ---------------------------------------------------------------------------

describe('patternStore — addRecordedNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePatternStore.setState(PATTERN_INITIAL);
  });

  it('appends a note to a Midi pattern', () => {
    const p = makePattern({ id: 'pat-rec', content: { type: 'Midi', notes: [] } });
    usePatternStore.setState({ patterns: { 'pat-rec': p } });

    const note = { id: 'n1', pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0 };
    usePatternStore.getState().addRecordedNote('pat-rec', note);

    const updated = usePatternStore.getState().patterns['pat-rec'];
    expect(updated.content.type).toBe('Midi');
    if (updated.content.type === 'Midi') {
      expect(updated.content.notes).toHaveLength(1);
      expect(updated.content.notes[0]).toEqual(note);
    }
  });

  it('appends multiple notes sequentially', () => {
    const p = makePattern({ id: 'pat-multi', content: { type: 'Midi', notes: [] } });
    usePatternStore.setState({ patterns: { 'pat-multi': p } });

    const note1 = { id: 'n1', pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0 };
    const note2 = { id: 'n2', pitch: 64, startBeats: 1, durationBeats: 1, velocity: 80, channel: 0 };
    usePatternStore.getState().addRecordedNote('pat-multi', note1);
    usePatternStore.getState().addRecordedNote('pat-multi', note2);

    const updated = usePatternStore.getState().patterns['pat-multi'];
    if (updated.content.type === 'Midi') {
      expect(updated.content.notes).toHaveLength(2);
    }
  });

  it('is a no-op for unknown pattern id', () => {
    usePatternStore.getState().addRecordedNote('nonexistent', {
      id: 'n1', pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0,
    });
    // Should not throw
    expect(Object.keys(usePatternStore.getState().patterns)).toHaveLength(0);
  });

  it('is a no-op for Audio patterns', () => {
    const p = makePattern({
      id: 'pat-audio',
      content: { type: 'Audio', filePath: '/samples/loop.wav' },
    });
    usePatternStore.setState({ patterns: { 'pat-audio': p } });

    usePatternStore.getState().addRecordedNote('pat-audio', {
      id: 'n1', pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0,
    });

    expect(usePatternStore.getState().patterns['pat-audio'].content.type).toBe('Audio');
  });

  it('addRecordedNote does not clear existing notes', () => {
    const existingNote = { id: 'existing', pitch: 48, startBeats: 0, durationBeats: 2, velocity: 90, channel: 0 };
    const p = makePattern({ id: 'pat-keep', content: { type: 'Midi', notes: [existingNote] } });
    usePatternStore.setState({ patterns: { 'pat-keep': p } });

    const newNote = { id: 'new', pitch: 60, startBeats: 2, durationBeats: 1, velocity: 100, channel: 0 };
    usePatternStore.getState().addRecordedNote('pat-keep', newNote);

    const updated = usePatternStore.getState().patterns['pat-keep'];
    if (updated.content.type === 'Midi') {
      expect(updated.content.notes).toHaveLength(2);
      expect(updated.content.notes[0]).toEqual(existingNote);
      expect(updated.content.notes[1]).toEqual(newNote);
    }
  });
});
