import { invoke } from "@tauri-apps/api/core";
import { useMidiStore } from "../midiStore";
import type { MidiStatus } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const mockStatus: MidiStatus = {
  active_input: null,
  active_output: null,
};

describe("midiStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useMidiStore.setState({
      devices: [],
      activeInput: null,
      activeOutput: null,
      error: null,
      isLoading: false,
    });
  });

  it("has correct initial state", () => {
    const state = useMidiStore.getState();
    expect(state.devices).toEqual([]);
    expect(state.activeInput).toBeNull();
    expect(state.activeOutput).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("refreshDevices updates device list", async () => {
    const devices = [
      { name: "loopMIDI Port", is_input: true, is_output: true },
    ];
    mockInvoke.mockResolvedValue(devices);

    await useMidiStore.getState().refreshDevices();

    const state = useMidiStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0].name).toBe("loopMIDI Port");
    expect(state.isLoading).toBe(false);
  });

  it("refreshDevices sets error on failure", async () => {
    mockInvoke.mockRejectedValue("MIDI error");

    await useMidiStore.getState().refreshDevices();

    const state = useMidiStore.getState();
    expect(state.error).toBe("MIDI error");
    expect(state.isLoading).toBe(false);
  });

  it("connectInput updates active input", async () => {
    const status: MidiStatus = {
      active_input: "loopMIDI Port",
      active_output: null,
    };
    mockInvoke.mockResolvedValue(status);

    await useMidiStore.getState().connectInput("loopMIDI Port");

    const state = useMidiStore.getState();
    expect(state.activeInput).toBe("loopMIDI Port");
    expect(state.activeOutput).toBeNull();
  });

  it("disconnectInput clears active input", async () => {
    useMidiStore.setState({ activeInput: "loopMIDI Port" });
    mockInvoke.mockResolvedValue(mockStatus);

    await useMidiStore.getState().disconnectInput();

    const state = useMidiStore.getState();
    expect(state.activeInput).toBeNull();
  });

  it("connectOutput updates active output", async () => {
    const status: MidiStatus = {
      active_input: null,
      active_output: "loopMIDI Port",
    };
    mockInvoke.mockResolvedValue(status);

    await useMidiStore.getState().connectOutput("loopMIDI Port");

    const state = useMidiStore.getState();
    expect(state.activeOutput).toBe("loopMIDI Port");
  });

  it("disconnectOutput clears active output", async () => {
    useMidiStore.setState({ activeOutput: "loopMIDI Port" });
    mockInvoke.mockResolvedValue(mockStatus);

    await useMidiStore.getState().disconnectOutput();

    const state = useMidiStore.getState();
    expect(state.activeOutput).toBeNull();
  });

  it("connectInput sets error on failure", async () => {
    mockInvoke.mockRejectedValue("Connection failed");

    await useMidiStore.getState().connectInput("bad-port");

    const state = useMidiStore.getState();
    expect(state.error).toBe("Connection failed");
    expect(state.isLoading).toBe(false);
  });

  it("clearError clears error state", () => {
    useMidiStore.setState({ error: "some error" });
    useMidiStore.getState().clearError();
    expect(useMidiStore.getState().error).toBeNull();
  });
});
