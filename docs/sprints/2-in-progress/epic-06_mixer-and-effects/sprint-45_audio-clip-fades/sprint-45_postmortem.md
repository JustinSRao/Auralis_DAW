# Sprint 45 Postmortem: Audio Clip Fades

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 45 |
| Completed | 2026-03-31 |
| Files Changed | 17 (7 new, 10 modified) |
| Rust Tests Added | 22 (fade.rs: 12, clip_player.rs: 2, fade_commands.rs: 5) |
| TS Tests Added | 19 (fadeStore: 8, FadeHandle: 6, FadeCurveOverlay: 5) |

## What Went Well

- `FadeTables` pre-computation with 256-entry lookup tables keeps the audio callback completely allocation-free.
- `compute_fade_gain` with linear interpolation between adjacent table entries gives smooth results at no extra cost.
- Persisting fade params on `ArrangementClip` with `#[serde(default)]` required no schema version bump — backward compatible.
- `FadeHandle` SVG triangle + `FadeCurveOverlay` polygon paths render cleanly as absolutely-positioned DOM overlays on the canvas-based timeline.
- All 644 Rust + 1143 TS tests passed cleanly.

## What Could Improve

- `samplesPerBar` defaults to 0 before the first transport event fires. The `Math.max(0, ...)` clamp prevents crashes but drag feels unresponsive until first transport event.
- `FadeCurveOverlay` uses a zero-sized SVG with `overflow: visible` — works but a sized SVG matching clip dimensions would be cleaner.

## Blockers Encountered

- `Timeline` directory uses capital `T` while new files were created with lowercase path — missed in first commit, fixed in a second commit.
- `fade_out_ramps_to_silence` test initially failed because only 256 frames were processed while fade-out started at frame 256. Fixed by processing the full 512-frame clip in a 1024-sample buffer.

## Technical Insights

- `FadeCurve::SCurve` (0.5 × (1 − cos(πt))) satisfies equal-power: at t=0.5, gain² + (1−gain)² = 0.5, maintaining constant energy through a crossfade.
- Fade-out gain maps using `remaining = fade_out_frames - pos_in_out` so position 0 (start of fade-out) returns 1.0 and position `fade_out_frames` (end) returns 0.0.
- `ArrangementClip::Default` was needed to use `..Default::default()` in `add_arrangement_clip` without listing all new fade fields explicitly.

## Process Insights

- Clarifying crossfade scope (user-explicit vs auto-detect) before implementation saved significant work — automatic overlap detection would have required scheduler-level position tracking.

## Patterns Discovered

```rust
// Fade lookup table interpolation:
let t = pos as f32 / fade_len as f32 * (TABLE_SIZE - 1) as f32;
let lo = t.floor() as usize;
let frac = t - lo as f32;
table[lo] + frac * (table[(lo + 1).min(TABLE_SIZE - 1)] - table[lo])

// Fade-out position remapping (full → silent):
let remaining = fade_out_frames.saturating_sub(pos_in_out);
compute_fade_gain(remaining, fade_out_frames, curve, tables)
```

## Action Items for Next Sprint

- [ ] Run `epic-complete 6` — all Epic 6 sprints are now done.

## Notes

- Sprint 15 (Waveform Editor) explicitly deferred fade handles to this sprint.
- Sprint 38 (Punch In/Out) proved the crossfade concept — this sprint generalizes it to user-configurable fades.
- Fade parameters persist via `ArrangementClip` JSON fields in `.mapp` project files.
