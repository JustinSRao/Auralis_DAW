import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

// Mock arrangementStore — updateClipOptimistic just records calls
const mockUpdateClipOptimistic = vi.fn();
vi.mock('../arrangementStore', () => ({
  useArrangementStore: {
    getState: () => ({ updateClipOptimistic: mockUpdateClipOptimistic }),
  },
}));

const { useFadeStore } = await import('../fadeStore');

beforeEach(() => {
  mockInvoke.mockResolvedValue({
    clip_id: 'c1',
    fade_in_frames: 0,
    fade_out_frames: 0,
    fade_in_curve: 'linear',
    fade_out_curve: 'linear',
  });
  mockUpdateClipOptimistic.mockClear();
  useFadeStore.setState({ fades: {} });
});

describe('fadeStore', () => {
  it('initClip creates default fade state for a clip', () => {
    useFadeStore.getState().initClip('c1');
    const fade = useFadeStore.getState().fades['c1'];
    expect(fade).toBeDefined();
    expect(fade.fadeInSamples).toBe(0);
    expect(fade.fadeOutSamples).toBe(0);
    expect(fade.fadeInCurve).toBe('linear');
  });

  it('initClip merges provided state', () => {
    useFadeStore.getState().initClip('c1', { fadeInSamples: 1000, fadeInCurve: 's_curve' });
    const fade = useFadeStore.getState().fades['c1'];
    expect(fade.fadeInSamples).toBe(1000);
    expect(fade.fadeInCurve).toBe('s_curve');
    expect(fade.fadeOutSamples).toBe(0); // default
  });

  it('setFadeIn updates store and calls IPC', async () => {
    await act(async () => {
      useFadeStore.getState().setFadeIn('c1', 2000, 'exponential_in');
    });
    expect(useFadeStore.getState().fades['c1'].fadeInSamples).toBe(2000);
    expect(useFadeStore.getState().fades['c1'].fadeInCurve).toBe('exponential_in');
    expect(mockInvoke).toHaveBeenCalledWith('set_clip_fade_in', {
      clipId: 'c1', fadeFrames: 2000, curveType: 'exponential_in',
    });
  });

  it('setFadeOut updates store and calls IPC', async () => {
    await act(async () => {
      useFadeStore.getState().setFadeOut('c1', 500, 'logarithmic');
    });
    expect(useFadeStore.getState().fades['c1'].fadeOutSamples).toBe(500);
    expect(useFadeStore.getState().fades['c1'].fadeOutCurve).toBe('logarithmic');
    expect(mockInvoke).toHaveBeenCalledWith('set_clip_fade_out', {
      clipId: 'c1', fadeFrames: 500, curveType: 'logarithmic',
    });
  });

  it('setCurveType for in updates only the in-curve', async () => {
    useFadeStore.getState().initClip('c1', { fadeInSamples: 1000, fadeOutSamples: 500 });
    await act(async () => {
      useFadeStore.getState().setCurveType('c1', 'in', 's_curve');
    });
    expect(useFadeStore.getState().fades['c1'].fadeInCurve).toBe('s_curve');
    expect(useFadeStore.getState().fades['c1'].fadeOutCurve).toBe('linear');
  });

  it('setCrossfade links two clips with S-Curve', async () => {
    mockInvoke.mockResolvedValueOnce([
      { clip_id: 'a', fade_in_frames: 0, fade_out_frames: 4410, fade_in_curve: 'linear', fade_out_curve: 's_curve' },
      { clip_id: 'b', fade_in_frames: 4410, fade_out_frames: 0, fade_in_curve: 's_curve', fade_out_curve: 'linear' },
    ]);
    await act(async () => {
      useFadeStore.getState().setCrossfade('a', 'b', 4410);
    });
    const fa = useFadeStore.getState().fades['a'];
    const fb = useFadeStore.getState().fades['b'];
    expect(fa.fadeOutSamples).toBe(4410);
    expect(fa.fadeOutCurve).toBe('s_curve');
    expect(fa.crossfadePartnerId).toBe('b');
    expect(fb.fadeInSamples).toBe(4410);
    expect(fb.fadeInCurve).toBe('s_curve');
    expect(fb.crossfadePartnerId).toBe('a');
  });

  it('removeCrossfade clears partner links and resets samples', () => {
    useFadeStore.setState({
      fades: {
        a: { fadeInSamples: 0, fadeOutSamples: 4410, fadeInCurve: 'linear', fadeOutCurve: 's_curve', crossfadePartnerId: 'b', crossfadeSamples: 4410 },
        b: { fadeInSamples: 4410, fadeOutSamples: 0, fadeInCurve: 's_curve', fadeOutCurve: 'linear', crossfadePartnerId: 'a', crossfadeSamples: 4410 },
      },
    });
    useFadeStore.getState().removeCrossfade('a', 'b');
    expect(useFadeStore.getState().fades['a'].crossfadePartnerId).toBeNull();
    expect(useFadeStore.getState().fades['a'].fadeOutSamples).toBe(0);
    expect(useFadeStore.getState().fades['b'].crossfadePartnerId).toBeNull();
    expect(useFadeStore.getState().fades['b'].fadeInSamples).toBe(0);
  });

  it('removeClip deletes the clip entry', () => {
    useFadeStore.getState().initClip('c1');
    useFadeStore.getState().removeClip('c1');
    expect(useFadeStore.getState().fades['c1']).toBeUndefined();
  });
});
