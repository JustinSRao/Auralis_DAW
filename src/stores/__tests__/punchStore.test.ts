import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { usePunchStore } from '../punchStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  usePunchStore.setState({
    punchEnabled: false,
    punchInBeats: 0,
    punchOutBeats: 4,
    preRollBars: 2,
    isLoading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  mockInvoke.mockResolvedValue(undefined);
});

describe('punchStore', () => {
  // -------------------------------------------------------------------------
  // togglePunchMode
  // -------------------------------------------------------------------------

  it('togglePunchMode calls IPC and updates state', async () => {
    await usePunchStore.getState().togglePunchMode(true);

    expect(mockInvoke).toHaveBeenCalledWith('toggle_punch_mode', { enabled: true });
    expect(usePunchStore.getState().punchEnabled).toBe(true);
    expect(usePunchStore.getState().isLoading).toBe(false);
    expect(usePunchStore.getState().error).toBeNull();
  });

  it('togglePunchMode reverts optimistic update on IPC error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('engine not running'));

    await usePunchStore.getState().togglePunchMode(true);

    // Should be reverted
    expect(usePunchStore.getState().punchEnabled).toBe(false);
    expect(usePunchStore.getState().error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // setPunchIn
  // -------------------------------------------------------------------------

  it('setPunchIn calls IPC and updates punchInBeats', async () => {
    await usePunchStore.getState().setPunchIn(8);

    expect(mockInvoke).toHaveBeenCalledWith('set_punch_in', { beats: 8 });
    expect(usePunchStore.getState().punchInBeats).toBe(8);
    expect(usePunchStore.getState().isLoading).toBe(false);
    expect(usePunchStore.getState().error).toBeNull();
  });

  it('setPunchIn sets error field on IPC failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('backend error'));

    await usePunchStore.getState().setPunchIn(4);

    expect(usePunchStore.getState().error).toBeTruthy();
    expect(usePunchStore.getState().isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // setPunchOut
  // -------------------------------------------------------------------------

  it('setPunchOut calls IPC and updates punchOutBeats', async () => {
    await usePunchStore.getState().setPunchOut(16);

    expect(mockInvoke).toHaveBeenCalledWith('set_punch_out', { beats: 16 });
    expect(usePunchStore.getState().punchOutBeats).toBe(16);
    expect(usePunchStore.getState().isLoading).toBe(false);
    expect(usePunchStore.getState().error).toBeNull();
  });

  it('IPC error in setPunchOut sets error field', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('out of range'));

    await usePunchStore.getState().setPunchOut(999);

    expect(usePunchStore.getState().error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // setPreRollBars
  // -------------------------------------------------------------------------

  it('setPreRollBars updates preRollBars without making an IPC call', () => {
    usePunchStore.getState().setPreRollBars(4);

    expect(usePunchStore.getState().preRollBars).toBe(4);
    // No IPC should have been called
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // refreshMarkers
  // -------------------------------------------------------------------------

  it('refreshMarkers fetches markers and updates beats state', async () => {
    mockInvoke.mockResolvedValueOnce({
      punch_in_beats: 2,
      punch_out_beats: 6,
      punch_in_samples: 88200,
      punch_out_samples: 264600,
    });

    await usePunchStore.getState().refreshMarkers();

    expect(mockInvoke).toHaveBeenCalledWith('get_punch_markers');
    expect(usePunchStore.getState().punchInBeats).toBe(2);
    expect(usePunchStore.getState().punchOutBeats).toBe(6);
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  it('clearError resets the error field', () => {
    usePunchStore.setState({ error: 'something went wrong' });

    usePunchStore.getState().clearError();

    expect(usePunchStore.getState().error).toBeNull();
  });
});
