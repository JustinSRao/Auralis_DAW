/**
 * Sample & Content Browser store (Sprint 28).
 *
 * Manages browser navigation, favorites, recents, search, and audio preview
 * state. Persistence is delegated to the backend via AppConfig (Sprint 27
 * pattern) — no localStorage.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FileEntry, AppBrowserConfig } from "@/lib/ipc";
import {
  ipcListDirectory,
  ipcGetDrives,
  ipcStartPreview,
  ipcStopPreview,
  ipcGetAppConfig,
  ipcSaveAppConfig,
} from "@/lib/ipc";

const MAX_RECENTS = 10;

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface BrowserStore {
  // State
  currentPath: string;
  fileEntries: FileEntry[];
  favorites: string[];
  recentFolders: string[];
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  isPreviewPlaying: boolean;
  previewingPath: string | null;

  // Actions
  navigate(path: string): Promise<void>;
  loadDrives(): Promise<void>;
  setSearch(q: string): void;
  addFavorite(path: string): Promise<void>;
  removeFavorite(path: string): Promise<void>;
  startPreview(path: string): Promise<void>;
  stopPreview(): Promise<void>;
  hydrateFromConfig(cfg: AppBrowserConfig): void;
  persistToConfig(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useBrowserStore = create<BrowserStore>()(
  immer((set, get) => ({
    currentPath: "",
    fileEntries: [],
    favorites: [],
    recentFolders: [],
    searchQuery: "",
    isLoading: false,
    error: null,
    isPreviewPlaying: false,
    previewingPath: null,

    async navigate(path: string) {
      set((s) => {
        s.isLoading = true;
        s.error = null;
        s.searchQuery = "";
      });
      try {
        const entries = await ipcListDirectory(path);
        set((s) => {
          s.currentPath = path;
          s.fileEntries = entries ?? [];
          s.isLoading = false;
          // Prepend to recents, dedupe, cap at MAX_RECENTS
          const without = s.recentFolders.filter((r) => r !== path);
          s.recentFolders = [path, ...without].slice(0, MAX_RECENTS);
        });
        await get().persistToConfig();
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    async loadDrives() {
      set((s) => {
        s.isLoading = true;
        s.error = null;
        s.currentPath = "";
      });
      try {
        const entries = await ipcGetDrives();
        set((s) => {
          s.fileEntries = entries ?? [];
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    setSearch(q: string) {
      set((s) => {
        s.searchQuery = q;
      });
    },

    async addFavorite(path: string) {
      set((s) => {
        if (!s.favorites.includes(path)) {
          s.favorites.push(path);
        }
      });
      await get().persistToConfig();
    },

    async removeFavorite(path: string) {
      set((s) => {
        s.favorites = s.favorites.filter((f) => f !== path);
      });
      await get().persistToConfig();
    },

    async startPreview(path: string) {
      try {
        await ipcStartPreview(path);
        set((s) => {
          s.isPreviewPlaying = true;
          s.previewingPath = path;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    async stopPreview() {
      try {
        await ipcStopPreview();
      } catch {
        // ignore
      }
      set((s) => {
        s.isPreviewPlaying = false;
        s.previewingPath = null;
      });
    },

    hydrateFromConfig(cfg: AppBrowserConfig) {
      set((s) => {
        s.favorites = cfg.favorites ?? [];
        s.recentFolders = cfg.recentFolders ?? [];
      });
    },

    async persistToConfig() {
      try {
        const cfg = await ipcGetAppConfig();
        const { favorites, recentFolders } = get();
        await ipcSaveAppConfig({
          ...cfg,
          browser: { favorites, recentFolders },
        });
      } catch (e) {
        // Non-fatal — log but don't surface to user
        console.warn("BrowserStore: failed to persist config", e);
      }
    },
  })),
);
