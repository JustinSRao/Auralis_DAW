---
sprint: 45
title: "Audio Clip Fades"
type: fullstack
epic: 5
status: planning
created: 2026-02-23T17:06:07Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 45: Audio Clip Fades

## Overview

| Field | Value |
|-------|-------|
| Sprint | 45 |
| Title | Audio Clip Fades |
| Type | fullstack |
| Epic | 5 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Add fade-in, fade-out, and crossfade handles to audio clips on the timeline, with configurable fade curves (linear, exponential, S-curve, logarithmic), enabling smooth transitions and click-free clip boundaries.

## Background

Every DAW provides fade handles on audio clips. Without them, clips start and end abruptly, producing audible clicks at cut points where the waveform doesn't cross zero. Sprint 15 (Waveform Editor) explicitly deferred fade handles, noting them as "future automation on volume parameter." Sprint 37 (Audio Clip Playback Engine) applies a static clip gain but has no fade envelope. Sprint 38 (Punch In/Out) applies short 5-10 ms crossfades at punch boundaries, proving the concept works — this sprint generalizes it to user-configurable fades on any clip.

## Requirements

### Functional Requirements

- [ ] Fade-in handle on left edge of audio clip: drag horizontally to set fade-in length (0 to clip duration)
- [ ] Fade-out handle on right edge of audio clip: drag horizontally to set fade-out length
- [ ] Crossfade between two adjacent or overlapping audio clips on the same track: automatic equal-power crossfade in the overlap region
- [ ] Fade curve types: Linear, Exponential In (slow start, fast end), Exponential Out (fast start, slow end), S-Curve (equal-power cosine), Logarithmic
- [ ] Right-click fade handle to select curve type from context menu
- [ ] Visual fade curve overlay drawn on top of the clip waveform in the timeline
- [ ] Fades are non-destructive: applied during playback by `AudioClipPlayer`, not baked into the WAV file
- [ ] Double-click a fade handle to reset to zero (no fade)
- [ ] Tauri commands: `set_clip_fade_in`, `set_clip_fade_out`, `set_fade_curve_type`, `set_crossfade_length`, `get_clip_fade_state`
- [ ] Fade parameters persist in the project file as part of the `AudioClip` metadata

### Non-Functional Requirements

- [ ] Fade gain computation uses pre-computed lookup tables (256 entries per curve type) — no `pow()` or `exp()` calls per sample on the audio thread
- [ ] Lookup tables computed once at engine startup and stored in a static `Arc<FadeTables>`
- [ ] Crossfades must be click-free: equal-power law ensures constant energy through the crossfade region
- [ ] Fade handle drag is smooth at 60 fps with up to 20 clips visible on screen
- [ ] Fade length resolution: 1 ms minimum (approximately 44 samples at 44.1 kHz)

## Dependencies

- **Sprints**: Sprint 13 (Song Timeline — displays audio clips as blocks on the timeline, provides the canvas where fade handles are drawn), Sprint 15 (Waveform Editor — deferred fades to this sprint), Sprint 37 (Audio Clip Playback Engine — `AudioClipPlayer` processes audio samples where fade gain envelope is applied)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/fade.rs` — `FadeCurve` enum, `FadeTables` struct (pre-computed lookup tables), `compute_fade_gain(position, length, curve) -> f32` function
- Extension to Sprint 37's `AudioClip` metadata: `fade_in_samples: u64`, `fade_out_samples: u64`, `fade_in_curve: FadeCurve`, `fade_out_curve: FadeCurve`
- Extension to `AudioClipPlayer::process()`: apply fade gain envelope during the fade-in and fade-out regions of each clip
- Crossfade logic: when two clips overlap on the same track, the earlier clip's fade-out and the later clip's fade-in are automatically linked as an equal-power crossfade
- Tauri commands for all fade parameters
- React `FadeHandle.tsx` — draggable triangle handles at clip edges on the timeline
- React `FadeCurveOverlay.tsx` — SVG/canvas path drawn on top of the waveform showing the fade shape
- React context menu on fade handles for curve type selection
- Project file serialization of fade parameters

### Out of Scope

- Fade handles on MIDI clips (MIDI notes don't need amplitude fades)
- Destructive fade rendering (baking fades into the WAV file — Sprint 15 waveform editor could add this later)
- Per-clip automation lanes for volume (backlog — fades are a simpler targeted solution)
- Fade presets or fade templates (backlog)

## Technical Approach

`FadeTables` pre-computes 256-entry lookup tables for each `FadeCurve` variant at startup. Linear is `i/255`. Exponential In is `(i/255)^3`. Exponential Out is `1 - (1 - i/255)^3`. S-Curve uses `0.5 * (1 - cos(pi * i/255))` for equal-power. Logarithmic uses `log(1 + 9*i/255) / log(10)`. The tables are stored in an `Arc<FadeTables>` accessible by all `AudioClipPlayer` instances.

During `AudioClipPlayer::process()`, for each sample in the output buffer:
- If sample position is within `[clip_start, clip_start + fade_in_samples]`: multiply by `fade_table[curve][(pos - clip_start) * 255 / fade_in_samples]`
- If sample position is within `[clip_end - fade_out_samples, clip_end]`: multiply by `fade_table[curve][255 - (pos - (clip_end - fade_out_samples)) * 255 / fade_out_samples]`
- Otherwise: no fade applied (gain = 1.0)

For crossfades between overlapping clips, the earlier clip's fade-out and later clip's fade-in both use S-Curve by default. Equal-power crossfade ensures `fade_out^2 + fade_in^2 ~= 1.0` at every point in the overlap, maintaining constant perceived loudness.

On the React side, `FadeHandle` components are positioned at the clip edges and respond to horizontal drag. The drag distance is converted to fade length in samples via the timeline's pixels-per-sample zoom ratio. `FadeCurveOverlay` draws the curve shape as a semi-transparent filled path over the waveform.

## Tasks

### Phase 1: Planning
- [ ] Define `FadeCurve` enum variants and their mathematical formulas
- [ ] Design the lookup table structure and pre-computation strategy
- [ ] Plan the crossfade detection logic: how to identify overlapping clips on the same track
- [ ] Design the fade handle UI interaction (drag behavior, snap, visual feedback)

### Phase 2: Implementation
- [ ] Implement `FadeCurve` enum and `FadeTables` with pre-computed lookup arrays in `fade.rs`
- [ ] Extend `AudioClip` metadata with fade_in/fade_out samples and curve types
- [ ] Extend `AudioClipPlayer::process()` to apply fade gain envelope using lookup tables
- [ ] Implement crossfade detection: when two clips overlap on the same track, auto-link their fades
- [ ] Implement equal-power crossfade gain computation for the overlap region
- [ ] Add Tauri commands: `set_clip_fade_in`, `set_clip_fade_out`, `set_fade_curve_type`, `set_crossfade_length`, `get_clip_fade_state`
- [ ] Serialize fade parameters in project file AudioClip metadata
- [ ] Build React `FadeHandle.tsx` — draggable triangles at clip edges
- [ ] Build React `FadeCurveOverlay.tsx` — visual curve shape on the waveform
- [ ] Add right-click context menu on fade handles for curve type selection
- [ ] Implement double-click to reset fade to zero

### Phase 3: Validation
- [ ] Set a 500 ms fade-in on a clip — audio ramps smoothly from silence, no click at clip start
- [ ] Set a 1 s fade-out on a clip — audio ramps to silence, no abrupt cutoff
- [ ] Switch fade curve from linear to S-curve — audible difference in fade shape
- [ ] Overlap two clips by 200 ms — crossfade plays both clips simultaneously with constant loudness
- [ ] Remove fade (double-click handle) — clip starts/ends at full volume immediately
- [ ] Fade parameters persist after project save/load
- [ ] 10 clips with fades playing simultaneously — no audio glitches or CPU spike
- [ ] Fade handles drag smoothly at 60 fps

### Phase 4: Documentation
- [ ] Rustdoc on `FadeCurve`, `FadeTables`, `compute_fade_gain()`
- [ ] Document the fade curve formulas and lookup table strategy
- [ ] Document the crossfade detection and equal-power algorithm

## Acceptance Criteria

- [ ] Fade-in and fade-out handles are draggable on audio clip edges in the timeline
- [ ] Fades produce smooth amplitude transitions with no clicks
- [ ] Five fade curve types are available via right-click context menu
- [ ] Overlapping clips on the same track automatically crossfade
- [ ] Crossfades maintain constant perceived loudness (equal-power)
- [ ] Fades are non-destructive and persist in the project file
- [ ] Visual fade curve overlay is visible on the clip waveform
- [ ] All tests pass

## Notes

Created: 2026-02-23
Sprint 15 (Waveform Editor) explicitly deferred fade handles to this sprint. Sprint 38 (Punch In/Out) proved the crossfade concept with 5-10 ms fades at punch boundaries — this sprint generalizes it to user-configurable fades on any audio clip.
