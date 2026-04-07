---
sprint: 59
title: "Backend Code Quality"
type: fullstack
epic: 17
status: planning
created: 2026-04-07T15:45:01Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 59: Backend Code Quality

## Overview

| Field | Value |
|-------|-------|
| Sprint | 59 |
| Title | Backend Code Quality |
| Type | fullstack |
| Epic | 17 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix four specific deferred backend correctness and quality items: applying the effect chain during bounce-in-place, updating the frontend track state after bounce, fixing TypeScript build errors in test files, and documenting the `unsafe impl Send` ADR — plus marking D-005 resolved after Sprint 47.

## Background

These items were deferred from Sprints 2, 38, and 40 postmortems and DEFERRED.md:

- **Sprint 40 debt (effect chain in bounce-in-place)**: The offline bounce-in-place renderer only runs instrument DSP, not the effect chain. This is the same bug as the Sprint 47 freeze fix, but applied specifically to the bounce-in-place operation (which creates a new audio clip in the arrangement, distinct from the freeze which replaces the track). Both paths need the fix, but they may be in different code locations. Sprint 47 fixes the freeze path; this sprint verifies and fixes the bounce-in-place path if it is separate.
- **Sprint 40 debt (frontend track state after bounce)**: After a successful bounce-in-place operation, the Rust backend converts the track from MIDI to Audio type internally. However, the frontend track state (from `useTrackStore`) still shows the track as a MIDI track. The track header still shows the MIDI instrument controls instead of audio clip controls. The fix is to update the frontend track state when the bounce completes — either via a Tauri event emitted from the backend or by refetching the track list.
- **Sprint 38 debt (TypeScript build errors in test files)**: `npm run build` (which runs `tsc`) has pre-existing TypeScript errors in test files (files under `*.test.ts` / `*.test.tsx`). These errors were tolerated because `vite` does not type-check during dev, but they fail `tsc --noEmit` which is needed for CI. The errors must be fixed so `npm run build` exits cleanly.
- **D-005 follow-up (mark as resolved)**: Sprint 47 implements EQ persistence (D-005). After Sprint 47 ships, `DEFERRED.md` must be updated to mark D-005 as "Resolved — fixed in Sprint 47". This sprint includes that update.
- **Sprint 2 debt (ADR for unsafe impl Send)**: The investigation from Sprint 50 produces findings about `unsafe impl Send` for `cpal::Stream`. If Sprint 50 created `docs/adr/adr-001-cpal-stream-thread-safety.md`, this sprint verifies it exists and is complete. If Sprint 50 did not create it (deferred), this sprint creates it.

## Requirements

### Functional Requirements

- [ ] **Bounce-in-place effect chain**: The bounce-in-place renderer applies the track's effect chain after instrument DSP, producing a bounced audio clip that sounds identical to live playback. (Verify this is a separate code path from the freeze renderer fixed in Sprint 47; if shared, mark as done via Sprint 47.)
- [ ] **Frontend track state after bounce**: After bounce-in-place completes, the frontend track in `useTrackStore` is updated from `TrackKind::Midi` to `TrackKind::Audio`. The track header reflects the new audio state (shows audio clip controls, not MIDI instrument controls) without requiring a manual app restart or project reload.
- [ ] **TypeScript build errors fixed**: `npm run build` (tsc) exits with code 0. All TypeScript errors in test files under `src/` are resolved. Errors may be fixed by correcting types, adding type assertions with justification, or (if the test file is fundamentally broken) by rewriting the test.
- [ ] **D-005 marked resolved**: `DEFERRED.md` entry for D-005 is updated with `status: resolved`, `resolved_in: Sprint 47`, and the date of resolution.
- [ ] **ADR for unsafe impl Send**: `docs/adr/adr-001-cpal-stream-thread-safety.md` exists (created here or in Sprint 50) with documented findings, decision, and rationale.

### Non-Functional Requirements

- [ ] Frontend track state update after bounce is event-driven (Tauri event or explicit refetch) — no polling
- [ ] ADR follows the standard format: Title, Status, Context, Decision, Consequences
- [ ] TypeScript fixes do not use `@ts-ignore` or `any` to suppress errors — use correct types

## Dependencies

- **Sprints**: Sprint 40 (Track Freeze & Bounce — bounce render path), Sprint 47 (EQ persistence — D-005 resolution), Sprint 50 (DSP Quality — unsafe impl Send investigation), Sprint 30 (DAW Shell — track state model, TrackKind enum)
- **External**: None

## Scope

### In Scope

- Bounce-in-place effect chain fix (if separate code path from freeze)
- Frontend `useTrackStore` update after bounce-in-place completes
- Fix all TypeScript errors in test files blocking `npm run build`
- Update `DEFERRED.md` to mark D-005 as resolved after Sprint 47
- Create `docs/adr/adr-001-cpal-stream-thread-safety.md` if not created by Sprint 50

### Out of Scope

- New Tauri commands or backend features
- Frontend visual changes (track header appearance changes are a consequence of the data fix, not a new design)
- New test coverage (covered by Epic 18)

## Technical Approach

### Bounce-in-Place Effect Chain

Locate the bounce-in-place code path. In the project, "freeze" and "bounce-in-place" may share the same render path (Sprint 40) or may be separate. If they are already unified by Sprint 47's fix, this task is a verification step and closes immediately. If separate, apply the same pattern: after instrument DSP produces the output buffer, iterate the track's `Vec<Box<dyn AudioEffect>>` and call `effect.process(&mut buffer, sample_rate)` for each effect.

### Frontend Track State After Bounce

In the Rust bounce-in-place command handler, after writing the bounced audio clip and converting the track to `TrackKind::Audio`, emit a Tauri event:
```rust
app_handle.emit("track-kind-changed", TrackKindChangedPayload {
    track_id: track.id.clone(),
    new_kind: TrackKind::Audio,
    audio_clip_id: new_clip.id.clone(),
});
```
In the React frontend, listen for this event in the track store or a `useEffect`:
```typescript
useEffect(() => {
  const unlisten = listen<TrackKindChangedPayload>('track-kind-changed', (event) => {
    trackStore.updateTrackKind(event.payload.track_id, event.payload.new_kind);
  });
  return () => { unlisten.then(f => f()); };
}, []);
```

### TypeScript Build Errors Fix

Run `tsc --noEmit 2>&1 | head -100` to enumerate all errors. Common causes in test files:
- `vi.mock` factory returns a type that doesn't match the real module's type
- Missing types for test utilities (e.g., `@testing-library/react` types not imported)
- Test files using `any` where strict mode requires real types

Fix each error category systematically. If a test file's errors cannot be fixed without rewriting it, and the test itself is already broken (not providing value), delete it and note it for re-creation in Sprint 61.

### D-005 and ADR

In `DEFERRED.md`, find the D-005 entry and update:
```markdown
- **D-005**: EQ parameter persistence — **RESOLVED in Sprint 47** (2026-04-07)
```

For the ADR, create `docs/adr/adr-001-cpal-stream-thread-safety.md` with the standard ADR template if Sprint 50 did not create it. If Sprint 50 created it, verify it is complete and accurate.

## Tasks

### Phase 1: Planning
- [ ] Determine if freeze and bounce-in-place share the same render path (check Sprint 47 implementation) — if shared, mark this item done immediately
- [ ] Run `tsc --noEmit` — capture and categorize all TypeScript errors in test files
- [ ] Confirm Sprint 47 has shipped (D-005 resolved) before updating DEFERRED.md
- [ ] Check if `docs/adr/adr-001-cpal-stream-thread-safety.md` was created by Sprint 50

### Phase 2: Backend Implementation
- [ ] Fix bounce-in-place effect chain (if separate from freeze path and not already fixed by Sprint 47)
- [ ] Add `track-kind-changed` Tauri event emission in the bounce-in-place command handler
- [ ] Update `DEFERRED.md`: mark D-005 as resolved (after confirming Sprint 47 shipped)
- [ ] Create `docs/adr/adr-001-cpal-stream-thread-safety.md` (if not created by Sprint 50)

### Phase 3: Frontend Implementation
- [ ] Add `track-kind-changed` event listener in the appropriate store or component
- [ ] Update `useTrackStore.updateTrackKind` to change the track's `kind` field
- [ ] Fix all TypeScript errors in test files — resolve each error correctly without `@ts-ignore`

### Phase 4: Tests
- [ ] Add Rust integration test: bounce-in-place on a MIDI track produces an audio clip and emits `track-kind-changed` event
- [ ] Add component test: simulating `track-kind-changed` event causes the track header to switch to audio controls
- [ ] Run `tsc --noEmit` — zero errors
- [ ] Run full test suite — all tests green

### Phase 5: Validation
- [ ] Manual test: bounce a MIDI track — verify track header switches to audio controls without reload
- [ ] Manual test: bounce a track with a reverb effect — verify bounced audio contains reverb
- [ ] Run `npm run build` — exits with code 0
- [ ] Verify `DEFERRED.md` shows D-005 as resolved
- [ ] Verify `docs/adr/adr-001-cpal-stream-thread-safety.md` exists and is complete

## Acceptance Criteria

- [ ] Bounce-in-place produces audio output with the effect chain applied (or confirmed shared path already fixed by Sprint 47)
- [ ] After bounce-in-place, the frontend track header shows audio controls without a project reload
- [ ] `npm run build` (tsc) exits with code 0 — zero TypeScript errors across all files including test files
- [ ] `DEFERRED.md` shows D-005 with status "RESOLVED in Sprint 47"
- [ ] `docs/adr/adr-001-cpal-stream-thread-safety.md` exists with Title, Status, Context, Decision, Consequences sections
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 40 debt | Effect chain in bounce-in-place render | `audio/` bounce render path |
| Sprint 40 debt | Frontend track state update after bounce | `useTrackStore` + Tauri event |
| Sprint 38 debt | TypeScript build errors in test files | `src/` test files |
| D-005 follow-up | Mark D-005 resolved in DEFERRED.md | `DEFERRED.md` |
| Sprint 2 debt | ADR for unsafe impl Send decision | `docs/adr/adr-001-cpal-stream-thread-safety.md` |

## Notes

Created: 2026-04-07
D-005 follow-up is contingent on Sprint 47 having shipped. If Sprint 59 runs before Sprint 47, defer the DEFERRED.md update to after Sprint 47 completes.
