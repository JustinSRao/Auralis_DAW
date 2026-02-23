---
description: "Show current sprint progress and next action"
allowed-tools: [Bash]
---

# Sprint Status

Run the sprint-status automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py sprint-status $ARGUMENTS
```

This command displays:
- Current sprint status
- Workflow version
- Started timestamp
- Current step (if in progress)
- Sprint file location

**Usage:**
```
/sprint-status <N>
```

**Example:**
```
/sprint-status 6
```
