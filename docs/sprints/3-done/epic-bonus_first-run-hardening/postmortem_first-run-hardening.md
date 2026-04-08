# Postmortem: First-Run Hardening

**Date:** 2026-04-07
**Triggered by:** First actual attempt to run `npm run tauri dev` after 46 sprints of test-only development.

---

## What Happened

All 46 planned sprints were complete with passing tests. When the application was run for the first time, three separate crashes were discovered in sequence. None of them would have been caught by the existing test suite. This document captures what broke, why, and what was fixed.

---

## Bugs Found & Fixed

### Bug 1 — Startup Panic: `tokio::spawn` in Tauri setup callback

**File:** `src-tauri/src/lib.rs`
**Symptom:** App compiled, then immediately panicked with:
```
thread 'main' panicked: there is no reactor running,
must be called from the context of a Tokio 1.x runtime
```
**Root cause:** Tauri 2's `.setup()` callback runs synchronously before the Tokio reactor is started. Eight `tokio::spawn(async move { ... })` calls in the setup function assumed a running Tokio runtime, which didn't exist yet at that point in the startup sequence.

**Fix:** Replaced all 8 occurrences of `tokio::spawn` with `tauri::async_runtime::spawn`, which uses Tauri's own managed runtime handle and is safe to call from the setup callback.

**Why this was missed:** Every `tokio::spawn` call was in the setup path, not in any code path exercised by unit or component tests. Tests mock the Tauri layer entirely and never boot the actual binary.

---

### Bug 2 — Vite EMFILE on first cold start

**File:** `vite.config.ts`
**Symptom:** On first launch, Vite's dependency scanner threw `EMFILE: too many open files` before recovering. The scanner swept `src-tauri/target/doc/` — thousands of Rust-generated HTML documentation files — hitting Windows' open file handle limit.

**Fix:** Added `optimizeDeps: { exclude: ["src-tauri"] }` to `vite.config.ts`. The existing `server.watch.ignored` already excluded `**/src-tauri/**` from the file watcher, but `optimizeDeps` is a separate scanner that was not covered.

**Why this was missed:** The Vite scanner only runs on first launch or when deps change. It self-recovered in development (Vite retried after the EMFILE), so it was a degraded-startup issue rather than a blocking crash.

---

### Bug 3 — Black screen after login: infinite re-render loop in `MixerView`

**Files:** `src/components/mixer/MixerView.tsx`, `src/components/daw/ExportMidiDialog.tsx`
**Symptom:** After a successful login, the screen went black. No error was visible because there was no error boundary. After adding an error boundary, the crash revealed:
```
Maximum update depth exceeded. This can happen when a component repeatedly
calls setState inside componentWillUpdate or componentDidUpdate.
```
**Root cause:** Three Zustand selectors used `Object.keys()` / `Object.values()` directly in the selector function:

```ts
// MixerView.tsx
const channelIds = useMixerStore((s) => Object.keys(s.channels));

// ExportMidiDialog.tsx
const clips    = useArrangementStore((s) => Object.values(s.clips));
const patterns = usePatternStore((s) => Object.values(s.patterns));
```

`Object.keys()` and `Object.values()` return a **new array instance on every call**, even when the contents haven't changed. Zustand compares selector results with `Object.is` (reference equality). Since the result is always a new reference, Zustand schedules a re-render after every render, creating an infinite synchronous update loop.

This is the same class of bug that was discovered and fixed in `presetsStore` (`?? []` fallback returning a new array) during Sprint 34's quality review — but the same pattern existed undetected in two older components.

**Fix:** Wrapped each affected selector with `useShallow` from `zustand/react/shallow`, which performs element-wise comparison on arrays instead of reference equality:

```ts
import { useShallow } from 'zustand/react/shallow';

const channelIds = useMixerStore(useShallow((s) => Object.keys(s.channels)));
const clips      = useArrangementStore(useShallow((s) => Object.values(s.clips)));
const patterns   = usePatternStore(useShallow((s) => Object.values(s.patterns)));
```

**Why this was missed:** Component tests mock the stores with static data. A mock that returns a fixed array always returns the same reference between renders, so the infinite loop never triggers in the test environment. The bug only manifests when a real Zustand store updates its state during the component's lifecycle.

---

## Collateral Work

### Error Boundary added (`src/components/ErrorBoundary.tsx`)

Without an error boundary, any React render crash produces a blank/black screen with no visible error — making root-cause diagnosis impossible. An `ErrorBoundary` component was added and mounted at the root in `main.tsx`. It catches synchronous render errors and displays the error message and component stack in the window, which immediately revealed Bug 3.

This should remain in production builds as a last-resort safety net.

### Deferred work audited and converted to 15 new sprints

All postmortems across 46 sprints were audited for deferred action items. 85 discrete items were found across bug fixes, performance, missing features, test infrastructure, and code quality. These were organized into 7 new epics (12–18) and 15 new sprints (47–61) in `docs/sprints/1-todo/`.

---

## Technical Insights

**`tauri::async_runtime::spawn` vs `tokio::spawn` in setup:** Tauri's runtime is not the same as a default Tokio runtime. Inside `.setup()`, always use `tauri::async_runtime::spawn`. Inside `#[tauri::command]` async functions, `tokio::spawn` works because those run within Tauri's runtime context.

**Zustand selector stability rule:** Any selector that constructs a new object or array (`Object.keys`, `Object.values`, `Object.entries`, array spread, `.map()`, `.filter()`) must be wrapped with `useShallow` or `useMemo`. Returning a new reference from a selector is equivalent to always returning `true` from a "has this changed?" check — it forces a re-render on every store update.

**Tests cannot catch binary-level startup bugs:** `tokio::spawn` in setup, Vite dep scanning, and OS file handle limits are all invisible to unit and component tests. These require actually running the binary. First-run testing should be a mandatory gate before calling a sprint complete.

---

## What Should Change Going Forward

- **Sprint 60 (CI & Build Pipeline)** should include a smoke-test step that actually builds and boots the binary (even headlessly with `--headless` or similar) rather than only running `cargo test` + `vitest`.
- Any new Zustand selector that returns a derived collection should be code-reviewed for reference stability before merging.
- The `ErrorBoundary` in `main.tsx` should stay — it provides the last line of defence for production crashes that make it past all other checks.
- The `useShallow` pattern should be documented as a project standard for collection selectors in `knowledge/patterns/` (tracked under Sprint 58 Frontend Code Quality).

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | `tokio::spawn` → `tauri::async_runtime::spawn` (8 occurrences) |
| `vite.config.ts` | Added `optimizeDeps.exclude: ["src-tauri"]` |
| `src/components/ErrorBoundary.tsx` | New — catches render errors and displays them |
| `src/main.tsx` | Wrapped `<App />` in `<ErrorBoundary>` |
| `src/components/mixer/MixerView.tsx` | `useShallow` on `Object.keys(s.channels)` selector |
| `src/components/daw/ExportMidiDialog.tsx` | `useShallow` on `Object.values(s.clips)` and `Object.values(s.patterns)` |
| `README.md` | Updated sprint plan, feature list, and known limitations |
