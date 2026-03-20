import { invoke } from "@tauri-apps/api/core";
import { useFileStore } from "../fileStore";
import type { ProjectFileData, RecentProject, SaveResult } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const mockProject: ProjectFileData = {
  schema_version: { major: 1, minor: 0, patch: 0 },
  id: "test-id-123",
  name: "Test Project",
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-01-01T00:00:00Z",
  transport: {
    bpm: 120,
    time_sig_numerator: 4,
    time_sig_denominator: 4,
    sample_rate: 44100,
    loop_enabled: false,
    loop_start_beats: 0,
    loop_end_beats: 16,
    tempo_map: [{ tick: 0, bpm: 120, interp: "Step" }],
  },
  tracks: [],
  master: { volume: 0.8, pan: 0, effects: [] },
  samples: [],
};

const mockSaveResult: SaveResult = {
  success: true,
  file_path: "/projects/test.mapp",
};

const mockRecent: RecentProject[] = [
  { name: "Song A", file_path: "/a.mapp", modified_at: "2026-01-01T00:00:00Z" },
  { name: "Song B", file_path: "/b.mapp", modified_at: "2026-01-01T00:00:00Z" },
];

function resetStore() {
  useFileStore.setState({
    filePath: null,
    isDirty: false,
    isAutoSaving: false,
    recentProjects: [],
    lastSavedAt: null,
    currentProject: null,
    error: null,
  });
}

describe("fileStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetStore();
  });

  it("has correct initial state", () => {
    const state = useFileStore.getState();
    expect(state.filePath).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.currentProject).toBeNull();
    expect(state.recentProjects).toEqual([]);
    expect(state.error).toBeNull();
  });

  describe("createNewProject", () => {
    it("creates a new project via IPC", async () => {
      mockInvoke.mockResolvedValueOnce(mockProject);

      await useFileStore.getState().createNewProject("Test Project");

      expect(mockInvoke).toHaveBeenCalledWith("new_project", { name: "Test Project" });
      const state = useFileStore.getState();
      expect(state.currentProject).toEqual(mockProject);
      expect(state.filePath).toBeNull();
      expect(state.isDirty).toBe(false);
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("creation failed"));

      await useFileStore.getState().createNewProject("Fail");

      expect(useFileStore.getState().error).toContain("creation failed");
    });
  });

  describe("save", () => {
    it("saves current project and updates state", async () => {
      useFileStore.setState({ currentProject: mockProject, isDirty: true });
      mockInvoke.mockResolvedValueOnce(mockSaveResult);

      await useFileStore.getState().save("/projects/test.mapp");

      expect(mockInvoke).toHaveBeenCalledWith("save_project", {
        project: { ...mockProject, patterns: [], arrangement: { clips: [] } },
        filePath: "/projects/test.mapp",
      });
      const state = useFileStore.getState();
      expect(state.filePath).toBe("/projects/test.mapp");
      expect(state.isDirty).toBe(false);
      expect(state.lastSavedAt).not.toBeNull();
    });

    it("does nothing when no current project", async () => {
      await useFileStore.getState().save("/test.mapp");
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("sets error on failure", async () => {
      useFileStore.setState({ currentProject: mockProject });
      mockInvoke.mockRejectedValueOnce(new Error("disk full"));

      await useFileStore.getState().save("/test.mapp");

      expect(useFileStore.getState().error).toContain("disk full");
    });
  });

  describe("open", () => {
    it("loads project from file path", async () => {
      mockInvoke.mockResolvedValueOnce(mockProject);

      await useFileStore.getState().open("/projects/test.mapp");

      expect(mockInvoke).toHaveBeenCalledWith("load_project", {
        filePath: "/projects/test.mapp",
      });
      const state = useFileStore.getState();
      expect(state.currentProject).toEqual(mockProject);
      expect(state.filePath).toBe("/projects/test.mapp");
      expect(state.isDirty).toBe(false);
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("corrupt file"));

      await useFileStore.getState().open("/bad.mapp");

      expect(useFileStore.getState().error).toContain("corrupt file");
    });
  });

  describe("markDirty", () => {
    it("sets isDirty to true", async () => {
      useFileStore.setState({ currentProject: mockProject, filePath: "/test.mapp" });
      mockInvoke.mockResolvedValueOnce(undefined);

      await useFileStore.getState().markDirty();

      expect(useFileStore.getState().isDirty).toBe(true);
    });

    it("calls mark_project_dirty when project and path exist", async () => {
      useFileStore.setState({ currentProject: mockProject, filePath: "/test.mapp" });
      mockInvoke.mockResolvedValueOnce(undefined);

      await useFileStore.getState().markDirty();

      expect(mockInvoke).toHaveBeenCalledWith("mark_project_dirty", {
        project: mockProject,
        filePath: "/test.mapp",
      });
    });

    it("does not call IPC when no file path", async () => {
      useFileStore.setState({ currentProject: mockProject, filePath: null });

      await useFileStore.getState().markDirty();

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(useFileStore.getState().isDirty).toBe(true);
    });
  });

  describe("loadRecentProjects", () => {
    it("fetches and stores recent projects", async () => {
      mockInvoke.mockResolvedValueOnce(mockRecent);

      await useFileStore.getState().loadRecentProjects();

      expect(mockInvoke).toHaveBeenCalledWith("get_recent_projects");
      expect(useFileStore.getState().recentProjects).toEqual(mockRecent);
    });

    it("keeps existing list on failure", async () => {
      useFileStore.setState({ recentProjects: mockRecent });
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      await useFileStore.getState().loadRecentProjects();

      expect(useFileStore.getState().recentProjects).toEqual(mockRecent);
    });
  });

  describe("setFilePath", () => {
    it("updates the file path", () => {
      useFileStore.getState().setFilePath("/new/path.mapp");
      expect(useFileStore.getState().filePath).toBe("/new/path.mapp");
    });

    it("clears the file path", () => {
      useFileStore.setState({ filePath: "/old.mapp" });
      useFileStore.getState().setFilePath(null);
      expect(useFileStore.getState().filePath).toBeNull();
    });
  });

  describe("setError", () => {
    it("sets and clears error", () => {
      useFileStore.getState().setError("something broke");
      expect(useFileStore.getState().error).toBe("something broke");

      useFileStore.getState().setError(null);
      expect(useFileStore.getState().error).toBeNull();
    });
  });
});
