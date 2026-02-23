---
description: "Sync workflow updates from master environment to project"
allowed-tools: [Read, Write, Bash, Glob]
---

# Update Project Workflow

Sync workflow updates from the master environment to the current project.

## What Gets Synced

| Component | Source | Action |
|-----------|--------|--------|
| Commands | `~/.claude/commands/` | Central (run `install.sh` to update) |
| Scripts | `~/.claude/scripts/` | Central (run `install.sh` to update) |
| Agents | `~/.claude/agents/` + `~/.claude/templates/project/.claude/agents/` | Add/Update |
| Hooks | `~/.claude/hooks/` + `~/.claude/templates/project/.claude/hooks/` | Add/Update |
| sprint-steps.json | `~/.claude/templates/project/.claude/sprint-steps.json` | Update |
| WORKFLOW_VERSION | `~/.claude/WORKFLOW_VERSION` | Update |
| CLAUDE.md | `~/.claude/templates/project/CLAUDE.md` | **Skip** (user customized) |
| settings.json | - | **Skip** (project specific) |
| State files | - | **Skip** (runtime data) |

**Note:** Commands and scripts are now central. To update them, run `./install.sh` in the claude-maestro repo.

## Instructions

### 1. Determine Target Project

```bash
TARGET_PATH="${ARGUMENTS:-$(pwd)}"
echo "Updating project at: $TARGET_PATH"
```

### 2. Validate Project

```bash
# Check project is initialized
if [ ! -f "$TARGET_PATH/.claude/sprint-steps.json" ]; then
  echo "ERROR: Project not initialized. Run /project-create first."
  exit 1
fi

# Show current version
echo "Current workflow version: $(cat $TARGET_PATH/.claude/WORKFLOW_VERSION 2>/dev/null || echo 'unknown')"
echo "Master workflow version: $(cat ~/.claude/WORKFLOW_VERSION 2>/dev/null || echo 'unknown')"
```

### 3. Create Backup

```bash
BACKUP_DIR="$TARGET_PATH/.claude/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup current files
cp -r "$TARGET_PATH/.claude/agents" "$BACKUP_DIR/" 2>/dev/null || true
cp -r "$TARGET_PATH/.claude/hooks" "$BACKUP_DIR/" 2>/dev/null || true
cp "$TARGET_PATH/.claude/sprint-steps.json" "$BACKUP_DIR/" 2>/dev/null || true

echo "Backup created at: $BACKUP_DIR"
```

### 4. Check Central Installation

```bash
echo ""
echo "=== Checking Central Installation ==="

MAESTRO_HOME="$HOME/.claude"

# Check if Maestro is properly installed
if [ ! -d "$MAESTRO_HOME/scripts" ]; then
  echo "WARNING: Scripts not found at $MAESTRO_HOME/scripts"
  echo "Run ./install.sh in the claude-maestro repo to update"
else
  echo "✓ Central scripts: $MAESTRO_HOME/scripts"
fi

if [ ! -d "$MAESTRO_HOME/commands" ]; then
  echo "WARNING: Commands not found at $MAESTRO_HOME/commands"
  echo "Run ./install.sh in the claude-maestro repo to update"
else
  echo "✓ Central commands: $MAESTRO_HOME/commands"
fi
```

### 5. Sync Agents

Track changes:
- ADDED: New agents not in project
- UPDATED: Changed agents
- UNCHANGED: Identical agents

```bash
echo ""
echo "=== Syncing Agents ==="

AGENTS_ADDED=0
AGENTS_UPDATED=0
AGENTS_UNCHANGED=0

# Sync from global agents
for agent in ~/.claude/agents/*.md; do
  [ -f "$agent" ] || continue
  filename=$(basename "$agent")
  target="$TARGET_PATH/.claude/agents/$filename"

  if [ ! -f "$target" ]; then
    cp "$agent" "$target"
    echo "  Added: $filename"
    ((AGENTS_ADDED++))
  elif ! diff -q "$agent" "$target" > /dev/null 2>&1; then
    cp "$agent" "$target"
    echo "  Updated: $filename"
    ((AGENTS_UPDATED++))
  else
    ((AGENTS_UNCHANGED++))
  fi
done

# Sync from template agents
for agent in ~/.claude/templates/project/.claude/agents/*.md; do
  [ -f "$agent" ] || continue
  filename=$(basename "$agent")
  target="$TARGET_PATH/.claude/agents/$filename"

  if [ ! -f "$target" ]; then
    cp "$agent" "$target"
    echo "  Added: $filename"
    ((AGENTS_ADDED++))
  elif ! diff -q "$agent" "$target" > /dev/null 2>&1; then
    cp "$agent" "$target"
    echo "  Updated: $filename"
    ((AGENTS_UPDATED++))
  else
    ((AGENTS_UNCHANGED++))
  fi
done

echo "Agents: $AGENTS_ADDED added, $AGENTS_UPDATED updated, $AGENTS_UNCHANGED unchanged"
```

### 6. Sync Hooks

```bash
echo ""
echo "=== Syncing Hooks ==="

HOOKS_ADDED=0
HOOKS_UPDATED=0
HOOKS_UNCHANGED=0

# Sync from global hooks
for hook in ~/.claude/hooks/*.py; do
  [ -f "$hook" ] || continue
  filename=$(basename "$hook")
  target="$TARGET_PATH/.claude/hooks/$filename"

  if [ ! -f "$target" ]; then
    cp "$hook" "$target"
    echo "  Added: $filename"
    ((HOOKS_ADDED++))
  elif ! diff -q "$hook" "$target" > /dev/null 2>&1; then
    cp "$hook" "$target"
    echo "  Updated: $filename"
    ((HOOKS_UPDATED++))
  else
    ((HOOKS_UNCHANGED++))
  fi
done

# Sync from template hooks
for hook in ~/.claude/templates/project/.claude/hooks/*.py; do
  [ -f "$hook" ] || continue
  filename=$(basename "$hook")
  target="$TARGET_PATH/.claude/hooks/$filename"

  if [ ! -f "$target" ]; then
    cp "$hook" "$target"
    echo "  Added: $filename"
    ((HOOKS_ADDED++))
  elif ! diff -q "$hook" "$target" > /dev/null 2>&1; then
    cp "$hook" "$target"
    echo "  Updated: $filename"
    ((HOOKS_UPDATED++))
  else
    ((HOOKS_UNCHANGED++))
  fi
done

echo "Hooks: $HOOKS_ADDED added, $HOOKS_UPDATED updated, $HOOKS_UNCHANGED unchanged"
```

### 7. Sync Configuration

```bash
echo ""
echo "=== Syncing Configuration ==="

# Update sprint-steps.json
if [ -f ~/.claude/templates/project/.claude/sprint-steps.json ]; then
  if ! diff -q ~/.claude/templates/project/.claude/sprint-steps.json "$TARGET_PATH/.claude/sprint-steps.json" > /dev/null 2>&1; then
    cp ~/.claude/templates/project/.claude/sprint-steps.json "$TARGET_PATH/.claude/"
    echo "  Updated: sprint-steps.json"
  else
    echo "  Unchanged: sprint-steps.json"
  fi
fi

# Update workflow version
if [ -f ~/.claude/WORKFLOW_VERSION ]; then
  cp ~/.claude/WORKFLOW_VERSION "$TARGET_PATH/.claude/"
  echo "  Updated: WORKFLOW_VERSION"
fi
```

### 8. Report Preserved Files

```bash
echo ""
echo "=== Preserved (not overwritten) ==="
echo "  - .claude/settings.json (project configuration)"
echo "  - .claude/sprint-*-state.json (runtime state)"
echo "  - .claude/product-state.json (runtime state)"
echo "  - CLAUDE.md (user customized)"
```

### 9. Report Summary

```
✅ Project workflow updated: $TARGET_PATH

Summary:
  Commands/Scripts: Central (~/.claude/) - run install.sh to update
  Agents: $AGENTS_ADDED added, $AGENTS_UPDATED updated
  Hooks: $HOOKS_ADDED added, $HOOKS_UPDATED updated
  Config: sprint-steps.json, WORKFLOW_VERSION

Backup: $BACKUP_DIR

New workflow version: $(cat ~/.claude/WORKFLOW_VERSION 2>/dev/null || echo 'unknown')

Note: Review updated hooks for any breaking changes.
To restore: cp -r $BACKUP_DIR/* $TARGET_PATH/.claude/
```

## Flags

- `--dry-run` - Show what would change without applying
- `--force-claude-md` - Also update CLAUDE.md (overwrites customizations)
- `--no-backup` - Skip creating backup

## Examples

```bash
# Update current project
/project-update

# Update specific project
/project-update /path/to/project

# Preview changes
/project-update --dry-run

# Force update CLAUDE.md too
/project-update --force-claude-md
```
