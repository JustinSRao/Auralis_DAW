---
sprint: 1
title: "Project Scaffold & Build Pipeline"
type: infrastructure
epic: 1
status: in-progress
created: 2026-02-22T22:06:47Z
started: 2026-02-22T22:52:27Z
completed: null
hours: null
workflow_version: "3.1.0"


---

# Sprint 1: Project Scaffold & Build Pipeline

## Overview

| Field | Value |
|-------|-------|
| Sprint | 1 |
| Title | Project Scaffold & Build Pipeline |
| Type | infrastructure |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Establish a fully working Tauri 2 + React/TypeScript + Rust project that builds successfully, runs on Windows, and is wired to GitHub with a clean folder structure ready for DAW development.

## Background

The Music Application needs a solid scaffold before any audio or UI work can begin. This sprint sets up the entire development environment: the Tauri 2 app shell, React frontend with Tailwind/Radix UI, the Rust backend module structure, npm install, and a GitHub-connected repo. All other sprints depend on this building cleanly.

## Requirements

### Functional Requirements

- [ ] `npm run tauri dev` starts the app and shows the DAW shell UI
- [ ] `npm run tauri build` produces a Windows installer
- [ ] Tauri IPC bridge works (frontend can call a Rust command and receive a response)
- [ ] React/TypeScript frontend renders with Tailwind dark theme
- [ ] Rust backend compiles with all planned crate dependencies
- [ ] GitHub remote connected, initial commit pushed to `main`
- [ ] All Rust modules stubbed out (audio, midi, instruments, effects, project, auth, vst3)

### Non-Functional Requirements

- [ ] Build time under 5 minutes (cold Rust compile)
- [ ] No compiler warnings in either Rust or TypeScript
- [ ] `.gitignore` excludes `target/`, `node_modules/`, `*.db`

## Dependencies

- **Sprints**: None (this is the first sprint)
- **External**: Rust toolchain, Node.js 22+, Tauri CLI, Windows SDK

## Scope

### In Scope

- Tauri 2 project configuration (`tauri.conf.json`)
- React 18 + TypeScript + Vite frontend scaffold
- Tailwind CSS + Radix UI setup
- Zustand state management stubs (authStore, projectStore)
- Rust backend with all module stubs
- Auth module (full implementation as foundation)
- SQLite database initialization on app start
- GitHub repo connected and initial code pushed
- CLAUDE.md customized for this project
- Maestro sprint workflow initialized

### Out of Scope

- Any actual audio functionality (Sprint 2)
- MIDI (Sprint 3)
- UI beyond the shell layout (later sprints)
- GitHub Actions CI (can be added later)

## Technical Approach

The project uses Tauri 2 as the desktop framework with Rust handling all performance-critical work (audio, MIDI, file I/O) and React/TypeScript for the UI layer. Communication happens via Tauri's typed IPC invoke system. The Rust backend is organized into domain modules that will be fleshed out in subsequent sprints. SQLite via `rusqlite` with bundled feature handles local data with no external DB dependency.

## Tasks

### Phase 1: Planning
- [ ] Verify all tools installed (cargo, node, tauri-cli)
- [ ] Confirm Cargo.toml dependencies resolve (cargo check)
- [ ] Confirm npm install succeeds

### Phase 2: Implementation
- [ ] Run `cargo check` in `src-tauri/` — fix any compile errors
- [ ] Run `npm run build` — fix any TypeScript errors
- [ ] Verify Tauri IPC: call `get_version` command from frontend
- [ ] Test `npm run tauri dev` launches the window
- [ ] Push to GitHub

### Phase 3: Validation
- [ ] Clean build from scratch (`cargo clean && npm run tauri build`)
- [ ] Window opens, DAW shell renders, no console errors
- [ ] GitHub repo shows all files correctly

### Phase 4: Documentation
- [ ] Update CLAUDE.md with project-specific notes
- [ ] Add README.md with setup instructions and tech stack

## Acceptance Criteria

- [ ] `npm run tauri dev` launches app window without errors
- [ ] `npm run tauri build` completes successfully
- [ ] Tauri IPC call to `get_version` returns version string
- [ ] React renders DAWLayout with dark theme
- [ ] All Rust modules compile (no errors, no warnings)
- [ ] GitHub `main` branch has initial commit
- [ ] SQLite DB initializes on first launch

## Notes

Created: 2026-02-22
Note: Much of the scaffold was pre-built during project setup. This sprint verifies it all compiles and works end-to-end.
