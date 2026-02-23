# Music Application (DAW)

A desktop Digital Audio Workstation built with Tauri 2 + Rust + React/TypeScript, targeting Windows.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.x |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Radix UI |
| State | Zustand + Immer |
| Backend | Rust (src-tauri/) |
| Audio I/O | cpal with ASIO feature |
| MIDI | midir |
| Database | SQLite (rusqlite bundled) |

## Prerequisites

- [Rust toolchain](https://rustup.rs/) (stable, 1.77+)
- [Node.js](https://nodejs.org/) 22+
- [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) — WebView2 runtime, Visual Studio Build Tools
- [LLVM](https://llvm.org/builds/) 21+ — required for cpal ASIO bindings
  - Set `LIBCLANG_PATH` to your LLVM `bin/` directory (e.g. `C:\Program Files\LLVM\bin`)
- [Steinberg ASIO SDK 2.3.3](https://www.steinberg.net/asiosdk)
  - Set `CPAL_ASIO_DIR` to the SDK root (e.g. `C:\Users\<you>\ASIO_SDK`)
- [ASIO4ALL](http://www.asio4all.org/) — optional, for low-latency audio on consumer hardware

## Setup

```bash
# Install npm dependencies
npm install

# Verify Rust compilation
cd src-tauri && cargo check && cd ..

# Run in development mode
npm run tauri dev

# Run tests
npm test                     # TypeScript/React tests (vitest)
cd src-tauri && cargo test   # Rust unit tests
```

## Build

```bash
npm run tauri build
```

Produces a Windows NSIS installer at `src-tauri/target/release/bundle/nsis/`.

## Project Structure

```
src/                          # React/TypeScript frontend
  components/
    auth/                     # Login, register UI (Sprint 5)
    daw/                      # Main DAW shell layout
    instruments/              # Synth, sampler, drum machine UI
    effects/                  # EQ, reverb, compressor UI
    mixer/                    # Mixer channel strips
    timeline/                 # Song timeline / piano roll
  stores/                     # Zustand state stores
  lib/
    ipc.ts                    # All Tauri IPC calls (typed wrappers)
  styles/                     # Global CSS + Tailwind config

src-tauri/src/                # Rust backend
  audio/                      # Audio engine, device management (Sprint 2)
  midi/                       # MIDI I/O (Sprint 3)
  instruments/                # DSP: synth, sampler, drum machine (Sprints 6-8)
  effects/                    # DSP: EQ, reverb, compressor (Sprints 18-20)
  project/                    # Project file save/load (Sprint 4)
  auth/                       # SQLite authentication (Sprint 5)
  vst3/                       # VST3 plugin host (Sprints 23-24)

docs/sprints/                 # Maestro sprint workflow
```

## Sprint Plan

24 sprints across 8 epics. See `docs/sprints/` for the full plan.

| Epic | Title | Sprints |
|------|-------|---------|
| 1 | Foundation & Infrastructure | 1–4 |
| 2 | Authentication | 5 |
| 3 | Software Instruments | 6–9 |
| 4 | Composition Tools | 10–14 |
| 5 | Audio Editing | 15–16 |
| 6 | Mixer & Effects | 17–21 |
| 7 | Export & Finalization | 22 |
| 8 | VST3 Plugin Support | 23–24 |

## Repository

GitHub: https://github.com/JustinSRao/Music_Application
