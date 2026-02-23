---
description: "Import a sketch epic directory with all sprint files into proper Maestro format"
allowed-tools: [Read, Write, Bash, Glob]
---

# Import Epic

Convert a sketch/draft epic directory with sprint files into proper Maestro format.

## Usage

```
/epic-import <directory-path> [--type=TYPE] [--dry-run]
```

**Arguments:**
- `<directory-path>`: Path to the epic directory or _epic.md file
- `--type=TYPE`: Default sprint type for imported sprints - fullstack, backend, frontend, research, spike, infrastructure (default: fullstack)
- `--dry-run`: Preview what would happen without making changes

**Examples:**
```
/epic-import sketches/user-management/
/epic-import ./my-epic/_epic.md --type=backend
/epic-import docs/drafts/payment-system --dry-run
```

## Instructions

### 1. Parse Arguments

Extract from $ARGUMENTS:
- `source_path`: Path to epic directory or _epic.md file (required)
- `sprint_type`: Type if `--type=X` present (default: fullstack)
- `dry_run`: Boolean if `--dry-run` present

### 2. Run Import Automation

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py import-epic "$SOURCE_PATH" \
  ${TYPE:+--type $TYPE} \
  ${DRY_RUN:+--dry-run}
```

This will:
- Auto-assign next epic number from registry
- Create proper epic directory structure in `docs/sprints/0-backlog/`
- Import all sprint markdown files found in the source directory
- Generate YAML frontmatter for epic and all sprints
- Register epic and all sprints in registry.json

### 3. Report Results

**Success output:**
```
✓ Imported epic from: <directory-name>
  Epic Number: <N>
  Title: <title>
  New Location: docs/sprints/0-backlog/epic-NN_slug/
  Sprints Imported: <count>/<total>

Next steps:
  1. Review the imported epic
  2. Run /epic-start <N> to begin work
```

**Dry-run output:**
```
[DRY RUN] Would import epic from: <directory>
  Epic Number: <next-number>
  Title: <extracted-title>
  Destination: docs/sprints/0-backlog/epic-NN_slug/
  Sprint files found: <count>
    - file1.md
    - file2.md

No changes made.
```

## What Gets Imported

The command looks for:
1. An `_epic.md` file (if present) - used for epic metadata
2. All `*.md` files in the directory (except `_epic.md`)
3. All `*.md` files in subdirectories (recursive)

## What Gets Created

For each epic import:
- `docs/sprints/0-backlog/epic-NN_slug/` - Epic directory
- `docs/sprints/0-backlog/epic-NN_slug/_epic.md` - Epic metadata file
- `docs/sprints/0-backlog/epic-NN_slug/sprint-MM_slug/` - Sprint directories
- Registry entries for epic and all sprints

## Source Directory Structure Examples

**Example 1: Simple directory with sprint files**
```
user-management/
├── authentication.md
├── authorization.md
└── user-profiles.md
```

**Example 2: Directory with _epic.md**
```
payment-system/
├── _epic.md
├── stripe-integration.md
├── invoice-generation.md
└── refund-processing.md
```

**Example 3: Nested structure**
```
e-commerce/
├── _epic.md
├── cart/
│   └── shopping-cart.md
├── checkout/
│   └── checkout-flow.md
└── orders/
    └── order-management.md
```

## Notes

- Original files are NOT deleted (user can remove manually after verification)
- Sprint numbers are auto-assigned in alphabetical order of filenames
- Use `--dry-run` first to preview the import
- All sprints inherit the `--type` specified (can be changed individually later)
