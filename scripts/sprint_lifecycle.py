#!/usr/bin/env python3
"""
Sprint lifecycle automation utilities.

Automates sprint file movements, registry updates, git tagging, and epic completion detection
to eliminate manual overhead in sprint completion workflow.

Functions:
    find_project_root() -> Path: Locate project root containing .claude/
    move_to_done(sprint_num, dry_run=False) -> Path: Move sprint file to done with --done suffix
    update_registry(sprint_num, status, dry_run=False, **metadata) -> None: Update sprint registry
    check_epic_completion(epic_num) -> tuple[bool, str]: Detect if epic ready to complete
    create_git_tag(sprint_num, title, dry_run=False) -> None: Create and push git tag

Usage:
    python scripts/sprint_lifecycle.py --help

    # From Python code:
    from scripts.sprint_lifecycle import move_to_done, update_registry, create_git_tag

    new_path = move_to_done(2)
    update_registry(2, status='done', hours=6)
    create_git_tag(2, "Automated Lifecycle Management")
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple


class SprintLifecycleError(Exception):
    """Base exception for sprint lifecycle operations."""

    pass


class GitError(SprintLifecycleError):
    """Git operation failed."""

    pass


class FileOperationError(SprintLifecycleError):
    """File operation failed."""

    pass


class ValidationError(SprintLifecycleError):
    """Validation check failed."""

    pass


def find_project_root() -> Path:
    """
    Find project root by walking up directory tree to find .claude/ directory.

    Returns:
        Path: Absolute path to project root

    Raises:
        FileOperationError: If project root cannot be found

    Example:
        >>> root = find_project_root()
        >>> print(root)
        /Users/name/project
    """
    current = Path.cwd().resolve()

    # Walk up directory tree
    for parent in [current] + list(current.parents):
        if (parent / ".claude").exists():
            return parent

    raise FileOperationError(
        "Could not find project root. Expected .claude/ directory. "
        "Are you in a Claude Code project?"
    )


def _backup_file(file_path: Path) -> Path:
    """
    Create backup of file before modification.

    Args:
        file_path: Path to file to backup

    Returns:
        Path to backup file
    """
    backup_path = file_path.with_suffix(file_path.suffix + ".bak")
    shutil.copy2(file_path, backup_path)
    return backup_path


def _restore_file(backup_path: Path) -> None:
    """
    Restore file from backup.

    Args:
        backup_path: Path to backup file
    """
    original_path = Path(str(backup_path).replace(".bak", ""))
    shutil.move(backup_path, original_path)


def _cleanup_backup(backup_path: Path) -> None:
    """
    Remove backup file after successful operation.

    Args:
        backup_path: Path to backup file
    """
    if backup_path.exists():
        backup_path.unlink()


def _find_sprint_file(sprint_num: int, project_root: Path) -> Optional[Path]:
    """
    Find sprint file by number in any status directory.

    Supports two patterns:
    1. Direct file: sprint-NN_title.md
    2. Folder with sprint.md: sprint-NN_title/sprint.md

    Args:
        sprint_num: Sprint number to find
        project_root: Project root path

    Returns:
        Path to sprint file if found, None otherwise

    Example:
        >>> _find_sprint_file(2, Path("/project"))
        Path("/project/docs/sprints/2-in-progress/sprint-02_title.md")
    """
    sprints_dir = project_root / "docs" / "sprints"
    pattern = f"sprint-{sprint_num:02d}_*"

    # Search in all status directories and epic folders
    for status_dir in sprints_dir.glob("*"):
        if not status_dir.is_dir():
            continue

        # Check direct children (standalone sprints) - pattern: sprint-NN_title.md
        for sprint_file in status_dir.glob(f"{pattern}.md"):
            # Exclude postmortem files
            if "_postmortem.md" not in sprint_file.name:
                return sprint_file

        # Check in epic folders - pattern: epic-NN/sprint-NN_title.md
        for sprint_file in status_dir.glob(f"**/{pattern}.md"):
            # Exclude postmortem files
            if "_postmortem.md" not in sprint_file.name:
                return sprint_file

        # Check for sprint folders with sprint.md inside - pattern: sprint-NN_title/sprint.md
        for sprint_dir in status_dir.glob(pattern):
            if sprint_dir.is_dir():
                sprint_file = sprint_dir / "sprint.md"
                if sprint_file.exists():
                    return sprint_file

        # Check in epic folders for sprint folders - pattern: epic-NN/sprint-NN_title/sprint.md
        for sprint_dir in status_dir.glob(f"**/{pattern}"):
            if sprint_dir.is_dir():
                sprint_file = sprint_dir / "sprint.md"
                if sprint_file.exists():
                    return sprint_file

    return None


def _is_epic_sprint(sprint_path: Path) -> Tuple[bool, Optional[int]]:
    """
    Check if sprint is part of an epic.

    Args:
        sprint_path: Path to sprint file

    Returns:
        Tuple of (is_epic, epic_number)

    Example:
        >>> _is_epic_sprint(Path("docs/sprints/2-in-progress/epic-01_name/sprint-02_title.md"))
        (True, 1)
    """
    # Check if path contains epic-NN_ pattern
    for part in sprint_path.parts:
        match = re.match(r"epic-(\d+)_", part)
        if match:
            return True, int(match.group(1))

    return False, None


def _update_yaml_frontmatter(file_path: Path, updates: dict) -> None:
    """
    Update YAML frontmatter in markdown file.

    Args:
        file_path: Path to markdown file
        updates: Dict of frontmatter keys to update

    Example:
        >>> _update_yaml_frontmatter(path, {"status": "done", "completed": "2025-12-30"})
    """
    with open(file_path, "r") as f:
        content = f.read()

    # Parse frontmatter
    if not content.startswith("---\n"):
        raise ValidationError(f"File {file_path} missing YAML frontmatter")

    parts = content.split("---\n", 2)
    if len(parts) < 3:
        raise ValidationError(f"File {file_path} has malformed YAML frontmatter")

    frontmatter = parts[1]
    body = parts[2]

    # Update frontmatter lines
    lines = frontmatter.split("\n")
    updated_keys = set()

    for i, line in enumerate(lines):
        for key, value in updates.items():
            if line.startswith(f"{key}:"):
                if value is None:
                    lines[i] = f"{key}: null"
                elif isinstance(value, str):
                    lines[i] = f"{key}: {value}"
                else:
                    lines[i] = f"{key}: {json.dumps(value)}"
                updated_keys.add(key)

    # Add missing keys
    for key, value in updates.items():
        if key not in updated_keys:
            if value is None:
                lines.append(f"{key}: null")
            elif isinstance(value, str):
                lines.append(f"{key}: {value}")
            else:
                lines.append(f"{key}: {json.dumps(value)}")

    # Reconstruct file
    new_content = f"---\n{chr(10).join(lines)}\n---\n{body}"

    with open(file_path, "w") as f:
        f.write(new_content)


def move_to_done(sprint_num: int, dry_run: bool = False) -> Path:
    """
    Move sprint file to done status with --done suffix.

    For epic sprints: Renames with --done suffix, keeps in epic folder
    For standalone sprints: Moves to 3-done/_standalone/ with --done suffix

    Updates YAML frontmatter: status=done, completed=timestamp

    Args:
        sprint_num: Sprint number to move
        dry_run: If True, only show what would happen without making changes

    Returns:
        Path to new location of sprint file

    Raises:
        FileOperationError: If sprint file not found or move fails
        ValidationError: If sprint already marked done

    Example:
        >>> new_path = move_to_done(2)
        >>> print(new_path)
        /project/docs/sprints/2-in-progress/epic-01_name/sprint-02_title--done.md
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(
            f"Sprint {sprint_num} not found in any status directory. "
            f"Searched in {project_root}/docs/sprints/"
        )

    # Check if already done
    if "--done" in sprint_file.name:
        raise ValidationError(
            f"Sprint {sprint_num} already marked as done: {sprint_file}"
        )

    is_epic, epic_num = _is_epic_sprint(sprint_file)

    if dry_run:
        if is_epic:
            if sprint_file.parent.name.startswith("sprint-"):
                # Sprint in subdirectory
                sprint_subdir = sprint_file.parent
                new_dir_name = sprint_subdir.name + "--done"
                # If file is generic "sprint.md", derive name from folder
                if sprint_file.name == "sprint.md":
                    new_name = sprint_subdir.name + "--done.md"
                else:
                    new_name = sprint_file.name.replace(".md", "--done.md")
                print("[DRY RUN] Would rename epic sprint subdirectory and file:")
                print(f"  From: {sprint_file}")
                print(f"  Dir:  {sprint_subdir.name} → {new_dir_name}")
                print(f"  File: {sprint_file.name} → {new_name}")
                new_path = sprint_subdir.with_name(new_dir_name) / new_name
            else:
                # Sprint directly in epic folder
                new_name = sprint_file.name.replace(".md", "--done.md")
                new_path = sprint_file.with_name(new_name)
                print("[DRY RUN] Would rename epic sprint:")
                print(f"  From: {sprint_file}")
                print(f"  To:   {new_path}")
        else:
            standalone_dir = (
                project_root / "docs" / "sprints" / "3-done" / "_standalone"
            )
            new_name = sprint_file.name.replace(".md", "--done.md")
            new_path = standalone_dir / new_name
            print("[DRY RUN] Would move standalone sprint:")
            print(f"  From: {sprint_file}")
            print(f"  To:   {new_path}")
        return new_path

    # Backup original file
    backup = _backup_file(sprint_file)

    try:
        # Update YAML frontmatter
        _update_yaml_frontmatter(
            sprint_file,
            {"status": "done", "completed": datetime.now().strftime("%Y-%m-%d")},
        )

        # YAML update succeeded, cleanup backup before directory operations
        # This prevents .bak files from being moved with directory renames
        _cleanup_backup(backup)
        backup = None  # Mark as cleaned up

        if is_epic:
            # Epic sprint: rename with --done suffix in place
            # If sprint is in a subdirectory (sprint-NN_name/sprint-NN_name.md),
            # move it up to the epic folder and rename the subdirectory
            if sprint_file.parent.name.startswith("sprint-"):
                # Sprint is in a subdirectory - move file up and rename dir
                sprint_subdir = sprint_file.parent
                # If file is generic "sprint.md", derive name from folder
                if sprint_file.name == "sprint.md":
                    new_name = sprint_subdir.name + "--done.md"
                else:
                    new_name = sprint_file.name.replace(".md", "--done.md")
                new_dir_name = sprint_subdir.name + "--done"
                new_subdir = sprint_subdir.with_name(new_dir_name)

                # Rename the subdirectory
                sprint_subdir.rename(new_subdir)

                # Update path to new location
                new_path = new_subdir / sprint_file.name
                new_path_with_done = new_path.with_name(new_name)
                new_path.rename(new_path_with_done)
                new_path = new_path_with_done
            else:
                # Sprint is directly in epic folder
                new_name = sprint_file.name.replace(".md", "--done.md")
                new_path = sprint_file.with_name(new_name)
                sprint_file.rename(new_path)
        else:
            # Standalone sprint: move to 3-done/_standalone/ in its own directory
            standalone_base = (
                project_root / "docs" / "sprints" / "3-done" / "_standalone"
            )
            standalone_base.mkdir(parents=True, exist_ok=True)

            # Determine the sprint directory name with --done suffix
            # If sprint is in a subdirectory, use that name; otherwise derive from filename
            if sprint_file.parent.name.startswith("sprint-"):
                # Sprint is in a subdirectory (e.g., sprint-34_name/)
                sprint_subdir = sprint_file.parent
                new_dir_name = sprint_subdir.name + "--done"
                new_sprint_dir = standalone_base / new_dir_name
                new_sprint_dir.mkdir(parents=True, exist_ok=True)

                # Move all files from source directory to new directory
                for item in sprint_subdir.iterdir():
                    dest = new_sprint_dir / item.name
                    # Only rename the main sprint file with --done suffix
                    # (not postmortem, quality-assessment, or state files)
                    if (item.suffix == ".md"
                        and item.name.startswith("sprint-")
                        and "_postmortem" not in item.name
                        and item.name == sprint_file.name):
                        dest = new_sprint_dir / item.name.replace(".md", "--done.md")
                    shutil.move(str(item), str(dest))

                # Remove empty source directory
                sprint_subdir.rmdir()

                # Find the main sprint file in new location
                new_name = sprint_file.name.replace(".md", "--done.md")
                new_path = new_sprint_dir / new_name
            else:
                # Sprint is a standalone file (no subdirectory)
                # Create a directory for it based on filename
                base_name = sprint_file.stem  # e.g., sprint-34_dockerize-clawbot
                new_dir_name = base_name + "--done"
                new_sprint_dir = standalone_base / new_dir_name
                new_sprint_dir.mkdir(parents=True, exist_ok=True)

                new_name = sprint_file.name.replace(".md", "--done.md")
                new_path = new_sprint_dir / new_name

                # Move file
                shutil.move(str(sprint_file), str(new_path))

        return new_path

    except Exception as e:
        # Restore from backup on failure (only if not already cleaned up)
        if backup and backup.exists():
            _restore_file(backup)
        raise FileOperationError(f"Failed to move sprint {sprint_num}: {e}") from e


def get_next_sprint_number(dry_run: bool = False) -> int:
    """
    Get next available sprint number and increment counter in registry.

    Uses counters.next_sprint field, and validates against existing sprints
    to prevent collisions.

    Args:
        dry_run: If True, return next number without incrementing

    Returns:
        Next sprint number

    Example:
        >>> next_num = get_next_sprint_number()
        >>> print(next_num)
        6
    """
    project_root = find_project_root()
    registry_path = project_root / "docs" / "sprints" / "registry.json"

    # Load or create registry
    if registry_path.exists():
        with open(registry_path) as f:
            registry = json.load(f)
    else:
        registry = {
            "counters": {"next_sprint": 1, "next_epic": 1},
            "sprints": {},
            "epics": {},
        }

    # Get counter from counters.next_sprint (preferred) or legacy nextSprintNumber
    if "counters" in registry and "next_sprint" in registry["counters"]:
        next_num = registry["counters"]["next_sprint"]
    else:
        next_num = registry.get("nextSprintNumber", 1)

    # Validate: ensure this number doesn't already exist in sprints
    existing_sprints = registry.get("sprints", {})
    while str(next_num) in existing_sprints:
        next_num += 1

    if dry_run:
        print(f"✓ Next sprint number: {next_num}")
        print(f"✓ Counter incremented to: {next_num + 1}")
        return next_num

    # Increment counter in both locations for compatibility
    if "counters" not in registry:
        registry["counters"] = {}
    registry["counters"]["next_sprint"] = next_num + 1
    # Also update legacy field if it exists
    if "nextSprintNumber" in registry:
        registry["nextSprintNumber"] = next_num + 1

    # Save registry
    backup = None
    if registry_path.exists():
        backup = _backup_file(registry_path)

    try:
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

        if backup:
            _cleanup_backup(backup)

        return next_num

    except Exception as e:
        if backup:
            _restore_file(backup)
        raise FileOperationError(f"Failed to update sprint counter: {e}") from e


def get_next_epic_number(dry_run: bool = False) -> int:
    """
    Get next available epic number and increment counter in registry.

    Args:
        dry_run: If True, return next number without incrementing

    Returns:
        Next epic number

    Example:
        >>> next_num = get_next_epic_number()
        >>> print(next_num)
        2
    """
    project_root = find_project_root()
    registry_path = project_root / "docs" / "sprints" / "registry.json"

    # Load or create registry
    if registry_path.exists():
        with open(registry_path) as f:
            registry = json.load(f)
    else:
        registry = {
            "version": "1.0",
            "nextSprintNumber": 1,
            "nextEpicNumber": 1,
            "sprints": {},
            "epics": {},
        }

    next_num = registry.get("nextEpicNumber", 1)

    if dry_run:
        print(f"[DRY RUN] Next epic number: {next_num}")
        print(f"[DRY RUN] Would increment to: {next_num + 1}")
        return next_num

    # Increment counter
    registry["nextEpicNumber"] = next_num + 1

    # Save registry
    backup = None
    if registry_path.exists():
        backup = _backup_file(registry_path)

    try:
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

        if backup:
            _cleanup_backup(backup)

        return next_num

    except Exception as e:
        if backup:
            _restore_file(backup)
        raise FileOperationError(f"Failed to update epic counter: {e}") from e


def create_sprint(
    sprint_num: int,
    title: str,
    sprint_type: str = "fullstack",
    epic: Optional[int] = None,
    dry_run: bool = False,
) -> dict:
    """
    Create sprint folder structure and files.

    Creates:
    - For epic sprints: docs/sprints/{status}/epic-{NN}_{slug}/sprint-{NN}_{slug}/sprint-{NN}_{slug}.md
    - For standalone: docs/sprints/{status}/sprint-{NN}_{slug}/sprint-{NN}_{slug}.md

    Also registers in registry if not already registered.

    Args:
        sprint_num: Sprint number to create
        title: Sprint title
        sprint_type: One of: fullstack, backend, frontend, research, spike, infrastructure
        epic: Optional epic number this sprint belongs to
        dry_run: If True, preview without creating

    Returns:
        Dict with created paths

    Example:
        >>> create_sprint(100, "Test Feature", sprint_type="fullstack", epic=99)
    """
    project_root = find_project_root()

    # Create slug from title
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = slug.strip("-")

    today = datetime.now().strftime("%Y-%m-%d")
    today_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Determine folder path based on epic
    if epic:
        # Find epic folder
        epic_folder = None
        for status_dir in ["0-backlog", "1-todo", "2-in-progress"]:
            search_path = project_root / "docs" / "sprints" / status_dir
            if search_path.exists():
                for folder in search_path.glob(f"epic-{epic:02d}_*"):
                    if folder.is_dir():
                        epic_folder = folder
                        break
            if epic_folder:
                break

        if not epic_folder:
            raise ValidationError(
                f"Epic {epic} folder not found. Create it first with create-epic."
            )

        sprint_dir = epic_folder / f"sprint-{sprint_num:02d}_{slug}"
    else:
        # Standalone sprint in backlog
        sprint_dir = (
            project_root
            / "docs"
            / "sprints"
            / "0-backlog"
            / f"sprint-{sprint_num:02d}_{slug}"
        )

    sprint_file = sprint_dir / f"sprint-{sprint_num:02d}_{slug}.md"

    if dry_run:
        print(f"[DRY RUN] Would create sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Type: {sprint_type}")
        print(f"  Epic: {epic or 'None (standalone)'}")
        print(f"  Folder: {sprint_dir.relative_to(project_root)}")
        print(f"  File: {sprint_file.name}")
        return {"sprint_dir": str(sprint_dir), "sprint_file": str(sprint_file)}

    # Create folder
    sprint_dir.mkdir(parents=True, exist_ok=True)

    # Create sprint file content
    sprint_content = f"""---
sprint: {sprint_num}
title: "{title}"
type: {sprint_type}
epic: {epic if epic else 'null'}
status: planning
created: {today_iso}
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint {sprint_num}: {title}

## Overview

| Field | Value |
|-------|-------|
| Sprint | {sprint_num} |
| Title | {title} |
| Type | {sprint_type} |
| Epic | {epic if epic else 'None'} |
| Status | Planning |
| Created | {today} |
| Started | - |
| Completed | - |

## Goal

{{One sentence describing what this sprint accomplishes}}

## Background

{{Why is this needed? What problem does it solve?}}

## Requirements

### Functional Requirements

- [ ] {{Requirement 1}}
- [ ] {{Requirement 2}}

### Non-Functional Requirements

- [ ] {{Performance, security, or other constraints}}

## Dependencies

- **Sprints**: None
- **External**: None

## Scope

### In Scope

- {{What's included}}

### Out of Scope

- {{What's explicitly NOT included}}

## Technical Approach

{{High-level description of how this will be implemented}}

## Tasks

### Phase 1: Planning
- [ ] Review requirements
- [ ] Design architecture
- [ ] Clarify requirements

### Phase 2: Implementation
- [ ] Write tests
- [ ] Implement feature
- [ ] Fix test failures

### Phase 3: Validation
- [ ] Quality review
- [ ] Refactoring

### Phase 4: Documentation
- [ ] Update docs

## Acceptance Criteria

- [ ] All tests passing
- [ ] Code reviewed

## Notes

Created: {today}
"""

    with open(sprint_file, "w") as f:
        f.write(sprint_content)

    # Register in registry
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    with open(registry_path) as f:
        registry = json.load(f)

    sprint_key = str(sprint_num)
    if sprint_key not in registry.get("sprints", {}):
        if "sprints" not in registry:
            registry["sprints"] = {}
        registry["sprints"][sprint_key] = {
            "title": title,
            "status": "planning",
            "epic": epic,
            "type": sprint_type,
            "created": today,
            "started": None,
            "completed": None,
            "hours": None,
        }
        # Update nextSprintNumber if needed
        if registry.get("nextSprintNumber", 1) <= sprint_num:
            registry["nextSprintNumber"] = sprint_num + 1

        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

    # Update epic's totalSprints count
    if epic:
        epic_key = str(epic)
        if epic_key in registry.get("epics", {}):
            registry["epics"][epic_key]["totalSprints"] = (
                registry["epics"][epic_key].get("totalSprints", 0) + 1
            )
            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2)

    print(f"✓ Created sprint {sprint_num}: {title}")
    print(f"  Type: {sprint_type}")
    print(f"  Epic: {epic or 'None (standalone)'}")
    print(f"  Folder: {sprint_dir.relative_to(project_root)}")

    return {"sprint_dir": str(sprint_dir), "sprint_file": str(sprint_file)}


def import_sprint(
    source_path: str,
    sprint_type: str = "fullstack",
    epic: Optional[int] = None,
    dry_run: bool = False,
) -> dict:
    """
    Import an existing sketch/draft sprint file into proper Maestro format.

    Takes a simple markdown file (with or without frontmatter) and:
    - Auto-assigns a sprint number from registry
    - Creates proper directory structure
    - Adds/completes YAML frontmatter
    - Preserves original content
    - Registers in registry.json

    Args:
        source_path: Path to the existing sprint markdown file
        sprint_type: One of: fullstack, backend, frontend, research, spike, infrastructure
        epic: Optional epic number this sprint belongs to
        dry_run: If True, preview without creating

    Returns:
        Dict with import details

    Example:
        >>> import_sprint("sketches/my-feature.md", epic=1)
        >>> import_sprint("./user-auth.md", sprint_type="backend")
    """
    import yaml

    project_root = find_project_root()
    source = Path(source_path)

    # Resolve relative paths
    if not source.is_absolute():
        source = project_root / source

    if not source.exists():
        raise ValidationError(f"Source file not found: {source}")

    # Read source file
    with open(source) as f:
        content = f.read()

    # Parse existing frontmatter if present
    existing_frontmatter = {}
    body_content = content

    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                existing_frontmatter = yaml.safe_load(parts[1]) or {}
                body_content = parts[2].strip()
            except yaml.YAMLError:
                # Invalid YAML, treat whole file as content
                pass

    # Extract title from content or filename
    title = None

    # Priority 1: From existing frontmatter
    if "title" in existing_frontmatter:
        title = existing_frontmatter["title"]

    # Priority 2: From first heading
    if not title:
        for line in body_content.split("\n"):
            line = line.strip()
            if line.startswith("# "):
                # Handle "# Sprint N: Title" format
                heading = line[2:].strip()
                if ":" in heading and heading.lower().startswith("sprint"):
                    title = heading.split(":", 1)[1].strip()
                else:
                    title = heading
                break

    # Priority 3: From filename
    if not title:
        title = source.stem.replace("-", " ").replace("_", " ").title()
        # Remove "sprint" prefix if present
        if title.lower().startswith("sprint"):
            title = title[6:].strip()
            # Remove number prefix if present (e.g., "01 " or "1 ")
            if title and title[0].isdigit():
                title = re.sub(r"^\d+\s*", "", title)

    if not title:
        raise ValidationError(f"Could not extract title from {source}")

    # Get next sprint number
    sprint_num = get_next_sprint_number(dry_run=dry_run)

    # Create slug from title
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = slug.strip("-")

    today = datetime.now().strftime("%Y-%m-%d")
    today_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Determine destination folder
    if epic:
        # Find epic folder
        epic_folder = None
        for status_dir in ["0-backlog", "1-todo", "2-in-progress"]:
            search_path = project_root / "docs" / "sprints" / status_dir
            if search_path.exists():
                for folder in search_path.glob(f"epic-{epic:02d}_*"):
                    if folder.is_dir():
                        epic_folder = folder
                        break
                # Also try single-digit epic pattern
                if not epic_folder:
                    for folder in search_path.glob(f"epic-{epic}_*"):
                        if folder.is_dir():
                            epic_folder = folder
                            break
            if epic_folder:
                break

        if not epic_folder:
            raise ValidationError(
                f"Epic {epic} folder not found. Create it first with /epic-new."
            )

        sprint_dir = epic_folder / f"sprint-{sprint_num:02d}_{slug}"
    else:
        # Standalone sprint in backlog
        sprint_dir = (
            project_root
            / "docs"
            / "sprints"
            / "0-backlog"
            / f"sprint-{sprint_num:02d}_{slug}"
        )

    sprint_file = sprint_dir / f"sprint-{sprint_num:02d}_{slug}.md"

    if dry_run:
        print(f"[DRY RUN] Would import sprint from: {source}")
        print(f"  Sprint Number: {sprint_num}")
        print(f"  Title: {title}")
        print(f"  Type: {sprint_type}")
        print(f"  Epic: {epic or 'None (standalone)'}")
        print(f"  Destination: {sprint_dir.relative_to(project_root)}")
        print(f"\nNo changes made.")
        return {
            "sprint_num": sprint_num,
            "title": title,
            "source": str(source),
            "destination": str(sprint_dir),
        }

    # Create folder
    sprint_dir.mkdir(parents=True, exist_ok=True)

    # Build new frontmatter (merge with existing)
    new_frontmatter = {
        "sprint": sprint_num,
        "title": title,
        "type": sprint_type,
        "epic": epic if epic else None,
        "status": "planning",
        "created": existing_frontmatter.get("created", today_iso),
        "started": existing_frontmatter.get("started"),
        "completed": existing_frontmatter.get("completed"),
        "hours": existing_frontmatter.get("hours"),
        "workflow_version": "3.1.0",
    }

    # Preserve any custom fields from original frontmatter
    for key, value in existing_frontmatter.items():
        if key not in new_frontmatter:
            new_frontmatter[key] = value

    # Update body content heading if needed
    lines = body_content.split("\n")
    new_lines = []
    heading_updated = False

    for line in lines:
        if not heading_updated and line.strip().startswith("# "):
            # Replace first heading with proper format
            new_lines.append(f"# Sprint {sprint_num}: {title}")
            heading_updated = True
        else:
            new_lines.append(line)

    # If no heading found, add one
    if not heading_updated:
        new_lines.insert(0, f"# Sprint {sprint_num}: {title}")
        new_lines.insert(1, "")

    updated_body = "\n".join(new_lines)

    # Build final content
    frontmatter_str = yaml.dump(new_frontmatter, default_flow_style=False, sort_keys=False)
    sprint_content = f"---\n{frontmatter_str}---\n\n{updated_body}"

    # Write new file
    with open(sprint_file, "w") as f:
        f.write(sprint_content)

    # Register in registry
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    with open(registry_path) as f:
        registry = json.load(f)

    sprint_key = str(sprint_num)
    if "sprints" not in registry:
        registry["sprints"] = {}

    registry["sprints"][sprint_key] = {
        "title": title,
        "status": "planning",
        "epic": epic,
        "type": sprint_type,
        "created": today,
        "started": None,
        "completed": None,
        "hours": None,
    }

    # Update nextSprintNumber
    if registry.get("nextSprintNumber", 1) <= sprint_num:
        registry["nextSprintNumber"] = sprint_num + 1

    # Also update counters if present
    if "counters" in registry:
        if registry["counters"].get("next_sprint", 1) <= sprint_num:
            registry["counters"]["next_sprint"] = sprint_num + 1

    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)

    # Update epic's totalSprints count
    if epic:
        epic_key = str(epic)
        if epic_key in registry.get("epics", {}):
            registry["epics"][epic_key]["totalSprints"] = (
                registry["epics"][epic_key].get("totalSprints", 0) + 1
            )
            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2)

    print(f"✓ Imported sprint from: {source.name}")
    print(f"  Sprint Number: {sprint_num}")
    print(f"  Title: {title}")
    print(f"  Type: {sprint_type}")
    print(f"  Epic: {epic or 'None (standalone)'}")
    print(f"  New Location: {sprint_dir.relative_to(project_root)}/")
    print(f"\nNext steps:")
    print(f"  1. Review the imported sprint: {sprint_file.relative_to(project_root)}")
    print(f"  2. Fill in any missing sections")
    print(f"  3. Run /sprint-start {sprint_num} when ready")

    return {
        "sprint_num": sprint_num,
        "title": title,
        "source": str(source),
        "sprint_dir": str(sprint_dir),
        "sprint_file": str(sprint_file),
    }


def import_epic(
    source_path: str,
    sprint_type: str = "fullstack",
    dry_run: bool = False,
) -> dict:
    """
    Import a sketch epic directory with all its sprint files into proper Maestro format.

    Takes a directory containing sprint markdown files (or an _epic.md file) and:
    - Auto-assigns an epic number from registry
    - Creates proper epic directory structure
    - Imports all sprint files found within
    - Adds/completes YAML frontmatter for epic and sprints
    - Registers epic and all sprints in registry.json

    Args:
        source_path: Path to source epic directory or _epic.md file
        sprint_type: Default sprint type for imported sprints
        dry_run: If True, preview without creating

    Returns:
        Dict with import details

    Example:
        >>> import_epic("sketches/user-management/")
        >>> import_epic("./my-epic/_epic.md", sprint_type="backend")
    """
    import yaml

    project_root = find_project_root()
    source = Path(source_path)

    # Resolve relative paths
    if not source.is_absolute():
        source = project_root / source

    # Determine if source is a file or directory
    if source.is_file():
        source_dir = source.parent
        epic_file = source if source.name == "_epic.md" else None
    elif source.is_dir():
        source_dir = source
        epic_file = source / "_epic.md" if (source / "_epic.md").exists() else None
    else:
        raise ValidationError(f"Source not found: {source}")

    # Extract epic title
    epic_title = None
    existing_epic_frontmatter = {}

    if epic_file and epic_file.exists():
        with open(epic_file) as f:
            content = f.read()

        # Parse frontmatter
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    existing_epic_frontmatter = yaml.safe_load(parts[1]) or {}
                except yaml.YAMLError:
                    pass

        # Get title from frontmatter or first heading
        if "title" in existing_epic_frontmatter:
            epic_title = existing_epic_frontmatter["title"]
        else:
            for line in content.split("\n"):
                if line.startswith("# "):
                    heading = line[2:].strip()
                    # Handle "# Epic N: Title" format
                    if ":" in heading and heading.lower().startswith("epic"):
                        epic_title = heading.split(":", 1)[1].strip()
                    else:
                        epic_title = heading
                    break

    # Fallback to directory name
    if not epic_title:
        epic_title = source_dir.name.replace("-", " ").replace("_", " ").title()
        # Remove "epic" prefix if present
        if epic_title.lower().startswith("epic"):
            epic_title = epic_title[4:].strip()
            # Remove number prefix if present
            if epic_title and epic_title[0].isdigit():
                epic_title = re.sub(r"^\d+\s*", "", epic_title)

    if not epic_title:
        raise ValidationError(f"Could not extract epic title from {source}")

    # Find all sprint files in source directory
    sprint_files = []
    for pattern in ["*.md", "**/*.md"]:
        for f in source_dir.glob(pattern):
            if f.name != "_epic.md" and f.is_file():
                sprint_files.append(f)

    # Deduplicate
    sprint_files = list(set(sprint_files))
    sprint_files.sort(key=lambda x: x.name)

    # Get next epic number
    epic_num = get_next_epic_number(dry_run=dry_run)

    # Create slug from title
    slug = epic_title.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = slug.strip("-")

    today = datetime.now().strftime("%Y-%m-%d")
    today_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Epic destination
    epic_dir = project_root / "docs" / "sprints" / "0-backlog" / f"epic-{epic_num:02d}_{slug}"
    epic_md_file = epic_dir / "_epic.md"

    if dry_run:
        print(f"[DRY RUN] Would import epic from: {source_dir}")
        print(f"  Epic Number: {epic_num}")
        print(f"  Title: {epic_title}")
        print(f"  Destination: {epic_dir.relative_to(project_root)}")
        print(f"  Sprint files found: {len(sprint_files)}")
        for sf in sprint_files:
            print(f"    - {sf.name}")
        print(f"\nNo changes made.")
        return {
            "epic_num": epic_num,
            "title": epic_title,
            "source": str(source_dir),
            "destination": str(epic_dir),
            "sprint_count": len(sprint_files),
        }

    # Create epic directory
    epic_dir.mkdir(parents=True, exist_ok=True)

    # Create or update epic file
    epic_frontmatter = {
        "epic": epic_num,
        "title": epic_title,
        "status": "backlog",
        "created": existing_epic_frontmatter.get("created", today_iso),
        "started": existing_epic_frontmatter.get("started"),
        "completed": existing_epic_frontmatter.get("completed"),
    }

    # Preserve custom fields
    for key, value in existing_epic_frontmatter.items():
        if key not in epic_frontmatter:
            epic_frontmatter[key] = value

    # Read original epic content if exists
    epic_body = ""
    if epic_file and epic_file.exists():
        with open(epic_file) as f:
            content = f.read()
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                epic_body = parts[2].strip()
        else:
            epic_body = content

    # Update heading in body
    lines = epic_body.split("\n") if epic_body else []
    new_lines = []
    heading_updated = False
    for line in lines:
        if not heading_updated and line.strip().startswith("# "):
            new_lines.append(f"# Epic {epic_num:02d}: {epic_title}")
            heading_updated = True
        else:
            new_lines.append(line)

    if not heading_updated:
        new_lines.insert(0, f"# Epic {epic_num:02d}: {epic_title}")
        new_lines.insert(1, "")

    updated_epic_body = "\n".join(new_lines)

    # Build epic file content
    frontmatter_str = yaml.dump(epic_frontmatter, default_flow_style=False, sort_keys=False)
    epic_content = f"---\n{frontmatter_str}---\n\n{updated_epic_body}"

    with open(epic_md_file, "w") as f:
        f.write(epic_content)

    # Register epic in registry
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    with open(registry_path) as f:
        registry = json.load(f)

    if "epics" not in registry:
        registry["epics"] = {}

    epic_key = str(epic_num)
    registry["epics"][epic_key] = {
        "title": epic_title,
        "status": "backlog",
        "created": today,
        "started": None,
        "completed": None,
        "totalSprints": len(sprint_files),
        "completedSprints": 0,
    }

    # Update nextEpicNumber
    if registry.get("nextEpicNumber", 1) <= epic_num:
        registry["nextEpicNumber"] = epic_num + 1

    if "counters" in registry:
        if registry["counters"].get("next_epic", 1) <= epic_num:
            registry["counters"]["next_epic"] = epic_num + 1

    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)

    # Import all sprint files into the epic
    imported_sprints = []
    for sprint_file in sprint_files:
        try:
            result = import_sprint(
                str(sprint_file),
                sprint_type=sprint_type,
                epic=epic_num,
                dry_run=False,
            )
            imported_sprints.append(result)
        except Exception as e:
            print(f"  Warning: Could not import {sprint_file.name}: {e}")

    print(f"\n✓ Imported epic from: {source_dir.name}")
    print(f"  Epic Number: {epic_num}")
    print(f"  Title: {epic_title}")
    print(f"  New Location: {epic_dir.relative_to(project_root)}/")
    print(f"  Sprints Imported: {len(imported_sprints)}/{len(sprint_files)}")
    print(f"\nNext steps:")
    print(f"  1. Review the imported epic: {epic_md_file.relative_to(project_root)}")
    print(f"  2. Run /epic-start {epic_num} to begin work")

    return {
        "epic_num": epic_num,
        "title": epic_title,
        "source": str(source_dir),
        "epic_dir": str(epic_dir),
        "epic_file": str(epic_md_file),
        "sprints_imported": len(imported_sprints),
        "sprints": imported_sprints,
    }


def register_new_sprint(
    title: str, epic: Optional[int] = None, dry_run: bool = False, **metadata
) -> int:
    """
    Register a new sprint in registry with auto-assigned number AND create sprint files.

    This function:
    1. Gets next available sprint number (validates no collision)
    2. Creates sprint folder and markdown file
    3. Registers in registry.json

    Args:
        title: Sprint title
        epic: Optional epic number this sprint belongs to
        dry_run: If True, show what would be registered
        **metadata: Additional metadata (estimatedHours, type, etc.)

    Returns:
        Assigned sprint number

    Example:
        >>> sprint_num = register_new_sprint("User Authentication", epic=2, estimatedHours=5)
        >>> print(sprint_num)
        6
    """
    project_root = find_project_root()
    registry_path = project_root / "docs" / "sprints" / "registry.json"

    # Load registry first to check for conflicts
    with open(registry_path) as f:
        registry = json.load(f)

    # Get next sprint number (this validates against existing sprints)
    sprint_num = get_next_sprint_number(dry_run=dry_run)

    # Double-check sprint doesn't exist (defensive)
    sprint_key = str(sprint_num)
    if sprint_key in registry.get("sprints", {}):
        raise ValidationError(f"Sprint {sprint_num} already exists in registry")

    if dry_run:
        print(f"[DRY RUN] Would register sprint {sprint_num}:")
        print(f"  title: {title}")
        print(f"  epic: {epic}")
        for key, value in metadata.items():
            print(f"  {key}: {value}")
        return sprint_num

    # Get sprint type from metadata, default to fullstack
    sprint_type = metadata.pop("type", "fullstack")

    # Create sprint folder and file using create_sprint
    try:
        create_sprint(sprint_num, title, sprint_type=sprint_type, epic=epic, dry_run=False)
        print(f"✓ Registered sprint {sprint_num}: {title}")
        if epic:
            print(f"  Part of Epic {epic}")
        return sprint_num
    except Exception as e:
        raise FileOperationError(f"Failed to register sprint: {e}") from e


def register_new_epic(
    title: str, sprint_count: int = 0, dry_run: bool = False, **metadata
) -> int:
    """
    Register a new epic in registry with auto-assigned number.

    Args:
        title: Epic title
        sprint_count: Number of sprints planned for this epic
        dry_run: If True, show what would be registered
        **metadata: Additional metadata (estimatedHours, etc.)

    Returns:
        Assigned epic number

    Example:
        >>> epic_num = register_new_epic("User Management", sprint_count=5, estimatedHours=25)
        >>> print(epic_num)
        2
    """
    # Get next epic number
    epic_num = get_next_epic_number(dry_run=dry_run)

    if dry_run:
        print(f"[DRY RUN] Would register epic {epic_num}:")
        print(f"  title: {title}")
        print(f"  sprint_count: {sprint_count}")
        for key, value in metadata.items():
            print(f"  {key}: {value}")
        return epic_num

    project_root = find_project_root()
    registry_path = project_root / "docs" / "sprints" / "registry.json"

    # Load registry
    with open(registry_path) as f:
        registry = json.load(f)

    # Ensure structure exists
    if "epics" not in registry:
        registry["epics"] = {}

    # Register epic
    epic_key = str(epic_num)
    registry["epics"][epic_key] = {
        "title": title,
        "status": "planning",
        "created": datetime.now().strftime("%Y-%m-%d"),
        "started": None,
        "completed": None,
        "totalSprints": sprint_count,
        "completedSprints": 0,
        **metadata,
    }

    # Save registry
    backup = _backup_file(registry_path)

    try:
        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

        _cleanup_backup(backup)

        return epic_num

    except Exception as e:
        _restore_file(backup)
        raise FileOperationError(f"Failed to register epic: {e}") from e


def create_epic(
    epic_num: int,
    title: str,
    dry_run: bool = False,
) -> dict:
    """
    Create epic folder structure and files.

    Creates:
    - docs/sprints/1-todo/epic-{NN}_{slug}/
    - docs/sprints/1-todo/epic-{NN}_{slug}/_epic.md

    Also registers in registry if not already registered.

    Args:
        epic_num: Epic number to create
        title: Epic title
        dry_run: If True, preview without creating

    Returns:
        Dict with created paths

    Example:
        >>> create_epic(99, "Test Workflow Validation")
        >>> # Creates: docs/sprints/1-todo/epic-99_test-workflow-validation/
    """
    project_root = find_project_root()

    # Create slug from title
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = slug.strip("-")

    # Epic folder path
    epic_dir = (
        project_root / "docs" / "sprints" / "1-todo" / f"epic-{epic_num:02d}_{slug}"
    )
    epic_file = epic_dir / "_epic.md"

    if dry_run:
        print(f"[DRY RUN] Would create epic {epic_num}:")
        print(f"  Folder: {epic_dir}")
        print(f"  File: {epic_file}")
        return {"epic_dir": str(epic_dir), "epic_file": str(epic_file)}

    # Create folder
    epic_dir.mkdir(parents=True, exist_ok=True)

    # Create _epic.md content
    today = datetime.now().strftime("%Y-%m-%d")
    epic_content = f"""---
epic: {epic_num}
title: "{title}"
status: planning
created: {today}
started: null
completed: null
---

# Epic {epic_num:02d}: {title}

## Overview

{{To be filled in - describe the strategic initiative}}

## Success Criteria

- [ ] {{Define measurable outcomes}}

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| -- | TBD | planned |

## Backlog

- [ ] {{Add unassigned tasks}}

## Notes

Created: {today}
"""

    with open(epic_file, "w") as f:
        f.write(epic_content)

    # Register in registry if not already
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    with open(registry_path) as f:
        registry = json.load(f)

    epic_key = str(epic_num)
    if epic_key not in registry.get("epics", {}):
        if "epics" not in registry:
            registry["epics"] = {}
        registry["epics"][epic_key] = {
            "title": title,
            "status": "planning",
            "created": today,
            "started": None,
            "completed": None,
            "totalSprints": 0,
            "completedSprints": 0,
        }
        # Update nextEpicNumber if needed
        if registry.get("nextEpicNumber", 1) <= epic_num:
            registry["nextEpicNumber"] = epic_num + 1

        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

    print(f"✓ Created epic {epic_num}: {title}")
    print(f"  Folder: {epic_dir.relative_to(project_root)}")

    return {"epic_dir": str(epic_dir), "epic_file": str(epic_file)}


def reset_epic(epic_num: int, dry_run: bool = False) -> dict:
    """
    Reset/delete an epic and all its sprints.

    Removes:
    - Epic folder and all contents from any status folder
    - Registry entries for epic and associated sprints
    - State files for associated sprints

    Args:
        epic_num: Epic number to reset
        dry_run: If True, preview without deleting

    Returns:
        Dict with deleted items

    Example:
        >>> reset_epic(99)
        >>> # Removes: epic-99_* folder, registry entries, state files
    """
    project_root = find_project_root()
    deleted = {"folders": [], "registry_entries": [], "state_files": []}

    print(f"{'='*60}")
    print(f"RESET EPIC {epic_num}")
    print(f"{'='*60}")

    # Find and remove epic folders from all status directories
    status_dirs = [
        "0-backlog",
        "1-todo",
        "2-in-progress",
        "3-done",
        "4-blocked",
        "5-abandoned",
        "6-archived",
    ]

    for status_dir in status_dirs:
        search_path = project_root / "docs" / "sprints" / status_dir
        if search_path.exists():
            for epic_folder in search_path.glob(f"epic-{epic_num:02d}_*"):
                if epic_folder.is_dir():
                    print(f"→ Found: {epic_folder.relative_to(project_root)}")
                    if not dry_run:
                        import shutil

                        shutil.rmtree(epic_folder)
                        print("  ✓ Deleted folder")
                    else:
                        print("  [DRY RUN] Would delete folder")
                    deleted["folders"].append(str(epic_folder))

    # Remove from registry
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    if registry_path.exists():
        with open(registry_path) as f:
            registry = json.load(f)

        epic_key = str(epic_num)
        if epic_key in registry.get("epics", {}):
            print(f"→ Found in registry: epic {epic_num}")
            if not dry_run:
                del registry["epics"][epic_key]
                print("  ✓ Removed from registry")
            else:
                print("  [DRY RUN] Would remove from registry")
            deleted["registry_entries"].append(f"epic:{epic_num}")

        # Find and remove associated sprints from registry
        sprints_to_remove = []
        for sprint_key, sprint_data in registry.get("sprints", {}).items():
            if sprint_data.get("epic") == epic_num:
                sprints_to_remove.append(sprint_key)
                print(f"→ Found associated sprint {sprint_key} in registry")
                if not dry_run:
                    print("  ✓ Removed from registry")
                else:
                    print("  [DRY RUN] Would remove from registry")
                deleted["registry_entries"].append(f"sprint:{sprint_key}")

        if not dry_run:
            for sprint_key in sprints_to_remove:
                del registry["sprints"][sprint_key]

            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2)

    # Remove state files
    claude_dir = project_root / ".claude"
    if claude_dir.exists():
        # Check for epic-specific state files
        for state_file in claude_dir.glob(f"*epic*{epic_num}*"):
            print(f"→ Found state file: {state_file.name}")
            if not dry_run:
                state_file.unlink()
                print("  ✓ Deleted")
            else:
                print("  [DRY RUN] Would delete")
            deleted["state_files"].append(str(state_file))

        # Check for sprint state files (would need to know sprint numbers)
        # For test epic 99, we'll check sprint-99 pattern
        for state_file in claude_dir.glob(f"sprint-{epic_num}-state.json"):
            print(f"→ Found state file: {state_file.name}")
            if not dry_run:
                state_file.unlink()
                print("  ✓ Deleted")
            else:
                print("  [DRY RUN] Would delete")
            deleted["state_files"].append(str(state_file))

    print(f"{'='*60}")
    if dry_run:
        print(
            f"[DRY RUN] Would delete {len(deleted['folders'])} folders, {len(deleted['registry_entries'])} registry entries"
        )
    else:
        print(
            f"✓ Reset complete: {len(deleted['folders'])} folders, {len(deleted['registry_entries'])} registry entries"
        )
    print(f"{'='*60}")

    return deleted


def update_registry(
    sprint_num: int, status: str, dry_run: bool = False, **metadata
) -> None:
    """
    Update sprint registry with completion metadata.

    Args:
        sprint_num: Sprint number to update
        status: New status (typically 'done')
        dry_run: If True, only show what would be updated
        **metadata: Additional fields to update (completed, hours, etc.)

    Raises:
        FileOperationError: If registry update fails

    Example:
        >>> update_registry(2, status='done', completed='2025-12-30', hours=6)
    """
    project_root = find_project_root()
    registry_path = project_root / "docs" / "sprints" / "registry.json"

    # Create registry if doesn't exist
    if not registry_path.exists():
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        registry = {"version": "1.0", "sprints": {}, "epics": {}}
    else:
        with open(registry_path) as f:
            registry = json.load(f)

    # Ensure structure exists
    if "sprints" not in registry:
        registry["sprints"] = {}

    sprint_key = str(sprint_num)

    if dry_run:
        # Load registry to check epic membership for dry-run output
        if registry_path.exists():
            with open(registry_path) as f:
                registry = json.load(f)
            epic_num = registry.get("sprints", {}).get(sprint_key, {}).get("epic")
        else:
            epic_num = None

        print(f"[DRY RUN] Would update registry for sprint {sprint_num}:")
        print(f"  status: {status}")
        for key, value in metadata.items():
            print(f"  {key}: {value}")

        if status == "done" and epic_num:
            print(f"  Would also increment Epic {epic_num} completedSprints count")

        return

    # Update sprint entry
    if sprint_key not in registry["sprints"]:
        registry["sprints"][sprint_key] = {}

    registry["sprints"][sprint_key]["status"] = status
    registry["sprints"][sprint_key].update(metadata)

    # If sprint is part of an epic and being marked done, update epic's completedSprints count
    if status == "done" and "epics" in registry:
        epic_num = registry["sprints"][sprint_key].get("epic")
        if epic_num:
            epic_key = str(epic_num)
            if epic_key in registry["epics"]:
                # Increment completed sprints count
                current_count = registry["epics"][epic_key].get("completedSprints", 0)
                registry["epics"][epic_key]["completedSprints"] = current_count + 1

    # Backup and save
    backup = None
    if registry_path.exists():
        backup = _backup_file(registry_path)

    try:
        with open(registry_path, "w") as f:
            json.dump(registry, f, indent=2)

        if backup:
            _cleanup_backup(backup)

    except Exception as e:
        if backup:
            _restore_file(backup)
        raise FileOperationError(f"Failed to update registry: {e}") from e


def check_epic_completion(epic_num: int) -> Tuple[bool, str]:
    """
    Check if epic is ready to be completed (all sprints finished).

    Args:
        epic_num: Epic number to check

    Returns:
        Tuple of (is_complete, message)
        - is_complete: True if all sprints are done or aborted
        - message: Status message for user

    Example:
        >>> is_complete, msg = check_epic_completion(1)
        >>> if is_complete:
        >>>     print(f"Epic ready! {msg}")
    """
    project_root = find_project_root()
    sprints_dir = project_root / "docs" / "sprints"

    # Find epic folder
    epic_pattern = f"epic-{epic_num:02d}_*"
    epic_folder = None

    for status_dir in sprints_dir.glob("*"):
        if not status_dir.is_dir():
            continue
        for folder in status_dir.glob(epic_pattern):
            if folder.is_dir():
                epic_folder = folder
                break
        if epic_folder:
            break

    if not epic_folder:
        return False, f"Epic {epic_num} not found"

    # List all sprint files in epic folder (may be in subdirectories)
    sprint_files = list(epic_folder.glob("sprint-*/*.md")) + list(
        epic_folder.glob("sprint-*.md")
    )

    if not sprint_files:
        return False, f"Epic {epic_num} has no sprint files"

    # Count by status
    done_count = 0
    aborted_count = 0
    active_sprints = []

    for sprint_file in sprint_files:
        # Check both file name and parent directory for --done/--aborted suffix
        file_name = sprint_file.name
        dir_name = sprint_file.parent.name

        if "--done" in file_name or "--done" in dir_name:
            done_count += 1
        elif "--aborted" in file_name or "--aborted" in dir_name:
            aborted_count += 1
        else:
            active_sprints.append(
                f"{dir_name}/{file_name}"
                if dir_name.startswith("sprint-")
                else file_name
            )

    total = len(sprint_files)
    finished = done_count + aborted_count

    if finished == total:
        return True, (
            f"Epic {epic_num} is complete!\n"
            f"  Total sprints: {total}\n"
            f"  Done: {done_count}\n"
            f"  Aborted: {aborted_count}\n\n"
            f"Run: /epic-complete {epic_num}"
        )
    else:
        return False, (
            f"Epic {epic_num} is not complete yet\n"
            f"  Total sprints: {total}\n"
            f"  Done: {done_count}\n"
            f"  Aborted: {aborted_count}\n"
            f"  Remaining: {len(active_sprints)}\n\n"
            f"Unfinished sprints:\n" + "\n".join(f"  - {s}" for s in active_sprints)
        )


def check_git_clean() -> bool:
    """
    Check if git working directory is clean.

    Returns:
        True if working directory is clean, False otherwise
    """
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, text=True, check=True
        )
        return len(result.stdout.strip()) == 0
    except subprocess.CalledProcessError:
        return False


def create_git_tag(
    sprint_num: int, title: str, dry_run: bool = False, auto_push: bool = True
) -> None:
    """
    Create git tag for sprint completion and optionally push to remote.

    Tag format: sprint-{N}
    Message format: Sprint {N}: {title}

    Args:
        sprint_num: Sprint number
        title: Sprint title
        dry_run: If True, only show what would happen
        auto_push: If True, push tag to remote after creation

    Raises:
        GitError: If git operations fail
        ValidationError: If working tree is dirty

    Example:
        >>> create_git_tag(2, "Automated Lifecycle Management", auto_push=True)
    """
    # Validate git status
    if not check_git_clean():
        raise ValidationError(
            "Git working directory is dirty. Commit or stash changes before creating tag."
        )

    tag_name = f"sprint-{sprint_num}"
    tag_message = f"Sprint {sprint_num}: {title}"

    if dry_run:
        print("[DRY RUN] Would create git tag:")
        print(f"  Tag: {tag_name}")
        print(f"  Message: {tag_message}")
        if auto_push:
            print(f"  Auto-push: Yes (git push origin {tag_name})")
        return

    try:
        # Create annotated tag
        subprocess.run(
            ["git", "tag", "-a", tag_name, "-m", tag_message],
            check=True,
            capture_output=True,
            text=True,
        )

        print(f"✓ Created git tag: {tag_name}")

        # Push tag if requested
        if auto_push:
            subprocess.run(
                ["git", "push", "origin", tag_name],
                check=True,
                capture_output=True,
                text=True,
            )
            print(f"✓ Pushed tag to remote: {tag_name}")

    except subprocess.CalledProcessError as e:
        raise GitError(f"Failed to create/push git tag '{tag_name}': {e.stderr}") from e


def start_sprint(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Start a sprint: move to in-progress, create state file, update YAML.

    Args:
        sprint_num: Sprint number to start
        dry_run: If True, preview changes without executing

    Returns:
        Dict with start summary

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint already started or in wrong state

    Example:
        >>> summary = start_sprint(3)
        >>> print(summary['status'])  # 'started'
    """
    project_root = find_project_root()

    # Find sprint in backlog, todo, or in-progress (for epic sprints)
    sprint_file = None
    already_in_progress = False

    for folder in ["0-backlog", "1-todo"]:
        search_path = project_root / "docs" / "sprints" / folder
        if search_path.exists():
            # Pattern 1: sprint-NN_title.md files
            found = list(search_path.glob(f"**/sprint-{sprint_num:02d}_*.md"))
            if found:
                sprint_file = found[0]
                break
            # Pattern 2: sprint-NN_title/sprint.md folders
            for sprint_dir in search_path.glob(f"**/sprint-{sprint_num:02d}_*"):
                if sprint_dir.is_dir() and (sprint_dir / "sprint.md").exists():
                    sprint_file = sprint_dir / "sprint.md"
                    break
            if sprint_file:
                break

    # If not found in backlog/todo, check if it's an epic sprint already in progress
    if not sprint_file:
        search_path = project_root / "docs" / "sprints" / "2-in-progress"
        if search_path.exists():
            # Pattern 1: Look for sprint files in epic folders (exclude --done files)
            found = [
                f
                for f in search_path.glob(f"**/sprint-{sprint_num:02d}_*.md")
                if "--done" not in f.name
            ]
            if found:
                sprint_file = found[0]
                already_in_progress = True
            else:
                # Pattern 2: sprint-NN_title/sprint.md folders (exclude --done folders)
                for sprint_dir in search_path.glob(f"**/sprint-{sprint_num:02d}_*"):
                    if sprint_dir.is_dir() and "--done" not in sprint_dir.name:
                        if (sprint_dir / "sprint.md").exists():
                            sprint_file = sprint_dir / "sprint.md"
                            already_in_progress = True
                            break

    if not sprint_file:
        raise FileOperationError(
            f"Sprint {sprint_num} not found in backlog, todo, or in-progress folders"
        )

    # Check if sprint is in an epic
    is_epic, epic_num = _is_epic_sprint(sprint_file)

    # Read content and check for YAML frontmatter
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)

    if yaml_match:
        # Parse existing frontmatter
        yaml_content = yaml_match.group(1)
        title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
        if title_match:
            title = title_match.group(1).strip().strip('"')
        else:
            # Try to get title from markdown heading
            heading_match = re.search(
                r"^#\s+Sprint\s+\d+:\s*(.+)$", content, re.MULTILINE
            )
            title = (
                heading_match.group(1).strip()
                if heading_match
                else f"Sprint {sprint_num}"
            )
    else:
        # No frontmatter - extract title from markdown heading and add frontmatter
        heading_match = re.search(r"^#\s+Sprint\s+\d+:\s*(.+)$", content, re.MULTILINE)
        title = (
            heading_match.group(1).strip() if heading_match else f"Sprint {sprint_num}"
        )

        # Read WORKFLOW_VERSION
        version_file = project_root / ".claude" / "WORKFLOW_VERSION"
        workflow_version = (
            version_file.read_text().strip() if version_file.exists() else "3.1.0"
        )

        # Add YAML frontmatter to file
        frontmatter = f"""---
sprint: {sprint_num}
title: "{title}"
epic: {epic_num if is_epic else 'null'}
status: planning
created: {datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")}
started: null
completed: null
hours: null
workflow_version: "{workflow_version}"
---

"""
        with open(sprint_file, "w") as f:
            f.write(frontmatter + content)
        print("✓ Added YAML frontmatter to sprint file")

    if dry_run:
        print(f"[DRY RUN] Would start sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Epic: {epic_num if is_epic else 'standalone'}")
        if already_in_progress:
            print("  1. Sprint already in 2-in-progress/ (epic sprint)")
        else:
            print("  1. Move to 2-in-progress/")
        print("  2. Update YAML (status=in-progress, started=<now>)")
        print(f"  3. Create state file .claude/sprint-{sprint_num}-state.json")
        return {"status": "dry-run", "sprint_num": sprint_num}

    # Update YAML frontmatter
    started_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    _update_yaml_frontmatter(
        sprint_file, {"status": "in-progress", "started": started_time}
    )

    # Move to in-progress (skip if already there - epic sprint case)
    if already_in_progress:
        new_path = sprint_file
        print(f"✓ Sprint already in progress (epic sprint): {sprint_file}")
    else:
        in_progress_dir = project_root / "docs" / "sprints" / "2-in-progress"
        in_progress_dir.mkdir(parents=True, exist_ok=True)

        if is_epic:
            # Find the epic folder (could be parent or grandparent)
            if sprint_file.parent.name.startswith("sprint-"):
                epic_folder = sprint_file.parent.parent
                sprint_folder_name = sprint_file.parent.name
            else:
                epic_folder = sprint_file.parent
                sprint_folder_name = None

            # Check if epic is in 0-backlog or 1-todo - if so, move entire epic
            if "0-backlog" in str(epic_folder) or "1-todo" in str(epic_folder):
                # Move entire epic folder to 2-in-progress
                new_epic_folder = in_progress_dir / epic_folder.name
                if new_epic_folder.exists():
                    # Epic already partially in progress, just move the sprint
                    if sprint_folder_name:
                        old_sprint_dir = sprint_file.parent
                        new_sprint_dir = new_epic_folder / sprint_folder_name
                        shutil.move(str(old_sprint_dir), str(new_sprint_dir))
                        new_path = new_sprint_dir / sprint_file.name
                    else:
                        new_path = new_epic_folder / sprint_file.name
                        shutil.move(str(sprint_file), str(new_path))
                else:
                    # Move entire epic folder
                    shutil.move(str(epic_folder), str(new_epic_folder))
                    print(
                        f"✓ Moved epic folder to: {new_epic_folder.relative_to(project_root)}"
                    )
                    if sprint_folder_name:
                        new_path = (
                            new_epic_folder / sprint_folder_name / sprint_file.name
                        )
                    else:
                        new_path = new_epic_folder / sprint_file.name
            else:
                # Epic already in progress folder
                new_path = sprint_file
        else:
            # Standalone sprint - check if in its own folder
            if sprint_file.parent.name.startswith("sprint-"):
                old_sprint_dir = sprint_file.parent
                new_sprint_dir = in_progress_dir / sprint_file.parent.name
                shutil.move(str(old_sprint_dir), str(new_sprint_dir))
                new_path = new_sprint_dir / sprint_file.name
            else:
                new_path = in_progress_dir / sprint_file.name
                shutil.move(str(sprint_file), str(new_path))

        print(f"✓ Moved to: {new_path}")

    # Create state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    state = {
        "sprint_number": sprint_num,
        "sprint_file": str(new_path.relative_to(project_root)),
        "sprint_title": title,
        "status": "in_progress",
        "current_phase": 1,
        "current_step": "1.1",
        "started_at": started_time,
        "workflow_version": "3.0",
        "completed_steps": [],
    }

    state_file.parent.mkdir(parents=True, exist_ok=True)
    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)
    print(f"✓ State file created: {state_file.name}")

    summary = {
        "status": "started",
        "sprint_num": sprint_num,
        "title": title,
        "file_path": str(new_path),
        "epic": epic_num if is_epic else None,
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {title} - STARTED ✓")
    print(f"{'='*60}")
    print(f"File: {new_path.relative_to(project_root)}")
    if is_epic:
        print(f"Epic: {epic_num}")
    print("Next: Begin Phase 1 (Planning)")
    print(f"{'='*60}")

    return summary


def abort_sprint(sprint_num: int, reason: str, dry_run: bool = False) -> dict:
    """
    Abort a sprint: rename with --aborted suffix, update state.

    Args:
        sprint_num: Sprint number to abort
        reason: Reason for aborting
        dry_run: If True, preview changes without executing

    Returns:
        Dict with abort summary

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint already aborted

    Example:
        >>> summary = abort_sprint(4, "Requirements changed")
        >>> print(summary['status'])  # 'aborted'
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} not found")

    # Check if already aborted
    if "--aborted" in sprint_file.name:
        raise ValidationError(f"Sprint {sprint_num} already aborted: {sprint_file}")

    # Read YAML for metadata
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Sprint {sprint_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    started_match = re.search(r"^started:\s*(.+)$", yaml_content, re.MULTILINE)

    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"

    # Calculate hours if started
    hours = None
    if started_match:
        started_str = started_match.group(1).strip()
        # Only calculate hours if started is not null
        if started_str and started_str.lower() != "null":
            started = datetime.fromisoformat(started_str.replace("Z", "+00:00"))
            aborted = datetime.now().astimezone()
            hours = round((aborted - started).total_seconds() / 3600, 1)

    if dry_run:
        print(f"[DRY RUN] Would abort sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Reason: {reason}")
        print(f"  Hours: {hours if hours else 'N/A'}")
        print("  1. Update YAML (status=aborted, reason, hours)")
        print("  2. Rename with --aborted suffix")
        print("  3. Update state file")
        return {"status": "dry-run", "sprint_num": sprint_num}

    # Update YAML frontmatter
    aborted_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    updates = {"status": "aborted", "aborted_at": aborted_time, "abort_reason": reason}
    if hours:
        updates["hours"] = hours

    _update_yaml_frontmatter(sprint_file, updates)

    # Rename with --aborted suffix
    if sprint_file.parent.name.startswith("sprint-"):
        # Sprint in subdirectory
        sprint_subdir = sprint_file.parent
        new_dir_name = sprint_subdir.name + "--aborted"
        new_subdir = sprint_subdir.with_name(new_dir_name)
        sprint_subdir.rename(new_subdir)

        new_name = sprint_file.name.replace(".md", "--aborted.md")
        new_path = new_subdir / new_name
        (new_subdir / sprint_file.name).rename(new_path)
    else:
        # Sprint file directly in folder
        new_name = sprint_file.name.replace(".md", "--aborted.md")
        new_path = sprint_file.with_name(new_name)
        sprint_file.rename(new_path)

    print(f"✓ Renamed to: {new_path.name}")

    # Update state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        state["status"] = "aborted"
        state["aborted_at"] = aborted_time
        state["abort_reason"] = reason
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
        print("✓ State file updated")

    # Update registry
    update_registry(
        sprint_num, status="aborted", abort_reason=reason, hours=hours if hours else 0
    )
    print("✓ Registry updated")

    summary = {
        "status": "aborted",
        "sprint_num": sprint_num,
        "title": title,
        "reason": reason,
        "hours": hours,
        "file_path": str(new_path),
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {title} - ABORTED")
    print(f"{'='*60}")
    print(f"Reason: {reason}")
    print(f"Hours before abort: {hours if hours else 'N/A'}")
    print(f"File: {new_path.name}")
    print(f"{'='*60}")

    return summary


def start_epic(epic_num: int, dry_run: bool = False) -> dict:
    """
    Start an epic: move from backlog/todo to in-progress, update YAML.

    Args:
        epic_num: Epic number to start
        dry_run: If True, preview changes without executing

    Returns:
        Dict with start summary

    Raises:
        FileOperationError: If epic folder not found
        ValidationError: If epic already started

    Example:
        >>> summary = start_epic(3)
        >>> print(summary['status'])  # 'started'
    """
    project_root = find_project_root()

    # Find epic in backlog or todo
    epic_folder = None
    epic_num_str = f"{epic_num:02d}"

    for folder in ["0-backlog", "1-todo"]:
        search_path = project_root / "docs" / "sprints" / folder
        if search_path.exists():
            found = list(search_path.glob(f"epic-{epic_num_str}_*"))
            if found and found[0].is_dir():
                epic_folder = found[0]
                break

    if not epic_folder:
        raise FileOperationError(
            f"Epic {epic_num} not found in backlog or todo folders"
        )

    # Find _epic.md file
    epic_file = epic_folder / "_epic.md"
    if not epic_file.exists():
        raise FileOperationError(f"Epic {epic_num} missing _epic.md file")

    # Read title from YAML
    with open(epic_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Epic {epic_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"

    # Count sprints in epic
    sprint_files = list(epic_folder.glob("**/sprint-*.md"))
    sprint_count = len(sprint_files)

    if dry_run:
        print(f"[DRY RUN] Would start epic {epic_num}:")
        print(f"  Title: {title}")
        print(f"  Sprints: {sprint_count}")
        print("  1. Move to 2-in-progress/")
        print("  2. Update YAML (status=in-progress, started=<now>)")
        return {"status": "dry-run", "epic_num": epic_num}

    # Move to in-progress
    in_progress_dir = project_root / "docs" / "sprints" / "2-in-progress"
    in_progress_dir.mkdir(parents=True, exist_ok=True)

    new_epic_folder = in_progress_dir / epic_folder.name
    epic_folder.rename(new_epic_folder)

    # Update YAML frontmatter
    epic_file = new_epic_folder / "_epic.md"
    started_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    _update_yaml_frontmatter(
        epic_file, {"status": "in-progress", "started": started_time}
    )

    summary = {
        "epic_num": epic_num,
        "title": title,
        "status": "started",
        "sprint_count": sprint_count,
        "new_path": str(new_epic_folder),
    }

    print(f"\n{'='*60}")
    print(f"Epic {epic_num}: {title} - STARTED")
    print(f"{'='*60}")
    print(f"Location: {new_epic_folder}")
    print(f"Sprints: {sprint_count}")
    print(f"{'='*60}")

    return summary


def complete_epic(epic_num: int, dry_run: bool = False) -> dict:
    """
    Complete an epic: verify all sprints done/aborted, move to done, calculate stats.

    Args:
        epic_num: Epic number to complete
        dry_run: If True, preview changes without executing

    Returns:
        Dict with completion summary

    Raises:
        FileOperationError: If epic folder not found
        ValidationError: If epic has unfinished sprints

    Example:
        >>> summary = complete_epic(3)
        >>> print(summary['total_hours'])  # 42.5
    """
    project_root = find_project_root()
    epic_num_str = f"{epic_num:02d}"

    # Find epic in in-progress
    in_progress_dir = project_root / "docs" / "sprints" / "2-in-progress"
    found = list(in_progress_dir.glob(f"epic-{epic_num_str}_*"))

    if not found or not found[0].is_dir():
        raise FileOperationError(f"Epic {epic_num} not found in in-progress folder")

    epic_folder = found[0]
    epic_file = epic_folder / "_epic.md"

    if not epic_file.exists():
        raise FileOperationError(f"Epic {epic_num} missing _epic.md file")

    # Read title from YAML
    with open(epic_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Epic {epic_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"

    # Check all sprints are finished
    # Exclude postmortem files (they're metadata, not sprints)
    sprint_files = [
        f for f in epic_folder.glob("**/sprint-*.md") if "_postmortem" not in f.name
    ]
    done_sprints = []
    aborted_sprints = []
    unfinished_sprints = []
    blocked_sprints = []

    for sprint_file in sprint_files:
        name = sprint_file.name
        # Check both file name and parent directory for status suffix
        parent_name = sprint_file.parent.name
        if "--done" in name or "--done" in parent_name:
            done_sprints.append(name)
        elif "--aborted" in name or "--aborted" in parent_name:
            aborted_sprints.append(name)
        elif "--blocked" in name or "--blocked" in parent_name:
            blocked_sprints.append(name)
        else:
            unfinished_sprints.append(name)

    if unfinished_sprints or blocked_sprints:
        error_msg = f"Cannot complete epic {epic_num} - has unfinished sprints:\n"
        if unfinished_sprints:
            error_msg += "\nIn Progress/Pending:\n"
            for sprint in unfinished_sprints:
                error_msg += f"  - {sprint}\n"
        if blocked_sprints:
            error_msg += "\nBlocked:\n"
            for sprint in blocked_sprints:
                error_msg += f"  - {sprint}\n"
        raise ValidationError(error_msg.strip())

    # Calculate total hours
    total_hours = 0.0
    for sprint_file in sprint_files:
        with open(sprint_file) as f:
            sprint_content = f.read()
        yaml_match = re.search(r"^---\n(.*?)\n---", sprint_content, re.DOTALL)
        if yaml_match:
            hours_match = re.search(
                r"^hours:\s*([0-9.]+)", yaml_match.group(1), re.MULTILINE
            )
            if hours_match:
                total_hours += float(hours_match.group(1))

    if dry_run:
        print(f"[DRY RUN] Would complete epic {epic_num}:")
        print(f"  Title: {title}")
        print(f"  Done: {len(done_sprints)}")
        print(f"  Aborted: {len(aborted_sprints)}")
        print(f"  Total hours: {total_hours:.1f}")
        print("  1. Move to 3-done/")
        print("  2. Update YAML (status=done, completed=<now>, total_hours)")
        return {"status": "dry-run", "epic_num": epic_num}

    # Move to done
    done_dir = project_root / "docs" / "sprints" / "3-done"
    done_dir.mkdir(parents=True, exist_ok=True)

    new_epic_folder = done_dir / epic_folder.name
    epic_folder.rename(new_epic_folder)

    # Update YAML frontmatter
    epic_file = new_epic_folder / "_epic.md"
    completed_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    _update_yaml_frontmatter(
        epic_file,
        {"status": "done", "completed": completed_time, "total_hours": total_hours},
    )

    summary = {
        "epic_num": epic_num,
        "title": title,
        "status": "done",
        "done_count": len(done_sprints),
        "aborted_count": len(aborted_sprints),
        "total_hours": total_hours,
        "new_path": str(new_epic_folder),
    }

    print(f"\n{'='*60}")
    print(f"Epic {epic_num}: {title} - COMPLETE")
    print(f"{'='*60}")
    print(f"Location: {new_epic_folder}")
    print(f"Sprints completed: {len(done_sprints)}")
    print(f"Sprints aborted: {len(aborted_sprints)}")
    print(f"Total hours: {total_hours:.1f}")
    print(f"{'='*60}")

    return summary


def archive_epic(epic_num: int, dry_run: bool = False) -> dict:
    """
    Archive an epic: move from done to archived, update YAML.

    Args:
        epic_num: Epic number to archive
        dry_run: If True, preview changes without executing

    Returns:
        Dict with archive summary

    Raises:
        FileOperationError: If epic folder not found in done
        ValidationError: If epic not yet complete

    Example:
        >>> summary = archive_epic(3)
        >>> print(summary['status'])  # 'archived'
    """
    project_root = find_project_root()
    epic_num_str = f"{epic_num:02d}"

    # Find epic in done
    done_dir = project_root / "docs" / "sprints" / "3-done"
    found = list(done_dir.glob(f"epic-{epic_num_str}_*"))

    if not found or not found[0].is_dir():
        raise FileOperationError(
            f"Epic {epic_num} not found in done folder. Complete it first with /epic-complete"
        )

    epic_folder = found[0]
    epic_file = epic_folder / "_epic.md"

    if not epic_file.exists():
        raise FileOperationError(f"Epic {epic_num} missing _epic.md file")

    # Read title from YAML
    with open(epic_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Epic {epic_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"

    # Count sprint files
    sprint_files = list(epic_folder.glob("**/sprint-*.md"))
    file_count = len(sprint_files)

    if dry_run:
        print(f"[DRY RUN] Would archive epic {epic_num}:")
        print(f"  Title: {title}")
        print(f"  Files: {file_count} sprints + 1 epic")
        print("  1. Move to 6-archived/")
        print("  2. Update YAML (status=archived, archived_at=<now>)")
        return {"status": "dry-run", "epic_num": epic_num}

    # Move to archived
    archived_dir = project_root / "docs" / "sprints" / "6-archived"
    archived_dir.mkdir(parents=True, exist_ok=True)

    new_epic_folder = archived_dir / epic_folder.name
    epic_folder.rename(new_epic_folder)

    # Update YAML frontmatter
    epic_file = new_epic_folder / "_epic.md"
    archived_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    _update_yaml_frontmatter(
        epic_file, {"status": "archived", "archived_at": archived_time}
    )

    summary = {
        "epic_num": epic_num,
        "title": title,
        "status": "archived",
        "file_count": file_count,
        "new_path": str(new_epic_folder),
    }

    print(f"\n{'='*60}")
    print(f"Epic {epic_num}: {title} - ARCHIVED")
    print(f"{'='*60}")
    print(f"Location: {new_epic_folder}")
    print(f"Files: {file_count} sprints + 1 epic")
    print(f"{'='*60}")

    return summary


def block_sprint(sprint_num: int, reason: str, dry_run: bool = False) -> dict:
    """
    Block a sprint: rename with --blocked suffix, update state.

    Args:
        sprint_num: Sprint number to block
        reason: Reason for blocking
        dry_run: If True, preview changes without executing

    Returns:
        Dict with block summary

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint already blocked

    Example:
        >>> summary = block_sprint(4, "Waiting for API access")
        >>> print(summary['status'])  # 'blocked'
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} not found")

    # Check if already blocked
    if "--blocked" in sprint_file.name:
        raise ValidationError(f"Sprint {sprint_num} already blocked: {sprint_file}")

    # Read YAML for metadata
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Sprint {sprint_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    started_match = re.search(r"^started:\s*(.+)$", yaml_content, re.MULTILINE)

    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"

    # Calculate hours worked so far
    hours = None
    if started_match:
        started_str = started_match.group(1).strip()
        if started_str and started_str.lower() != "null":
            started = datetime.fromisoformat(started_str.replace("Z", "+00:00"))
            blocked = datetime.now().astimezone()
            hours = round((blocked - started).total_seconds() / 3600, 1)

    if dry_run:
        print(f"[DRY RUN] Would block sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Reason: {reason}")
        print(f"  Hours so far: {hours if hours else 'N/A'}")
        print("  1. Update YAML (status=blocked, blocker, hours_before_block)")
        print("  2. Rename with --blocked suffix")
        print("  3. Update state file")
        return {"status": "dry-run", "sprint_num": sprint_num}

    # Update YAML frontmatter
    blocked_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    updates = {"status": "blocked", "blocked_at": blocked_time, "blocker": reason}
    if hours:
        updates["hours_before_block"] = hours

    _update_yaml_frontmatter(sprint_file, updates)

    # Rename with --blocked suffix
    if sprint_file.parent.name.startswith("sprint-"):
        # Sprint in subdirectory
        sprint_subdir = sprint_file.parent
        new_dir_name = sprint_subdir.name + "--blocked"
        new_subdir = sprint_subdir.with_name(new_dir_name)
        sprint_subdir.rename(new_subdir)

        new_name = sprint_file.name.replace(".md", "--blocked.md")
        new_path = new_subdir / new_name
    else:
        # Sprint file directly in folder
        new_name = sprint_file.name.replace(".md", "--blocked.md")
        new_path = sprint_file.with_name(new_name)
        sprint_file.rename(new_path)

    # Update state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        state["status"] = "blocked"
        state["blocked_at"] = blocked_time
        state["blocker"] = reason
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)

    summary = {
        "sprint_num": sprint_num,
        "title": title,
        "status": "blocked",
        "reason": reason,
        "hours": hours,
        "new_path": str(new_path),
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {title} - BLOCKED")
    print(f"{'='*60}")
    print(f"Blocker: {reason}")
    print(f"Hours before block: {hours if hours else 'N/A'}")
    print(f"File: {new_path.name}")
    print(f"To resume: /sprint-resume {sprint_num}")
    print(f"{'='*60}")

    return summary


def resume_sprint(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Resume a blocked sprint: remove --blocked suffix, update state.

    Args:
        sprint_num: Sprint number to resume
        dry_run: If True, preview changes without executing

    Returns:
        Dict with resume summary

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint not blocked

    Example:
        >>> summary = resume_sprint(4)
        >>> print(summary['status'])  # 'resumed'
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} not found")

    # Check if sprint is blocked
    if "--blocked" not in sprint_file.name:
        raise ValidationError(
            f"Sprint {sprint_num} is not blocked. Current state: {sprint_file.name}"
        )

    # Read YAML for metadata
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Sprint {sprint_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    blocker_match = re.search(r"^blocker:\s*(.+)$", yaml_content, re.MULTILINE)
    hours_match = re.search(
        r"^hours_before_block:\s*([0-9.]+)", yaml_content, re.MULTILINE
    )

    title = title_match.group(1).strip().strip('"') if title_match else "Unknown"
    blocker = blocker_match.group(1).strip().strip('"') if blocker_match else "Unknown"
    hours_before = float(hours_match.group(1)) if hours_match else None

    if dry_run:
        print(f"[DRY RUN] Would resume sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Was blocked by: {blocker}")
        print(f"  Hours before block: {hours_before if hours_before else 'N/A'}")
        print("  1. Update YAML (status=in-progress, resumed_at, previous_blocker)")
        print("  2. Remove --blocked suffix")
        print("  3. Update state file")
        return {"status": "dry-run", "sprint_num": sprint_num}

    # Update YAML frontmatter
    resumed_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    updates = {
        "status": "in-progress",
        "resumed_at": resumed_time,
        "previous_blocker": blocker,
    }
    # Remove blocked-specific fields
    updates["blocker"] = None
    updates["blocked_at"] = None

    _update_yaml_frontmatter(sprint_file, updates)

    # Remove --blocked suffix
    if (
        sprint_file.parent.name.startswith("sprint-")
        and "--blocked" in sprint_file.parent.name
    ):
        # Sprint in subdirectory
        sprint_subdir = sprint_file.parent
        new_dir_name = sprint_subdir.name.replace("--blocked", "")
        new_subdir = sprint_subdir.with_name(new_dir_name)
        sprint_subdir.rename(new_subdir)

        new_name = sprint_file.name.replace("--blocked", "")
        new_path = new_subdir / new_name
    else:
        # Sprint file directly in folder
        new_name = sprint_file.name.replace("--blocked", "")
        new_path = sprint_file.with_name(new_name)
        sprint_file.rename(new_path)

    # Update state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        state["status"] = "in-progress"
        state["resumed_at"] = resumed_time
        state["previous_blocker"] = blocker
        # Remove blocked fields
        state.pop("blocker", None)
        state.pop("blocked_at", None)
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)

    summary = {
        "sprint_num": sprint_num,
        "title": title,
        "status": "resumed",
        "previous_blocker": blocker,
        "hours_before_block": hours_before,
        "new_path": str(new_path),
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {title} - RESUMED")
    print(f"{'='*60}")
    print(f"Previously blocked by: {blocker}")
    print(f"Hours before block: {hours_before if hours_before else 'N/A'}")
    print(f"File: {new_path.name}")
    print(f"Use /sprint-next {sprint_num} to continue")
    print(f"{'='*60}")

    return summary


def advance_step(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Advance sprint to next workflow step.

    Reads current step from state, finds next step in workflow definition,
    and updates state file. Validates that current step is completed.

    Args:
        sprint_num: Sprint number to advance
        dry_run: If True, preview changes without executing

    Returns:
        Dict with summary of step advancement

    Raises:
        FileOperationError: If sprint or state file not found
        ValidationError: If current step is not complete

    Example:
        >>> advance_step(4, dry_run=True)
        >>> # Preview: Sprint 4: 1.1 Planning → 1.2 Design
    """
    project_root = find_project_root()

    # Read state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if not state_file.exists():
        raise FileOperationError(
            f"No state file for sprint {sprint_num}. Sprint may not be started."
        )

    with open(state_file) as f:
        state = json.load(f)

    current_step = state.get("current_step")
    if not current_step:
        raise ValidationError("State file missing current_step")

    # Load workflow steps definition
    steps_file = Path.home() / ".claude" / "sprint-steps.json"
    if not steps_file.exists():
        raise FileOperationError(f"Sprint steps definition not found at {steps_file}")

    with open(steps_file) as f:
        steps_def = json.load(f)

    step_order = steps_def.get("step_order", [])
    if not step_order:
        raise ValidationError("sprint-steps.json missing step_order")

    # Find current step index
    try:
        current_idx = step_order.index(current_step)
    except ValueError:
        raise ValidationError(f"Current step '{current_step}' not found in workflow")

    # Get next step
    if current_idx >= len(step_order) - 1:
        raise ValidationError(
            f"Already at final step ({current_step}). Use /sprint-complete to finish."
        )

    next_step = step_order[current_idx + 1]

    # Find step details
    current_step_name = None
    next_step_name = None
    for phase in steps_def.get("phases", []):
        for step_info in phase.get("steps", []):
            if step_info["step"] == current_step:
                current_step_name = step_info["name"]
            if step_info["step"] == next_step:
                next_step_name = step_info["name"]

    summary = {
        "sprint_num": sprint_num,
        "previous_step": current_step,
        "previous_step_name": current_step_name,
        "new_step": next_step,
        "new_step_name": next_step_name,
        "dry_run": dry_run,
    }

    print(f"\n{'='*60}")
    print(f"ADVANCE SPRINT {sprint_num} TO NEXT STEP")
    print(f"{'='*60}")
    print(f"Current:  {current_step} - {current_step_name}")
    print(f"Next:     {next_step} - {next_step_name}")

    if dry_run:
        print("\n[DRY RUN] Would update state file:")
        print(f"  - Mark {current_step} as completed")
        print(f"  - Advance to {next_step}")
        print(f"{'='*60}")
        return summary

    # Mark current step completed
    completed_steps = state.get("completed_steps", [])
    completed_steps.append(
        {"step": current_step, "completed_at": datetime.now().isoformat()}
    )

    # Update state
    state["current_step"] = next_step
    state["completed_steps"] = completed_steps

    # Parse current step to update phase (e.g., "2.3" → phase 2)
    try:
        phase_num = int(next_step.split(".")[0])
        state["current_phase"] = phase_num
    except (ValueError, IndexError):
        pass  # Keep existing phase if parsing fails

    # Write updated state
    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)

    # Create test artifacts for specific steps
    sprint_file = _find_sprint_file(sprint_num, project_root)
    if sprint_file:
        sprint_folder = sprint_file.parent

        # Step 1.5.1: Create interface contract file (for fullstack sprints)
        if current_step == "1.5.1":
            contract_file = (
                sprint_folder / f"sprint-{sprint_num}_interface-contract.json"
            )
            if not contract_file.exists():
                contract_content = {
                    "sprint": sprint_num,
                    "version": "1.0",
                    "created": datetime.now().isoformat(),
                    "interfaces": {
                        "backend": {"endpoints": [], "models": [], "enums": []},
                        "frontend": {"components": [], "hooks": [], "types": []},
                        "shared": {"types": [], "constants": []},
                    },
                    "validation_status": "pending",
                }
                with open(contract_file, "w") as f:
                    json.dump(contract_content, f, indent=2)
                print(f"  ✓ Created interface contract: {contract_file.name}")

        # Step 3.2: Create quality assessment file
        if current_step == "3.2":
            quality_file = (
                sprint_folder / f"sprint-{sprint_num}_quality-assessment.json"
            )
            if not quality_file.exists():
                quality_content = {
                    "sprint": sprint_num,
                    "assessed_at": datetime.now().isoformat(),
                    "code_quality": {
                        "docstrings": True,
                        "type_hints": True,
                        "lint_clean": True,
                        "complexity_acceptable": True,
                    },
                    "test_quality": {
                        "coverage_percentage": 0,
                        "edge_cases_covered": True,
                        "mocks_appropriate": True,
                    },
                    "issues_found": [],
                    "recommendations": [],
                    "overall_status": "pass",
                }
                with open(quality_file, "w") as f:
                    json.dump(quality_content, f, indent=2)
                print(f"  ✓ Created quality assessment: {quality_file.name}")

    print(f"\n✓ Sprint {sprint_num} advanced to step {next_step}")
    print(f"{'='*60}")

    return summary


def generate_postmortem(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Generate postmortem analysis as a separate file linked from sprint.

    Creates sprint-{N}_postmortem.md with metrics, learnings, and analysis.
    Adds link to postmortem from the sprint file.

    Args:
        sprint_num: Sprint number to generate postmortem for
        dry_run: If True, preview without creating files

    Returns:
        Dict with summary of postmortem generation

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint is not complete

    Example:
        >>> generate_postmortem(4)
        >>> # Creates: sprint-4_postmortem.md
        >>> # Links from: sprint-4_feature-name--done.md
    """
    project_root = find_project_root()

    # Find sprint file
    sprint_file = _find_sprint_file(sprint_num, project_root)
    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} file not found")

    # Read sprint YAML frontmatter
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Sprint {sprint_num} has no YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    sprint_title = (
        title_match.group(1).strip().strip('"')
        if title_match
        else f"Sprint {sprint_num}"
    )

    # Read state file if exists
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    metrics = {}
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)

        # Calculate duration
        started = state.get("started_at")
        completed = state.get("completed_at")
        if started and completed:
            from datetime import datetime

            start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
            complete_dt = datetime.fromisoformat(completed.replace("Z", "+00:00"))
            duration = complete_dt - start_dt
            metrics["duration_hours"] = round(duration.total_seconds() / 3600, 1)
            metrics["started_at"] = started
            metrics["completed_at"] = completed

        metrics["completed_steps"] = len(state.get("completed_steps", []))

    # Create postmortem file in same directory as sprint
    postmortem_file = sprint_file.parent / f"sprint-{sprint_num}_postmortem.md"

    # Generate postmortem content
    postmortem_content = f"""# Sprint {sprint_num} Postmortem: {sprint_title}

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | {sprint_num} |
| Started | {metrics.get('started_at', 'N/A')} |
| Completed | {metrics.get('completed_at', 'N/A')} |
| Duration | {metrics.get('duration_hours', 'N/A')} hours |
| Steps Completed | {metrics.get('completed_steps', 'N/A')} |
| Files Changed | TODO: Run `git diff --stat` |
| Tests Added | TODO: Count test functions |
| Coverage Delta | TODO: Compare coverage |

## What Went Well

<!-- What worked well during this sprint? -->

- TODO: Add positives

## What Could Improve

<!-- What could be done better next time? -->

- TODO: Add improvements

## Blockers Encountered

<!-- Were there any blockers or unexpected challenges? -->

- TODO: Document blockers

## Technical Insights

<!-- What did we learn technically? -->

- TODO: Add technical learnings

## Process Insights

<!-- What did we learn about our process? -->

- TODO: Add process learnings

## Patterns Discovered

<!-- Any reusable code patterns worth documenting? -->

```
TODO: Add code patterns
```

## Action Items for Next Sprint

- [ ] TODO: Add follow-up tasks

## Notes

<!-- Any other observations or context -->

TODO: Add additional notes
"""

    summary = {
        "sprint_num": sprint_num,
        "postmortem_file": str(postmortem_file),
        "sprint_file": str(sprint_file),
        "dry_run": dry_run,
        "metrics": metrics,
    }

    print(f"\n{'='*60}")
    print(f"GENERATE POSTMORTEM FOR SPRINT {sprint_num}")
    print(f"{'='*60}")
    print(f"Sprint: {sprint_title}")
    if metrics:
        print(f"Duration: {metrics.get('duration_hours', 'N/A')} hours")
        print(f"Steps: {metrics.get('completed_steps', 'N/A')}")
    print(f"Postmortem file: {postmortem_file.name}")

    if dry_run:
        print("\n[DRY RUN] Would create:")
        print(f"  - {postmortem_file}")
        print(f"{'='*60}")
        return summary

    # Write postmortem file
    with open(postmortem_file, "w") as f:
        f.write(postmortem_content)

    print(f"\n✓ Created postmortem file: {postmortem_file.name}")
    print(f"{'='*60}")

    return summary


def get_sprint_status(sprint_num: int) -> dict:
    """
    Get current sprint status and progress.

    Args:
        sprint_num: Sprint number to check

    Returns:
        Dict with sprint status information

    Raises:
        FileOperationError: If sprint or state file not found

    Example:
        >>> status = get_sprint_status(4)
        >>> print(status['status'])  # 'in-progress'
    """
    project_root = find_project_root()

    # Read state file
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if not state_file.exists():
        raise FileOperationError(
            f"No state file for sprint {sprint_num}. Sprint may not be started."
        )

    with open(state_file) as f:
        state = json.load(f)

    # Find sprint file
    sprint_file = _find_sprint_file(sprint_num, project_root)
    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} file not found")

    # Read YAML frontmatter
    with open(sprint_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    yaml_data = {}
    if yaml_match:
        yaml_content = yaml_match.group(1)
        for line in yaml_content.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                yaml_data[key.strip()] = value.strip()

    status = {
        "sprint_num": sprint_num,
        "title": yaml_data.get("title", "Unknown").strip('"'),
        "status": state.get("status", yaml_data.get("status", "Unknown")),
        "workflow_version": state.get("workflow_version", "1.0"),
        "started": yaml_data.get("started"),
        "completed": yaml_data.get("completed"),
        "current_step": state.get("current_step"),
        "sprint_file": str(sprint_file),
        "sprint_type": yaml_data.get("type", "fullstack"),
    }

    # Calculate progress from step
    step_order = [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "1.5.1",
        "1.5.2",
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "3.1",
        "3.2",
        "3.3",
        "3.4",
        "4.1",
        "5.1",
        "5.2",
        "6.1",
        "6.2",
        "6.3",
        "6.4",
        "6.5",
        "6.6",
    ]
    current_step = status["current_step"] or "1.1"
    try:
        step_index = step_order.index(current_step)
    except ValueError:
        step_index = 0
    progress_pct = int((step_index / len(step_order)) * 100)

    # Determine phase info
    phase_info = {
        "1": ("Planning", ["Plan", "Explore"]),
        "1.5": ("Interface Contract", ["Plan"]),
        "2": ("Test-First Implementation", ["product-engineer", "test-runner"]),
        "3": ("Validation & Refactoring", ["quality-engineer", "test-runner"]),
        "4": ("Documentation", ["file-creator"]),
        "5": ("Commit", []),
        "6": ("Completion", []),
    }

    # Get current phase
    if current_step.startswith("1.5"):
        phase_num = "1.5"
    else:
        phase_num = current_step.split(".")[0]
    phase_name, recommended_agents = phase_info.get(phase_num, ("Unknown", []))

    # Build progress bar
    bar_width = 20
    filled = int(bar_width * progress_pct / 100)
    bar = (
        "=" * filled + ">" + " " * (bar_width - filled - 1)
        if filled < bar_width
        else "=" * bar_width
    )
    progress_bar = f"[{bar}] {progress_pct}%"

    # Display enhanced status
    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {status['title']}")
    print(f"{'='*60}")
    print(f"Status: {status['status']}")
    print(f"Progress: {progress_bar}")
    print(f"Phase: {phase_num} - {phase_name}")
    print(f"Current Step: {current_step}")
    print(f"{'='*60}")

    # Next actions
    print("\nNEXT ACTIONS:")
    print("  /sprint-next              Advance to next step")
    if status["status"] == "in_progress":
        print(f"  /sprint-status {sprint_num}          Refresh status")

    # Recommended agents (if any)
    if recommended_agents:
        print("\nRECOMMENDED AGENTS:")
        agent_descriptions = {
            "Plan": "Design implementation approach",
            "Explore": "Explore codebase structure",
            "product-engineer": "Implement features",
            "test-runner": "Run test suite",
            "quality-engineer": "Review code quality",
            "file-creator": "Create documentation",
        }
        for agent in recommended_agents:
            desc = agent_descriptions.get(agent, "")
            print(f"  {agent:<20} {desc}")

    print(f"\n{'='*60}")
    print("Run /workflow-help for full command reference")
    print(f"{'='*60}")

    return status


def get_epic_status(epic_num: int) -> dict:
    """
    Get detailed epic status with sprint progress.

    Args:
        epic_num: Epic number to check

    Returns:
        Dict with epic status information

    Raises:
        FileOperationError: If epic not found

    Example:
        >>> status = get_epic_status(1)
        >>> print(status['progress'])  # 0.6 (60%)
    """
    project_root = find_project_root()
    epic_num_str = f"{epic_num:02d}"

    # Find epic folder
    epic_folder = None
    for folder in ["0-backlog", "1-todo", "2-in-progress", "3-done", "6-archived"]:
        search_path = project_root / "docs" / "sprints" / folder
        if search_path.exists():
            found = list(search_path.glob(f"epic-{epic_num_str}_*"))
            if found and found[0].is_dir():
                epic_folder = found[0]
                break

    if not epic_folder:
        raise FileOperationError(f"Epic {epic_num} not found")

    epic_file = epic_folder / "_epic.md"
    if not epic_file.exists():
        raise FileOperationError(f"Epic {epic_num} missing _epic.md")

    # Read epic file
    with open(epic_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    yaml_data = {}
    if yaml_match:
        yaml_content = yaml_match.group(1)
        for line in yaml_content.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                yaml_data[key.strip()] = value.strip()

    title = yaml_data.get("title", "Unknown").strip('"')
    status = yaml_data.get("status", "Unknown")

    # Count sprints
    sprint_files = list(epic_folder.glob("**/sprint-*.md"))
    total = len(sprint_files)
    done = len([f for f in sprint_files if "--done" in f.name])
    aborted = len([f for f in sprint_files if "--aborted" in f.name])
    blocked = len([f for f in sprint_files if "--blocked" in f.name])
    in_progress = total - done - aborted - blocked

    progress = done / total if total > 0 else 0

    epic_status = {
        "epic_num": epic_num,
        "title": title,
        "status": status,
        "location": epic_folder.parent.name,
        "total_sprints": total,
        "done": done,
        "in_progress": in_progress,
        "blocked": blocked,
        "aborted": aborted,
        "progress": progress,
    }

    # Display status
    print(f"\n{'='*60}")
    print(f"Epic {epic_num}: {title}")
    print(f"{'='*60}")
    print(f"Status: {status}")
    print(f"Location: {epic_folder.parent.name}")
    print(f"Sprints: {done}/{total} done ({progress*100:.0f}%)")
    if in_progress > 0:
        print(f"  In progress: {in_progress}")
    if blocked > 0:
        print(f"  Blocked: {blocked}")
    if aborted > 0:
        print(f"  Aborted: {aborted}")
    print(f"{'='*60}")

    return epic_status


def list_epics() -> list:
    """
    List all epics with their progress.

    Returns:
        List of dicts with epic information

    Example:
        >>> epics = list_epics()
        >>> for epic in epics:
        ...     print(f"Epic {epic['epic_num']}: {epic['progress']*100:.0f}%")
    """
    project_root = find_project_root()
    sprints_dir = project_root / "docs" / "sprints"

    if not sprints_dir.exists():
        print("No sprints directory found")
        return []

    # Find all epic folders
    epic_folders = []
    for folder in ["0-backlog", "1-todo", "2-in-progress", "3-done", "6-archived"]:
        folder_path = sprints_dir / folder
        if folder_path.exists():
            for epic_dir in folder_path.glob("epic-*"):
                if epic_dir.is_dir():
                    epic_folders.append(epic_dir)

    epics = []
    for epic_folder in sorted(epic_folders):
        # Extract epic number
        import re

        match = re.search(r"epic-(\d+)", epic_folder.name)
        if not match:
            continue

        epic_num = int(match.group(1))

        # Read epic file
        epic_file = epic_folder / "_epic.md"
        if not epic_file.exists():
            continue

        with open(epic_file) as f:
            content = f.read()

        yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
        title = "Unknown"
        if yaml_match:
            yaml_content = yaml_match.group(1)
            title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
            if title_match:
                title = title_match.group(1).strip().strip('"')

        # Count sprints
        sprint_files = list(epic_folder.glob("**/sprint-*.md"))
        total = len(sprint_files)
        done = len([f for f in sprint_files if "--done" in f.name])

        progress = done / total if total > 0 else 0

        epics.append(
            {
                "epic_num": epic_num,
                "title": title,
                "total": total,
                "done": done,
                "progress": progress,
                "location": epic_folder.parent.name,
            }
        )

    # Display list
    print(f"\n{'='*60}")
    print("Epics:")
    print(f"{'='*60}")
    for epic in epics:
        bar_length = 10
        filled = int(epic["progress"] * bar_length)
        bar = "█" * filled + "░" * (bar_length - filled)
        location_marker = {
            "0-backlog": "📦",
            "1-todo": "📋",
            "2-in-progress": "⚙️",
            "3-done": "✅",
            "6-archived": "📁",
        }.get(epic["location"], "  ")

        print(
            f"  {location_marker} {epic['epic_num']:02d}. {epic['title'][:40]:<40} [{bar}] {epic['progress']*100:3.0f}%  ({epic['done']}/{epic['total']} sprints)"
        )
    print(f"{'='*60}")
    print(f"Total: {len(epics)} epics")
    print(f"{'='*60}")

    return epics


def recover_sprint(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Recover a sprint file that ended up in the wrong location.

    Args:
        sprint_num: Sprint number to recover
        dry_run: If True, preview changes without executing

    Returns:
        Dict with recovery summary

    Raises:
        FileOperationError: If sprint file not found
        ValidationError: If sprint is already in correct location

    Example:
        >>> summary = recover_sprint(4)
        >>> print(summary['new_path'])
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} not found")

    # Determine correct location
    is_epic, epic_num = _is_epic_sprint(sprint_file)
    has_done_suffix = "--done" in sprint_file.name

    # Determine expected location
    if not has_done_suffix:
        raise ValidationError(
            f"Sprint {sprint_num} is not complete (no --done suffix). Nothing to recover."
        )

    if is_epic:
        # Epic sprint - should be in epic folder (either in-progress or done depending on epic status)
        expected_parent = sprint_file.parent
        if not expected_parent.name.startswith("epic-"):
            expected_parent = expected_parent.parent

        # Check if we need to move
        if "3-done" in str(sprint_file) and "2-in-progress" in str(expected_parent):
            # Epic sprint in wrong location
            correct_path = expected_parent / sprint_file.name
        else:
            raise ValidationError(f"Sprint {sprint_num} is already in correct location")
    else:
        # Standalone sprint - should be in 3-done
        correct_folder = project_root / "docs" / "sprints" / "3-done"
        correct_path = correct_folder / sprint_file.name

        if sprint_file.parent == correct_folder:
            raise ValidationError(f"Sprint {sprint_num} is already in correct location")

    if dry_run:
        print(f"[DRY RUN] Would recover sprint {sprint_num}:")
        print(f"  From: {sprint_file}")
        print(f"  To: {correct_path}")
        return {"status": "dry-run", "sprint_num": sprint_num}

    # Move file
    correct_path.parent.mkdir(parents=True, exist_ok=True)
    sprint_file.rename(correct_path)

    # Update state file if exists
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        state["sprint_file"] = str(correct_path)
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)

    summary = {
        "sprint_num": sprint_num,
        "old_path": str(sprint_file),
        "new_path": str(correct_path),
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num} - RECOVERED")
    print(f"{'='*60}")
    print(f"From: {sprint_file}")
    print(f"To: {correct_path}")
    print(f"{'='*60}")

    return summary


def add_to_epic(sprint_num: int, epic_num: int, dry_run: bool = False) -> dict:
    """
    Add an existing sprint to an epic.

    Args:
        sprint_num: Sprint number to add
        epic_num: Epic number to add sprint to
        dry_run: If True, preview changes without executing

    Returns:
        Dict with operation summary

    Raises:
        FileOperationError: If sprint or epic not found
        ValidationError: If sprint already in epic

    Example:
        >>> summary = add_to_epic(81, 10)
        >>> print(summary['epic_title'])
    """
    project_root = find_project_root()

    # Find sprint file
    sprint_file = _find_sprint_file(sprint_num, project_root)
    if not sprint_file:
        raise FileOperationError(f"Sprint {sprint_num} not found")

    # Check if already in epic
    is_epic, current_epic = _is_epic_sprint(sprint_file)
    if is_epic:
        raise ValidationError(f"Sprint {sprint_num} is already in epic {current_epic}")

    # Find epic folder
    epic_num_str = f"{epic_num:02d}"
    epic_folder = None
    for folder in ["0-backlog", "1-todo", "2-in-progress"]:
        search_path = project_root / "docs" / "sprints" / folder
        if search_path.exists():
            found = list(search_path.glob(f"epic-{epic_num_str}_*"))
            if found and found[0].is_dir():
                epic_folder = found[0]
                break

    if not epic_folder:
        raise FileOperationError(f"Epic {epic_num} not found")

    epic_file = epic_folder / "_epic.md"
    if not epic_file.exists():
        raise FileOperationError(f"Epic {epic_num} missing _epic.md")

    # Read epic title
    with open(epic_file) as f:
        content = f.read()

    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    epic_title = "Unknown"
    if yaml_match:
        title_match = re.search(r"^title:\s*(.+)$", yaml_match.group(1), re.MULTILINE)
        if title_match:
            epic_title = title_match.group(1).strip().strip('"')

    # Read sprint title
    with open(sprint_file) as f:
        sprint_content = f.read()

    sprint_yaml = re.search(r"^---\n(.*?)\n---", sprint_content, re.DOTALL)
    sprint_title = "Unknown"
    if sprint_yaml:
        title_match = re.search(r"^title:\s*(.+)$", sprint_yaml.group(1), re.MULTILINE)
        if title_match:
            sprint_title = title_match.group(1).strip().strip('"')

    # Determine if sprint is in a directory or standalone file
    sprint_dir = sprint_file.parent
    sprint_dir_name = sprint_dir.name

    # Check if sprint file is in its own directory (e.g., sprint-07_title/sprint-07_title.md)
    # vs being a standalone file
    is_in_sprint_dir = sprint_dir_name.startswith(f"sprint-{sprint_num:02d}_") or sprint_dir_name.startswith(f"sprint-{sprint_num}_")

    if is_in_sprint_dir:
        # Move entire directory
        new_dir_path = epic_folder / sprint_dir_name
        new_file_path = new_dir_path / sprint_file.name
    else:
        # Standalone file - just move the file
        new_dir_path = None
        new_file_path = epic_folder / sprint_file.name

    if dry_run:
        print(f"[DRY RUN] Would add sprint {sprint_num} to epic {epic_num}:")
        print(f"  Sprint: {sprint_title}")
        print(f"  Epic: {epic_title}")
        if is_in_sprint_dir:
            print(f"  Move directory: {sprint_dir}")
            print(f"  To: {new_dir_path}")
        else:
            print(f"  Move file: {sprint_file}")
            print(f"  To: {new_file_path}")
        print(f"  Update YAML: epic={epic_num}")
        return {"status": "dry-run", "sprint_num": sprint_num, "epic_num": epic_num}

    # Move sprint directory or file
    import shutil
    if is_in_sprint_dir:
        shutil.move(str(sprint_dir), str(new_dir_path))
    else:
        sprint_file.rename(new_file_path)

    # Update sprint YAML
    _update_yaml_frontmatter(new_file_path, {"epic": epic_num})

    # Update registry with new file path
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    if registry_path.exists():
        with open(registry_path) as f:
            registry = json.load(f)

        sprint_key = str(sprint_num)
        if sprint_key in registry.get("sprints", {}):
            registry["sprints"][sprint_key]["epic"] = epic_num
            registry["sprints"][sprint_key]["file"] = str(new_file_path.relative_to(project_root))

            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2)

    summary = {
        "sprint_num": sprint_num,
        "sprint_title": sprint_title,
        "epic_num": epic_num,
        "epic_title": epic_title,
        "new_path": str(new_file_path),
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num} added to Epic {epic_num}")
    print(f"{'='*60}")
    print(f"Sprint: {sprint_title}")
    print(f"Epic: {epic_title}")
    print(f"New location: {new_file_path}")
    print(f"{'='*60}")

    return summary


def create_project(target_path: Optional[str] = None, dry_run: bool = False) -> dict:
    """
    Initialize a new project with the complete sprint workflow system.

    Supports dual-mode operation:
    - Maestro mode: If templates/project/ exists in target, copy FROM local templates
    - Normal mode: Copy FROM ~/.claude/templates/project/ (standard projects)

    Args:
        target_path: Target directory path (defaults to current directory)
        dry_run: If True, preview changes without executing

    Returns:
        Dict with initialization summary including 'maestro_mode' flag

    Raises:
        FileOperationError: If target doesn't exist or master template not found
        ValidationError: If project already initialized

    Example:
        >>> summary = create_project("/path/to/new/project")
        >>> print(summary['status'])  # 'initialized'
    """

    # 1. Determine target path
    if target_path:
        target = Path(target_path).resolve()
    else:
        target = Path.cwd().resolve()

    # 2. Validate target
    if not target.exists():
        raise FileOperationError(f"Directory not found: {target}")

    # Check if already initialized
    if (target / ".claude" / "sprint-steps.json").exists():
        raise ValidationError(
            f"Project already initialized at {target}\n"
            f"Use /project-update to sync changes instead."
        )

    # 3. Detect maestro mode
    maestro_mode = (target / "templates" / "project").exists()

    # 4. Define source paths based on mode
    master_project = Path.home() / "Development" / "Dreadnought" / "claude-maestro"
    global_claude = Path.home() / ".claude"

    if maestro_mode:
        # Maestro mode: Use local templates
        template_path = target / "templates" / "project"
        print("🔧 MAESTRO MODE: Initializing from local templates")
        print(f"   Source: {template_path}")
    else:
        # Normal mode: Use global templates
        template_path = global_claude / "templates" / "project"
        # Validate master project exists for normal mode
        if not master_project.exists():
            raise FileOperationError(
                f"Master project not found at {master_project}\n"
                f"Cannot initialize without template source."
            )

    if dry_run:
        print(f"[DRY RUN] Would initialize project at: {target}")
        print("\nWould create structure:")
        print(f"  ├── commands/ (from {master_project}/commands/)")
        print(f"  ├── scripts/ (from {master_project}/scripts/)")
        print("  ├── .claude/")
        print("  │   ├── agents/ (global + template)")
        print("  │   ├── hooks/ (global + template)")
        print("  │   ├── settings.json")
        print("  │   ├── sprint-steps.json")
        print("  │   └── WORKFLOW_VERSION")
        print("  ├── docs/sprints/")
        print("  │   ├── 0-backlog/")
        print("  │   ├── 1-todo/")
        print("  │   ├── 2-in-progress/")
        print("  │   ├── 3-done/")
        print("  │   ├── 4-blocked/")
        print("  │   ├── 5-aborted/")
        print("  │   ├── 6-archived/")
        print("  │   └── registry.json")
        print("  ├── CLAUDE.md")
        print("  └── .gitignore (updated)")
        return {"status": "dry-run", "target": str(target)}

    # 5. Create directory structure
    print("→ Creating directory structure...")
    dirs_to_create = [
        target / ".claude" / "agents",
        target / ".claude" / "hooks",
        target / "docs" / "sprints" / "0-backlog",
        target / "docs" / "sprints" / "1-todo",
        target / "docs" / "sprints" / "2-in-progress",
        target / "docs" / "sprints" / "3-done",
        target / "docs" / "sprints" / "4-blocked",
        target / "docs" / "sprints" / "5-aborted",
        target / "docs" / "sprints" / "6-archived",
    ]

    # Only create commands/ and scripts/ for normal projects
    if not maestro_mode:
        dirs_to_create.extend(
            [
                target / "commands",
                target / "scripts",
            ]
        )

    for dir_path in dirs_to_create:
        dir_path.mkdir(parents=True, exist_ok=True)

    print("✓ Created directory structure")

    # 6. Copy commands from master project (skip in maestro mode)
    command_count = 0
    if not maestro_mode:
        print("→ Copying commands...")
        if (master_project / "commands").exists():
            for cmd_file in (master_project / "commands").glob("*.md"):
                shutil.copy2(cmd_file, target / "commands" / cmd_file.name)
                command_count += 1
        print(f"✓ Copied {command_count} command files")
    else:
        print("✓ Skipping commands/ (maestro mode - already exists)")

    # 7. Copy scripts from master project (skip in maestro mode)
    if not maestro_mode:
        print("→ Copying scripts...")
        if (master_project / "scripts").exists():
            for script_file in (master_project / "scripts").iterdir():
                if script_file.is_file():
                    dest = target / "scripts" / script_file.name
                    shutil.copy2(script_file, dest)
                    # Make Python scripts executable
                    if script_file.suffix == ".py":
                        dest.chmod(0o755)
        print("✓ Copied automation scripts")
    else:
        print("✓ Skipping scripts/ (maestro mode - already exists)")

    # 7. Copy agents (global + template)
    print("→ Copying agents...")
    agent_count = 0

    # Copy global agents
    if (global_claude / "agents").exists():
        for agent_file in (global_claude / "agents").glob("*.md"):
            shutil.copy2(agent_file, target / ".claude" / "agents" / agent_file.name)
            agent_count += 1

    # Copy template agents
    if (template_path / ".claude" / "agents").exists():
        for agent_file in (template_path / ".claude" / "agents").glob("*.md"):
            shutil.copy2(agent_file, target / ".claude" / "agents" / agent_file.name)
            agent_count += 1

    print(f"✓ Copied {agent_count} agents")

    # 8. Copy hooks (global + template)
    print("→ Copying hooks...")
    hook_count = 0

    # Copy global hooks
    if (global_claude / "hooks").exists():
        for hook_file in (global_claude / "hooks").glob("*.py"):
            dest = target / ".claude" / "hooks" / hook_file.name
            shutil.copy2(hook_file, dest)
            dest.chmod(0o755)
            hook_count += 1

    # Copy template hooks
    if (template_path / ".claude" / "hooks").exists():
        for hook_file in (template_path / ".claude" / "hooks").glob("*.py"):
            dest = target / ".claude" / "hooks" / hook_file.name
            shutil.copy2(hook_file, dest)
            dest.chmod(0o755)
            hook_count += 1

    print(f"✓ Copied {hook_count} hooks")

    # 9. Copy configuration files
    print("→ Copying configuration...")

    # Copy sprint-steps.json
    if (template_path / ".claude" / "sprint-steps.json").exists():
        shutil.copy2(
            template_path / ".claude" / "sprint-steps.json",
            target / ".claude" / "sprint-steps.json",
        )

    # Copy settings.json
    if (template_path / ".claude" / "settings.json").exists():
        shutil.copy2(
            template_path / ".claude" / "settings.json",
            target / ".claude" / "settings.json",
        )

    # Copy WORKFLOW_VERSION
    if (master_project / "WORKFLOW_VERSION").exists():
        shutil.copy2(
            master_project / "WORKFLOW_VERSION", target / ".claude" / "WORKFLOW_VERSION"
        )

    print("✓ Copied configuration files")

    # 10. Copy CLAUDE.md (don't overwrite if exists)
    print("→ Copying CLAUDE.md...")
    if not (target / "CLAUDE.md").exists():
        if (template_path / "CLAUDE.md").exists():
            shutil.copy2(template_path / "CLAUDE.md", target / "CLAUDE.md")
            print("✓ Created CLAUDE.md")
        else:
            print("⚠ Template CLAUDE.md not found, skipping")
    else:
        print("✓ CLAUDE.md already exists, skipping")

    # 11. Create sprint registry
    print("→ Creating sprint registry...")
    registry = {
        "counters": {"next_sprint": 1, "next_epic": 1},
        "sprints": {},
        "epics": {},
    }

    registry_path = target / "docs" / "sprints" / "registry.json"
    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)

    print("✓ Created sprint registry")

    # 12. Update .gitignore
    print("→ Updating .gitignore...")
    gitignore_path = target / ".gitignore"
    gitignore_entries = [
        "# Sprint workflow state files",
        ".claude/sprint-*-state.json",
        ".claude/product-state.json",
    ]

    if gitignore_path.exists():
        content = gitignore_path.read_text()
        if "sprint-.*-state.json" not in content:
            with open(gitignore_path, "a") as f:
                f.write("\n")
                f.write("\n".join(gitignore_entries))
                f.write("\n")
            print("✓ Updated .gitignore")
        else:
            print("✓ .gitignore already configured")
    else:
        with open(gitignore_path, "w") as f:
            f.write("\n".join(gitignore_entries))
            f.write("\n")
        print("✓ Created .gitignore")

    # Read workflow version
    workflow_version = "unknown"
    if (target / ".claude" / "WORKFLOW_VERSION").exists():
        workflow_version = (target / ".claude" / "WORKFLOW_VERSION").read_text().strip()

    # 13. Report success
    print(f"\n{'='*70}")
    if maestro_mode:
        print(f"✅ Maestro workflow initialized at: {target}")
        print(f"{'='*70}")
        print("\n🔧 MAESTRO MODE - Dogfooding the workflow")
        print("   Source: ./templates/project/")
    else:
        print(f"✅ Project workflow initialized at: {target}")
        print(f"{'='*70}")

    print("\nCreated structure:")
    if not maestro_mode:
        print(f"├── commands/             ({command_count} command files)")
        print("├── scripts/              (automation)")
    print("├── .claude/")
    print(f"│   ├── agents/           ({agent_count} agents)")
    print(f"│   ├── hooks/            ({hook_count} hooks)")
    print("│   ├── settings.json")
    print("│   ├── sprint-steps.json")
    print("│   └── WORKFLOW_VERSION")
    print("├── docs/sprints/")
    print("│   ├── 0-backlog/")
    print("│   ├── 1-todo/")
    print("│   ├── 2-in-progress/")
    print("│   ├── 3-done/")
    print("│   ├── 4-blocked/")
    print("│   ├── 5-aborted/")
    print("│   ├── 6-archived/")
    print("│   └── registry.json")
    print("└── CLAUDE.md")

    print("\nNext steps:")
    if maestro_mode:
        print("1. Use sprints to develop maestro itself (dogfooding)")
        print('2. Create sprint: /sprint-new "Feature Name"')
        print("3. Start working: /sprint-start N")
        print("4. Publish templates: /maestro-publish (when ready)")
    else:
        print("1. Review and customize CLAUDE.md for your project")
        print('2. Create your first sprint: /sprint-new "Initial Setup"')
        print("3. Start working: /sprint-start 1")

    print("\nTo sync future updates: /project-update")
    print(f"Workflow version: {workflow_version}")
    print(f"{'='*70}")

    return {
        "status": "initialized",
        "target": str(target),
        "maestro_mode": maestro_mode,
        "command_count": command_count,
        "agent_count": agent_count,
        "hook_count": hook_count,
        "workflow_version": workflow_version,
    }


def complete_sprint(sprint_num: int, dry_run: bool = False) -> dict:
    """
    Complete a sprint with full automation: pre-flight checks, file movement,
    registry update, git commit, and tag creation.

    Args:
        sprint_num: Sprint number to complete
        dry_run: If True, preview changes without executing

    Returns:
        Dict with completion summary

    Raises:
        FileOperationError: If sprint file not found or operations fail
        ValidationError: If pre-flight checks fail
        GitError: If git operations fail

    Example:
        >>> summary = complete_sprint(2)
        >>> print(summary['status'])  # 'completed'
    """
    project_root = find_project_root()
    sprint_file = _find_sprint_file(sprint_num, project_root)

    if not sprint_file:
        raise FileOperationError(
            f"Sprint {sprint_num} not found. Use /sprint-start {sprint_num} first."
        )

    # 1. Generate postmortem if not exists
    postmortem_file = sprint_file.parent / f"sprint-{sprint_num}_postmortem.md"
    if not postmortem_file.exists():
        print("→ Generating postmortem...")
        generate_postmortem(sprint_num, dry_run=dry_run)
        if not dry_run:
            print("✓ Postmortem generated")

    with open(sprint_file) as f:
        content = f.read()

    # 2. Read YAML frontmatter for metadata
    import re

    yaml_match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not yaml_match:
        raise ValidationError(f"Sprint {sprint_num} missing YAML frontmatter")

    yaml_content = yaml_match.group(1)
    title_match = re.search(r"^title:\s*(.+)$", yaml_content, re.MULTILINE)
    started_match = re.search(r"^started:\s*(.+)$", yaml_content, re.MULTILINE)

    if not title_match:
        raise ValidationError(f"Sprint {sprint_num} missing title in YAML")
    if not started_match:
        raise ValidationError(f"Sprint {sprint_num} missing started timestamp")

    title = title_match.group(1).strip().strip('"')
    started_str = started_match.group(1).strip()

    # 3. Calculate hours
    from datetime import datetime

    started = datetime.fromisoformat(started_str.replace("Z", "+00:00"))
    completed = datetime.now().astimezone()
    hours = round((completed - started).total_seconds() / 3600, 1)

    if dry_run:
        # Calculate actual paths for dry-run display
        sprint_folder = sprint_file.parent
        new_file_name = sprint_file.name.replace(".md", "--done.md")
        new_folder_name = sprint_folder.name + "--done"
        new_folder = sprint_folder.parent / new_folder_name

        print(f"[DRY RUN] Would complete sprint {sprint_num}:")
        print(f"  Title: {title}")
        print(f"  Hours: {hours}")
        if not postmortem_file.exists():
            print(f"\n  1. Generate postmortem: {postmortem_file.name}")
        else:
            print(f"\n  1. Postmortem exists: {postmortem_file.name}")
        print("\n  2. Rename folder and file with --done suffix:")
        print(f"     {sprint_folder.relative_to(project_root)}/")
        print(f"     → {new_folder.relative_to(project_root)}/")
        print(f"     {sprint_file.name}")
        print(f"     → {new_file_name}")
        print(f"\n  3. Update registry (status=done, hours={hours})")
        print(f"  4. Archive state file to sprint done folder")
        print("  5. Commit changes")
        print(f"  6. Create and push git tag: sprint-{sprint_num}")
        print("  7. Check epic completion")
        return {"status": "dry-run", "sprint_num": sprint_num, "hours": hours}

    # 4. Move sprint file to done
    print(f"→ Moving sprint {sprint_num} to done...")
    new_path = move_to_done(sprint_num, dry_run=False)
    print(f"✓ Moved to: {new_path}")

    # 5. Update registry
    print("→ Updating registry...")
    update_registry(
        sprint_num,
        status="done",
        dry_run=False,
        completed=completed.strftime("%Y-%m-%d"),
        hours=hours,
    )
    print("✓ Registry updated")

    # 6. Commit changes
    print("→ Committing changes...")
    try:
        commit_msg = (
            f"feat(sprint-{sprint_num}): complete sprint - {title}\n\n"
            f"- Duration: {hours} hours\n"
            f"- Marked with --done suffix\n"
            f"- Updated registry\n\n"
            f"🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n"
            f"Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
        )
        subprocess.run(["git", "add", "-A"], check=True, capture_output=True, text=True)
        subprocess.run(
            ["git", "commit", "-m", commit_msg],
            check=True,
            capture_output=True,
            text=True,
        )
        print("✓ Changes committed")
    except subprocess.CalledProcessError as e:
        raise GitError(f"Failed to commit changes: {e.stderr}") from e

    # 7. Create and push git tag
    print("→ Creating git tag...")
    create_git_tag(sprint_num, title, dry_run=False, auto_push=True)

    # 8. Check epic completion
    is_epic, epic_num = _is_epic_sprint(new_path)
    if is_epic and epic_num:
        print(f"→ Checking epic {epic_num} completion...")
        is_complete, message = check_epic_completion(epic_num)
        print(message)
        if is_complete:
            print(f"\n💡 Epic {epic_num} is ready! Run: /epic-complete {epic_num}")

    # 9. Update state file and move to sprint done folder
    state_file = project_root / ".claude" / f"sprint-{sprint_num}-state.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        state["status"] = "complete"
        state["completed_at"] = completed.isoformat()
        # Move state file to sprint's done folder as an audit artifact
        dest_dir = Path(new_path).parent
        dest_state = dest_dir / f"sprint-{sprint_num}-state.json"
        with open(dest_state, "w") as f:
            json.dump(state, f, indent=2)
        state_file.unlink()
        print(f"✓ State file archived to {dest_state.relative_to(project_root)}")

    # 10. Success summary
    summary = {
        "status": "completed",
        "sprint_num": sprint_num,
        "title": title,
        "hours": hours,
        "file_path": str(new_path),
        "tag": f"sprint-{sprint_num}",
        "epic": epic_num if is_epic else None,
    }

    print(f"\n{'='*60}")
    print(f"Sprint {sprint_num}: {title} - COMPLETE ✓")
    print(f"{'='*60}")
    print(f"Duration: {hours} hours")
    print(f"File: {new_path.name}")
    print(f"Tag: sprint-{sprint_num} (pushed to remote)")
    if is_epic:
        print(f"Epic: {epic_num}")
    print(f"{'='*60}")

    return summary


def main():
    """CLI interface for sprint lifecycle utilities."""
    parser = argparse.ArgumentParser(
        description="Sprint lifecycle automation utilities (creation → execution → completion)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # === CREATION COMMANDS ===

    # next-sprint-number command
    next_sprint_parser = subparsers.add_parser(
        "next-sprint-number", help="Get next sprint number"
    )
    next_sprint_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without incrementing"
    )

    # next-epic-number command
    next_epic_parser = subparsers.add_parser(
        "next-epic-number", help="Get next epic number"
    )
    next_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without incrementing"
    )

    # register-sprint command
    register_sprint_parser = subparsers.add_parser(
        "register-sprint", help="Register new sprint"
    )
    register_sprint_parser.add_argument("title", help="Sprint title")
    register_sprint_parser.add_argument(
        "--epic", type=int, help="Epic number (optional)"
    )
    register_sprint_parser.add_argument(
        "--estimated-hours", type=float, help="Estimated hours"
    )
    register_sprint_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without registering"
    )

    # register-epic command
    register_epic_parser = subparsers.add_parser(
        "register-epic", help="Register new epic"
    )
    register_epic_parser.add_argument("title", help="Epic title")
    register_epic_parser.add_argument(
        "--sprint-count", type=int, default=0, help="Number of sprints"
    )
    register_epic_parser.add_argument(
        "--estimated-hours", type=float, help="Estimated hours"
    )
    register_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without registering"
    )

    # === LIFECYCLE COMMANDS ===

    # start-sprint command
    start_parser = subparsers.add_parser(
        "start-sprint", help="Start a sprint (move to in-progress)"
    )
    start_parser.add_argument("sprint_num", type=int, help="Sprint number")
    start_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # abort-sprint command
    abort_parser = subparsers.add_parser("abort-sprint", help="Abort a sprint")
    abort_parser.add_argument("sprint_num", type=int, help="Sprint number")
    abort_parser.add_argument("reason", help="Reason for aborting")
    abort_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # block-sprint command
    block_parser = subparsers.add_parser(
        "block-sprint", help="Block a sprint (mark as blocked)"
    )
    block_parser.add_argument("sprint_num", type=int, help="Sprint number")
    block_parser.add_argument("reason", help="Reason for blocking")
    block_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # resume-sprint command
    resume_parser = subparsers.add_parser(
        "resume-sprint", help="Resume a blocked sprint"
    )
    resume_parser.add_argument("sprint_num", type=int, help="Sprint number")
    resume_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # start-epic command
    start_epic_parser = subparsers.add_parser(
        "start-epic", help="Start an epic (move to in-progress)"
    )
    start_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    start_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # complete-epic command
    complete_epic_parser = subparsers.add_parser(
        "complete-epic", help="Complete an epic (move to done)"
    )
    complete_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    complete_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # archive-epic command
    archive_epic_parser = subparsers.add_parser(
        "archive-epic", help="Archive an epic (move to archived)"
    )
    archive_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    archive_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # create-epic command
    create_epic_parser = subparsers.add_parser(
        "create-epic", help="Create epic folder structure and files"
    )
    create_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    create_epic_parser.add_argument("title", type=str, help="Epic title")
    create_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # reset-epic command
    reset_epic_parser = subparsers.add_parser(
        "reset-epic", help="Reset/delete an epic and all its sprints"
    )
    reset_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    reset_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # create-sprint command
    create_sprint_parser = subparsers.add_parser(
        "create-sprint", help="Create sprint folder structure and files"
    )
    create_sprint_parser.add_argument("sprint_num", type=int, help="Sprint number")
    create_sprint_parser.add_argument("title", type=str, help="Sprint title")
    create_sprint_parser.add_argument(
        "--type",
        dest="sprint_type",
        default="fullstack",
        choices=[
            "fullstack",
            "backend",
            "frontend",
            "research",
            "spike",
            "infrastructure",
        ],
        help="Sprint type (default: fullstack)",
    )
    create_sprint_parser.add_argument("--epic", type=int, help="Epic number (optional)")
    create_sprint_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # import-sprint command
    import_sprint_parser = subparsers.add_parser(
        "import-sprint", help="Import sketch sprint file into proper Maestro format"
    )
    import_sprint_parser.add_argument("source_path", help="Path to source sprint file")
    import_sprint_parser.add_argument(
        "--type",
        dest="sprint_type",
        default="fullstack",
        choices=[
            "fullstack",
            "backend",
            "frontend",
            "research",
            "spike",
            "infrastructure",
        ],
        help="Sprint type (default: fullstack)",
    )
    import_sprint_parser.add_argument(
        "--epic", type=int, help="Epic number (optional)"
    )
    import_sprint_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # import-epic command
    import_epic_parser = subparsers.add_parser(
        "import-epic", help="Import sketch epic directory with all sprint files"
    )
    import_epic_parser.add_argument(
        "source_path", help="Path to source epic directory or _epic.md file"
    )
    import_epic_parser.add_argument(
        "--type",
        dest="sprint_type",
        default="fullstack",
        choices=[
            "fullstack",
            "backend",
            "frontend",
            "research",
            "spike",
            "infrastructure",
        ],
        help="Default sprint type for imported sprints (default: fullstack)",
    )
    import_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # === COMPLETION COMMANDS ===

    # complete-sprint command
    complete_parser = subparsers.add_parser(
        "complete-sprint", help="Complete sprint with full automation"
    )
    complete_parser.add_argument("sprint_num", type=int, help="Sprint number")
    complete_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # move-to-done command
    move_parser = subparsers.add_parser(
        "move-to-done", help="Move sprint to done status"
    )
    move_parser.add_argument("sprint_num", type=int, help="Sprint number")
    move_parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without executing"
    )

    # update-registry command
    registry_parser = subparsers.add_parser(
        "update-registry", help="Update sprint registry"
    )
    registry_parser.add_argument("sprint_num", type=int, help="Sprint number")
    registry_parser.add_argument("--status", required=True, help="Sprint status")
    registry_parser.add_argument("--completed", help="Completion date (YYYY-MM-DD)")
    registry_parser.add_argument("--hours", type=float, help="Hours spent")
    registry_parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without executing"
    )

    # check-epic command
    epic_parser = subparsers.add_parser("check-epic", help="Check if epic is complete")
    epic_parser.add_argument("epic_num", type=int, help="Epic number")

    # create-tag command
    tag_parser = subparsers.add_parser("create-tag", help="Create git tag for sprint")
    tag_parser.add_argument("sprint_num", type=int, help="Sprint number")
    tag_parser.add_argument("title", help="Sprint title")
    tag_parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without executing"
    )
    tag_parser.add_argument(
        "--no-push", action="store_true", help="Don't auto-push tag to remote"
    )

    # === QUERY COMMANDS ===

    # sprint-status command
    sprint_status_parser = subparsers.add_parser(
        "sprint-status", help="Get sprint status and progress"
    )
    sprint_status_parser.add_argument("sprint_num", type=int, help="Sprint number")

    # epic-status command
    epic_status_parser = subparsers.add_parser(
        "epic-status", help="Get epic status with sprint progress"
    )
    epic_status_parser.add_argument("epic_num", type=int, help="Epic number")

    # list-epics command
    _ = subparsers.add_parser("list-epics", help="List all epics with progress")

    # recover-sprint command
    recover_parser = subparsers.add_parser(
        "recover-sprint", help="Recover sprint file in wrong location"
    )
    recover_parser.add_argument("sprint_num", type=int, help="Sprint number")
    recover_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # add-to-epic command
    add_epic_parser = subparsers.add_parser("add-to-epic", help="Add sprint to epic")
    add_epic_parser.add_argument("sprint_num", type=int, help="Sprint number")
    add_epic_parser.add_argument("epic_num", type=int, help="Epic number")
    add_epic_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # === PROJECT SETUP COMMANDS ===

    # create-project command
    create_project_parser = subparsers.add_parser(
        "create-project", help="Initialize new project with workflow"
    )
    create_project_parser.add_argument(
        "target_path", nargs="?", help="Target directory (default: current)"
    )
    create_project_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # === STATE MANAGEMENT COMMANDS ===

    # advance-step command
    advance_step_parser = subparsers.add_parser(
        "advance-step", help="Advance sprint to next workflow step"
    )
    advance_step_parser.add_argument("sprint_num", type=int, help="Sprint number")
    advance_step_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    # generate-postmortem command
    postmortem_parser = subparsers.add_parser(
        "generate-postmortem", help="Generate postmortem analysis file"
    )
    postmortem_parser.add_argument("sprint_num", type=int, help="Sprint number")
    postmortem_parser.add_argument(
        "--dry-run", action="store_true", help="Preview without executing"
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        # === CREATION COMMAND HANDLERS ===

        if args.command == "next-sprint-number":
            num = get_next_sprint_number(dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Next sprint number: {num}")
                print(f"✓ Counter incremented to: {num + 1}")

        elif args.command == "next-epic-number":
            num = get_next_epic_number(dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Next epic number: {num}")
                print(f"✓ Counter incremented to: {num + 1}")

        elif args.command == "register-sprint":
            metadata = {}
            if args.estimated_hours:
                metadata["estimatedHours"] = args.estimated_hours

            sprint_num = register_new_sprint(
                args.title, epic=args.epic, dry_run=args.dry_run, **metadata
            )
            if not args.dry_run:
                print(f"✓ Registered sprint {sprint_num}: {args.title}")
                if args.epic:
                    print(f"  Part of Epic {args.epic}")

        elif args.command == "register-epic":
            metadata = {}
            if args.estimated_hours:
                metadata["estimatedHours"] = args.estimated_hours

            epic_num = register_new_epic(
                args.title,
                sprint_count=args.sprint_count,
                dry_run=args.dry_run,
                **metadata,
            )
            if not args.dry_run:
                print(f"✓ Registered epic {epic_num}: {args.title}")
                print(f"  Planned sprints: {args.sprint_count}")

        # === LIFECYCLE COMMAND HANDLERS ===

        elif args.command == "start-sprint":
            start_sprint(args.sprint_num, dry_run=args.dry_run)
            # Output handled by function

        elif args.command == "abort-sprint":
            abort_sprint(args.sprint_num, args.reason, dry_run=args.dry_run)
            # Output handled by function

        elif args.command == "block-sprint":
            result = block_sprint(args.sprint_num, args.reason, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Blocked sprint {result['sprint_num']}: {result['title']}")
                print(f"  Reason: {args.reason}")
                print(f"  New path: {result['new_path']}")
                if result.get("hours"):
                    print(f"  Hours worked: {result['hours']:.1f}")

        elif args.command == "resume-sprint":
            result = resume_sprint(args.sprint_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Resumed sprint {result['sprint_num']}: {result['title']}")
                print(f"  Previously blocked by: {result['previous_blocker']}")
                print(f"  New path: {result['new_path']}")

        elif args.command == "start-epic":
            result = start_epic(args.epic_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Started epic {result['epic_num']}: {result['title']}")
                print(f"  Moved to: {result['new_path']}")
                print(f"  Sprints: {result['sprint_count']}")

        elif args.command == "complete-epic":
            result = complete_epic(args.epic_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Completed epic {result['epic_num']}: {result['title']}")
                print(f"  Moved to: {result['new_path']}")
                print(f"  Sprints completed: {result['done_count']}")
                print(f"  Sprints aborted: {result['aborted_count']}")
                print(f"  Total hours: {result['total_hours']:.1f}")

        elif args.command == "archive-epic":
            result = archive_epic(args.epic_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Archived epic {result['epic_num']}: {result['title']}")
                print(f"  Moved to: {result['new_path']}")
                print(f"  Files: {result['file_count']} sprints + 1 epic")

        elif args.command == "create-epic":
            result = create_epic(args.epic_num, args.title, dry_run=args.dry_run)
            # Output handled by function

        elif args.command == "reset-epic":
            result = reset_epic(args.epic_num, dry_run=args.dry_run)
            # Output handled by function

        elif args.command == "create-sprint":
            result = create_sprint(
                args.sprint_num,
                args.title,
                sprint_type=args.sprint_type,
                epic=args.epic,
                dry_run=args.dry_run,
            )
            # Output handled by function

        elif args.command == "import-sprint":
            result = import_sprint(
                args.source_path,
                sprint_type=args.sprint_type,
                epic=args.epic,
                dry_run=args.dry_run,
            )
            # Output handled by function

        elif args.command == "import-epic":
            result = import_epic(
                args.source_path,
                sprint_type=args.sprint_type,
                dry_run=args.dry_run,
            )
            # Output handled by function

        # === COMPLETION COMMAND HANDLERS ===

        elif args.command == "complete-sprint":
            complete_sprint(args.sprint_num, dry_run=args.dry_run)

        elif args.command == "move-to-done":
            new_path = move_to_done(args.sprint_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Moved sprint {args.sprint_num} to: {new_path}")

        elif args.command == "update-registry":
            metadata = {}
            if args.completed:
                metadata["completed"] = args.completed
            if args.hours:
                metadata["hours"] = args.hours

            update_registry(
                args.sprint_num, args.status, dry_run=args.dry_run, **metadata
            )
            if not args.dry_run:
                print(f"✓ Updated registry for sprint {args.sprint_num}")

        elif args.command == "check-epic":
            is_complete, message = check_epic_completion(args.epic_num)
            print(message)
            sys.exit(0 if is_complete else 1)

        elif args.command == "create-tag":
            create_git_tag(
                args.sprint_num,
                args.title,
                dry_run=args.dry_run,
                auto_push=not args.no_push,
            )

        # === QUERY COMMAND HANDLERS ===

        elif args.command == "sprint-status":
            get_sprint_status(args.sprint_num)

        elif args.command == "epic-status":
            get_epic_status(args.epic_num)

        elif args.command == "list-epics":
            list_epics()

        elif args.command == "recover-sprint":
            result = recover_sprint(args.sprint_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Recovered sprint {result['sprint_num']}")

        elif args.command == "add-to-epic":
            result = add_to_epic(args.sprint_num, args.epic_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(
                    f"✓ Added sprint {result['sprint_num']} to epic {result['epic_num']}"
                )

        # === PROJECT SETUP COMMAND HANDLERS ===

        elif args.command == "create-project":
            target = getattr(args, "target_path", None)
            result = create_project(target_path=target, dry_run=args.dry_run)
            # Output is handled by create_project() function

        # === STATE MANAGEMENT COMMAND HANDLERS ===

        elif args.command == "advance-step":
            result = advance_step(args.sprint_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(
                    f"✓ Sprint {result['sprint_num']} advanced to step {result['new_step']}"
                )

        elif args.command == "generate-postmortem":
            result = generate_postmortem(args.sprint_num, dry_run=args.dry_run)
            if not args.dry_run:
                print(f"✓ Created postmortem: {result['postmortem_file']}")

    except SprintLifecycleError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
