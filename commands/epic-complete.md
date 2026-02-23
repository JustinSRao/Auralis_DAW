---
description: "Complete an epic - move to done after all sprints finished"
allowed-tools: [Bash]
---

# Complete Epic

Run the complete-epic automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py complete-epic $ARGUMENTS
```

This command handles all completion steps:
- Verifies all sprints are done or aborted
- Calculates total hours from all sprints
- Moves epic folder to 3-done/
- Updates _epic.md YAML frontmatter (status, completed timestamp, total_hours)

**Prerequisites:**
- Epic must be in 2-in-progress/
- ALL sprints must have --done or --aborted suffix

**Valid sprint statuses for epic completion:**
- `--done` suffix: Sprint completed successfully
- `--aborted` suffix: Sprint was cancelled (counts as finished)

**Blocking statuses:**
- No suffix (pending or in-progress)
- `--blocked` suffix

**After completing:**
- Use `/epic-archive <N>` to archive when ready
