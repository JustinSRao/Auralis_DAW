#!/usr/bin/env python3
"""
Ralph Loop Stop Hook for Sprint Workflow

Implements the Ralph Wiggum technique for continuous AI agent loops.
When Ralph mode is active, this hook intercepts session exit and
re-injects the sprint prompt to continue iteration.

The loop continues until:
- Completion promise is detected in output
- Max iterations reached
- User cancels via /sprint-ralph-stop
- Tests pass and all tasks complete

Usage:
    /sprint-start <N> --ralph           # Start sprint in Ralph mode
    /sprint-ralph-stop                  # Cancel active Ralph loop
    /sprint-status                      # Check Ralph iteration count
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path


def main():
    """Main entry point for Ralph Stop hook."""
    try:
        # Read hook input from stdin
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, allow exit
        print(json.dumps({}))
        sys.exit(0)

    project_root = Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))

    # Check if Ralph mode is active for any sprint
    ralph_state = get_active_ralph_state(project_root)

    if not ralph_state:
        # No active Ralph loop, allow normal exit
        print(json.dumps({}))
        sys.exit(0)

    # Check termination conditions
    should_stop, reason = check_termination_conditions(ralph_state, hook_data, project_root)

    if should_stop:
        # Deactivate Ralph mode and allow exit
        deactivate_ralph_mode(ralph_state["state_file"], reason)
        print(json.dumps({
            "systemMessage": f"🛑 Ralph loop ended: {reason}\n"
                           f"Iterations completed: {ralph_state.get('iteration', 0)}"
        }))
        sys.exit(0)

    # Continue the loop - increment iteration and re-inject prompt
    new_iteration = ralph_state.get("iteration", 0) + 1
    update_ralph_iteration(ralph_state["state_file"], new_iteration)

    # Generate the continuation prompt
    continuation_prompt = generate_continuation_prompt(ralph_state, new_iteration, project_root)

    # Return the prompt to continue the loop
    result = {
        "decision": "block",
        "reason": f"Ralph loop iteration {new_iteration}/{ralph_state.get('max_iterations', '∞')}",
        "updatedUserMessage": continuation_prompt
    }

    print(json.dumps(result))
    sys.exit(0)


def get_active_ralph_state(project_root: Path) -> dict | None:
    """Find active Ralph loop state from any sprint state file."""
    claude_dir = project_root / ".claude"

    if not claude_dir.exists():
        return None

    # Check all sprint state files
    for state_file in claude_dir.glob("sprint-*-state.json"):
        try:
            with open(state_file) as f:
                state = json.load(f)

            ralph_config = state.get("ralph_mode", {})
            if ralph_config.get("active"):
                return {
                    "state_file": state_file,
                    "sprint_number": state.get("sprint_number"),
                    "sprint_file": state.get("sprint_file"),
                    "iteration": ralph_config.get("iteration", 0),
                    "max_iterations": ralph_config.get("max_iterations", 100),
                    "completion_promise": ralph_config.get("completion_promise", "SPRINT_COMPLETE"),
                    "started_at": ralph_config.get("started_at"),
                    "current_step": state.get("current_step"),
                    "current_phase": state.get("current_phase"),
                    **state
                }
        except (json.JSONDecodeError, OSError):
            continue

    return None


def check_termination_conditions(ralph_state: dict, hook_data: dict, project_root: Path) -> tuple[bool, str]:
    """Check if Ralph loop should terminate."""

    # 1. Check max iterations
    current_iter = ralph_state.get("iteration", 0) + 1
    max_iter = ralph_state.get("max_iterations", 100)
    if max_iter > 0 and current_iter >= max_iter:
        return True, f"Max iterations reached ({max_iter})"

    # 2. Check for completion promise in recent output
    # The hook_data might contain recent conversation output
    transcript = hook_data.get("transcript", "")
    if isinstance(transcript, list):
        transcript = "\n".join(str(msg) for msg in transcript[-5:])  # Last 5 messages

    completion_promise = ralph_state.get("completion_promise", "SPRINT_COMPLETE")
    if completion_promise and completion_promise in str(transcript):
        return True, f"Completion promise detected: {completion_promise}"

    # 3. Check for manual cancellation flag
    cancel_file = project_root / ".claude" / "ralph-cancel"
    if cancel_file.exists():
        try:
            cancel_file.unlink()
        except OSError:
            pass
        return True, "Manually cancelled via /sprint-ralph-stop"

    # 4. Check if sprint is TRULY complete (all tasks done, not just tests passing)
    state_file = ralph_state.get("state_file")
    if state_file and state_file.exists():
        try:
            with open(state_file) as f:
                current_state = json.load(f)

            status = current_state.get("status", "")
            if status in ("complete", "done"):
                return True, "Sprint marked complete"

            # CRITICAL: Check if ALL tasks are actually done
            # This prevents early termination when only partial work is complete
            task_verification = verify_all_tasks_complete(current_state, project_root)
            if not task_verification["all_complete"]:
                # NOT done yet - continue looping
                return False, ""

            # Check if all pre-flight checks passed AND all tasks verified
            checklist = current_state.get("pre_flight_checklist", {})
            required_checks = ["tests_passing", "sprint_file_updated"]
            if all(checklist.get(check) for check in required_checks):
                current_phase = current_state.get("current_phase", 0)
                if current_phase >= 4:
                    return True, "All tasks complete and pre-flight passed"
        except (json.JSONDecodeError, OSError):
            pass

    # Continue the loop
    return False, ""


def verify_all_tasks_complete(state: dict, project_root: Path) -> dict:
    """
    CRITICAL BACKPRESSURE: Verify ALL tasks from sprint are actually done.

    This prevents Ralph from terminating when only partial work is complete.
    For example, if sprint says "create 20 screens" but only 3 exist, this catches it.

    Returns: {
        "all_complete": bool,
        "total_tasks": int,
        "completed_tasks": int,
        "missing_tasks": [list of incomplete items],
        "verification_method": str
    }
    """
    result = {
        "all_complete": False,
        "total_tasks": 0,
        "completed_tasks": 0,
        "missing_tasks": [],
        "verification_method": "none"
    }

    # Method 1: Check task_tracking in state (if populated by sprint workflow)
    task_tracking = state.get("task_tracking", {})
    if task_tracking:
        tasks = task_tracking.get("tasks", [])
        if tasks:
            result["total_tasks"] = len(tasks)
            completed = [t for t in tasks if t.get("status") == "done"]
            result["completed_tasks"] = len(completed)
            result["missing_tasks"] = [t.get("name", "unknown") for t in tasks if t.get("status") != "done"]
            result["all_complete"] = len(completed) == len(tasks)
            result["verification_method"] = "task_tracking"
            return result

    # Method 2: Check acceptance_criteria in state
    acceptance_criteria = state.get("acceptance_criteria", [])
    if acceptance_criteria:
        result["total_tasks"] = len(acceptance_criteria)
        completed = [ac for ac in acceptance_criteria if ac.get("verified")]
        result["completed_tasks"] = len(completed)
        result["missing_tasks"] = [ac.get("description", "unknown") for ac in acceptance_criteria if not ac.get("verified")]
        result["all_complete"] = len(completed) == len(acceptance_criteria)
        result["verification_method"] = "acceptance_criteria"
        return result

    # Method 3: Read sprint file and extract tasks
    sprint_file = state.get("sprint_file")
    if sprint_file:
        sprint_path = project_root / sprint_file if not Path(sprint_file).is_absolute() else Path(sprint_file)
        if sprint_path.exists():
            tasks_from_file = extract_tasks_from_sprint_file(sprint_path)
            if tasks_from_file:
                result["total_tasks"] = len(tasks_from_file)
                # Can't auto-verify without more context, assume not complete
                # This forces the agent to explicitly mark tasks done
                result["completed_tasks"] = 0
                result["missing_tasks"] = tasks_from_file
                result["all_complete"] = False
                result["verification_method"] = "sprint_file_extraction"
                return result

    # Method 4: Fallback - check if we're in phase 4+ (post-validation)
    current_phase = state.get("current_phase", 0)
    if current_phase >= 4:
        # If we've passed validation phase, assume tasks are done
        result["all_complete"] = True
        result["verification_method"] = "phase_based"
        return result

    # Cannot verify - default to NOT complete to be safe
    result["verification_method"] = "unknown"
    return result


def extract_tasks_from_sprint_file(sprint_path: Path) -> list[str]:
    """Extract task list from sprint markdown file."""
    tasks = []
    try:
        with open(sprint_path) as f:
            content = f.read()

        # Look for common task patterns in markdown
        import re

        # Pattern 1: Checkbox items under Tasks/Acceptance Criteria sections
        # - [ ] Task description
        # - [x] Completed task
        checkbox_pattern = r'- \[ \] (.+)'
        unchecked = re.findall(checkbox_pattern, content)
        tasks.extend(unchecked)

        # Pattern 2: Numbered items under "Tasks:" or "Acceptance Criteria:"
        # 1. Task description
        sections = re.split(r'#+\s*(Tasks|Acceptance Criteria|Requirements|Deliverables)', content, flags=re.IGNORECASE)
        for i, section in enumerate(sections):
            if i > 0 and i < len(sections) - 1:
                next_section = sections[i + 1]
                numbered = re.findall(r'^\d+\.\s+(.+)$', next_section, re.MULTILINE)
                tasks.extend(numbered[:20])  # Limit to prevent runaway

    except (OSError, Exception):
        pass

    # Deduplicate while preserving order
    seen = set()
    unique_tasks = []
    for task in tasks:
        task_clean = task.strip()
        if task_clean and task_clean not in seen:
            seen.add(task_clean)
            unique_tasks.append(task_clean)

    return unique_tasks[:50]  # Cap at 50 tasks


def deactivate_ralph_mode(state_file: Path, reason: str):
    """Deactivate Ralph mode in state file."""
    try:
        with open(state_file) as f:
            state = json.load(f)

        state["ralph_mode"]["active"] = False
        state["ralph_mode"]["ended_at"] = datetime.utcnow().isoformat() + "Z"
        state["ralph_mode"]["end_reason"] = reason

        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
    except (json.JSONDecodeError, OSError, KeyError):
        pass


def update_ralph_iteration(state_file: Path, iteration: int):
    """Update iteration count in state file."""
    try:
        with open(state_file) as f:
            state = json.load(f)

        state["ralph_mode"]["iteration"] = iteration
        state["ralph_mode"]["last_iteration_at"] = datetime.utcnow().isoformat() + "Z"

        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
    except (json.JSONDecodeError, OSError, KeyError):
        pass


def generate_continuation_prompt(ralph_state: dict, iteration: int, project_root: Path) -> str:
    """Generate the prompt for the next Ralph iteration."""
    sprint_number = ralph_state.get("sprint_number", "?")
    sprint_file = ralph_state.get("sprint_file", "")
    current_step = ralph_state.get("current_step", "2.1")
    current_phase = ralph_state.get("current_phase", 2)
    max_iterations = ralph_state.get("max_iterations", 100)
    completion_promise = ralph_state.get("completion_promise", "SPRINT_COMPLETE")

    # Read current state for more context
    test_results = ralph_state.get("test_results", {})
    coverage = ralph_state.get("coverage_percentage", 0)

    # CRITICAL: Get task verification status
    task_status = verify_all_tasks_complete(ralph_state, project_root)
    tasks_complete = task_status.get("completed_tasks", 0)
    tasks_total = task_status.get("total_tasks", "?")
    missing_tasks = task_status.get("missing_tasks", [])

    # Format missing tasks for display
    missing_tasks_display = ""
    if missing_tasks:
        missing_list = "\n".join(f"   - {task}" for task in missing_tasks[:10])
        if len(missing_tasks) > 10:
            missing_list += f"\n   ... and {len(missing_tasks) - 10} more"
        missing_tasks_display = f"""
### ⚠️ INCOMPLETE TASKS ({len(missing_tasks)} remaining)
{missing_list}

**YOU MUST COMPLETE ALL TASKS ABOVE BEFORE THE SPRINT CAN FINISH.**
"""

    return f"""
🔄 **RALPH LOOP - Iteration {iteration}/{max_iterations}**

## Current Sprint
- **Sprint**: {sprint_number}
- **File**: {sprint_file}
- **Phase**: {current_phase}
- **Step**: {current_step}

## Task Completion Status
- **Tasks**: {tasks_complete}/{tasks_total} complete
- **Tests**: {test_results.get('passed', '?')}/{test_results.get('total', '?')} passing
- **Coverage**: {coverage}%
{missing_tasks_display}
## Your Task
Continue working on Sprint {sprint_number}. You are in an autonomous loop.

### Priority Actions (in order):
1. **Check incomplete tasks above** - Focus on completing missing work
2. **Read sprint file** - Verify you haven't missed any requirements
3. **If tests failing** - Fix the failures
4. **If implementation incomplete** - Continue implementing ALL items
5. **If lint/type errors** - Fix them
6. **When ALL tasks done** - Advance via /sprint-next {sprint_number}

### Backpressure Gates (ALL must pass before completion)
- [ ] ALL tasks from sprint file completed (not just some)
- [ ] All tests passing
- [ ] Coverage >= 75%
- [ ] Lint clean (ruff check)
- [ ] Type check clean (mypy)

### Commands Available
- `/sprint-status {sprint_number}` - Check detailed progress
- `/sprint-next {sprint_number}` - Advance to next step
- `/sprint-ralph-stop` - Cancel this loop

### Completion
When the sprint is FULLY complete (ALL tasks done, phase 4 done), output:
```
<promise>{completion_promise}</promise>
```

**CRITICAL: Do not stop until ALL tasks are complete. Check the sprint file for the full list.**

---
Continue working on the sprint now.
"""


if __name__ == "__main__":
    main()
