---
description: "Add an existing sprint to an epic"
allowed-tools: [Bash]
---

# Add Sprint to Epic

Run the add-to-epic automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py add-to-epic $ARGUMENTS
```

This command handles:
- Moving sprint file into epic folder
- Updating sprint YAML frontmatter (epic field)
- Validation that sprint isn't already in another epic

**Prerequisites:**
- Sprint must exist
- Epic must exist
- Sprint cannot already be in an epic

**Usage:**
```
/sprint-add-to-epic <sprint-number> <epic-number> [--dry-run]
```

**Examples:**
```
/sprint-add-to-epic 81 10
/sprint-add-to-epic 82 6 --dry-run
```
