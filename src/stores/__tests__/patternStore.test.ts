/**
 * Unit tests for patternStore.
 *
 * All IPC calls are mocked via vi.mock so tests run without a Tauri runtime.
 * The store's Zustand state is reset to defaults before each test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatternStore } from '../patternStore';
import type { PatternData } from '../../lib/ipc';

// ---------------------------------------------------------------------------
// Mock the ipc module
// ---------------------------------------------------------------------------

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc');
  return {
    ...actual,
    ipcCreatePattern: vi.fn(),
    ipcRenamePattern: vi.fn(),
    ipcDuplicatePattern: vi.fn(),
    ipcDeletePattern: vi.fn(),
    ipcSetPatternLength: vi.fn(),
  };
});

// Re-import after mocking so we get the mocked versions.
import {
  ipcCreatePattern,
  ipcRenamePattern,
  ipcDuplicatePattern,
  ipcDeletePattern,
  ipcSetPatternLength,
} from '../../lib/ipc';

const mockCreate = vi.mocked(ipcCreatePattern);
const mockRename = vi.mocked(ipcRenamePattern);
const mockDuplicate = vi.mocked(ipcDuplicatePattern);
const mockDelete = vi.mocked(ipcDeletePattern);
const mockSetLength = vi.mocked(ipcSetPatternLength);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: 'pat-001',
    name: 'Verse',
    trackId: 'track-1',
    lengthBars: 4,
    content: { type: 'Midi', notes: [] },
    ...overrides,
  };
}

const INITIAL_STATE = {
  patterns: {} as Record<string, PatternData>,
  selectedPatternId: null as string | null,
  isLoading: false,
  error: null as string | null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('patternStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePatternStore.setState({ ...INITIAL_STATE });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('has correct initial state', () => {
    const s = usePatternStore.getState();
    expect(s.patterns).toEqual({});
    expect(s.selectedPatternId).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  // ── createPattern ──────────────────────────────────────────────────────────

  it('createPattern calls ipcCreatePattern and adds the returned pattern', async () => {
    const newPattern = makePattern({ id: 'pat-new', name: 'Pattern 1' });
    mockCreate.mockResolvedValueOnce(newPattern);

    await usePatternStore.getState().createPattern('track-1');

    expect(mockCreate).toHaveBeenCalledWith('track-1', 'Pattern 1');
    expect(usePatternStore.getState().patterns['pat-new']).toEqual(newPattern);
    expect(usePatternStore.getState().isLoading).toBe(false);
  });

  it('createPattern uses provided name when given', async () => {
    const newPattern = makePattern({ id: 'pat-named', name: 'My Custom Pattern' });
    mockCreate.mockResolvedValueOnce(newPattern);

    await usePatternStore.getState().createPattern('track-1', 'My Custom Pattern');

    expect(mockCreate).toHaveBeenCalledWith('track-1', 'My Custom Pattern');
  });

  it('createPattern auto-increments name based on existing count for track', async () => {
    const existing = makePattern({ id: 'pat-a', name: 'Pattern 1', trackId: 'track-1' });
    usePatternStore.setState({ patterns: { 'pat-a': existing } });
    const newPattern = makePattern({ id: 'pat-b', name: 'Pattern 2' });
    mockCreate.mockResolvedValueOnce(newPattern);

    await usePatternStore.getState().createPattern('track-1');

    expect(mockCreate).toHaveBeenCalledWith('track-1', 'Pattern 2');
  });

  it('createPattern sets isLoading=true during fetch, false after', async () => {
    let loadingDuringCall = false;
    mockCreate.mockImplementationOnce(async () => {
      loadingDuringCall = usePatternStore.getState().isLoading;
      return makePattern();
    });

    await usePatternStore.getState().createPattern('track-1');

    expect(loadingDuringCall).toBe(true);
    expect(usePatternStore.getState().isLoading).toBe(false);
  });

  it('createPattern on IPC error sets error string and isLoading=false', async () => {
    mockCreate.mockRejectedValueOnce(new Error('backend failure'));

    await usePatternStore.getState().createPattern('track-1');

    expect(usePatternStore.getState().error).toContain('backend failure');
    expect(usePatternStore.getState().isLoading).toBe(false);
    expect(Object.keys(usePatternStore.getState().patterns)).toHaveLength(0);
  });

  // ── renamePattern ──────────────────────────────────────────────────────────

  it('renamePattern updates name in store and calls ipcRenamePattern', async () => {
    const p = makePattern({ id: 'pat-r1', name: 'Old Name' });
    usePatternStore.setState({ patterns: { 'pat-r1': p } });
    mockRename.mockResolvedValueOnce(undefined);

    await usePatternStore.getState().renamePattern('pat-r1', 'New Name');

    expect(mockRename).toHaveBeenCalledWith('pat-r1', 'New Name');
    expect(usePatternStore.getState().patterns['pat-r1'].name).toBe('New Name');
  });

  it('renamePattern on IPC error sets error and leaves name unchanged', async () => {
    const p = makePattern({ id: 'pat-r2', name: 'Unchanged' });
    usePatternStore.setState({ patterns: { 'pat-r2': p } });
    mockRename.mockRejectedValueOnce(new Error('validation failed'));

    await usePatternStore.getState().renamePattern('pat-r2', '');

    expect(usePatternStore.getState().patterns['pat-r2'].name).toBe('Unchanged');
    expect(usePatternStore.getState().error).toContain('validation failed');
  });

  // ── duplicatePattern ───────────────────────────────────────────────────────

  it('duplicatePattern adds the copy to the store', async () => {
    const original = makePattern({ id: 'pat-orig' });
    const copy = makePattern({ id: 'pat-copy', name: 'Verse (copy)' });
    usePatternStore.setState({ patterns: { 'pat-orig': original } });
    mockDuplicate.mockResolvedValueOnce(copy);

    await usePatternStore.getState().duplicatePattern('pat-orig');

    expect(mockDuplicate).toHaveBeenCalledWith(original);
    const patterns = usePatternStore.getState().patterns;
    expect(patterns['pat-orig']).toEqual(original);
    expect(patterns['pat-copy']).toEqual(copy);
  });

  it('duplicatePattern does nothing when pattern id is not found', async () => {
    await usePatternStore.getState().duplicatePattern('nonexistent');
    expect(mockDuplicate).not.toHaveBeenCalled();
  });

  // ── deletePattern ──────────────────────────────────────────────────────────

  it('deletePattern removes pattern from store and calls ipcDeletePattern', async () => {
    const p = makePattern({ id: 'pat-del-1' });
    usePatternStore.setState({ patterns: { 'pat-del-1': p } });
    mockDelete.mockResolvedValueOnce(undefined);

    await usePatternStore.getState().deletePattern('pat-del-1');

    expect(mockDelete).toHaveBeenCalledWith('pat-del-1');
    expect(usePatternStore.getState().patterns['pat-del-1']).toBeUndefined();
  });

  it('deletePattern clears selectedPatternId when the deleted pattern was selected', async () => {
    const p = makePattern({ id: 'pat-sel-del' });
    usePatternStore.setState({ patterns: { 'pat-sel-del': p }, selectedPatternId: 'pat-sel-del' });
    mockDelete.mockResolvedValueOnce(undefined);

    await usePatternStore.getState().deletePattern('pat-sel-del');

    expect(usePatternStore.getState().selectedPatternId).toBeNull();
  });

  it('deletePattern preserves selectedPatternId when a different pattern is deleted', async () => {
    const pA = makePattern({ id: 'pat-a' });
    const pB = makePattern({ id: 'pat-b' });
    usePatternStore.setState({ patterns: { 'pat-a': pA, 'pat-b': pB }, selectedPatternId: 'pat-a' });
    mockDelete.mockResolvedValueOnce(undefined);

    await usePatternStore.getState().deletePattern('pat-b');

    expect(usePatternStore.getState().selectedPatternId).toBe('pat-a');
  });

  // ── setPatternLength ───────────────────────────────────────────────────────

  it('setPatternLength updates lengthBars in store and calls ipcSetPatternLength', async () => {
    const p = makePattern({ id: 'pat-len', lengthBars: 4 });
    usePatternStore.setState({ patterns: { 'pat-len': p } });
    mockSetLength.mockResolvedValueOnce(undefined);

    await usePatternStore.getState().setPatternLength('pat-len', 8);

    expect(mockSetLength).toHaveBeenCalledWith('pat-len', 8);
    expect(usePatternStore.getState().patterns['pat-len'].lengthBars).toBe(8);
  });

  // ── selectPattern ──────────────────────────────────────────────────────────

  it('selectPattern sets selectedPatternId', () => {
    usePatternStore.getState().selectPattern('pat-select-1');
    expect(usePatternStore.getState().selectedPatternId).toBe('pat-select-1');
  });

  it('selectPattern(null) clears selectedPatternId', () => {
    usePatternStore.setState({ selectedPatternId: 'pat-select-1' });
    usePatternStore.getState().selectPattern(null);
    expect(usePatternStore.getState().selectedPatternId).toBeNull();
  });

  // ── updatePatternNotes ─────────────────────────────────────────────────────

  it('updatePatternNotes replaces notes on a Midi pattern', () => {
    const p = makePattern({ id: 'pat-notes', content: { type: 'Midi', notes: [] } });
    usePatternStore.setState({ patterns: { 'pat-notes': p } });

    const newNotes = [
      { id: 'n1', pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, channel: 0 },
    ];
    usePatternStore.getState().updatePatternNotes('pat-notes', newNotes);

    const updated = usePatternStore.getState().patterns['pat-notes'];
    expect(updated.content.type).toBe('Midi');
    if (updated.content.type === 'Midi') {
      expect(updated.content.notes).toEqual(newNotes);
    }
  });

  it('updatePatternNotes is a no-op on Audio patterns', () => {
    const p = makePattern({
      id: 'pat-audio',
      content: { type: 'Audio', filePath: '/samples/loop.wav' },
    });
    usePatternStore.setState({ patterns: { 'pat-audio': p } });

    usePatternStore.getState().updatePatternNotes('pat-audio', []);

    // Content should remain Audio (not mutated).
    expect(usePatternStore.getState().patterns['pat-audio'].content.type).toBe('Audio');
  });

  // ── getPatternsForTrack ────────────────────────────────────────────────────

  it('getPatternsForTrack returns only patterns belonging to the given track', () => {
    const pA = makePattern({ id: 'p-a', trackId: 'track-1' });
    const pB = makePattern({ id: 'p-b', trackId: 'track-2' });
    const pC = makePattern({ id: 'p-c', trackId: 'track-1' });
    usePatternStore.setState({ patterns: { 'p-a': pA, 'p-b': pB, 'p-c': pC } });

    const result = usePatternStore.getState().getPatternsForTrack('track-1');
    const ids = result.map((p) => p.id).sort();
    expect(ids).toEqual(['p-a', 'p-c']);
  });

  it('getPatternsForTrack returns empty array when no patterns exist for track', () => {
    expect(usePatternStore.getState().getPatternsForTrack('track-x')).toEqual([]);
  });

  // ── loadFromProject ────────────────────────────────────────────────────────

  it('loadFromProject replaces all patterns with the provided array', () => {
    const existing = makePattern({ id: 'old' });
    usePatternStore.setState({ patterns: { old: existing } });

    const incoming = [
      makePattern({ id: 'new-1', name: 'Pattern A' }),
      makePattern({ id: 'new-2', name: 'Pattern B' }),
    ];
    usePatternStore.getState().loadFromProject(incoming);

    const state = usePatternStore.getState();
    expect(state.patterns['old']).toBeUndefined();
    expect(state.patterns['new-1']).toEqual(incoming[0]);
    expect(state.patterns['new-2']).toEqual(incoming[1]);
  });

  it('loadFromProject clears selectedPatternId', () => {
    usePatternStore.setState({ selectedPatternId: 'pat-old' });
    usePatternStore.getState().loadFromProject([]);
    expect(usePatternStore.getState().selectedPatternId).toBeNull();
  });

  it('loadFromProject with empty array clears all patterns', () => {
    const p = makePattern({ id: 'pat-clear' });
    usePatternStore.setState({ patterns: { 'pat-clear': p } });

    usePatternStore.getState().loadFromProject([]);

    expect(Object.keys(usePatternStore.getState().patterns)).toHaveLength(0);
  });
});
