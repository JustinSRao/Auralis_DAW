import { invoke } from "@tauri-apps/api/core";
import { useMidiMappingStore } from "../midiMappingStore";
import type { MidiMapping } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const makeMapping = (
  paramId: string,
  cc: number,
  channel: number | null = null,
): MidiMapping => ({
  param_id: paramId,
  cc,
  channel,
  min_value: 0,
  max_value: 1,
});

describe("midiMappingStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useMidiMappingStore.setState({
      mappings: [],
      learningParamId: null,
      lastLearnedParamId: null,
    });
  });

  it("hydrate loads mappings from backend", async () => {
    mockInvoke.mockResolvedValueOnce([makeMapping("synth.cutoff", 74)]);
    await useMidiMappingStore.getState().hydrate();
    expect(useMidiMappingStore.getState().mappings).toHaveLength(1);
    expect(useMidiMappingStore.getState().mappings[0].param_id).toBe("synth.cutoff");
  });

  it("loadMappings calls backend and updates store", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const mappings = [makeMapping("synth.cutoff", 74)];
    await useMidiMappingStore.getState().loadMappings(mappings);
    expect(mockInvoke).toHaveBeenCalledWith("load_midi_mappings", { mappings });
    expect(useMidiMappingStore.getState().mappings).toEqual(mappings);
  });

  it("startLearn sets learningParamId and calls backend", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useMidiMappingStore.getState().startLearn("synth.cutoff", 20, 20000);
    expect(mockInvoke).toHaveBeenCalledWith("start_midi_learn", {
      paramId: "synth.cutoff",
      minValue: 20,
      maxValue: 20000,
    });
    expect(useMidiMappingStore.getState().learningParamId).toBe("synth.cutoff");
  });

  it("cancelLearn clears learningParamId and calls backend", async () => {
    useMidiMappingStore.setState({ learningParamId: "synth.cutoff" });
    mockInvoke.mockResolvedValueOnce(undefined);
    await useMidiMappingStore.getState().cancelLearn();
    expect(mockInvoke).toHaveBeenCalledWith("cancel_midi_learn");
    expect(useMidiMappingStore.getState().learningParamId).toBeNull();
  });

  it("onLearnCaptured updates mapping and clears learn state", () => {
    useMidiMappingStore.setState({
      learningParamId: "synth.cutoff",
      mappings: [makeMapping("synth.cutoff", 0)], // placeholder from startLearn
    });
    useMidiMappingStore.getState().onLearnCaptured("synth.cutoff", 74, 0);
    const state = useMidiMappingStore.getState();
    expect(state.learningParamId).toBeNull();
    expect(state.lastLearnedParamId).toBe("synth.cutoff");
    expect(state.mappings[0].cc).toBe(74);
  });

  it("onLearnCaptured adds new mapping if none existed", () => {
    useMidiMappingStore.setState({ learningParamId: "synth.resonance", mappings: [] });
    useMidiMappingStore.getState().onLearnCaptured("synth.resonance", 71, 1);
    const state = useMidiMappingStore.getState();
    expect(state.mappings).toHaveLength(1);
    expect(state.mappings[0].cc).toBe(71);
    expect(state.mappings[0].channel).toBe(1);
  });

  it("deleteMapping removes from store and calls backend", async () => {
    useMidiMappingStore.setState({
      mappings: [makeMapping("synth.cutoff", 74), makeMapping("synth.resonance", 71)],
    });
    mockInvoke.mockResolvedValueOnce(undefined);
    await useMidiMappingStore.getState().deleteMapping("synth.cutoff");
    expect(mockInvoke).toHaveBeenCalledWith("delete_midi_mapping", {
      paramId: "synth.cutoff",
    });
    expect(useMidiMappingStore.getState().mappings).toHaveLength(1);
    expect(useMidiMappingStore.getState().mappings[0].param_id).toBe("synth.resonance");
  });

  it("getMappingForParam returns the correct mapping", () => {
    useMidiMappingStore.setState({
      mappings: [makeMapping("synth.cutoff", 74)],
    });
    const m = useMidiMappingStore.getState().getMappingForParam("synth.cutoff");
    expect(m).toBeDefined();
    expect(m!.cc).toBe(74);
  });

  it("getMappingForParam returns undefined for unknown param", () => {
    const m = useMidiMappingStore.getState().getMappingForParam("nonexistent");
    expect(m).toBeUndefined();
  });
});
