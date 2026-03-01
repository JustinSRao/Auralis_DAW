import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface Track {
  id: string;
  name: string;
  type: "audio" | "midi" | "bus";
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  color: string;
}

export interface Pattern {
  id: string;
  name: string;
  trackId: string;
  startBar: number;
  lengthBars: number;
}

export interface ProjectState {
  name: string;
  bpm: number;
  timeSignature: [number, number];
  sampleRate: number;
  tracks: Track[];
  patterns: Pattern[];
  isPlaying: boolean;
  isRecording: boolean;
  currentBar: number;
  // Actions
  setBpm: (bpm: number) => void;
  setPlaying: (playing: boolean) => void;
  setRecording: (recording: boolean) => void;
  addTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, updates: Partial<Track>) => void;
  /** Rename the pattern identified by `patternId` to `name`. No-op when the id is not found. */
  renamePattern: (patternId: string, name: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  immer((set) => ({
    name: "Untitled Project",
    bpm: 120,
    timeSignature: [4, 4],
    sampleRate: 44100,
    tracks: [],
    patterns: [],
    isPlaying: false,
    isRecording: false,
    currentBar: 0,

    setBpm: (bpm) => set((state) => { state.bpm = bpm; }),
    setPlaying: (playing) => set((state) => { state.isPlaying = playing; }),
    setRecording: (recording) => set((state) => { state.isRecording = recording; }),
    addTrack: (track) => set((state) => { state.tracks.push(track); }),
    removeTrack: (id) => set((state) => {
      state.tracks = state.tracks.filter((t) => t.id !== id);
    }),
    updateTrack: (id, updates) => set((state) => {
      const track = state.tracks.find((t) => t.id === id);
      if (track) Object.assign(track, updates);
    }),
    renamePattern: (patternId, name) => set((state) => {
      const pattern = state.patterns.find((p) => p.id === patternId);
      if (pattern) pattern.name = name;
    }),
  }))
);
