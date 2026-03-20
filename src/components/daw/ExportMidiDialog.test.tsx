import { render, screen, fireEvent } from '@testing-library/react';
import { ExportMidiDialog } from './ExportMidiDialog';

// ---------------------------------------------------------------------------
// Mock: Tauri dialog plugin (save)
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Mock: IPC functions
// ---------------------------------------------------------------------------

vi.mock('@/lib/ipc', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ipc')>();
  return {
    ...original,
    ipcExportMidiPattern: vi.fn().mockResolvedValue(undefined),
    ipcExportMidiArrangement: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const midiPattern = {
  id: 'pat-1',
  name: 'My Pattern',
  trackId: 'track-1',
  lengthBars: 4 as const,
  content: {
    type: 'Midi' as const,
    notes: [
      { pitch: 60, velocity: 100, channel: 0, startBeats: 0, durationBeats: 1 },
    ],
  },
};

const audioPattern = {
  id: 'pat-2',
  name: 'Audio Pattern',
  trackId: 'track-1',
  lengthBars: 4 as const,
  content: {
    type: 'Audio' as const,
    filePath: '/some/file.wav',
  },
};

const defaultTransportSnapshot = {
  state: 'stopped' as const,
  position_samples: 0,
  bpm: 120,
  time_sig_numerator: 4,
  time_sig_denominator: 4,
  loop_start_bar: 0,
  loop_end_bar: 4,
  loop_enabled: false,
};

const defaultTempoPoints = [{ tick: 0, bpm: 120.0, interp: 'Step' as const }];

// ---------------------------------------------------------------------------
// Mock stores (selector-aware pattern)
// ---------------------------------------------------------------------------

let mockPatternState = {
  patterns: { 'pat-1': midiPattern } as Record<string, typeof midiPattern | typeof audioPattern>,
};

let mockArrangementState = {
  clips: {} as Record<string, unknown>,
};

let mockTransportState = {
  snapshot: defaultTransportSnapshot,
};

let mockTempoMapState = {
  points: defaultTempoPoints,
};

vi.mock('@/stores/patternStore', () => ({
  usePatternStore: (selector?: (s: typeof mockPatternState) => unknown) => {
    if (typeof selector === 'function') return selector(mockPatternState);
    return mockPatternState;
  },
}));

vi.mock('@/stores/arrangementStore', () => ({
  useArrangementStore: (selector?: (s: typeof mockArrangementState) => unknown) => {
    if (typeof selector === 'function') return selector(mockArrangementState);
    return mockArrangementState;
  },
}));

vi.mock('@/stores/transportStore', () => ({
  useTransportStore: (selector?: (s: typeof mockTransportState) => unknown) => {
    if (typeof selector === 'function') return selector(mockTransportState);
    return mockTransportState;
  },
}));

vi.mock('@/stores/tempoMapStore', () => ({
  useTempoMapStore: (selector?: (s: typeof mockTempoMapState) => unknown) => {
    if (typeof selector === 'function') return selector(mockTempoMapState);
    return mockTempoMapState;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockPatternState = {
    patterns: { 'pat-1': midiPattern },
  };
  mockArrangementState = { clips: {} };
  mockTransportState = { snapshot: defaultTransportSnapshot };
  mockTempoMapState = { points: defaultTempoPoints };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExportMidiDialog', () => {
  it('renders without crashing (smoke test)', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    expect(screen.getByText('Export MIDI')).toBeInTheDocument();
  });

  it('shows arrangement and pattern mode radio buttons', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /full arrangement/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /single pattern/i })).toBeInTheDocument();
  });

  it('defaults to arrangement mode', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    const arrangementRadio = screen.getByRole('radio', {
      name: /full arrangement/i,
    }) as HTMLInputElement;
    expect(arrangementRadio.checked).toBe(true);
  });

  it('shows PPQ radio buttons with 480 and 960 options', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    const allRadios = screen.getAllByRole('radio') as HTMLInputElement[];
    const ppqValues = allRadios.map((r) => r.value);
    expect(ppqValues).toContain('480');
    expect(ppqValues).toContain('960');
  });

  it('defaults to 480 PPQ', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    const allRadios = screen.getAllByRole('radio') as HTMLInputElement[];
    const radio480 = allRadios.find((r) => r.value === '480');
    expect(radio480?.checked).toBe(true);
  });

  it('pattern selector is hidden when mode is arrangement (default)', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('pattern selector is visible when mode is changed to pattern', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /single pattern/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('pattern dropdown lists only MIDI patterns (not Audio)', () => {
    mockPatternState = {
      patterns: {
        'pat-1': midiPattern,
        'pat-2': audioPattern as typeof midiPattern,
      },
    };
    render(<ExportMidiDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /single pattern/i }));

    expect(screen.getByRole('option', { name: 'My Pattern' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Audio Pattern' })).not.toBeInTheDocument();
  });

  it('export button is disabled in pattern mode when no pattern is selected', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /single pattern/i }));

    const exportBtn = screen.getByRole('button', { name: /export/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
  });

  it('export button is enabled in arrangement mode', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    const exportBtn = screen.getByRole('button', { name: /export/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
  });

  it('export button becomes enabled in pattern mode after selecting a pattern', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /single pattern/i }));

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'pat-1' } });

    const exportBtn = screen.getByRole('button', { name: /export/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
  });

  it('cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(<ExportMidiDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking inside the dialog card does not call onClose', () => {
    const onClose = vi.fn();
    render(<ExportMidiDialog onClose={onClose} />);
    fireEvent.click(screen.getByText('Export MIDI'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('switching back from pattern to arrangement hides the pattern selector', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /single pattern/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /full arrangement/i }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('PPQ can be changed to 960', () => {
    render(<ExportMidiDialog onClose={vi.fn()} />);
    const allRadios = screen.getAllByRole('radio') as HTMLInputElement[];
    const radio960 = allRadios.find((r) => r.value === '960');
    if (!radio960) throw new Error('960 PPQ radio not found');

    fireEvent.click(radio960);
    expect(radio960.checked).toBe(true);
  });
});
