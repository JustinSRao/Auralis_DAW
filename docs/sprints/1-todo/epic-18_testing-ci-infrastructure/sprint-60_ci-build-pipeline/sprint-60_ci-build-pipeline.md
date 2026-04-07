---
sprint: 60
title: "CI & Build Pipeline"
type: fullstack
epic: 18
status: planning
created: 2026-04-07T15:45:51Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 60: CI & Build Pipeline

## Overview

| Field | Value |
|-------|-------|
| Sprint | 60 |
| Title | CI & Build Pipeline |
| Type | fullstack |
| Epic | 18 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Set up the Rust toolchain in CI to run the 695 Rust unit tests automatically, add `cargo clippy` to the pre-commit hook, fix broken workflow hook scripts, and fix the `sprint_lifecycle.py` cp1252 codec error on Windows.

## Background

These items were deferred from Sprints 1, 2, and 33 postmortems and tracked in DEFERRED.md:

- **D-004 (Rust toolchain in CI)**: The CI/codespace environment does not have `cargo` installed, so the 695 Rust unit tests never run in automated builds. Every Rust change must be validated manually. This is a significant regression risk as the codebase grows. The fix is to configure GitHub Actions with the Rust toolchain (including ASIO feature flag handling) on a Windows runner.
- **Sprint 1 debt (`cargo clippy` in pre-commit hook)**: The pre-commit hook currently runs Python validation scripts but does not invoke `cargo clippy`. Rust lint warnings accumulate between sprints and are only caught when a developer runs clippy manually. Adding `cargo clippy -- -D warnings` to the pre-commit hook makes lint warnings a hard gate on every commit.
- **Sprint 2 debt (broken workflow hooks)**: The `pre_commit_check.py` and `validate_step.py` workflow hook scripts were written for a previous pytest-based test setup. They currently attempt to run `pytest` calls which fail silently or produce incorrect results instead of running `cargo test` and `npm test`. These scripts need to be fixed to call the correct test commands.
- **Sprint 33 debt (`sprint_lifecycle.py` cp1252 codec error)**: On Windows, `sprint_lifecycle.py` produces a `UnicodeEncodeError: 'cp1252' codec can't encode character` error when printing sprint names or content that contains non-ASCII characters (e.g., Unicode symbols in sprint file headers). The fix is to set `sys.stdout` to use UTF-8 encoding in the script header, or to set `PYTHONIOENCODING=utf-8` in the script's execution context.

## Requirements

### Functional Requirements

- [ ] **D-004 (CI Rust toolchain)**: A GitHub Actions workflow (`.github/workflows/ci.yml`) runs `cargo test` on every push to `main` and on every pull request, using the `dtolnay/rust-toolchain@stable` action on a `windows-latest` runner. The workflow handles ASIO feature flags correctly (ASIO4ALL headers are not available on the runner; the CI build uses the non-ASIO audio backend for testing).
- [ ] **`cargo clippy` pre-commit hook**: The pre-commit hook script includes `cargo clippy -- -D warnings` and fails the commit if clippy reports any warnings. The hook runs from the repository root targeting `src-tauri/`.
- [ ] **Workflow hook scripts fixed**: `pre_commit_check.py` and `validate_step.py` call `cargo test` (for Rust tests) and `npm test` (for TypeScript tests) correctly. Legacy `pytest` calls are removed or replaced. The scripts exit with the correct exit code (0 for pass, non-zero for failure).
- [ ] **`sprint_lifecycle.py` codec fix**: `sprint_lifecycle.py` does not crash with `UnicodeEncodeError` on Windows. The fix adds `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` near the top of the script (or equivalent), ensuring UTF-8 output regardless of the Windows console code page.

### Non-Functional Requirements

- [ ] The CI workflow completes in under 20 minutes for a full run (Rust tests + TypeScript tests + clippy + fmt)
- [ ] Rust dependency caching is configured (`~/.cargo/registry`, `~/.cargo/git`, `src-tauri/target`) keyed on `Cargo.lock` hash — reduces subsequent CI run time
- [ ] The CI workflow YAML is compatible with GitHub Actions syntax version 2
- [ ] The pre-commit hook change does not significantly slow local commits — `cargo clippy` on a warm build should complete in under 30 seconds

## Dependencies

- **Sprints**: Sprint 59 (Backend Code Quality — `cargo clippy -- -D warnings` must pass before the pre-commit hook enforces it; otherwise every commit fails), Sprint 58 (Frontend Code Quality — `npm test` must pass before the hook enforces it)
- **External**: GitHub repository with Actions enabled; GitHub-hosted `windows-latest` runner

## Scope

### In Scope

- `.github/workflows/ci.yml` creation or update with Rust toolchain, cargo test, clippy
- `cargo clippy -- -D warnings` added to the pre-commit hook
- `pre_commit_check.py` and `validate_step.py` fixed to use correct test commands
- `sprint_lifecycle.py` UTF-8 codec fix for Windows
- Rust dependency caching in CI

### Out of Scope

- Full CD pipeline (deployment/release automation)
- Code signing for Windows installer
- Cross-platform builds (Linux/macOS)
- Performance benchmarking in CI
- `npm run build` (Tauri full build) in CI — that is expensive; `cargo test` + `npm test` is the priority

## Technical Approach

### D-004: GitHub Actions CI Workflow

Create or update `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: ${{ runner.os }}-cargo-
      - name: Cargo clippy
        run: cargo clippy -- -D warnings
        working-directory: src-tauri
      - name: Cargo test (non-ASIO)
        run: cargo test --no-default-features
        working-directory: src-tauri
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: TypeScript typecheck
        run: npm run typecheck
      - name: npm test
        run: npm test
```

Note: The ASIO feature must be excluded in CI (`--no-default-features`) because ASIO4ALL headers are not available on GitHub-hosted runners. The non-ASIO backend (WASAPI) is sufficient for unit tests since audio thread tests use a null device.

### `cargo clippy` Pre-Commit Hook

Locate the pre-commit hook script (likely `.claude/hooks/pre_commit_check.py` or `.git/hooks/pre-commit`). Add:
```python
result = subprocess.run(
    ['cargo', 'clippy', '--', '-D', 'warnings'],
    cwd=os.path.join(repo_root, 'src-tauri'),
    capture_output=True, text=True
)
if result.returncode != 0:
    print(result.stderr)
    sys.exit(1)
```

### Workflow Hook Script Fixes

In `pre_commit_check.py` and `validate_step.py`, replace any `pytest` invocation with:
- `cargo test --no-default-features` (in `src-tauri/`) for Rust tests
- `npx vitest run` (in the repo root) for TypeScript tests

Ensure each command's return code is checked and the script exits non-zero on failure.

### sprint_lifecycle.py Codec Fix

Near the top of `sprint_lifecycle.py`, after the imports, add:
```python
import io
import sys
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
```
This reconfigures stdout to use UTF-8 on Windows without affecting Unix environments (where stdout is already UTF-8).

## Tasks

### Phase 1: Planning
- [ ] Check current state of `.github/workflows/ci.yml` — does it exist? What does it currently test?
- [ ] Run `cargo test --no-default-features` locally — verify it passes without ASIO
- [ ] Review `pre_commit_check.py` and `validate_step.py` — list all legacy pytest calls
- [ ] Reproduce the `sprint_lifecycle.py` codec error on Windows — confirm the fix works locally

### Phase 2: CI Workflow Implementation
- [ ] Create or update `.github/workflows/ci.yml` with Rust toolchain, caching, clippy, cargo test
- [ ] Add Node setup, npm ci, typecheck, and npm test steps
- [ ] Verify the workflow YAML syntax is valid
- [ ] Push to a test branch — verify CI triggers and runs

### Phase 3: Pre-Commit Hook and Script Fixes
- [ ] Add `cargo clippy -- -D warnings` to the pre-commit hook script
- [ ] Fix `pre_commit_check.py` to use `cargo test` and `npx vitest run`
- [ ] Fix `validate_step.py` to use correct test commands
- [ ] Test the pre-commit hook locally: make a clean commit — verify clippy runs
- [ ] Fix `sprint_lifecycle.py` with UTF-8 stdout reconfiguration
- [ ] Test the fix: run a sprint lifecycle command with a sprint containing Unicode characters — verify no codec error

### Phase 4: Validation
- [ ] Open a PR on GitHub — verify CI pipeline triggers and all steps pass
- [ ] Introduce a deliberate clippy warning — verify CI fails on the `cargo clippy` step
- [ ] Make a local commit — verify the pre-commit hook runs `cargo clippy` and catches the warning
- [ ] Fix the warning — verify hook passes
- [ ] Run `sprint_lifecycle.py` on Windows — verify no codec error

## Acceptance Criteria

- [ ] `.github/workflows/ci.yml` triggers on every push to `main` and every PR
- [ ] CI runs `cargo clippy -- -D warnings` and fails on any warning
- [ ] CI runs `cargo test --no-default-features` — all 695 Rust unit tests run in CI
- [ ] CI runs `npm run typecheck` and `npm test`
- [ ] Cargo dependency caching reduces subsequent CI run time
- [ ] Pre-commit hook runs `cargo clippy -- -D warnings` and fails commits on warnings
- [ ] `pre_commit_check.py` and `validate_step.py` run `cargo test` and `npx vitest run` without legacy pytest calls
- [ ] `sprint_lifecycle.py` runs without `UnicodeEncodeError` on Windows
- [ ] Full CI pipeline completes in under 20 minutes

## Deferred Item Traceability

| Deferred ID | Description | Fix Location |
|-------------|-------------|--------------|
| D-004 | Rust toolchain in CI for automated Rust test runs | `.github/workflows/ci.yml` |
| Sprint 1 debt | `cargo clippy` added to pre-commit hook | Pre-commit hook script |
| Sprint 2 debt | Workflow hook scripts fixed for correct test commands | `pre_commit_check.py`, `validate_step.py` |
| Sprint 33 debt | `sprint_lifecycle.py` cp1252 codec error on Windows | `sprint_lifecycle.py` |

## Notes

Created: 2026-04-07
D-004 is tracked in DEFERRED.md. The `--no-default-features` flag for CI is intentional — ASIO is an optional performance enhancement not required for unit tests.
