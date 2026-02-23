import "@testing-library/jest-dom";

// Mock the Tauri IPC layer — tests run in jsdom, not a real Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
