---
description: "Create a new epic to group related sprints"
allowed-tools: [Read, Write, Glob, Bash]
---

# Create Epic: $ARGUMENTS

Create a new epic file for organizing related sprints.

## Instructions

### 1. Parse Arguments

Parse $ARGUMENTS to get the epic title:
- Example: "Mobile Field Application"

If no title provided, ask the user for one.

### 2. Register Epic and Get Auto-Assigned Number

**IMPORTANT**: Epic numbers are now AUTO-ASSIGNED from registry.json.

Register the epic using automation:

```bash
# Extract title from arguments
TITLE="$TITLE"  # Parsed from arguments
SPRINT_COUNT="$SPRINT_COUNT"  # Optional, how many sprints planned
ESTIMATED_HOURS="$ESTIMATED_HOURS"  # Optional

# Register epic and get assigned number
EPIC_NUM=$(python3 ~/.claude/scripts/sprint_lifecycle.py register-epic "$TITLE" --sprint-count ${SPRINT_COUNT:-0} --estimated-hours ${ESTIMATED_HOURS:-0} 2>&1 | grep "Registered epic" | awk '{print $3}')

echo "✓ Epic $EPIC_NUM registered: $TITLE"
```

This automatically:
- Assigns next available epic number
- Increments registry counter
- Registers epic in registry.json with metadata
- Initializes completedSprints counter to 0

### 3. Create Slug

Convert title to slug:
- Lowercase
- Replace spaces with hyphens
- Remove special characters
- Example: "Mobile Field Application" → "mobile-field-application"

### 4. Create Epic Folder and File

**Note**: Epics now use folder structure to group sprints.

Create epic folder: `docs/sprints/1-todo/epic-{NN}_{slug}/`

Create epic metadata file: `docs/sprints/1-todo/epic-{NN}_{slug}/_epic.md`

```bash
# Create epic folder
EPIC_DIR="docs/sprints/1-todo/epic-${EPIC_NUM}_${SLUG}"
mkdir -p "$EPIC_DIR"

# Create _epic.md file
cat > "$EPIC_DIR/_epic.md" << 'EOF'
```

Use this template for `_epic.md`:

```markdown
---
epic: {NN}
title: "{Title}"
status: planning
created: {TODAY}
started: null
completed: null
---

# Epic {NN}: {Title}

## Overview

{To be filled in - describe the strategic initiative}

## Success Criteria

- [ ] {Define measurable outcomes}

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| -- | TBD | planned |

## Backlog

- [ ] {Add unassigned tasks}

## Notes

Created: {TODAY}
```

### 5. Report

Output:
```
Created: docs/epics/epic-{NN}_{slug}.md

Next steps:
1. Fill in the Overview and Success Criteria
2. Add existing sprints to the Sprints table
3. Use /sprint-new "<title>" --epic={NN} to create new sprints
```
