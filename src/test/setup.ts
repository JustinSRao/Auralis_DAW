import "@testing-library/jest-dom";

// Mock the Tauri IPC layer — tests run in jsdom, not a real Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the Tauri event system — listen() returns an unlisten function
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock the Tauri dialog plugin — open() returns null by default (no file selected)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// Canvas context returns null in jsdom — prevent draw crash in canvas components
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null as unknown as CanvasRenderingContext2D;
});

// ResizeObserver is not implemented in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
