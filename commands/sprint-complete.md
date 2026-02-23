---
description: "Complete a sprint with full automation"
allowed-tools: [Bash]
---

# Complete Sprint

**CRITICAL**: Use the automation script ONLY. Do NOT manually move files, edit state files, or run manual checks.

## Run Automation

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py complete-sprint $ARGUMENTS
```

This single command handles ALL completion steps automatically:

### What The Script Does

1. **Pre-Flight Checks**
   - Verifies postmortem section exists
   - Validates YAML frontmatter
   - Checks sprint file status

2. **File Operations** (Hook-Protected)
   - Renames file with `--done` suffix
   - Moves to correct location based on epic membership:
     - Epic sprints: Keep in `2-in-progress/epic-N/sprint-N--done/`
     - Standalone: Move to `3-done/_standalone/`
   - Updates registry

3. **Git Operations**
   - Commits all changes
   - Creates annotated tag: `sprint-N`
   - Pushes tag to remote

4. **Epic Management**
   - Checks if epic is complete
   - Updates epic status if needed

5. **State Updates**
   - Calculates actual hours worked
   - Updates state file status
   - Preserves completion timestamp

---

## Prerequisites

Before running `/sprint-complete`:

1. **Postmortem Required** - Sprint file must have `## Postmortem` section
   - If missing: Run `/sprint-postmortem $ARGUMENTS` first
   - See postmortem skill for format requirements

2. **Work Committed** - All implementation work should be committed
   - The completion itself will create a final commit
   - But don't mix completion with implementation changes

3. **YAML Frontmatter** - Sprint file needs proper frontmatter:
   ```yaml
   ---
   sprint: N
   title: Sprint Title
   status: done
   started: 2026-01-01T12:00:00Z
   completed: 2026-01-01T18:00:00Z
   hours: 6.0
   epic: NN  # if part of epic, else omit
   workflow_version: "3.1.0"
   ---
   ```

---

## Why Automation-Only?

**Hook Enforcement**: The `pre_tool_use.py` hook blocks manual operations:
- ❌ Manual `mv` commands on sprint files → BLOCKED
- ❌ Direct edits to state files → BLOCKED
- ❌ Manual moves to wrong folders → BLOCKED
- ✅ Only `scripts/sprint_lifecycle.py` can bypass gates

**Benefits**:
- Prevents file location errors
- Ensures consistent completion flow
- Automatic registry updates
- Proper git tagging
- Epic status tracking

---

## Troubleshooting

### Error: "Sprint 3 missing YAML frontmatter"
**Fix**: Add YAML frontmatter to top of sprint file with ISO 8601 timestamps

### Error: "Postmortem section not found"
**Fix**: Run `/sprint-postmortem $ARGUMENTS` first

### Error: "can't subtract offset-naive and offset-aware datetimes"
**Fix**: Ensure timestamps in YAML use ISO format with timezone: `2026-01-01T12:00:00Z`

### Hook blocks manual operations
**Expected**: This is correct behavior! Use the automation script instead.

---

## After Completion

The script reports:
- Final file location
- Git tag created
- Hours worked (calculated from timestamps)
- Epic status (if applicable)

**For epic sprints**: File stays in `2-in-progress/epic-N/` until epic complete
- When all sprints done: `/epic-complete <N>`

**For standalone**: File moves to `3-done/_standalone/`
