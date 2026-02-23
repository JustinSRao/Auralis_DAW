---
description: "Import a sketch sprint file into proper Maestro format with directory structure and registry"
allowed-tools: [Read, Write, Bash, Glob]
---

# Import Sprint File

Convert a sketch/draft sprint file into proper Maestro format.

## Usage

```
/sprint-import <file-path> [--epic=N] [--type=TYPE] [--dry-run]
```

**Arguments:**
- `<file-path>`: Path to the existing sprint markdown file
- `--epic=N`: Link to epic number N (optional)
- `--type=TYPE`: Sprint type - fullstack, backend, frontend, research, spike, infrastructure (default: fullstack)
- `--dry-run`: Preview what would happen without making changes

**Examples:**
```
/sprint-import docs/sprints/user-auth-feature.md
/sprint-import ./my-sprint-idea.md --epic=1 --type=backend
/sprint-import sketches/photo-upload.md --dry-run
```

## Instructions

### 1. Parse Arguments

Extract from $ARGUMENTS:
- `file_path`: The path to the sketch file (required)
- `epic`: Epic number if `--epic=N` present
- `sprint_type`: Type if `--type=X` present (default: fullstack)
- `dry_run`: Boolean if `--dry-run` present

### 2. Validate Source File Exists

```bash
# Check file exists
if [ ! -f "$FILE_PATH" ]; then
  echo "Error: File not found: $FILE_PATH"
  exit 1
fi
```

### 3. Read and Parse Source File

Read the source file and extract:
- **Title**: From first `# ` heading or filename
- **Content**: Everything after the title heading
- **Existing frontmatter**: If any YAML frontmatter exists, preserve relevant fields

**Title extraction priority:**
1. From `# Sprint N: Title` → use "Title"
2. From `# Title` → use "Title"
3. From filename: `sprint-name.md` → use "Sprint Name"

### 4. Run Import Automation

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py import-sprint "$FILE_PATH" \
  ${EPIC:+--epic $EPIC} \
  ${TYPE:+--type $TYPE} \
  ${DRY_RUN:+--dry-run}
```

This will:
- Auto-assign next sprint number from registry
- Create proper directory structure
- Generate YAML frontmatter
- Preserve original content
- Register in registry.json
- Optionally link to epic

### 5. Report Results

**Success output:**
```
✓ Imported sprint from: <original-path>
  Sprint Number: <N>
  Title: <title>
  Type: <type>
  Epic: <epic or "None (standalone)">
  New Location: docs/sprints/<status>/<sprint-dir>/

Next steps:
1. Review the imported sprint: <new-path>
2. Fill in any missing sections
3. Run /sprint-start <N> when ready
```

**Dry-run output:**
```
[DRY RUN] Would import sprint:
  Source: <original-path>
  Sprint Number: <next-number>
  Title: <extracted-title>
  Type: <type>
  Epic: <epic or "None">
  Destination: docs/sprints/<status>/<sprint-dir>/

No changes made.
```

## What Gets Preserved

- All content from the original file
- Any existing YAML frontmatter values (merged with required fields)
- Task lists, code blocks, and markdown formatting

## What Gets Added/Normalized

- YAML frontmatter with required fields:
  - sprint, title, type, status, created, workflow_version
- Directory structure: `sprint-NN_slug/sprint-NN_slug.md`
- Registry entry with auto-assigned number
- Epic linkage if specified

## Notes

- Original file is NOT deleted (user can remove manually after verification)
- If file already has a sprint number in frontmatter, it will be reassigned
- Use `--dry-run` first to preview changes
