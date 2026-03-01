import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

/**
 * Zustand slice for UI panel visibility and global keyboard-driven toggles.
 *
 * No `persist` wrapper — panel state resets to sensible defaults on every
 * app launch. Add `persist` in a future sprint if users request it.
 */
interface KeyboardStoreState {
  /** Whether the left browser/history panel is visible. */
  browserOpen: boolean;
  /** Whether the bottom mixer panel is visible. */
  mixerOpen: boolean;
  /** Whether the playhead follows playback position automatically. */
  followPlayhead: boolean;

  /** Toggles the browser panel between open and closed. */
  toggleBrowser: () => void;
  /** Toggles the mixer panel between open and closed. */
  toggleMixer: () => void;
  /** Toggles follow-playhead mode. */
  toggleFollowPlayhead: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useKeyboardStore = create<KeyboardStoreState>()(
  immer((set) => ({
    browserOpen: true,
    mixerOpen: true,
    followPlayhead: false,

    toggleBrowser: () => {
      set((s) => {
        s.browserOpen = !s.browserOpen;
      });
    },

    toggleMixer: () => {
      set((s) => {
        s.mixerOpen = !s.mixerOpen;
      });
    },

    toggleFollowPlayhead: () => {
      set((s) => {
        s.followPlayhead = !s.followPlayhead;
      });
    },
  })),
);
