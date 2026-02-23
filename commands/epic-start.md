---
description: "Start an epic - move to in-progress"
allowed-tools: [Bash]
---

# Start Epic

Run the start-epic automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py start-epic $ARGUMENTS
```

This command handles all startup steps:
- Finds epic folder in backlog/todo
- Moves entire folder to 2-in-progress/
- Updates _epic.md YAML frontmatter (status, started timestamp)
- All sprints in epic move together

**Prerequisites:**
- Epic must be in 0-backlog/ or 1-todo/

**After starting:**
- Individual sprints can be started with `/sprint-start <N>`
- Completed sprints get --done suffix but stay in epic folder
- Epic moves to 3-done/ only when ALL sprints have --done or --aborted suffix
