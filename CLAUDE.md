# Project Instructions

## Workflow System

This project uses an **AI-assisted development workflow** with parallel agents, skills, and slash commands.

**Workflow Version**: See `.claude/WORKFLOW_VERSION` for current version.

### Quick Start

```bash
/sprint-new "Feature Name"    # Create a new sprint
/sprint-start <N>             # Initialize sprint, spawn Plan agent
/sprint-next                  # Advance to next step
/sprint-status                # Check progress and agent status
/sprint-complete              # Pre-flight checklist and finish
/sprint-postmortem            # Capture learnings
```

### How It Works

```
Phase 1: Planning (sequential)
├── Read sprint → Plan agent designs team → Clarify requirements

Phase 2: Implementation (PARALLEL)
├── Backend agent ──┐
├── Frontend agent ─┼── Run simultaneously
└── Test agent ─────┘

Phase 3: Validation (sequential)
├── Integrate → Run tests → Quality review → User approval

Phase 4: Complete (sequential)
├── Commit → Move to done → Postmortem
```

### Key Concepts

- **Agents**: Plan, product-engineer, quality-engineer, test-runner, devops-engineer
- **State Files**: `.claude/sprint-N-state.json` tracks each sprint
- **Sprint Counter**: `docs/sprints/next-sprint.txt` auto-assigns numbers

### Sprint Directories

| Directory | Purpose |
|-----------|---------|
| `docs/sprints/1-todo/` | Planned sprints waiting to start |
| `docs/sprints/2-in-progress/` | Currently active sprints |
| `docs/sprints/3-done/` | Completed sprints |
| `docs/sprints/5-aborted/` | Cancelled/abandoned sprints |

### Workflow Enforcement

The sprint workflow is enforced via hooks. Key rules:
- Cannot skip steps - must complete current before advancing
- Cannot commit without completing sprint
- All sprints require postmortem before completion
- Sprint numbers auto-assigned from counter file

### Epic Management

Group related sprints into epics:

```bash
/epic-new "Epic Name"         # Create new epic
/epic-start <N>               # Start working on epic
/sprint-new "Feature" --epic=N # Add sprint to epic
/epic-complete <N>            # Finish epic when all sprints done
```

---

## Project: Music Application (DAW)

A desktop Digital Audio Workstation built with **Tauri 2 + Rust + React/TypeScript** targeting Windows.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.x |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Radix UI |
| State | Zustand + Immer |
| Backend | Rust (src-tauri/) |
| Audio I/O | cpal with ASIO feature |
| MIDI | midir |
| Audio Decode | symphonia |
| Sample Rate | rubato |
| Database | rusqlite (SQLite, bundled) |
| Auth | argon2 password hashing |
| Serialization | serde / serde_json |

### Repository

- **GitHub**: https://github.com/JustinSRao/Music_Application.git
- **Branch strategy**: feature branches → `main`
- **Push after every sprint completion**

### Project Structure

```
src/                    # React/TypeScript frontend
  components/
    auth/               # Login, register, profile UI
    daw/                # Main DAW layout and views
    instruments/        # Synth, sampler, drum machine UI
    effects/            # EQ, reverb, compressor UI
    mixer/              # Mixer channel strips
    timeline/           # Song timeline / piano roll / step sequencer
  stores/               # Zustand state stores
  styles/               # Global CSS + Tailwind config

src-tauri/src/          # Rust backend
  audio/                # Audio engine, device management, graph, transport clock, scheduler
  midi/                 # MIDI I/O, event bus, CC mapping (Sprint 29), MIDI import (Sprint 32)
  instruments/          # DSP: synth, sampler, drum machine, LFO (Sprint 33)
  effects/              # DSP: EQ, reverb, compressor, delay
  project/              # Project file save/load (.mapp format), track types (Sprint 30)
  auth/                 # SQLite auth (commands, db, models)
  config/               # App preferences persistence (Sprint 27)
  browser/              # File system browser + audio preview (Sprint 28)
  presets/              # Instrument & effect preset management (Sprint 34)
  vst3/                 # VST3 plugin host

docs/sprints/           # Maestro sprint workflow
```

### Code Standards

**Rust:**
- No `unwrap()` in non-test code — use `?` or proper error handling with `anyhow`
- No heap allocations on the audio thread (verify with profiling)
- Use `crossbeam-channel` for audio thread communication, never `std::sync::Mutex` on hot path
- All public types must have rustdoc comments

**TypeScript/React:**
- Strict TypeScript — no `any` types
- All Zustand stores use `immer` middleware for immutable updates
- Tauri IPC calls wrapped in typed functions in `src/lib/ipc.ts`
- Components are functional with hooks only

### Testing Requirements

- **Rust**: Unit tests for all DSP algorithms and pure logic. Smoke tests for audio engine start/stop.
- **TypeScript**: Component tests for all UI interactions
- Coverage thresholds per sprint type (see CLAUDE.md global rules)
- Real-time audio callback code is exempt from unit testing — use integration smoke tests instead

### Audio Architecture Rules

- Audio callback must NEVER block, allocate memory, or use mutexes
- All parameter changes flow through `atomic_float` (continuous) or `crossbeam-channel` (discrete commands)
- Audio engine state machine: `Stopped → Starting → Running → Stopping → Stopped`
- Buffer size default: 256 samples. Sample rate default: 44100 Hz

### Deployment

- Build: `npm run tauri build` produces a Windows NSIS installer in `src-tauri/target/release/bundle/`
- No CI/CD yet — manual build and test on Windows
- ASIO4ALL must be installed separately by user for low-latency audio

### Sprint Execution Order

Sprints must be executed roughly in order due to dependencies:
1. Sprint 1 → 2 → 3 → 4 (Foundation — all others depend on these)
2. Sprint 30 (DAW Shell & Track Management — needs Sprint 1; run before any track-touching sprint)
3. Sprint 26 (Undo/Redo — needs Sprint 1; parallel with Sprint 2)
4. Sprint 25 (Transport & Tempo — needs Sprint 2 audio engine)
5. Sprint 5 (Auth — can run parallel with foundation sprints)
6. Sprints 6-9 (Instruments — need Sprint 2 audio engine)
7. Sprint 33 (LFO Modulation — needs Sprint 6 synth)
8. Sprints 10-14 (Composition — need Sprints 3, 6-8, 25 for tempo, 30 for track types)
9. Sprint 31 (Arrangement Playback Engine — needs Sprints 2, 12, 13, 25)
10. Sprint 32 (MIDI File Import — needs Sprints 11, 12)
11. Sprints 15-16 (Audio Editing — need Sprints 9, 13)
12. Sprints 17-21 (Mixer/Effects — need Sprints 2, 6-9, 30 for track types)
13. Sprint 34 (Instrument & Effect Presets — needs Sprints 6-8, 18-20)
14. Sprint 22 (Export — needs Sprints 17-21)
15. Sprints 23-24 (VST3 — needs Sprint 2 audio engine)
16. Sprint 27 (Settings UI — needs Sprints 2, 3)
17. Sprint 28 (Sample Browser — needs Sprint 7 sampler)
18. Sprint 29 (MIDI Learn — needs Sprint 3 MIDI I/O)
