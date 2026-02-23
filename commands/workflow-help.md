---
description: "Show all available workflow commands"
allowed-tools: [Bash, Read]
---

# Workflow Help

Display all available workflow commands organized by category.

## Instructions

### 1. Parse Arguments

`$ARGUMENTS` may contain an optional category filter: `sprint`, `epic`, `project`, or `all`.

If no category specified, show all commands.

### 2. Read Command Reference

```bash
cat .claude/workflow-command-reference.json
```

### 3. Display Output

Format the output as shown below, filtering by category if specified.

**If showing all commands:**

```
============================================================
WORKFLOW COMMAND REFERENCE
============================================================

SPRINT COMMANDS
  /sprint-new <title>           Create a new sprint planning file
  /sprint-start <N>             Start a sprint
  /sprint-status [N]            Show sprint progress and next action
  /sprint-next                  Advance to next workflow step
  /sprint-complete <N>          Complete sprint (postmortem, tag)
  /sprint-abort <N> <reason>    Abort sprint
  /sprint-blocked <N> <reason>  Mark sprint as blocked
  /sprint-resume <N>            Resume blocked sprint

EPIC COMMANDS
  /epic-new <title>             Create a new epic
  /epic-start <N>               Start an epic
  /epic-status <N>              Show epic status
  /epic-list                    List all epics
  /epic-complete <N>            Complete epic
  /epic-archive <N>             Archive completed epic

PROJECT COMMANDS
  /project-create               Initialize new project with workflow
  /project-update               Sync workflow updates

QUICK START
  1. /sprint-start <N>          Start working on a sprint
  2. /sprint-status             Check current progress
  3. /sprint-next               Advance when step is complete
  4. /sprint-complete <N>       Finish the sprint

============================================================
Run /workflow-help <category> for detailed help on a category.
============================================================
```

**If showing specific category (e.g., `/workflow-help sprint`):**

```
============================================================
SPRINT COMMANDS
============================================================

/sprint-new <title> [--epic N]
  Create a new sprint planning file
  Example: /sprint-new "Add authentication" --epic 1

/sprint-start <N>
  Start a sprint (creates state file, moves to in-progress)
  Example: /sprint-start 5

/sprint-status [N]
  Show current sprint progress and next action
  Example: /sprint-status 5

/sprint-next
  Advance to next workflow step after completing current
  Example: /sprint-next

/sprint-complete <N>
  Complete sprint (generates postmortem, moves to done, creates tag)
  Example: /sprint-complete 5

/sprint-abort <N> <reason>
  Abort sprint (cancelled, won't be completed)
  Example: /sprint-abort 5 "Requirements changed"

/sprint-blocked <N> <reason>
  Mark sprint as blocked by external dependency
  Example: /sprint-blocked 5 "Waiting for API"

/sprint-resume <N>
  Resume a blocked sprint
  Example: /sprint-resume 5

============================================================
```

### 4. Show Context-Aware Tips

If there's an active sprint (check for `.claude/sprint-*-state.json`), add:

```
CURRENT SPRINT
  Sprint N is active at step X.Y
  Next: /sprint-next to advance
```
