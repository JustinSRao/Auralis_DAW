/**
 * Frontend MIDI import utilities.
 *
 * Mirrors the Rust `MidiImporter::snap_length_bars` logic so the dialog can
 * compute a default pattern length without an extra IPC round-trip.
 */

const VALID_LENGTHS = [1, 2, 4, 8, 16, 32] as const;

export const MidiImporter = {
  /**
   * Rounds `rawBars` up to the nearest valid pattern length (1,2,4,8,16,32).
   * Clamps to 32 if the value exceeds 32.
   */
  snapLengthBars(rawBars: number): number {
    const ceil = Math.ceil(rawBars);
    for (const v of VALID_LENGTHS) {
      if (v >= ceil) return v;
    }
    return 32;
  },
};
