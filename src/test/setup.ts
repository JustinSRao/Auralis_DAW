import "@testing-library/jest-dom";

// Mock the Tauri IPC layer — tests run in jsdom, not a real Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the Tauri event system — listen() returns an unlisten function
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
