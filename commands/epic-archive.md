---
description: "Archive a completed epic"
allowed-tools: [Bash]
---

# Archive Epic

Run the archive-epic automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py archive-epic $ARGUMENTS
```

This command handles all archiving steps:
- Finds epic in 3-done/
- Moves entire folder to 6-archived/
- Updates _epic.md YAML frontmatter (status=archived, archived_at timestamp)
- Preserves all sprint files and state files

**Prerequisites:**
- Epic must be in 3-done/ (complete it first with `/epic-complete <N>`)

**After archiving:**
- Epic and all its sprints are in 6-archived/
- State files (.claude/sprint-*-state.json) are preserved for reference
