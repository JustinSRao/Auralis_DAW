import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useClipPlayerStore } = await import('../clipPlayerStore');

const baseSnap = {
  clip_id: 'clip-1',
  file_path: '/audio/test.wav',
  start_bar: 0,
  duration_bars: 4,
  gain: 1.0,
  start_offset_frames: 0,
  loaded: true,
};

const basePeaks = {
  framesPerPixel: 512,
  left: [{ min: -0.5, max: 0.5 }],
  right: [{ min: -0.5, max: 0.5 }],
  totalFrames: 44100,
  sampleRate: 44100,
};

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useClipPlayerStore.setState({ clips: {}, peaks: {} });
});

describe('clipPlayerStore', () => {
  it('loadClip calls load_audio_clip and stores snapshot', async () => {
    mockInvoke.mockResolvedValueOnce(baseSnap);
    await act(async () => {
      await useClipPlayerStore.getState().loadClip('clip-1', '/audio/test.wav', 0, 4);
    });
    expect(useClipPlayerStore.getState().clips['clip-1']).toMatchObject(baseSnap);
  });

  it('setGain updates local state and calls IPC', async () => {
    useClipPlayerStore.setState({ clips: { 'clip-1': baseSnap }, peaks: {} });
    await act(async () => {
      useClipPlayerStore.getState().setGain('clip-1', 0.5);
    });
    expect(useClipPlayerStore.getState().clips['clip-1'].gain).toBe(0.5);
    expect(mockInvoke).toHaveBeenCalledWith('set_clip_gain', { clipId: 'clip-1', gain: 0.5 });
  });

  it('setOffset updates local state and calls IPC', async () => {
    useClipPlayerStore.setState({ clips: { 'clip-1': baseSnap }, peaks: {} });
    await act(async () => {
      useClipPlayerStore.getState().setOffset('clip-1', 4410);
    });
    expect(useClipPlayerStore.getState().clips['clip-1'].start_offset_frames).toBe(4410);
    expect(mockInvoke).toHaveBeenCalledWith('set_clip_offset', { clipId: 'clip-1', startOffsetFrames: 4410 });
  });

  it('triggerClip calls trigger_audio_clip', async () => {
    await act(async () => {
      await useClipPlayerStore.getState().triggerClip('clip-1');
    });
    expect(mockInvoke).toHaveBeenCalledWith('trigger_audio_clip', { clipId: 'clip-1' });
  });

  it('stopClip calls stop_audio_clip', async () => {
    await act(async () => {
      await useClipPlayerStore.getState().stopClip('clip-1');
    });
    expect(mockInvoke).toHaveBeenCalledWith('stop_audio_clip', { clipId: 'clip-1' });
  });

  it('loadPeaks caches result by filePath+framesPerPixel key', async () => {
    mockInvoke.mockResolvedValueOnce(basePeaks);
    await act(async () => {
      await useClipPlayerStore.getState().loadPeaks('/audio/test.wav', 512);
    });
    const key = '/audio/test.wav::512';
    expect(useClipPlayerStore.getState().peaks[key]).toMatchObject(basePeaks);
    // Second call should not invoke IPC (uses cache)
    mockInvoke.mockClear();
    await act(async () => {
      await useClipPlayerStore.getState().loadPeaks('/audio/test.wav', 512);
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refreshClip calls get_clip_state and updates store', async () => {
    mockInvoke.mockResolvedValueOnce({ ...baseSnap, gain: 0.75 });
    await act(async () => {
      await useClipPlayerStore.getState().refreshClip('clip-1');
    });
    expect(useClipPlayerStore.getState().clips['clip-1'].gain).toBe(0.75);
  });
});
