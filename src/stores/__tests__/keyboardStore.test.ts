import { beforeEach, describe, expect, it } from "vitest";
import { useKeyboardStore } from "../keyboardStore";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("keyboardStore", () => {
  beforeEach(() => {
    // Reset to known initial state before every test
    useKeyboardStore.setState({
      browserOpen: true,
      mixerOpen: true,
      followPlayhead: false,
    });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("has correct initial state: browserOpen=true, mixerOpen=true, followPlayhead=false", () => {
    const { browserOpen, mixerOpen, followPlayhead } =
      useKeyboardStore.getState();
    expect(browserOpen).toBe(true);
    expect(mixerOpen).toBe(true);
    expect(followPlayhead).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleBrowser
  // -------------------------------------------------------------------------

  it("toggleBrowser flips browserOpen from true to false", () => {
    useKeyboardStore.setState({ browserOpen: true });

    useKeyboardStore.getState().toggleBrowser();

    expect(useKeyboardStore.getState().browserOpen).toBe(false);
  });

  it("toggleBrowser flips browserOpen from false to true", () => {
    useKeyboardStore.setState({ browserOpen: false });

    useKeyboardStore.getState().toggleBrowser();

    expect(useKeyboardStore.getState().browserOpen).toBe(true);
  });

  it("toggleBrowser twice returns browserOpen to original state", () => {
    const initial = useKeyboardStore.getState().browserOpen;

    useKeyboardStore.getState().toggleBrowser();
    useKeyboardStore.getState().toggleBrowser();

    expect(useKeyboardStore.getState().browserOpen).toBe(initial);
  });

  // -------------------------------------------------------------------------
  // toggleMixer
  // -------------------------------------------------------------------------

  it("toggleMixer flips mixerOpen from true to false", () => {
    useKeyboardStore.setState({ mixerOpen: true });

    useKeyboardStore.getState().toggleMixer();

    expect(useKeyboardStore.getState().mixerOpen).toBe(false);
  });

  it("toggleMixer flips mixerOpen from false to true", () => {
    useKeyboardStore.setState({ mixerOpen: false });

    useKeyboardStore.getState().toggleMixer();

    expect(useKeyboardStore.getState().mixerOpen).toBe(true);
  });

  it("toggleMixer twice returns mixerOpen to original state", () => {
    const initial = useKeyboardStore.getState().mixerOpen;

    useKeyboardStore.getState().toggleMixer();
    useKeyboardStore.getState().toggleMixer();

    expect(useKeyboardStore.getState().mixerOpen).toBe(initial);
  });

  // -------------------------------------------------------------------------
  // toggleFollowPlayhead
  // -------------------------------------------------------------------------

  it("toggleFollowPlayhead flips followPlayhead from false to true", () => {
    useKeyboardStore.setState({ followPlayhead: false });

    useKeyboardStore.getState().toggleFollowPlayhead();

    expect(useKeyboardStore.getState().followPlayhead).toBe(true);
  });

  it("toggleFollowPlayhead flips followPlayhead from true to false", () => {
    useKeyboardStore.setState({ followPlayhead: true });

    useKeyboardStore.getState().toggleFollowPlayhead();

    expect(useKeyboardStore.getState().followPlayhead).toBe(false);
  });

  it("toggleFollowPlayhead twice returns followPlayhead to original state", () => {
    const initial = useKeyboardStore.getState().followPlayhead;

    useKeyboardStore.getState().toggleFollowPlayhead();
    useKeyboardStore.getState().toggleFollowPlayhead();

    expect(useKeyboardStore.getState().followPlayhead).toBe(initial);
  });

  // -------------------------------------------------------------------------
  // Independence of toggles
  // -------------------------------------------------------------------------

  it("toggling browser does not affect mixerOpen or followPlayhead", () => {
    useKeyboardStore.setState({
      browserOpen: true,
      mixerOpen: true,
      followPlayhead: false,
    });

    useKeyboardStore.getState().toggleBrowser();

    expect(useKeyboardStore.getState().mixerOpen).toBe(true);
    expect(useKeyboardStore.getState().followPlayhead).toBe(false);
  });

  it("toggling mixer does not affect browserOpen or followPlayhead", () => {
    useKeyboardStore.setState({
      browserOpen: true,
      mixerOpen: true,
      followPlayhead: false,
    });

    useKeyboardStore.getState().toggleMixer();

    expect(useKeyboardStore.getState().browserOpen).toBe(true);
    expect(useKeyboardStore.getState().followPlayhead).toBe(false);
  });
});
