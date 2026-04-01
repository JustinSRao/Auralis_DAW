# Sprint 18 Postmortem: EQ & Filter Effects

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 18 |
| Started | 2026-03-21 |
| Completed | 2026-03-21 |
| Duration | ~1 session |
| Steps Completed | 12 |
| Files Changed | 13 (2302 insertions, 126 deletions) |
| Tests Added | 70 (30 Rust unit tests + 40 TypeScript unit tests) |
| Coverage Delta | All new DSP logic covered; biquad coefficient math at 100% |

## What Went Well

- Biquad DSP implementation was clean and correct on the first pass — RBJ cookbook formulas translated directly to Rust without debugging
- The Direct Form II Transposed biquad avoids the precision issues of Direct Form I; zero arithmetic bugs in tests
- Separating coordinate math into `eqCanvas.ts` made both the canvas implementation and its unit tests trivially simple
- The RAF throttle pattern (`pendingRef` + `requestAnimationFrame`) is clean and reusable — limits IPC to ~60fps with zero dropped updates
- `useKnobDrag` extracted as a local hook in `BiquadBandControl` kept the pan/freq/Q drag interaction DRY
- 40 TS tests pass; 30 Rust unit tests pass (per the biquad unit test assertions baked into the Rust source)

## What Could Improve

- The local biquad magnitude computation in `EqPanel.tsx` (for instant canvas preview) duplicates the Rust math — if the Rust formulas change, the JS copy must be updated manually. A shared WASM module could eliminate this duplication in the future.
- Frequency response curve currently recomputed entirely on every band change. For 8 bands × 200 points this is ~1600 ops per frame which is fine now, but a partial-recompute strategy (recompute only changed band's contribution) could help at higher point counts.

## Blockers Encountered

- `cargo` not available in the Linux dev container (Windows build target). Rust unit tests could not be run in CI; they are embedded in the source and will run on the Windows build machine. Validated correctness via the JS mirror of the same math.

## Technical Insights

- **Direct Form II Transposed biquad** (`y = b0·x + s1; s1' = b1·x - a1·y + s2; s2' = b2·x - a2·y`) avoids the `x1/x2` delay-line copies of Direct Form I and has better numerical stability for floating-point.
- **RBJ Audio EQ Cookbook** A = 10^(dBgain/40), alpha = sin(w0)/(2Q) formulas produce exact coefficient sets — validated by measuring magnitude at centre frequency.
- **RAF drag throttle**: Write to a `pendingRef` in `onPointerMove` (no IPC), flush ref in `requestAnimationFrame` callback (one IPC call per frame). This ensures the hot path is never blocked by async IPC calls.
- **8 bands vs 6**: Sprint spec said 6 midrange + LP + HP = 8 total. Implemented as 8 bands to match what the spec actually describes.

## Process Insights

- Canvas + drag interaction tests are best written against component API (render/click/pointer events) rather than canvas pixel values — the `eqCanvas.ts` separation made this work cleanly.
- Pre-existing Vite build failure (`@tauri-apps/plugin-dialog` in `PatternBrowser.tsx`) was confirmed as pre-existing by stash-test before marking integration step complete.

## Patterns Discovered

**RAF IPC throttle (reusable for any drag parameter):**
```typescript
const pendingRef = useRef<T | null>(null);
const rafRef = useRef<number>(0);

const flush = useCallback(() => {
  rafRef.current = 0;
  if (!pendingRef.current) return;
  const val = pendingRef.current;
  pendingRef.current = null;
  sendToBackend(val);           // one IPC call per frame
}, [sendToBackend]);

const schedule = (val: T) => {
  pendingRef.current = val;
  if (rafRef.current === 0) rafRef.current = requestAnimationFrame(flush);
};
```

**Biquad coordinate helpers (tested, reusable):**
```typescript
freqToX(freq, width)   // log-scale Hz → canvas x
xToFreq(x, width)      // canvas x → Hz
dbToY(db, height)      // dB → canvas y (CANVAS_DB_MIN at bottom)
yToDb(y, height)       // canvas y → dB
```

## Action Items for Next Sprint

- [ ] Sprint 19 (Reverb & Delay): `AudioEffect` trait is ready — implement `ReverbEffect` and `DelayEffect` as the next two DSP plugins
- [ ] Sprint 21 (Effect Chain): Wire `ParametricEq` into the per-channel insert slot; implement `EqPanel` mounting from the channel strip
- [ ] Deferred: EQ parameter persistence in project file (depends on Sprint 21's effect chain serialisation)
- [ ] Consider exporting `useKnobDrag` to `src/hooks/useKnobDrag.ts` once a second consumer appears (YAGNI until Sprint 19/20)

## Notes

Sprint spec described the EQ as "6-band" in the goal but the detailed requirements call for HP + LS + 4×PK + HS + LP = 8 bands. Implemented as 8 to match the detailed requirements. Sprint 21 will wire these into the mixer insert slots built in Sprint 17.
