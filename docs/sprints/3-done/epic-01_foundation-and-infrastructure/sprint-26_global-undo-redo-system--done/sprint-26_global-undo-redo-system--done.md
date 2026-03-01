---
sprint: 26
title: "Global Undo/Redo System"
type: fullstack
epic: 1
status: done
created: 2026-02-23T00:00:00Z
started: 2026-02-28T21:31:32Z
completed: 2026-02-28
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80



---

# Sprint 26: Global Undo/Redo System

## Overview

| Field | Value |
|-------|-------|
| Sprint | 26 |
| Title | Global Undo/Redo System |
| Type | fullstack |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Implement a global command-pattern undo/redo stack that all future sprints plug into. Any destructive operation in the DAW — note placement, automation edits, mixer moves, pattern changes — will be represented as a reversible command. Ctrl+Z / Ctrl+Shift+Z work app-wide.

## Background

Sprint 15 (waveform editor) specifies its own undo/redo, but MIDI note editing, automation drawing, mixer changes, and pattern operations have no undo coverage planned. If each sprint invents its own approach, the result will be inconsistent and non-composable (e.g. an undo that only reverses the last note edit, not the mixer move before it). Establishing the undo infrastructure in Epic 1 means every subsequent sprint can adopt it for free and users get a consistent Ctrl+Z that works across the whole app.

## Requirements

### Functional Requirements

- [ ] Global undo stack: Ctrl+Z undoes the last operation regardless of which view triggered it
- [ ] Global redo stack: Ctrl+Shift+Z / Ctrl+Y redoes the last undone operation
- [ ] Operations composable into macro commands (e.g. "paste 16 notes" = one undo step)
- [ ] Undo history panel showing last N operations with labels
- [ ] Stack cleared on new project / project load
- [ ] Maximum history depth configurable (default: 100 steps)

### Non-Functional Requirements

- [ ] Undo/redo executes synchronously in < 16ms (one frame) for all supported operations
- [ ] Command objects are serializable (for future project-level undo persistence)
- [ ] No audio thread involvement — undo is a pure UI/state-layer concern

## Dependencies

- **Sprints**: Sprint 1 (Project Scaffold) — needs Zustand store infrastructure

## Scope

### In Scope

- `src/lib/history.ts` — `Command` interface, `HistoryManager` class with push/undo/redo
- `src/stores/historyStore.ts` — Zustand store wrapping `HistoryManager`, exposes `undo()`, `redo()`, `push(cmd)`, `canUndo`, `canRedo`, `history[]`
- `src/hooks/useUndoRedo.ts` — hook wiring Ctrl+Z / Ctrl+Shift+Z keyboard events
- `src/components/daw/HistoryPanel.tsx` — undo history sidebar panel (collapsible)
- Integration: `useUndoRedo` hook mounted at app root so shortcuts work globally

### Out of Scope

- Persisting undo history across app restarts (backlog)
- Undo for audio clip waveform edits (Sprint 15 owns that with its own stack; the two stacks should eventually be unified — backlog)
- Server-side / collaborative undo (out of scope for this app)

## Technical Approach

`Command` is a TypeScript interface with `execute(): void` and `undo(): void`. `HistoryManager` maintains an array of `Command` objects and a pointer; `push()` executes the command and clears the redo tail; `undo()` calls `command.undo()` and moves the pointer back. The Zustand `historyStore` wraps `HistoryManager` so components can subscribe to `canUndo`/`canRedo` for button states. The `useUndoRedo` hook listens for `keydown` at `document` level with `useEffect`. Future sprints create `Command` implementations in their own files and call `historyStore.push(cmd)` when performing destructive operations.

## Tasks

### Phase 1: Planning
- [ ] Design `Command` interface and `HistoryManager` API
- [ ] Decide on macro-command (composite) pattern for multi-step operations
- [ ] Identify two example operations from later sprints to use as integration test cases

### Phase 2: Implementation
- [ ] Implement `Command` interface and `HistoryManager` in `src/lib/history.ts`
- [ ] Implement `historyStore.ts` Zustand store
- [ ] Implement `useUndoRedo` hook with global keyboard listener
- [ ] Build `HistoryPanel.tsx` — scrollable list of operation labels with undo pointer indicator
- [ ] Write two example command implementations (e.g. `SetBpmCommand`, `RenamePatternCommand`) to prove the pattern works end-to-end

### Phase 3: Validation
- [ ] Unit test: push 3 commands → undo 2 → redo 1 → state correct
- [ ] Unit test: push after undo clears redo stack
- [ ] Unit test: history depth capped at max
- [ ] Unit test: macro command undoes all sub-commands atomically
- [ ] Manual: Ctrl+Z / Ctrl+Shift+Z work from any focused view in the app

### Phase 4: Documentation
- [ ] TSDoc on `Command` interface explaining how future sprints implement commands
- [ ] README section: "Adding undo support to a new feature"

## Acceptance Criteria

- [ ] Ctrl+Z undoes last operation; Ctrl+Shift+Z redoes it
- [ ] Undo/redo buttons in history panel are enabled/disabled correctly
- [ ] History panel shows operation labels in correct order
- [ ] Macro commands undo as a single step
- [ ] Stack clears on new project
- [ ] All unit tests pass; coverage ≥ 80%

## Notes

Created: 2026-02-23
