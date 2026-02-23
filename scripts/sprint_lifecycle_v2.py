"""
Sprint Lifecycle V2 - Facade to modular package.

This module provides backward compatibility with the original sprint_lifecycle.py
API while using the new modular sprint_automation package internally.

Usage:
    # Can be used as a drop-in replacement for sprint_lifecycle.py
    from sprint_lifecycle_v2 import create_sprint, start_sprint, complete_sprint
"""

# Re-export everything from the modular package
from scripts.sprint_automation import (
    # Constants
    FOLDER_ARCHIVED,
    FOLDER_BACKLOG,
    FOLDER_BLOCKED,
    FOLDER_DONE,
    FOLDER_IN_PROGRESS,
    FOLDER_TODO,
    STATUS_ABORTED,
    STATUS_BLOCKED,
    STATUS_DONE,
    # Exceptions
    FileOperationError,
    GitError,
    SprintLifecycleError,
    ValidationError,
    # Epic operations
    add_to_epic,
    archive_epic,
    complete_epic,
    create_epic,
    get_epic_status,
    list_epics,
    reset_epic,
    start_epic,
    # Project operations
    create_project,
    # Registry operations
    check_epic_completion,
    get_next_epic_number,
    get_next_sprint_number,
    load_registry,
    register_new_epic,
    register_new_sprint,
    save_registry,
    update_registry,
    # Sprint operations
    abort_sprint,
    advance_step,
    block_sprint,
    complete_sprint,
    create_sprint,
    generate_postmortem,
    get_sprint_status,
    move_to_done,
    recover_sprint,
    resume_sprint,
    start_sprint,
    # Utilities
    check_git_clean,
    create_git_tag,
    find_epic_folder,
    find_project_root,
    find_sprint_file,
    get_registry_path,
    get_sprints_dir,
    is_epic_sprint,
    update_yaml_frontmatter,
)

# Private utility functions (prefixed with _) for backward compatibility
# These are internal functions that shouldn't be used externally
# but some scripts might depend on them
_find_sprint_file = find_sprint_file
_is_epic_sprint = is_epic_sprint
_update_yaml_frontmatter = update_yaml_frontmatter

# Explicit exports to satisfy linter
__all__ = [
    # Constants
    "FOLDER_ARCHIVED",
    "FOLDER_BACKLOG",
    "FOLDER_BLOCKED",
    "FOLDER_DONE",
    "FOLDER_IN_PROGRESS",
    "FOLDER_TODO",
    "STATUS_ABORTED",
    "STATUS_BLOCKED",
    "STATUS_DONE",
    # Exceptions
    "FileOperationError",
    "GitError",
    "SprintLifecycleError",
    "ValidationError",
    # Epic operations
    "add_to_epic",
    "archive_epic",
    "complete_epic",
    "create_epic",
    "get_epic_status",
    "list_epics",
    "reset_epic",
    "start_epic",
    # Project operations
    "create_project",
    # Registry operations
    "check_epic_completion",
    "get_next_epic_number",
    "get_next_sprint_number",
    "load_registry",
    "register_new_epic",
    "register_new_sprint",
    "save_registry",
    "update_registry",
    # Sprint operations
    "abort_sprint",
    "advance_step",
    "block_sprint",
    "complete_sprint",
    "create_sprint",
    "generate_postmortem",
    "get_sprint_status",
    "move_to_done",
    "recover_sprint",
    "resume_sprint",
    "start_sprint",
    # Utilities
    "check_git_clean",
    "create_git_tag",
    "find_epic_folder",
    "find_project_root",
    "find_sprint_file",
    "get_registry_path",
    "get_sprints_dir",
    "is_epic_sprint",
    "update_yaml_frontmatter",
    # Private
    "_find_sprint_file",
    "_is_epic_sprint",
    "_update_yaml_frontmatter",
    # CLI
    "main",
]


def main():
    """CLI entry point - delegates to the modular package."""
    from scripts.sprint_automation.__main__ import main as modular_main

    modular_main()


if __name__ == "__main__":
    main()
