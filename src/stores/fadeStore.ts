import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetClipFadeIn,
  ipcSetClipFadeOut,
  ipcSetFadeCurveType,
  ipcSetCrossfade,
} from '../lib/ipc';
import type { FadeCurveType } from '../lib/ipc';
import { useArrangementStore } from './arrangementStore';

export type { FadeCurveType };

export interface ClipFadeState {
  fadeInSamples: number;
  fadeOutSamples: number;
  fadeInCurve: FadeCurveType;
  fadeOutCurve: FadeCurveType;
  crossfadePartnerId: string | null;
  crossfadeSamples: number;
}

interface FadeStoreState {
  /** Keyed by clipId */
  fades: Record<string, ClipFadeState>;
}

interface FadeStoreActions {
  /** Initialise a clip's fade state (called when a project loads or clip is created). */
  initClip: (clipId: string, state?: Partial<ClipFadeState>) => void;
  /** Removes a clip's fade state. */
  removeClip: (clipId: string) => void;
  /** Sets fade-in length (in samples) and curve, updates backend and arrangement store. */
  setFadeIn: (clipId: string, samples: number, curve: FadeCurveType) => void;
  /** Sets fade-out length (in samples) and curve, updates backend and arrangement store. */
  setFadeOut: (clipId: string, samples: number, curve: FadeCurveType) => void;
  /** Changes just the curve type for a fade. */
  setCurveType: (clipId: string, kind: 'in' | 'out', curve: FadeCurveType) => void;
  /** Sets an equal-power crossfade between two clips. */
  setCrossfade: (clipIdA: string, clipIdB: string, overlapSamples: number) => void;
  /** Removes the crossfade link between two clips. */
  removeCrossfade: (clipIdA: string, clipIdB: string) => void;
}

type FadeStore = FadeStoreState & FadeStoreActions;

const defaultFade = (): ClipFadeState => ({
  fadeInSamples: 0,
  fadeOutSamples: 0,
  fadeInCurve: 'linear',
  fadeOutCurve: 'linear',
  crossfadePartnerId: null,
  crossfadeSamples: 0,
});

export const useFadeStore = create<FadeStore>()(
  immer((set) => ({
    fades: {},

    initClip: (clipId, state) => set((s) => {
      s.fades[clipId] = { ...defaultFade(), ...state };
    }),

    removeClip: (clipId) => set((s) => {
      delete s.fades[clipId];
    }),

    setFadeIn: (clipId, samples, curve) => {
      set((s) => {
        if (!s.fades[clipId]) s.fades[clipId] = defaultFade();
        s.fades[clipId].fadeInSamples = samples;
        s.fades[clipId].fadeInCurve = curve;
      });
      // Mirror to arrangementStore for persistence
      useArrangementStore.getState().updateClipOptimistic(clipId, {
        fadeInSamples: samples,
        fadeInCurve: curve,
      });
      void ipcSetClipFadeIn(clipId, samples, curve);
    },

    setFadeOut: (clipId, samples, curve) => {
      set((s) => {
        if (!s.fades[clipId]) s.fades[clipId] = defaultFade();
        s.fades[clipId].fadeOutSamples = samples;
        s.fades[clipId].fadeOutCurve = curve;
      });
      useArrangementStore.getState().updateClipOptimistic(clipId, {
        fadeOutSamples: samples,
        fadeOutCurve: curve,
      });
      void ipcSetClipFadeOut(clipId, samples, curve);
    },

    setCurveType: (clipId, kind, curve) => {
      set((s) => {
        if (!s.fades[clipId]) s.fades[clipId] = defaultFade();
        if (kind === 'in') s.fades[clipId].fadeInCurve = curve;
        else s.fades[clipId].fadeOutCurve = curve;
      });
      const patch =
        kind === 'in' ? { fadeInCurve: curve } : { fadeOutCurve: curve };
      useArrangementStore.getState().updateClipOptimistic(clipId, patch);
      void ipcSetFadeCurveType(clipId, kind, curve);
    },

    setCrossfade: (clipIdA, clipIdB, overlapSamples) => {
      set((s) => {
        if (!s.fades[clipIdA]) s.fades[clipIdA] = defaultFade();
        if (!s.fades[clipIdB]) s.fades[clipIdB] = defaultFade();
        s.fades[clipIdA].fadeOutSamples = overlapSamples;
        s.fades[clipIdA].fadeOutCurve = 's_curve';
        s.fades[clipIdA].crossfadePartnerId = clipIdB;
        s.fades[clipIdA].crossfadeSamples = overlapSamples;
        s.fades[clipIdB].fadeInSamples = overlapSamples;
        s.fades[clipIdB].fadeInCurve = 's_curve';
        s.fades[clipIdB].crossfadePartnerId = clipIdA;
        s.fades[clipIdB].crossfadeSamples = overlapSamples;
      });
      // Mirror to arrangement store
      const arr = useArrangementStore.getState();
      arr.updateClipOptimistic(clipIdA, {
        fadeOutSamples: overlapSamples,
        fadeOutCurve: 's_curve',
        crossfadePartnerId: clipIdB,
        crossfadeSamples: overlapSamples,
      });
      arr.updateClipOptimistic(clipIdB, {
        fadeInSamples: overlapSamples,
        fadeInCurve: 's_curve',
        crossfadePartnerId: clipIdA,
        crossfadeSamples: overlapSamples,
      });
      void ipcSetCrossfade(clipIdA, clipIdB, overlapSamples);
    },

    removeCrossfade: (clipIdA, clipIdB) => {
      set((s) => {
        if (s.fades[clipIdA]) {
          s.fades[clipIdA].crossfadePartnerId = null;
          s.fades[clipIdA].crossfadeSamples = 0;
          s.fades[clipIdA].fadeOutSamples = 0;
        }
        if (s.fades[clipIdB]) {
          s.fades[clipIdB].crossfadePartnerId = null;
          s.fades[clipIdB].crossfadeSamples = 0;
          s.fades[clipIdB].fadeInSamples = 0;
        }
      });
      const arr = useArrangementStore.getState();
      arr.updateClipOptimistic(clipIdA, {
        fadeOutSamples: 0,
        crossfadePartnerId: undefined,
        crossfadeSamples: 0,
      });
      arr.updateClipOptimistic(clipIdB, {
        fadeInSamples: 0,
        crossfadePartnerId: undefined,
        crossfadeSamples: 0,
      });
    },
  }))
);
