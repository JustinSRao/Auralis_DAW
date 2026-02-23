---
description: "List all epics with their status and progress"
allowed-tools: [Bash]
---

# List All Epics

Run the list-epics automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py list-epics
```

This command displays:
- All epics across all folders
- Progress bars showing completion percentage
- Sprint counts (done/total)
- Location indicators (📦 backlog, 📋 todo, ⚙️ in-progress, ✅ done, 📁 archived)

**Usage:**
```
/epic-list
```

No arguments required - lists all epics.
