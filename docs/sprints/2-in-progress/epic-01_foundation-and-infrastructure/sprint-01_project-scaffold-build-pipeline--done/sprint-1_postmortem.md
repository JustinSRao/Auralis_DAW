# Sprint 1 Postmortem: Project Scaffold & Build Pipeline

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 1 |
| Started | 2026-02-22 |
| Completed | 2026-02-23 |
| Duration | 1 session |
| Steps Completed | 13 |
| Files Changed | 33 files, 9333 insertions, 46 deletions |
| Tests Added | 15 (6 Rust, 9 TypeScript) |
| Coverage | Rust: auth/db fully covered; TS: all 3 modules covered |

## What Went Well

- **Toolchain detection was fast**: Running diagnostic commands in parallel surfaced all 3 blockers (ASIO SDK, libclang, main.rs crate name) before touching any code
- **LLVM available via winget**: Single command install with no manual steps
- **Steinberg ASIO SDK had a public download URL**: No account required — direct zip download worked cleanly
- **Plan agent audit was thorough**: Caught 6 real issues (missing capabilities file, immer missing from authStore, `new_without_default` warning, missing rustdoc, etc.) that weren't obvious from a quick read
- **All Rust tests green on first write**: The `auth/db.rs` tests passed immediately — the existing DB code was correct
- **tsconfig split worked cleanly**: Excluding test files from `tsconfig.json` and introducing `tsconfig.test.json` fixed the production build without affecting vitest

## What Could Improve

- **Scaffold should ship with env var documentation**: Future projects using cpal ASIO need `LIBCLANG_PATH` and `CPAL_ASIO_DIR` documented upfront — cost one full diagnostic loop here
- **tsconfig.node.json was misconfigured at project creation**: `composite: true` and `noEmit` conflict are a known Vite gotcha — should be in the project template
- **`music_application_lib` crate name in main.rs**: Wrong default from Tauri scaffolding — caught late
- **Vitest 2.x ships with moderate vulnerabilities**: Should evaluate upgrading to vitest 4.x in a dedicated dependency sprint

## Blockers Encountered

1. **`CPAL_ASIO_DIR` not set + ASIO SDK not present**: `cargo check` died on the `asio-sys` bindgen step. Resolution: downloaded Steinberg ASIO SDK 2.3.3 from public URL, installed to `C:\Users\nitsu\ASIO_SDK`, set env var via `setx`.
2. **`LIBCLANG_PATH` not set**: bindgen couldn't find `libclang.dll`. Resolution: installed LLVM 21.1.8 via winget, set `LIBCLANG_PATH` to `C:\Program Files\LLVM\bin`.
3. **Placeholder icons missing**: `tauri-build` requires `icons/icon.ico` to generate the Windows resource file. Resolution: generated placeholder icons with Pillow.
4. **`icon.icns` in `tauri.conf.json`**: macOS icon format listed in config but file doesn't exist. Would block `tauri build`. Removed.
5. **Test files leaking into production `tsc`**: Vitest globals (`vi`, `describe`, `expect`) caused TS errors when `tsc` included test dirs. Resolution: added `exclude` to `tsconfig.json`, created `tsconfig.test.json`.

## Technical Insights

- **Tauri 2 ACL is mandatory**: Without `src-tauri/capabilities/default.json`, IPC commands are silently blocked at runtime in production builds. This is a breaking change from Tauri 1.x and is easy to miss.
- **`cpal` ASIO feature requires two separate installs**: The ASIO SDK (headers for compile-time bindgen) is separate from ASIO drivers (runtime). FL Studio ASIO found on the system was runtime-only — not useful for compilation.
- **`asio-sys` caching**: Once built, subsequent `cargo check` runs take ~2s instead of 2min — the bindgen output is cached in `target/`.
- **Zustand v5 immer composition**: `persist(immer(...))` order matters — `persist` must be the outer middleware so it sees the final state shape after immer transforms.
- **`new_without_default` clippy lint**: Any `pub struct Foo` with `pub fn new() -> Self` that doesn't also `impl Default` triggers a warning. Pattern: always add `impl Default { fn default() -> Self { Self::new() } }` to stub structs.

## Process Insights

- **Diagnostic-first approach paid off**: Running parallel terminal checks before touching code meant zero rework — every fix was targeted.
- **Plan agent's file-by-file audit is worth the wait**: It found 6 issues that a quick scan would have missed. The 5-minute planning cost saved multiple fix-and-rerun cycles.
- **setx for env vars**: Windows `setx` persists to user environment but doesn't affect the current shell session — always verify with PowerShell `[Environment]::GetEnvironmentVariable(...)` rather than `echo $VAR`.

## Patterns Discovered

**IPC wrapper pattern** (use this in every sprint that adds new Rust commands):
```typescript
// src/lib/ipc.ts
import { invoke } from "@tauri-apps/api/core";

export async function commandName(arg: string): Promise<ReturnType> {
  return invoke<ReturnType>("command_name", { arg });
}
```

**Zustand store with immer + persist** (standard pattern for all stores):
```typescript
export const useStore = create<State>()(
  persist(
    immer((set) => ({
      // state and actions using immer draft mutations
    })),
    { name: "storage-key" }
  )
);
```

**Rust public stub with Default** (use for all placeholder structs):
```rust
/// Description of what this will do in SprintN.
pub struct MyStruct;

impl MyStruct {
    /// Creates a new idle instance.
    pub fn new() -> Self { MyStruct }
}

impl Default for MyStruct {
    fn default() -> Self { Self::new() }
}
```

## Action Items for Next Sprint

- [ ] Sprint 2: Implement core audio engine (cpal ASIO/WASAPI device enumeration, stream start/stop, state machine)
- [ ] Sprint 2: Wire `AudioEngine` into the Tauri app state (replace stub with real implementation)
- [ ] Evaluate vitest 4.x upgrade — check for breaking API changes vs 2.x before upgrading
- [ ] Consider adding `cargo clippy` to the pre-commit check so warnings surface immediately

## Notes

- The `src-tauri/gen/` directory is generated by `tauri-build` and contains ACL schemas — it is gitignored correctly and should not be committed
- ASIO SDK lives at `C:\Users\nitsu\ASIO_SDK` — if the machine is rebuilt, re-run the ASIO + LLVM setup steps from the sprint notes
- All environment variables are set at user scope via `setx` — they persist across terminal sessions but require opening a new terminal to take effect
