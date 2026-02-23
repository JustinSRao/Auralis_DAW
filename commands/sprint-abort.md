---
description: "Abort a sprint - mark as cancelled, won't be completed"
allowed-tools: [Bash]
---

# Abort Sprint

Run the abort-sprint automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py abort-sprint $ARGUMENTS
```

This command handles all abort steps:
- Finds sprint file
- Calculates hours worked (if started)
- Updates YAML frontmatter (status, aborted_at, reason, hours)
- Renames file with --aborted suffix
- Updates state file
- Updates registry

**Prerequisites:**
- Sprint must exist and be in progress or todo

**Usage:**
```
/sprint-abort <N> "<reason>"
```

**Examples:**
```
/sprint-abort 34 "Requirements changed, need to re-plan"
/sprint-abort 36 "Feature no longer needed after customer feedback"
```

**Note:** If the sprint is temporarily blocked and will resume later, use `/sprint-blocked` instead.
