# Sprint Lifecycle Automation Scripts

This directory contains automation utilities for the Claude Code workflow system.

## sprint_lifecycle.py

Automates sprint file movements, registry updates, git tagging, and epic completion detection.

### Features

- **Automatic file movement**: Moves sprint files to correct locations based on epic/standalone status
- **Registry updates**: Updates `docs/sprints/registry.json` with completion metadata
- **Epic detection**: Detects when epics are complete and prompts for closure
- **Git tagging**: Creates and pushes annotated tags for completed sprints
- **Dry-run mode**: Preview all operations before executing
- **Transaction safety**: Atomic operations with automatic rollback on failure

### Usage

```bash
# Move sprint to done status
python scripts/sprint_lifecycle.py move-to-done <sprint-num> [--dry-run]

# Update sprint registry
python scripts/sprint_lifecycle.py update-registry <sprint-num> --status done [--completed YYYY-MM-DD] [--hours H.H] [--dry-run]

# Check if epic is complete
python scripts/sprint_lifecycle.py check-epic <epic-num>

# Create git tag for sprint
python scripts/sprint_lifecycle.py create-tag <sprint-num> "<title>" [--dry-run] [--no-push]
```

### Examples

```bash
# Preview what would happen when completing Sprint 5
python scripts/sprint_lifecycle.py move-to-done 5 --dry-run

# Complete Sprint 5 (actually execute)
python scripts/sprint_lifecycle.py move-to-done 5
python scripts/sprint_lifecycle.py update-registry 5 --status done --hours 6.5
python scripts/sprint_lifecycle.py create-tag 5 "Automated Lifecycle Management"

# Check if Epic 1 is ready to complete
python scripts/sprint_lifecycle.py check-epic 1
```

### Integration

This utility is automatically used by the `/sprint-complete` command. See `commands/sprint-complete.md` for the complete workflow.

### Error Handling

All operations include:
- Pre-validation checks
- Atomic file operations with backup
- Automatic rollback on failure
- Clear error messages with actionable guidance

### Epic vs Standalone Sprints

**Epic sprints** (in epic folders):
- File/directory renamed with `--done` suffix
- Stays in epic folder (e.g., `sprint-02_name--done/sprint-02_name--done.md`)
- Epic folder remains in `2-in-progress/` until ALL sprints complete

**Standalone sprints**:
- Moved to `docs/sprints/3-done/_standalone/`
- Renamed with `--done` suffix (e.g., `sprint-05_name--done.md`)

### User Preferences

Based on sprint 2 planning:
- ✅ Dry-run mode enabled for safety
- ✅ Blocks completion on uncommitted changes
- ✅ Auto-pushes git tags to remote
- ✅ Warns but continues if epic README parsing fails
