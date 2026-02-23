---
description: "Recover a sprint file that ended up in the wrong location"
allowed-tools: [Bash]
---

# Recover Sprint File

Run the recover-sprint automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py recover-sprint $ARGUMENTS
```

This command handles:
- Finding sprint file in wrong location
- Moving to correct folder (3-done for standalone, epic folder for epic sprints)
- Updating state file with new path

**Prerequisites:**
- Sprint must have --done suffix (completed sprints only)

**Usage:**
```
/sprint-recover <N> [--dry-run]
```

**Examples:**
```
/sprint-recover 124
/sprint-recover 100 --dry-run
```

**Common scenarios:**
- File in wrong numbered folder
- File missing proper folder structure
- Epic sprint in wrong location
