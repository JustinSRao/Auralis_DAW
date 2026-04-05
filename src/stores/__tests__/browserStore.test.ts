import { invoke } from "@tauri-apps/api/core";
import { useBrowserStore } from "../browserStore";
import type { FileEntry, AppConfig } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const mockEntry = (name: string, is_dir: boolean, is_audio = false): FileEntry => ({
  name,
  path: `/music/${name}`,
  size: is_dir ? 0 : 1024,
  is_dir,
  is_audio,
});

const mockConfig: AppConfig = {
  audio: { outputDevice: null, inputDevice: null, sampleRate: 44100, bufferSize: 256 },
  midi: { activeInput: null, activeOutput: null },
  general: { autosaveIntervalSecs: 300, recentProjectsLimit: 10 },
  ui: { browserOpen: true, mixerOpen: true, followPlayhead: false, theme: "dark" },
  shortcuts: { bindings: {} },
  browser: { favorites: [], recentFolders: [] },
};

describe("browserStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useBrowserStore.setState({
      currentPath: "",
      fileEntries: [],
      favorites: [],
      recentFolders: [],
      searchQuery: "",
      isLoading: false,
      error: null,
      isPreviewPlaying: false,
      previewingPath: null,
    });
  });

  it("has correct initial state", () => {
    const s = useBrowserStore.getState();
    expect(s.currentPath).toBe("");
    expect(s.fileEntries).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("navigate calls list_directory and updates state", async () => {
    const entries = [mockEntry("drums", true), mockEntry("kick.wav", false, true)];
    mockInvoke
      .mockResolvedValueOnce(entries) // list_directory
      .mockResolvedValueOnce(mockConfig) // get_config (for persist)
      .mockResolvedValueOnce(undefined); // save_config

    await useBrowserStore.getState().navigate("/music");

    const s = useBrowserStore.getState();
    expect(s.currentPath).toBe("/music");
    expect(s.fileEntries).toHaveLength(2);
    expect(s.isLoading).toBe(false);
  });

  it("navigate adds to recentFolders newest-first", async () => {
    mockInvoke.mockResolvedValue([]);
    mockInvoke
      .mockResolvedValueOnce([]) // list_directory /a
      .mockResolvedValueOnce(mockConfig)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]) // list_directory /b
      .mockResolvedValueOnce(mockConfig)
      .mockResolvedValueOnce(undefined);

    await useBrowserStore.getState().navigate("/a");
    await useBrowserStore.getState().navigate("/b");

    const { recentFolders } = useBrowserStore.getState();
    expect(recentFolders[0]).toBe("/b");
    expect(recentFolders[1]).toBe("/a");
  });

  it("navigate deduplicates recentFolders", async () => {
    mockInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockConfig)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockConfig)
      .mockResolvedValueOnce(undefined);

    await useBrowserStore.getState().navigate("/music");
    await useBrowserStore.getState().navigate("/music");

    const { recentFolders } = useBrowserStore.getState();
    expect(recentFolders.filter((r) => r === "/music")).toHaveLength(1);
  });

  it("navigate caps recentFolders at 10", async () => {
    for (let i = 0; i < 11; i++) {
      mockInvoke
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockConfig)
        .mockResolvedValueOnce(undefined);
      await useBrowserStore.getState().navigate(`/folder${i}`);
    }
    expect(useBrowserStore.getState().recentFolders.length).toBeLessThanOrEqual(10);
  });

  it("startPreview sets isPreviewPlaying and previewingPath", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await useBrowserStore.getState().startPreview("/music/kick.wav");

    const s = useBrowserStore.getState();
    expect(s.isPreviewPlaying).toBe(true);
    expect(s.previewingPath).toBe("/music/kick.wav");
  });

  it("stopPreview clears preview state", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    useBrowserStore.setState({ isPreviewPlaying: true, previewingPath: "/kick.wav" });

    await useBrowserStore.getState().stopPreview();

    const s = useBrowserStore.getState();
    expect(s.isPreviewPlaying).toBe(false);
    expect(s.previewingPath).toBeNull();
  });

  it("addFavorite adds path to favorites", async () => {
    mockInvoke.mockResolvedValueOnce(mockConfig).mockResolvedValueOnce(undefined);

    await useBrowserStore.getState().addFavorite("/music/samples");

    expect(useBrowserStore.getState().favorites).toContain("/music/samples");
  });

  it("removeFavorite removes path from favorites", async () => {
    useBrowserStore.setState({ favorites: ["/music/samples", "/other"] });
    mockInvoke.mockResolvedValueOnce(mockConfig).mockResolvedValueOnce(undefined);

    await useBrowserStore.getState().removeFavorite("/music/samples");

    expect(useBrowserStore.getState().favorites).not.toContain("/music/samples");
    expect(useBrowserStore.getState().favorites).toContain("/other");
  });

  it("navigate sets error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("access denied"));

    await useBrowserStore.getState().navigate("/restricted");

    const s = useBrowserStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.isLoading).toBe(false);
  });

  it("hydrateFromConfig populates favorites and recentFolders", () => {
    useBrowserStore.getState().hydrateFromConfig({
      favorites: ["/music/drums"],
      recentFolders: ["/music/loops", "/music/fx"],
    });

    const s = useBrowserStore.getState();
    expect(s.favorites).toEqual(["/music/drums"]);
    expect(s.recentFolders).toEqual(["/music/loops", "/music/fx"]);
  });

  it("setSearch updates searchQuery", () => {
    useBrowserStore.getState().setSearch("kick");
    expect(useBrowserStore.getState().searchQuery).toBe("kick");
  });
});
