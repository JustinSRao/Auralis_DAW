/**
 * Component tests for PatternBrowser.
 *
 * Mocking strategy:
 * - usePatternStore / usePianoRollStore / useTrackStore: mocked via vi.mock
 *   with factory functions so selectors and full-store calls both work.
 * - window.confirm: replaced with a vi.fn() that returns true by default.
 * - Timers: vi.useFakeTimers() for the audio toast timeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PatternBrowser } from '../PatternBrowser';
import type { PatternData } from '../../../lib/ipc';
import type { DawTrack } from '../../../stores/trackStore';

// ---------------------------------------------------------------------------
// Fixtures
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

function makeTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    id: 'track-1',
    name: 'Lead Synth',
    kind: 'Midi',
    color: '#6c63ff',
    volume: 0.8,
    pan: 0.0,
    muted: false,
    soloed: false,
    armed: false,
    instrumentId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const mockCreatePattern = vi.fn();
const mockDeletePattern = vi.fn();
const mockDuplicatePattern = vi.fn();
const mockSetPatternLength = vi.fn();
const mockSelectPattern = vi.fn();
const mockRenamePattern = vi.fn();

let mockPatterns: Record<string, PatternData> = {};
let mockSelectedPatternId: string | null = null;

vi.mock('../../../stores/patternStore', () => ({
  usePatternStore: (selector?: (s: ReturnType<typeof buildPatternStoreState>) => unknown) => {
    const state = buildPatternStoreState();
    if (typeof selector === 'function') return selector(state);
    return state;
  },
}));

function buildPatternStoreState() {
  return {
    patterns: mockPatterns,
    selectedPatternId: mockSelectedPatternId,
    isLoading: false,
    error: null,
    createPattern: mockCreatePattern,
    deletePattern: mockDeletePattern,
    duplicatePattern: mockDuplicatePattern,
    setPatternLength: mockSetPatternLength,
    selectPattern: mockSelectPattern,
    renamePattern: mockRenamePattern,
    updatePatternNotes: vi.fn(),
    getPatternsForTrack: (trackId: string) =>
      Object.values(mockPatterns).filter((p) => p.trackId === trackId),
    getPatternCount: (trackId: string) =>
      Object.values(mockPatterns).filter((p) => p.trackId === trackId).length,
    loadFromProject: vi.fn(),
  };
}

const mockOpenForPattern = vi.fn();

vi.mock('../../../stores/pianoRollStore', () => ({
  usePianoRollStore: (selector?: (s: { openForPattern: typeof mockOpenForPattern }) => unknown) => {
    const state = { openForPattern: mockOpenForPattern };
    if (typeof selector === 'function') return selector(state);
    return state;
  },
}));

let mockTracks: DawTrack[] = [];

vi.mock('../../../stores/trackStore', () => ({
  useTrackStore: (selector?: (s: { tracks: DawTrack[] }) => unknown) => {
    const state = { tracks: mockTracks };
    if (typeof selector === 'function') return selector(state);
    return state;
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockPatterns = {};
  mockSelectedPatternId = null;
  mockTracks = [];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mockCreatePattern.mockResolvedValue(undefined);
  mockDeletePattern.mockResolvedValue(undefined);
  mockDuplicatePattern.mockResolvedValue(undefined);
  mockSetPatternLength.mockResolvedValue(undefined);
  mockRenamePattern.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PatternBrowser', () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  it('renders the PATTERNS header', () => {
    render(<PatternBrowser />);
    expect(screen.getByText('Patterns')).toBeInTheDocument();
  });

  it('shows empty-state message when no tracks exist', () => {
    render(<PatternBrowser />);
    expect(screen.getByText(/no tracks yet/i)).toBeInTheDocument();
  });

  // ── Track groups ─────────────────────────────────────────────────────────────

  it('renders a track group for each track', () => {
    mockTracks = [makeTrack({ id: 'track-1', name: 'Lead' })];
    render(<PatternBrowser />);
    expect(screen.getByTestId('track-group-track-1')).toBeInTheDocument();
    expect(screen.getByText(/lead/i)).toBeInTheDocument();
  });

  it('renders "+ Add Pattern" button for each track', () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    render(<PatternBrowser />);
    expect(screen.getByTestId('add-pattern-track-1')).toBeInTheDocument();
  });

  it('clicking "+ Add Pattern" calls createPattern with the track id', async () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    render(<PatternBrowser />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('add-pattern-track-1'));
    });

    expect(mockCreatePattern).toHaveBeenCalledWith('track-1');
  });

  // ── Pattern rows ──────────────────────────────────────────────────────────────

  it('renders pattern rows for patterns belonging to the track', () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = {
      'pat-1': makePattern({ id: 'pat-1', name: 'Verse', trackId: 'track-1' }),
      'pat-2': makePattern({ id: 'pat-2', name: 'Chorus', trackId: 'track-1' }),
    };
    render(<PatternBrowser />);
    expect(screen.getByTestId('pattern-row-pat-1')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-row-pat-2')).toBeInTheDocument();
    expect(screen.getByText('Verse')).toBeInTheDocument();
    expect(screen.getByText('Chorus')).toBeInTheDocument();
  });

  it('single click on a pattern row calls selectPattern', () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = { 'pat-1': makePattern({ id: 'pat-1', trackId: 'track-1' }) };
    render(<PatternBrowser />);

    fireEvent.click(screen.getByTestId('pattern-row-pat-1'));

    expect(mockSelectPattern).toHaveBeenCalledWith('pat-1');
  });

  // ── Double click ─────────────────────────────────────────────────────────────

  it('double click on a MIDI pattern calls openForPattern', () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    const pattern = makePattern({
      id: 'pat-midi',
      trackId: 'track-1',
      content: { type: 'Midi', notes: [] },
    });
    mockPatterns = { 'pat-midi': pattern };
    render(<PatternBrowser />);

    fireEvent.dblClick(screen.getByTestId('pattern-row-pat-midi'));

    expect(mockOpenForPattern).toHaveBeenCalledWith('track-1', 'pat-midi', []);
  });

  it('double click on an Audio pattern shows toast, does not call openForPattern', async () => {
    vi.useFakeTimers();
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = {
      'pat-audio': makePattern({
        id: 'pat-audio',
        trackId: 'track-1',
        content: { type: 'Audio', filePath: '/loop.wav' },
      }),
    };
    render(<PatternBrowser />);

    await act(async () => {
      fireEvent.dblClick(screen.getByTestId('pattern-row-pat-audio'));
    });

    expect(mockOpenForPattern).not.toHaveBeenCalled();
    expect(screen.getByTestId('audio-toast')).toBeInTheDocument();
    expect(screen.getByTestId('audio-toast')).toHaveTextContent('Audio editing coming soon.');

    // Toast should disappear after 2500ms.
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByTestId('audio-toast')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  // ── Context menu ─────────────────────────────────────────────────────────────

  it('right click on a pattern row shows the context menu', () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = { 'pat-ctx': makePattern({ id: 'pat-ctx', trackId: 'track-1' }) };
    render(<PatternBrowser />);

    fireEvent.contextMenu(screen.getByTestId('pattern-row-pat-ctx'));

    expect(screen.getByTestId('pattern-context-menu')).toBeInTheDocument();
  });

  it('clicking Delete in context menu calls deletePattern after confirm', async () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = { 'pat-del': makePattern({ id: 'pat-del', name: 'Del Me', trackId: 'track-1' }) };
    render(<PatternBrowser />);

    fireEvent.contextMenu(screen.getByTestId('pattern-row-pat-del'));

    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });

    expect(window.confirm).toHaveBeenCalledWith('Delete pattern "Del Me"?');
    expect(mockDeletePattern).toHaveBeenCalledWith('pat-del');
  });

  it('clicking Duplicate in context menu calls duplicatePattern', async () => {
    mockTracks = [makeTrack({ id: 'track-1' })];
    mockPatterns = { 'pat-dup': makePattern({ id: 'pat-dup', trackId: 'track-1' }) };
    render(<PatternBrowser />);

    fireEvent.contextMenu(screen.getByTestId('pattern-row-pat-dup'));

    await act(async () => {
      fireEvent.click(screen.getByText('Duplicate'));
    });

    expect(mockDuplicatePattern).toHaveBeenCalledWith('pat-dup');
  });
});
