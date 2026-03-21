# Deferred Work Tracker

Tracks incomplete items, deferred acceptance criteria, and follow-up tasks across sprints.

**Last Updated**: 2026-03-21

---

## Active Deferred Items

| ID | Sprint Origin | Description | Priority | Target Sprint | Status |
|----|--------------|-------------|----------|---------------|--------|
| D-001 | Sprint 17 | Change `ChannelLevelEvent.channel_id` from `String` to `Arc<str>` to eliminate per-callback string clone (~1,400 small allocs/sec with 8 channels) | Medium | Before Sprint 31 | Open |
| D-002 | Sprint 17 | `commands.rs` validation tests test inline logic, not the actual command functions — rewrite to call real commands via Tauri State test harness | Low | Sprint 21 or cleanup | Open |
| D-003 | Sprint 17 | `MasterStrip` is not wrapped in `React.memo` — minor performance suggestion | Low | Unassigned | Open |
| D-004 | Sprint 17 | Rust toolchain (`cargo`) not available in codespace — Rust unit tests cannot be verified in CI | High | Unassigned (env setup) | Open |

---

## By Target Sprint

### Before Sprint 31 (Arrangement Playback Engine)
- **D-001**: `Arc<str>` for channel IDs — must be done before real audio flows through mixer channels

### Sprint 21 (Effect Chain & Modular Routing)
- **D-002**: Fix validation tests in `commands.rs` to exercise actual Tauri command functions

### Unassigned
- **D-003**: `React.memo` on `MasterStrip`
- **D-004**: Rust toolchain / CI environment setup

---

## Resolved Items

_(none yet)_
