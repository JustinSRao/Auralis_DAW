# Sprint 5 Postmortem: Local Authentication System

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 5 |
| Started | 2026-03-01 |
| Completed | 2026-03-01 |
| Duration | ~2 hours |
| Steps Completed | 13 |
| Files Changed | 15 (9 new, 6 modified) |
| Tests Added | 46 new TypeScript tests + 4 new Rust tests |
| Coverage | 85.08% (threshold 75% — PASS) |

## What Went Well

- Sprint 1 stubs were high quality — `db.rs`, `models.rs`, and partial `commands.rs` were mostly complete; implementation agent only needed to add `get_current_user` and fix argon2 parameters
- 3-agent parallelism worked cleanly again: Rust backend, React frontend, and test agents had no file conflicts
- `isHydrating` guard in `App.tsx` was caught in planning before implementation — prevented a UX flash-of-login bug that would have been hard to notice in testing
- `partialize` on persist config is a good pattern; keeping `isLoading`/`error`/`users` out of localStorage avoids stale UI state on restart
- Plan agent correctly identified argon2 default params were below the spec's minimum and designed the `argon2_instance()` centralisation

## What Could Improve

- The sprint spec described a full `sessions` SQLite table + UUID token flow that was explicitly simplified away — the spec could have been clearer that local-only auth doesn't need revocable session tokens
- `ProfileSwitcher` coverage at 96.1% (lines 60-62 uncovered) — the uncovered lines are the `if (!selectedUser) return` guard in the form submit handler; a minor gap but worth noting

## Blockers Encountered

- None — smooth sprint with no unexpected issues

## Technical Insights

- **`Option<T>` from Rust serializes as `T | null` in TypeScript**: `invoke<User | null>('get_current_user', ...)` correctly receives `null` when Rust returns `None`. This is a reliable Tauri serde pattern for optional values.
- **argon2 `Params::new(m, t, p, output_len)`**: The fourth argument is output length — `None` uses the default 32-byte output. Using explicit `Argon2::new(Algorithm::Argon2id, Version::V0x13, params)` instead of `Argon2::default()` makes security parameters auditable in one place.
- **`persist` + `partialize`**: Zustand's `partialize` option lets you selectively serialize only stable state to localStorage, avoiding persisting ephemeral fields like `isLoading`, `error`, `users[]`. Essential for stores with both persistent and transient state.
- **`hydrateFromStorage` reads from already-hydrated Zustand state**: On app mount, Zustand `persist` has already rehydrated from localStorage before the `useEffect` runs. So `hydrateFromStorage` can safely read `get().currentUser` — it doesn't need to read localStorage directly.

## Process Insights

- Sprint 1 stubs of the right quality dramatically reduce Sprint 5 effort — the auth db layer was fully tested before we even started
- When the spec says "sessions table" but the app is local-only, the Plan agent correctly escalated to the clarification gate rather than building unnecessary infrastructure

## Patterns Discovered

**`argon2_instance()` centralized helper:**
```rust
fn argon2_instance() -> Result<Argon2<'static>, String> {
    let params = Params::new(65536, 2, 1, None).map_err(|e| e.to_string())?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}
```
Use this pattern anywhere argon2 hashing/verifying is needed — never call `Argon2::default()`.

**`partialize` for stores with mixed persistence needs:**
```typescript
persist(immer(...), {
  name: 'auth-storage',
  partialize: (state) => ({
    isAuthenticated: state.isAuthenticated,
    currentUser: state.currentUser,
  }),
})
```

**`isHydrating` guard in App.tsx for async session validation:**
```typescript
useEffect(() => { void hydrateFromStorage(); }, []);
if (isHydrating) return <LoadingScreen />;
return isAuthenticated ? <DAWLayout /> : <AuthScreen />;
```

## Action Items for Next Sprint

- [ ] [backlog] ProfileSwitcher lines 60-62 — add test for `handleLogin` called with no selected user (guard branch)
- [ ] [backlog] Consider password strength meter in `RegisterPage` (UX improvement, not blocking)
- [ ] [sprint] Epic 2 has only Sprint 5 — run `/epic-complete 2` after `/sprint-complete 5`

## Notes

Sprint 5 completes Epic 2 (Authentication & User Management). The auth layer is now solid: argon2id hashing, DB-validated session hydration on startup, full Login/Register/ProfileSwitcher UI. All subsequent sprints that touch user data can assume a valid `currentUser` in `authStore` when the DAW UI is visible.
