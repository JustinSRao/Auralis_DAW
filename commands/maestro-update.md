---
description: "Update Maestro installation from source repository"
allowed-tools: [Bash]
---

# Update Maestro Installation

Updates the global Maestro installation by running install.sh from the source repository.

## Instructions

```bash
# Check if source path is saved
if [ ! -f ~/.claude/maestro-source ]; then
  echo "ERROR: Maestro source path not found."
  echo "This usually means Maestro was installed before this feature was added."
  echo ""
  echo "To fix, run install.sh manually from your claude-maestro repo:"
  echo "  cd /path/to/claude-maestro && ./install.sh"
  exit 1
fi

# Get source path
MAESTRO_SOURCE=$(cat ~/.claude/maestro-source)

# Verify it exists
if [ ! -d "$MAESTRO_SOURCE" ]; then
  echo "ERROR: Maestro source not found at: $MAESTRO_SOURCE"
  echo "The repository may have been moved or deleted."
  exit 1
fi

if [ ! -f "$MAESTRO_SOURCE/install.sh" ]; then
  echo "ERROR: install.sh not found at: $MAESTRO_SOURCE"
  exit 1
fi

echo "Updating Maestro from: $MAESTRO_SOURCE"
echo ""

# Run install.sh
cd "$MAESTRO_SOURCE" && ./install.sh
```

## What This Does

1. Reads the saved Maestro source path from `~/.claude/maestro-source`
2. Runs `install.sh` to update all symlinks/copies
3. Updates: scripts, commands, skills, agents, templates, hooks

## Usage

```bash
/maestro-update
```

## Notes

- The source path is saved automatically when you first run `install.sh`
- If you move the claude-maestro repo, run `install.sh` again from the new location
- This updates the global installation; use `/project-update` for project-specific files
