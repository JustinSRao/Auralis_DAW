import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { ProjectFileData, RecentProject } from "../lib/ipc";
import { useHistoryStore } from "./historyStore";
import { usePatternStore } from "./patternStore";
import {
  getRecentProjects,
  loadProject,
  markProjectDirty,
  newProject,
  saveProject,
} from "../lib/ipc";

interface FileStoreState {
  filePath: string | null;
  isDirty: boolean;
  isAutoSaving: boolean;
  recentProjects: RecentProject[];
  lastSavedAt: string | null;
  currentProject: ProjectFileData | null;
  error: string | null;

  // Actions
  createNewProject: (name: string) => Promise<void>;
  save: (filePath: string) => Promise<void>;
  open: (filePath: string) => Promise<void>;
  markDirty: () => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  setFilePath: (path: string | null) => void;
  setError: (error: string | null) => void;
}

export const useFileStore = create<FileStoreState>()(
  immer((set, get) => ({
    filePath: null,
    isDirty: false,
    isAutoSaving: false,
    recentProjects: [],
    lastSavedAt: null,
    currentProject: null,
    error: null,

    createNewProject: async (name: string) => {
      try {
        const project = await newProject(name);
        set((state) => {
          state.currentProject = project;
          state.filePath = null;
          state.isDirty = false;
          state.lastSavedAt = null;
          state.error = null;
        });
        // Clear pattern store — prior patterns belong to the previous project.
        usePatternStore.getState().loadFromProject([]);
        // Clear undo/redo history — prior commands belong to the previous project.
        useHistoryStore.getState().clear();
      } catch (e) {
        set((state) => {
          state.error = String(e);
        });
      }
    },

    save: async (filePath: string) => {
      const { currentProject } = get();
      if (!currentProject) return;

      // Inject current patterns from patternStore into the project before saving.
      const projectToSave: ProjectFileData = {
        ...currentProject,
        patterns: Object.values(usePatternStore.getState().patterns),
      };

      try {
        const result = await saveProject(projectToSave, filePath);
        set((state) => {
          // Mirror the saved patterns back into currentProject so it stays in sync.
          if (state.currentProject) {
            state.currentProject.patterns = projectToSave.patterns;
          }
          state.filePath = result.file_path;
          state.isDirty = false;
          state.lastSavedAt = new Date().toISOString();
          state.error = null;
        });
      } catch (e) {
        set((state) => {
          state.error = String(e);
        });
      }
    },

    open: async (filePath: string) => {
      try {
        const project = await loadProject(filePath);
        set((state) => {
          state.currentProject = project;
          state.filePath = filePath;
          state.isDirty = false;
          state.lastSavedAt = project.modified_at;
          state.error = null;
        });
        // Populate pattern store from the loaded project.
        usePatternStore.getState().loadFromProject(project.patterns ?? []);
        // Clear undo/redo history — prior commands belong to the previous project.
        useHistoryStore.getState().clear();
      } catch (e) {
        set((state) => {
          state.error = String(e);
        });
      }
    },

    markDirty: async () => {
      set((state) => {
        state.isDirty = true;
      });
      const { currentProject, filePath } = get();
      if (currentProject && filePath) {
        try {
          await markProjectDirty(currentProject, filePath);
        } catch {
          // Auto-save notification failure is non-critical
        }
      }
    },

    loadRecentProjects: async () => {
      try {
        const recent = await getRecentProjects();
        set((state) => {
          state.recentProjects = recent;
        });
      } catch {
        // Non-critical — keep existing list
      }
    },

    setFilePath: (path: string | null) => {
      set((state) => {
        state.filePath = path;
      });
    },

    setError: (error: string | null) => {
      set((state) => {
        state.error = error;
      });
    },
  })),
);
