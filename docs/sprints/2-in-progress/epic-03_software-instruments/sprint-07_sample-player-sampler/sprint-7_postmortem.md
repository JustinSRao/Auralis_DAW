# Sprint 7 Postmortem: Sample Player & Sampler

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 7 |
| Started | 2026-03-02 |
| Completed | 2026-03-04 |
| Duration | ~2 days (credit-interrupted; resumed same session) |
| Steps Completed | 13 (1.1–1.4, 2.1–2.3, 3.1–3.4, 4.1–4.3) |
| Files Changed | 15 files, +2342 lines, −47 lines |
| Rust Tests Added | 17 (decoder: 2, zone: 5, voice: 5, Sampler AudioNode: 5) |
| TypeScript Tests Added | 29 (SamplerPanel: 16, samplerStore: 13) |
| Total Tests Added | 46 |
| Tests Before Sprint | 179 Rust + 379 TS = 558 |
| Tests After Sprint | 206 Rust + 408 TS = 614 |
| Bugs Fixed During Sprint | 1 (zone capacity silent failure → proper error return) |

## What Went Well

- **Architectural reuse was high.** `Envelope` from Sprint 6 was dropped in with zero modification. The `SamplerVoice` ADSR section was a near-copy of the synth voice envelope handling — no reinvention.
- **AudioNode pattern held up.** The `process()` → drain commands → drain MIDI → render voices pattern composed cleanly. No structural changes to the audio graph needed.
- **`SamplerCommand` channel separation was the right call.** Keeping zone load/remove commands on a separate channel (bounded 64) from MIDI events (bounded 256) avoids any risk of large zone payloads stalling MIDI responsiveness on the audio thread.
- **Decode-off-thread architecture worked first try.** `tokio::task::spawn_blocking` + crossbeam send to audio thread was simple, correct, and required no rework.
- **Test coverage was natural to write.** Every DSP unit (pitch ratio, linear interpolation, ADSR integration, zone lookup) had deterministic, hardware-independent inputs → outputs, making tests fast and reliable (no `#[ignore]`).
- **Tab switcher UI was minimal but correct.** Reusing the existing `SynthPanel` dock slot with a two-button tab bar required only ~20 lines of DAWLayout change.

## What Could Improve

- **Sprint was interrupted mid-implementation.** The original session ran out of credits after writing `decoder.rs`, `zone.rs`, and `voice.rs` but before completing `mod.rs`, the Tauri commands, or any frontend work. This left the codebase in a partially-built state for days. Smaller, more atomic commits during a session would have made the interruption recovery cleaner.
- **Zone capacity check was added reactively.** The `MAX_ZONES = 32` limit existed from the start, but the command layer had no guard — it was only caught during the post-implementation audit. A pre-implementation review of the data flow would have caught this earlier.
- **No loop point controls in the UI.** The sprint doc required "loop point numeric inputs" in the SamplerPanel. The backend fully supports `loop_start`, `loop_end`, `loop_enabled` per zone, but the UI exposes no way to configure them after zone load. The default (loop disabled) is correct, but users cannot enable looping from the panel.
- **Drag-and-drop root note / MIDI range is hardcoded.** When a user drops a file, it always loads with root=C4 (60), min=0, max=127. There is no UX to specify these before or after loading. Acceptable for MVP but should be addressed.

## Blockers Encountered

- **Credit interruption.** Session ended mid-sprint. The prior session had completed planning (1.1–1.4) and partial implementation. Recovery required reading all prior files to reconstruct context before continuing.
- **Rust borrow checker on zone slot lookup.** `apply_command` initially used chained `iter_mut().find(...).or_else(|| iter_mut().find(...))` which the borrow checker rejected (two simultaneous mutable borrows). Fixed by switching to `iter().position(...)` to find the index first, then indexing once.

## Technical Insights

- **`Arc<SampleBuffer>` is the right sharing primitive.** The decoded audio buffer is immutable after load, so `Arc` with no `Mutex` gives safe multi-reader sharing (zone holds one, voice holds one during playback) with automatic cleanup when both drop.
- **`f64` pitch position is necessary.** Using `f64` for `position` and `pitch_ratio` in `SamplerVoice` prevents accumulating floating-point error over long samples. A `f32` position would drift audibly on files longer than ~10 seconds at high pitch ratios.
- **Tauri serde auto-converts camelCase → snake_case.** TypeScript `invoke("load_sample_zone", { filePath, zoneId, rootNote, ... })` maps correctly to Rust `load_sample_zone(file_path: String, zone_id: u32, root_note: u8, ...)` without any extra configuration — Tauri's serde layer handles it.
- **`SamplerZoneListState` avoids `Arc<SampleBuffer>` in managed state.** Keeping only `Vec<SampleZoneSnapshot>` (metadata only) on the Tauri side means `get_sampler_state` doesn't need to touch the audio buffers at all — no risk of accidentally blocking the audio thread through a shared reference count.
- **Sample rate init at 44100 is safe.** `Sampler::new()` takes a `sample_rate: f32` argument, but `AudioNode::process()` overwrites `self.sample_rate` on every buffer before any voice rendering or MIDI handling. The hardcoded init is never used in production — same established pattern as `SubtractiveSynth`.

## Process Insights

- **Interrupted sprints need a context-recovery step.** When resuming after a credit interruption, the first thing to do is read every partially-written file and the sprint state, then explicitly list what's done and what's missing before writing a single line of code. This sprint did that correctly on resume.
- **Audit before advancing works.** Running a code audit at step 3.2 (Quality Review) caught the zone capacity bug that would have been a confusing silent failure in production. Worth doing on every sprint.
- **Sprint doc task checkboxes should be updated as work completes**, not in a batch at the end. The sprint file had all unchecked boxes until the postmortem phase — if the sprint had been interrupted a second time, it would be unclear which tasks were actually done.

## Patterns Discovered

**SamplerCommand channel pattern** — when a long-lived audio node needs both real-time MIDI events and infrequent lifecycle commands (load/unload resources), use two separate bounded channels:

```rust
// Lifecycle commands — bounded small, non-time-critical
let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<SamplerCommand>(64);
// MIDI events — bounded larger, high-frequency
let (midi_tx, midi_rx) = crossbeam_channel::bounded::<TimestampedMidiEvent>(256);

// In process():
while let Ok(cmd) = self.cmd_rx.try_recv() { self.apply_command(cmd); }
while let Ok(msg) = self.midi_rx.try_recv() { self.handle_midi_event(&msg.event); }
```

This keeps MIDI latency predictable regardless of how large the zone payload is.

**Zone-list shadow state pattern** — maintain a serializable mirror of audio-thread state on the Tauri side for IPC reads:

```rust
// Tauri side: cheap metadata only, no Arc<Buffer> references
pub type SamplerZoneListState = Arc<Mutex<Vec<SampleZoneSnapshot>>>;

// Update after successful audio thread send:
zone_list.lock()?.push(snapshot.clone());

// Read for IPC:
pub fn get_sampler_state(...) -> SamplerSnapshot {
    SamplerSnapshot { params, zones: zone_list.lock()?.clone() }
}
```

## Action Items for Next Sprint

- [ ] Add loop point controls to `SamplerPanel` (enable/disable, start/end frame inputs per zone)
- [ ] Add root note and MIDI range fields to zone load flow (either in the drop action or as editable fields in the zone list row)
- [ ] Consider adding a zone preview button (play one note via test NoteOn without MIDI hardware)
- [ ] Sprint 8 (Drum Machine) can reuse `SamplerVoice`, `decode_audio_file`, and `SampleBuffer` directly

## Notes

This was the second instrument sprint (after Sprint 6 Subtractive Synthesizer). The sampler adds a fundamentally different sound source — sample playback rather than synthesis — while reusing nearly all the infrastructure patterns established in Sprint 6. The codebase is now in a solid position for Sprint 8 (Drum Machine), which can be viewed as a specialized multi-zone sampler with fixed note-to-pad mapping.
