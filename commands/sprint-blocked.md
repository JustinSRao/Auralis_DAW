---
description: "Mark sprint as blocked by external dependency"
allowed-tools: [Bash]
---

# Block Sprint

Run the block-sprint automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py block-sprint $ARGUMENTS
```

This command handles all blocking steps:
- Finds sprint file
- Calculates hours worked so far
- Updates YAML frontmatter (status=blocked, blocker, hours_before_block)
- Renames file with --blocked suffix
- Updates state file

**Prerequisites:**
- Sprint must be in progress

**Usage:**
```
/sprint-blocked <N> "<reason>"
```

**Examples:**
```
/sprint-blocked 35 "Waiting for API access from vendor"
/sprint-blocked 36 "Blocked by infrastructure team delivery"
```

**To resume:** Use `/sprint-resume <N>` when blocker is resolved.
