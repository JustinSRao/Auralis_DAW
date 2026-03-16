import { render, screen, fireEvent } from '@testing-library/react';
import { MidiImportDialog } from '../MidiImportDialog';
import type { MidiFileInfo } from '@/lib/ipc';
import { useTrackStore } from '@/stores/trackStore';

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

vi.mock('@/stores/trackStore', () => ({
  useTrackStore: vi.fn(),
}));

const mockTracks = [
  { id: 'track-1', name: 'Lead', color: '#5b8def' },
  { id: 'track-2', name: 'Bass', color: '#ff6666' },
];

beforeEach(() => {
  vi.mocked(useTrackStore).mockReturnValue({ tracks: mockTracks } as ReturnType<typeof useTrackStore>);
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeNote(pitch: number, start: number, dur: number) {
  return { pitch, velocity: 100, channel: 0, startBeats: start, durationBeats: dur };
}

const multiTrackInfo: MidiFileInfo = {
  format: 1,
  suggestedBpm: 120,
  tracks: [
    {
      midiTrackIndex: 0,
      name: 'Tempo Track',
      notes: [],
      isEmpty: true,
    },
    {
      midiTrackIndex: 1,
      name: 'Melody',
      notes: [makeNote(60, 0, 1), makeNote(64, 1, 1)],
      isEmpty: false,
    },
    {
      midiTrackIndex: 2,
      name: 'Chords',
      notes: [makeNote(48, 0, 4)],
      isEmpty: false,
    },
  ],
};

const singleTrackInfo: MidiFileInfo = {
  format: 0,
  suggestedBpm: 140,
  tracks: [
    {
      midiTrackIndex: 0,
      name: 'Track 1',
      notes: [makeNote(60, 0, 2)],
      isEmpty: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MidiImportDialog', () => {
  it('renders with multi-track list', () => {
    const onConfirm = vi.fn();
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('import-track-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('import-track-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('import-track-row-2')).toBeInTheDocument();
  });

  it('shows suggested BPM', () => {
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('suggested-bpm').textContent).toContain('120');
  });

  it('shows suggested BPM for single track', () => {
    render(
      <MidiImportDialog fileInfo={singleTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('suggested-bpm').textContent).toContain('140');
  });

  it('empty tracks are disabled by default', () => {
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const emptyCheckbox = screen.getByTestId('import-track-checkbox-0') as HTMLInputElement;
    expect(emptyCheckbox.disabled).toBe(true);
    expect(emptyCheckbox.checked).toBe(false);
  });

  it('non-empty tracks are enabled by default', () => {
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const cb1 = screen.getByTestId('import-track-checkbox-1') as HTMLInputElement;
    const cb2 = screen.getByTestId('import-track-checkbox-2') as HTMLInputElement;
    expect(cb1.checked).toBe(true);
    expect(cb2.checked).toBe(true);
  });

  it('unchecking a track disables it', () => {
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const cb = screen.getByTestId('import-track-checkbox-1') as HTMLInputElement;
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it('confirm button includes only enabled tracks', () => {
    const onConfirm = vi.fn();
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    // Uncheck track 1 (index 1 = Melody)
    fireEvent.click(screen.getByTestId('import-track-checkbox-1'));
    fireEvent.click(screen.getByTestId('midi-import-confirm'));

    expect(onConfirm).toHaveBeenCalledOnce();
    const payloads = onConfirm.mock.calls[0][0];
    // Only Chords (index 2) should be in the payload
    expect(payloads).toHaveLength(1);
    expect(payloads[0].midiTrackIndex).toBe(2);
  });

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <MidiImportDialog fileInfo={multiTrackInfo} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('midi-import-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('pattern name input is editable and reflected in payload', () => {
    const onConfirm = vi.fn();
    render(
      <MidiImportDialog fileInfo={singleTrackInfo} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId('import-track-name-0') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My Melody' } });
    fireEvent.click(screen.getByTestId('midi-import-confirm'));

    expect(onConfirm).toHaveBeenCalledOnce();
    const payloads = onConfirm.mock.calls[0][0];
    expect(payloads[0].patternName).toBe('My Melody');
  });

  it('confirm is disabled when all tracks are unchecked', () => {
    render(
      <MidiImportDialog fileInfo={singleTrackInfo} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('import-track-checkbox-0'));
    const confirmBtn = screen.getByTestId('midi-import-confirm') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });
});
