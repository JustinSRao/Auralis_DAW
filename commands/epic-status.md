---
description: "Show detailed status of an epic"
allowed-tools: [Bash]
---

# Epic Status

Run the epic-status automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py epic-status $ARGUMENTS
```

This command displays:
- Epic title and status
- Current location (backlog/todo/in-progress/done/archived)
- Sprint progress (done/total)
- Breakdown of in-progress, blocked, and aborted sprints

**Usage:**
```
/epic-status <N>
```

**Example:**
```
/epic-status 1
```
