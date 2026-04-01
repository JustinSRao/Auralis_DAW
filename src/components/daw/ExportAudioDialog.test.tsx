/**
 * Tests for ExportAudioDialog (Sprint 22).
 *
 * Strategy: mock Tauri dialog, event listener, and IPC helpers so all tests
 * run in jsdom without a real Tauri runtime.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportAudioDialog } from './ExportAudioDialog';

// ---------------------------------------------------------------------------
// Mock: Tauri dialog plugin
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/some/stem/dir'),
  save: vi.fn().mockResolvedValue('/some/output.wav'),
}));

// ---------------------------------------------------------------------------
// Mock: Tauri event API
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

// ---------------------------------------------------------------------------
// Mock: IPC helpers
// ---------------------------------------------------------------------------

vi.mock('@/lib/ipc', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ipc')>();
  return {
    ...original,
    ipcStartExport:    vi.fn().mockResolvedValue(undefined),
    ipcCancelExport:   vi.fn().mockResolvedValue(undefined),
    ipcGetExportProgress: vi.fn().mockResolvedValue(0),
  };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExportAudioDialog', () => {
  // ── Smoke test ─────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.getByText('Export Audio')).toBeInTheDocument();
  });

  // ── Format selection ───────────────────────────────────────────────────────

  it('shows WAV, FLAC, and MP3 format options', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /wav/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /flac/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /mp3/i })).toBeInTheDocument();
  });

  it('defaults to WAV format', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    const wavRadio = screen.getByRole('radio', { name: /^wav$/i }) as HTMLInputElement;
    expect(wavRadio.checked).toBe(true);
  });

  // ── Bit depth section ──────────────────────────────────────────────────────

  it('shows bit depth options for WAV (default)', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.getByText(/16-bit/i)).toBeInTheDocument();
    expect(screen.getByText(/24-bit/i)).toBeInTheDocument();
    expect(screen.getByText(/32-bit float/i)).toBeInTheDocument();
  });

  it('hides bit depth and shows kbps options when MP3 is selected', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /^mp3$/i }));

    expect(screen.queryByText(/16-bit/i)).not.toBeInTheDocument();
    expect(screen.getByText(/128 kbps/i)).toBeInTheDocument();
    expect(screen.getByText(/192 kbps/i)).toBeInTheDocument();
    expect(screen.getByText(/320 kbps/i)).toBeInTheDocument();
  });

  it('shows bit depth when FLAC is selected', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /^flac$/i }));

    expect(screen.getByText(/16-bit/i)).toBeInTheDocument();
    expect(screen.getByText(/24-bit/i)).toBeInTheDocument();
  });

  // ── Sample rate ────────────────────────────────────────────────────────────

  it('shows 44.1 kHz and 48 kHz sample rate options', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.getByText(/44\.1 kHz/i)).toBeInTheDocument();
    expect(screen.getByText(/48 kHz/i)).toBeInTheDocument();
  });

  it('defaults to 44.1 kHz', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    const allRadios = screen.getAllByRole('radio') as HTMLInputElement[];
    // The 44100 radio corresponds to the '44.1 kHz' label.
    // It is checked by default.
    const sr441 = allRadios.find(
      (r) => r.closest('label')?.textContent?.includes('44.1'),
    );
    expect(sr441?.checked).toBe(true);
  });

  // ── Export range ───────────────────────────────────────────────────────────

  it('shows Full Song and Custom Bars range options', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /full song/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /custom bars/i })).toBeInTheDocument();
  });

  it('defaults to Full Song range', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    const fullSongRadio = screen.getByRole('radio', { name: /full song/i }) as HTMLInputElement;
    expect(fullSongRadio.checked).toBe(true);
  });

  it('shows bar number inputs when Custom Bars is selected', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /custom bars/i }));
    const spinners = screen.getAllByRole('spinbutton');
    expect(spinners.length).toBeGreaterThanOrEqual(2);
  });

  it('hides bar inputs when switching back to Full Song', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /custom bars/i }));
    expect(screen.getAllByRole('spinbutton').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('radio', { name: /full song/i }));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  // ── Stems ──────────────────────────────────────────────────────────────────

  it('shows the stems checkbox unchecked by default', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('shows stem directory picker when stems checkbox is checked', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    // The stem browse button should now be visible.
    const browseButtons = screen.getAllByRole('button', { name: /browse/i });
    expect(browseButtons.length).toBeGreaterThanOrEqual(2);
  });

  // ── Export button state ────────────────────────────────────────────────────

  it('Export button is disabled when no output file is chosen', () => {
    render(<ExportAudioDialog onClose={vi.fn()} />);
    const exportBtn = screen.getByRole('button', { name: /^export$/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
  });

  it('Export button remains disabled when stems is checked but no stem dir is chosen', async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/out.wav');

    render(<ExportAudioDialog onClose={vi.fn()} />);

    // Pick an output file.
    const browseButtons = screen.getAllByRole('button', { name: /browse/i });
    fireEvent.click(browseButtons[browseButtons.length - 1]);
    await waitFor(() =>
      expect(screen.queryByText('No file chosen')).not.toBeInTheDocument(),
    );

    // Enable stems — no stem dir chosen yet.
    fireEvent.click(screen.getByRole('checkbox'));

    const exportBtn = screen.getByRole('button', { name: /^export$/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
  });

  // ── Close behaviour ────────────────────────────────────────────────────────

  it('Close button calls onClose when not exporting', () => {
    const onClose = vi.fn();
    render(<ExportAudioDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<ExportAudioDialog onClose={onClose} />);
    // The backdrop is the outermost div; clicking it directly triggers onClose.
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking inside the dialog card does not call onClose', () => {
    const onClose = vi.fn();
    render(<ExportAudioDialog onClose={onClose} />);
    fireEvent.click(screen.getByText('Export Audio'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
