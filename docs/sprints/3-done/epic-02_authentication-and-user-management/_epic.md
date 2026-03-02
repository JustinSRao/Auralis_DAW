---
epic: 02
title: "Authentication & User Management"
status: done
created: 2026-02-22
started: null
completed: 2026-03-01T01:36:02Z

total_hours: 0.0
---

# Epic 02: Authentication & User Management

## Overview

Provides a local, offline-first user authentication system for the Music Application DAW. Users can register and log in with a username and password stored in a local SQLite database, with passwords hashed using argon2. Profile switching allows multiple users on the same machine, and sessions persist across app restarts via Zustand state hydrated from localStorage.

## Success Criteria

- [ ] Users can register with a username and password that is argon2-hashed before storage
- [ ] Users can log in and receive a persisted session (no re-login required on restart)
- [ ] Invalid credentials are rejected with a clear error message in the UI
- [ ] Multiple user profiles can exist and be switched between within the app
- [ ] Auth state is fully managed in Zustand and survives app restarts via localStorage

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 5 | Local Authentication System | planned |

## Backlog

- [ ] Password change / reset flow
- [ ] Profile avatar / display name customization

## Notes

Created: 2026-02-22
