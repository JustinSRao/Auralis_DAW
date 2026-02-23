---
description: "Resume a blocked sprint"
allowed-tools: [Bash]
---

# Resume Sprint

Run the resume-sprint automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py resume-sprint $ARGUMENTS
```

This command handles all resumption steps:
- Finds blocked sprint file (with --blocked suffix)
- Updates YAML frontmatter (status=in-progress, resumed_at, previous_blocker)
- Removes --blocked suffix from file/directory
- Updates state file
- Preserves all progress from before block

**Prerequisites:**
- Sprint must have --blocked suffix

**Usage:**
```
/sprint-resume <N>
```

**Examples:**
```
/sprint-resume 35
/sprint-resume 36
```

**After resuming:** Use `/sprint-next <N>` to continue from where you left off.
