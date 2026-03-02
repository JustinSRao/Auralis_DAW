---
sprint: 5
title: "Local Authentication System"
type: fullstack
epic: 2
status: done
created: 2026-02-22T22:09:56Z
started: 2026-03-01T01:16:47Z
completed: 2026-03-01
hours: null
workflow_version: "3.1.0"


---

# Sprint 5: Local Authentication System

## Overview

| Field | Value |
|-------|-------|
| Sprint | 5 |
| Title | Local Authentication System |
| Type | fullstack |
| Epic | 2 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement a fully working local user authentication system with SQLite storage, argon2 password hashing, and React login/register UI so that each user's settings and projects are isolated under their own profile.

## Background

The DAW needs multi-user support on a single Windows machine — for example, a shared studio PC where each producer has their own projects and preferences. Authentication is local-only (no internet required), using a SQLite database already initialized in Sprint 1. The auth module stub from Sprint 1 needs to be fleshed out into a full implementation with secure password storage and session persistence.

## Requirements

### Functional Requirements

- [ ] Register a new user with username and password; reject duplicates
- [ ] Log in with correct credentials; reject incorrect password with error message
- [ ] Passwords are hashed with argon2 (argon2id variant) before storing in SQLite
- [ ] Session persists across app restarts (user stays logged in via localStorage token)
- [ ] List all existing profiles and allow switching between them from the UI
- [ ] Log out clears the session from Zustand and localStorage
- [ ] Tauri commands: `register_user`, `login_user`, `logout_user`, `list_users`, `get_current_user`

### Non-Functional Requirements

- [ ] argon2id hashing with at least m=65536, t=2, p=1 parameters
- [ ] Passwords never stored or transmitted in plaintext — only the argon2 hash in SQLite
- [ ] Auth state fully encapsulated in Zustand `authStore` with TypeScript types
- [ ] Login/register round-trip completes in under 500 ms on a typical Windows PC

## Dependencies

- **Sprints**: Sprint 1 (Project Scaffold — SQLite DB initialized, auth module stub exists), Sprint 4 (Project File System — `users` table schema defined)
- **External**: `argon2` Rust crate, `rusqlite` (already in Cargo.toml)

## Scope

### In Scope

- `src-tauri/src/auth/mod.rs` — full implementation: register, login, logout, list, session
- SQLite `users` table: `id`, `username`, `password_hash`, `created_at`
- SQLite `sessions` table: `user_id`, `token`, `created_at`
- React `LoginPage` component with username/password form and error display
- React `RegisterPage` component with validation (min password length, username taken check)
- React `ProfileSwitcher` component listing all users for quick switching
- Zustand `authStore`: `currentUser`, `login()`, `logout()`, `register()`, `hydrateFromStorage()`
- localStorage persistence of session token (not password)

### Out of Scope

- Online authentication or OAuth
- Password reset via email
- Fine-grained per-project permissions
- User avatar image upload

## Technical Approach

The Rust `auth` module exposes Tauri commands that run on the Tokio async thread pool. `register_user` takes a plaintext password, hashes it with the `argon2` crate using argon2id parameters, and stores the hash in the `users` table via `rusqlite`. `login_user` fetches the hash from SQLite, verifies the plaintext with `argon2::verify_encoded`, and on success generates a UUID session token stored in the `sessions` table. The token is returned to the frontend and persisted in localStorage. On app startup, `authStore.hydrateFromStorage()` reads the token from localStorage and calls `get_current_user` to validate it against the DB. The React UI uses controlled form components with inline validation before calling Tauri invoke.

## Tasks

### Phase 1: Planning
- [ ] Confirm `users` and `sessions` table schemas in the existing SQLite migration
- [ ] Design Tauri command signatures and TypeScript types for auth responses
- [ ] Decide session token format (UUID v4) and expiry policy (none for local use)

### Phase 2: Implementation
- [ ] Implement `register_user` Tauri command with argon2id hashing
- [ ] Implement `login_user` with argon2 verify and session token creation
- [ ] Implement `logout_user` (deletes session from DB, clears localStorage)
- [ ] Implement `list_users` and `get_current_user` commands
- [ ] Build React `LoginPage` with form validation and error state
- [ ] Build React `RegisterPage` with duplicate username check
- [ ] Build `ProfileSwitcher` dropdown component for the DAW header
- [ ] Implement Zustand `authStore` with `hydrateFromStorage()` on app mount
- [ ] Wire startup hydration in `App.tsx` — redirect to login if no valid session

### Phase 3: Validation
- [ ] Test: register then login with same credentials succeeds
- [ ] Test: login with wrong password returns error string, not a panic
- [ ] Test: re-launch app after login — still authenticated (session hydrated)
- [ ] Test: register duplicate username returns "username taken" error
- [ ] Test: logout clears state and redirects to login page

### Phase 4: Documentation
- [ ] Inline rustdoc on all public `auth::` functions
- [ ] Document argon2 parameters used and rationale in code comments

## Acceptance Criteria

- [ ] `register_user` stores an argon2id hash in SQLite (not plaintext)
- [ ] `login_user` returns a session token on correct credentials
- [ ] `login_user` returns an error on incorrect password without crashing
- [ ] App reopened after login shows the DAW UI without re-authenticating
- [ ] `list_users` returns all registered usernames
- [ ] `logout_user` clears the session and navigates to the login screen
- [ ] No plaintext passwords appear in SQLite, logs, or localStorage

## Notes

Created: 2026-02-22
