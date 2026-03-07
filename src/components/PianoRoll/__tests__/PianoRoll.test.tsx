/**
 * Smoke tests for the PianoRoll component.
 *
 * Canvas drawing is opaque in jsdom — we test behaviour (DOM structure,
 * toolbar interactions, keyboard shortcuts) rather than pixel output.
 *
 * Mocking strategy:
 * - usePianoRollState / usePianoRollMouse: replaced with thin fakes that
 *   expose spy functions for all user-facing actions.
 * - useHistoryStore: replaced with a fake that exposes undo/redo spies.
 * - usePianoRollStore: replaced with a fake that exposes setMode, close, etc.
 * - ipc: getTransportState always resolves with a safe snapshot so the
 *   playhead polling useEffect never throws.
 * - PianoKeyboard / VelocityLane: stub out canvas-heavy child components.
 * - ResizeObserver: no-op stub — jsdom does not implement it.
 * - HTMLCanvasElement.getContext: stubbed to return null so the component's
 *   `if (!ctx) return` guards fire cleanly without jsdom console noise.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Global jsdom polyfills — must run before any module import that touches DOM
// ---------------------------------------------------------------------------

// ResizeObserver is absent in jsdom.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// canvas.getContext throws a "not implemented" error in jsdom.
// The PianoRoll component already guards every getContext call with
// `if (!ctx) return`, so returning null is a correct stub.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null as unknown as CanvasRenderingContext2D;
});

// ---------------------------------------------------------------------------
// Spy references — declared before vi.mock calls so factories can close over them.
// vi.mock factories are hoisted to the top of the file by Vitest's transformer,
// but the variable declarations in module scope are also hoisted (TDZ-safe for
// `const` initialised with `vi.fn()`).
// ---------------------------------------------------------------------------

const mockSetMode = vi.fn();
const mockSetQuantDiv = vi.fn();
const mockClose = vi.fn();
const mockCopySelection = vi.fn();
const mockDeleteSelectedNotes = vi.fn();
const mockPasteAtBeat = vi.fn();
const mockUndo = vi.fn();
const mockRedo = vi.fn();
const mockSetViewport = vi.fn();

// Stable transport snapshot returned by the getTransportState mock.
const TRANSPORT_SNAPSHOT = {
  state: 'stopped' as const,
  position_samples: 0,
  bbt: { bar: 1, beat: 1, tick: 0 },
  bpm: 120,
  time_sig_numerator: 4,
  time_sig_denominator: 4,
  loop_enabled: false,
  loop_start_samples: 0,
  loop_end_samples: 0,
  metronome_enabled: false,
  metronome_volume: 0.7,
  metronome_pitch_hz: 880,
  record_armed: false,
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// The ipc module must be mocked BEFORE the component imports it.
// getTransportState is called in a polling loop — it must return a real Promise.
vi.mock('../../../lib/ipc', () => ({
  getTransportState: vi.fn(() => Promise.resolve(TRANSPORT_SNAPSHOT)),
}));

// Mock the stores that PianoRoll.tsx imports directly.
vi.mock('../../../stores/pianoRollStore', () => ({
  usePianoRollStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      notes: [],
      selectedNoteIds: [],
      viewport: { scrollX: 0, scrollY: 600, pixelsPerBeat: 80, pixelsPerSemitone: 12 },
      mode: 'draw',
      quantDiv: 16,
      clipboardNotes: [],
      isOpen: true,
      activeTrackId: 'track-001',
      setMode: mockSetMode,
      setQuantDiv: mockSetQuantDiv,
      setViewport: mockSetViewport,
      setNotes: vi.fn(),
      addNote: vi.fn(),
      removeNotes: vi.fn(),
      moveNotes: vi.fn(),
      resizeNote: vi.fn(),
      setVelocity: vi.fn(),
      selectNotes: vi.fn(),
      clearSelection: vi.fn(),
      copySelection: mockCopySelection,
      pasteAtBeat: vi.fn(),
      openForTrack: vi.fn(),
      close: mockClose,
    };
    // Support selector pattern: usePianoRollStore((s) => s.viewport)
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
  selectViewport: vi.fn((s: { viewport: unknown }) => s.viewport),
}));

vi.mock('../../../stores/historyStore', () => ({
  useHistoryStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      canUndo: false,
      canRedo: false,
      entries: [],
      currentPointer: -1,
      push: vi.fn(),
      undo: mockUndo,
      redo: mockRedo,
      clear: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

// usePianoRollState wraps the store + history. Mock it so we control the spies.
vi.mock('../usePianoRollState', () => ({
  usePianoRollState: vi.fn(() => ({
    notes: [],
    selectedNoteIds: [],
    viewport: { scrollX: 0, scrollY: 600, pixelsPerBeat: 80, pixelsPerSemitone: 12 },
    mode: 'draw',
    quantDiv: 16,
    isOpen: true,
    activeTrackId: 'track-001',
    addNote: vi.fn(),
    deleteSelectedNotes: mockDeleteSelectedNotes,
    deleteNotes: vi.fn(),
    commitMove: vi.fn(),
    commitResize: vi.fn(),
    commitVelocity: vi.fn(),
    pasteAtBeat: mockPasteAtBeat,
    selectNotes: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: mockCopySelection,
    setMode: mockSetMode,
    setQuantDiv: mockSetQuantDiv,
    setViewport: mockSetViewport,
    close: mockClose,
  })),
}));

// usePianoRollMouse drives drag state — stub it to avoid canvas pointer logic.
vi.mock('../usePianoRollMouse', () => ({
  usePianoRollMouse: vi.fn(() => ({
    interaction: { current: { kind: 'idle' } },
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
  })),
}));

// Stub child components that render canvas elements of their own.
vi.mock('../PianoKeyboard', () => ({
  PianoKeyboard: () => <div data-testid="piano-keyboard" />,
}));

vi.mock('../VelocityLane', () => ({
  VelocityLane: () => <div data-testid="velocity-lane" />,
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are declared (hoisting handles the rest).
// ---------------------------------------------------------------------------

import { PianoRoll } from '../PianoRoll';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Render the component and flush all pending effects synchronously. */
async function renderPianoRoll() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<PianoRoll />);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PianoRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply getContext stub after clearAllMocks (does not affect prototype stub).
  });

  afterEach(() => {
    // Nothing extra — act() drains pending effects per test.
  });

  // ── Visibility ────────────────────────────────────────────────────────────

  it('renders the editor when isOpen is true', async () => {
    await renderPianoRoll();
    expect(screen.getByRole('dialog', { name: /piano roll editor/i })).toBeInTheDocument();
  });

  it('returns null (renders nothing) when isOpen is false', async () => {
    const { usePianoRollState } = await import('../usePianoRollState');
    vi.mocked(usePianoRollState).mockReturnValueOnce({
      notes: [],
      selectedNoteIds: [],
      viewport: { scrollX: 0, scrollY: 600, pixelsPerBeat: 80, pixelsPerSemitone: 12 },
      mode: 'draw',
      quantDiv: 16,
      isOpen: false,
      activeTrackId: null,
      addNote: vi.fn(),
      deleteSelectedNotes: vi.fn(),
      deleteNotes: vi.fn(),
      commitMove: vi.fn(),
      commitResize: vi.fn(),
      commitVelocity: vi.fn(),
      pasteAtBeat: vi.fn(),
      selectNotes: vi.fn(),
      clearSelection: vi.fn(),
      copySelection: vi.fn(),
      setMode: vi.fn(),
      setQuantDiv: vi.fn(),
      setViewport: vi.fn(),
      close: vi.fn(),
    });

    const { container } = await renderPianoRoll();
    expect(container.firstChild).toBeNull();
  });

  // ── Toolbar: mode buttons ─────────────────────────────────────────────────

  it('renders a "DRAW" mode button in the toolbar', async () => {
    await renderPianoRoll();
    expect(screen.getByRole('button', { name: /draw/i })).toBeInTheDocument();
  });

  it('renders a "SELECT" mode button in the toolbar', async () => {
    await renderPianoRoll();
    expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
  });

  it('clicking the SELECT button calls setMode("select")', async () => {
    await renderPianoRoll();
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    expect(mockSetMode).toHaveBeenCalledWith('select');
  });

  it('clicking the DRAW button calls setMode("draw")', async () => {
    await renderPianoRoll();
    fireEvent.click(screen.getByRole('button', { name: /draw/i }));
    expect(mockSetMode).toHaveBeenCalledWith('draw');
  });

  // ── Toolbar: quantisation ─────────────────────────────────────────────────

  it('renders a SNAP quantisation select control', async () => {
    await renderPianoRoll();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('the SNAP select includes options for 1/4, 1/8, 1/16, 1/32', async () => {
    await renderPianoRoll();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('4');
    expect(values).toContain('8');
    expect(values).toContain('16');
    expect(values).toContain('32');
  });

  it('changing SNAP select to 8 calls setQuantDiv(8)', async () => {
    await renderPianoRoll();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '8' } });
    expect(mockSetQuantDiv).toHaveBeenCalledWith(8);
  });

  it('changing SNAP select to 32 calls setQuantDiv(32)', async () => {
    await renderPianoRoll();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '32' } });
    expect(mockSetQuantDiv).toHaveBeenCalledWith(32);
  });

  // ── Toolbar: close button ─────────────────────────────────────────────────

  it('renders a close button labelled "Close Piano Roll"', async () => {
    await renderPianoRoll();
    expect(screen.getByRole('button', { name: /close piano roll/i })).toBeInTheDocument();
  });

  it('clicking the close button calls close()', async () => {
    await renderPianoRoll();
    fireEvent.click(screen.getByRole('button', { name: /close piano roll/i }));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  // ── Toolbar: zoom slider ──────────────────────────────────────────────────

  it('renders the horizontal zoom slider', async () => {
    await renderPianoRoll();
    expect(screen.getByLabelText(/horizontal zoom/i)).toBeInTheDocument();
  });

  // ── Canvas elements ───────────────────────────────────────────────────────

  it('renders at least two canvas elements (grid canvas and note canvas)', async () => {
    const { container } = await renderPianoRoll();
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(2);
  });

  // ── Child components ──────────────────────────────────────────────────────

  it('renders the PianoKeyboard child component', async () => {
    await renderPianoRoll();
    expect(screen.getByTestId('piano-keyboard')).toBeInTheDocument();
  });

  it('renders the VelocityLane child component', async () => {
    await renderPianoRoll();
    expect(screen.getByTestId('velocity-lane')).toBeInTheDocument();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  it('Delete key on the dialog calls deleteSelectedNotes', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Delete' });
    expect(mockDeleteSelectedNotes).toHaveBeenCalledTimes(1);
  });

  it('Backspace key on the dialog calls deleteSelectedNotes', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Backspace' });
    expect(mockDeleteSelectedNotes).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C on the dialog calls copySelection', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'c', ctrlKey: true });
    expect(mockCopySelection).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z on the dialog calls undo', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'z', ctrlKey: true });
    expect(mockUndo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Y on the dialog calls redo', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'y', ctrlKey: true });
    expect(mockRedo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+V on the dialog calls pasteAtBeat', async () => {
    await renderPianoRoll();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'v', ctrlKey: true });
    expect(mockPasteAtBeat).toHaveBeenCalledTimes(1);
  });

  // ── Track ID display ──────────────────────────────────────────────────────

  it('shows "PIANO ROLL" text in the toolbar', async () => {
    await renderPianoRoll();
    expect(screen.getByText(/piano roll/i)).toBeInTheDocument();
  });

  // ── Playhead polling cleanup ──────────────────────────────────────────────

  it('unmounts cleanly without throwing even with pending transport polling', async () => {
    const { unmount } = await renderPianoRoll();
    await act(async () => {
      unmount();
    });
    // If we reach here without an unhandled rejection, the cleanup worked.
  });
});
