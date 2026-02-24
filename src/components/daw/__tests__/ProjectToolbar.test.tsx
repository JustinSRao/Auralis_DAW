import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectToolbar } from "../ProjectToolbar";
import { useFileStore } from "@/stores/fileStore";
import type { ProjectFileData, RecentProject } from "@/lib/ipc";

const mockInvoke = vi.mocked(invoke);

const mockProject: ProjectFileData = {
  schema_version: { major: 1, minor: 0, patch: 0 },
  id: "test-id",
  name: "My Song",
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
  },
  tracks: [],
  master: { volume: 0.8, pan: 0, effects: [] },
  samples: [],
};

const mockRecent: RecentProject[] = [
  { name: "Song A", file_path: "/a.mapp", modified_at: "2026-01-01T00:00:00Z" },
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

describe("ProjectToolbar", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Mock loadRecentProjects IPC call in useEffect
    mockInvoke.mockResolvedValue([]);
    resetStore();
  });

  it("renders New, Save, and Open buttons", () => {
    render(<ProjectToolbar />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("shows project name when a project is loaded", () => {
    useFileStore.setState({ currentProject: mockProject });
    render(<ProjectToolbar />);
    expect(screen.getByText("My Song")).toBeInTheDocument();
  });

  it("shows 'No Project' when no project loaded", () => {
    render(<ProjectToolbar />);
    expect(screen.getByText("No Project")).toBeInTheDocument();
  });

  it("shows dirty indicator when project is modified", () => {
    useFileStore.setState({ currentProject: mockProject, isDirty: true });
    render(<ProjectToolbar />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("does not show dirty indicator when project is clean", () => {
    useFileStore.setState({ currentProject: mockProject, isDirty: false });
    render(<ProjectToolbar />);
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("calls createNewProject when New is clicked", async () => {
    mockInvoke.mockResolvedValueOnce([]); // loadRecent
    mockInvoke.mockResolvedValueOnce(mockProject); // newProject
    render(<ProjectToolbar />);

    fireEvent.click(screen.getByText("New"));

    // Should have called new_project
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("new_project", {
        name: "Untitled Project",
      });
    });
  });

  it("shows error message and dismiss button", () => {
    useFileStore.setState({ error: "Something went wrong" });
    render(<ProjectToolbar />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("clears error when dismiss button is clicked", () => {
    useFileStore.setState({ error: "Some error" });
    render(<ProjectToolbar />);

    fireEvent.click(screen.getByText("x"));
    expect(useFileStore.getState().error).toBeNull();
  });

  it("shows recent projects dropdown when Open is clicked", () => {
    useFileStore.setState({ recentProjects: mockRecent });
    render(<ProjectToolbar />);

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Song A")).toBeInTheDocument();
  });

  it("Save button is disabled when no project is loaded", () => {
    render(<ProjectToolbar />);
    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
  });
});
