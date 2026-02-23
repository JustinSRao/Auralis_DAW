#!/usr/bin/env python3
"""
Utility functions for sprint step validation.

Used by other hooks and can be imported for testing.
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Paths relative to project root
STATE_FILE = Path(".claude/sprint-state.json")
STEPS_FILE = Path(".claude/sprint-steps.json")

# Quality gate configuration by sprint type
QUALITY_GATES = {
    "fullstack": {"coverage": 75, "integration_tests": True, "documentation": False},
    "backend": {"coverage": 85, "integration_tests": True, "documentation": False},
    "frontend": {"coverage": 70, "visual_regression": True, "documentation": False},
    "research": {"coverage": 30, "documentation": True},  # MANDATORY docs
    "spike": {"coverage": 0, "documentation": True},  # MANDATORY docs
    "infrastructure": {"coverage": 60, "smoke_tests": True}
}


def load_state() -> Optional[dict]:
    """Load sprint state from file."""
    if not STATE_FILE.exists():
        return None
    with open(STATE_FILE) as f:
        return json.load(f)


def save_state(state: dict) -> None:
    """Save sprint state to file."""
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def load_steps() -> dict:
    """Load step definitions."""
    with open(STEPS_FILE) as f:
        return json.load(f)


def get_step_info(step_id: str) -> Optional[dict]:
    """Get info for a specific step."""
    steps = load_steps()
    for phase in steps["phases"]:
        for step in phase["steps"]:
            if step["step"] == step_id:
                return {**step, "phase_name": phase["name"], "phase": phase["phase"]}
    return None


def get_next_step(current_step: str) -> Optional[str]:
    """Get the next step in the workflow."""
    steps = load_steps()
    order = steps["step_order"]
    try:
        idx = order.index(current_step)
        if idx + 1 < len(order):
            return order[idx + 1]
    except ValueError:
        pass
    return None


def get_current_phase(step_id: str) -> int:
    """Extract phase number from step ID."""
    return int(step_id.split(".")[0])


def extract_sprint_type_from_file(sprint_file_path: Path) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Extract sprint type and coverage override from sprint YAML frontmatter.

    Args:
        sprint_file_path: Path to the sprint markdown file

    Returns:
        Tuple of (sprint_type, coverage_override, justification)
        - sprint_type: One of the keys in QUALITY_GATES, or None if not specified
        - coverage_override: Integer override value, or None
        - justification: Comment line following coverage_threshold, or None
    """
    if not sprint_file_path or not sprint_file_path.exists():
        return None, None, None

    try:
        with open(sprint_file_path) as f:
            content = f.read()

        # Extract YAML frontmatter (between --- markers)
        frontmatter_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
        if not frontmatter_match:
            return None, None, None

        frontmatter = frontmatter_match.group(1)

        # Extract type field
        sprint_type = None
        type_match = re.search(r'^type:\s*([a-z_-]+)', frontmatter, re.MULTILINE)
        if type_match:
            sprint_type = type_match.group(1).strip()

        # Extract coverage_threshold override
        coverage_override = None
        justification = None
        threshold_match = re.search(r'^coverage_threshold:\s*(\d+)', frontmatter, re.MULTILINE)
        if threshold_match:
            coverage_override = int(threshold_match.group(1))

            # Look for justification comment on following line(s)
            lines = frontmatter.split('\n')
            for i, line in enumerate(lines):
                if 'coverage_threshold:' in line and i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line.startswith('#'):
                        justification = next_line.lstrip('#').strip()
                    break

        return sprint_type, coverage_override, justification

    except Exception as e:
        print(f"Warning: Failed to parse sprint file {sprint_file_path}: {e}", file=sys.stderr)
        return None, None, None


def get_sprint_type(state: Optional[dict] = None) -> str:
    """Get sprint type from state or sprint file, with fallback to 'fullstack'.

    Args:
        state: Sprint state dict (optional, will load from file if not provided)

    Returns:
        Sprint type string (one of QUALITY_GATES keys)
    """
    if state is None:
        state = load_state()

    if not state:
        print("Warning: No active sprint, defaulting to 'fullstack' type", file=sys.stderr)
        return "fullstack"

    # Check if sprint file path is in state
    sprint_file = state.get("sprint_file")
    if not sprint_file:
        print("Warning: No sprint_file in state, defaulting to 'fullstack' type", file=sys.stderr)
        return "fullstack"

    # Extract type from sprint file
    sprint_type, _, _ = extract_sprint_type_from_file(Path(sprint_file))

    if sprint_type:
        if sprint_type not in QUALITY_GATES:
            print(f"Warning: Invalid sprint type '{sprint_type}', defaulting to 'fullstack'", file=sys.stderr)
            return "fullstack"
        return sprint_type
    else:
        print(f"Warning: No 'type' field in sprint frontmatter, defaulting to 'fullstack'", file=sys.stderr)
        return "fullstack"


def get_coverage_threshold(state: Optional[dict] = None) -> int:
    """Get coverage threshold for current sprint based on type and overrides.

    Args:
        state: Sprint state dict (optional, will load from file if not provided)

    Returns:
        Coverage threshold percentage as integer
    """
    if state is None:
        state = load_state()

    if not state:
        return 75  # Default

    sprint_type = get_sprint_type(state)
    default_threshold = QUALITY_GATES[sprint_type]["coverage"]

    # Check for override in sprint file
    sprint_file = state.get("sprint_file")
    if sprint_file:
        _, coverage_override, justification = extract_sprint_type_from_file(Path(sprint_file))
        if coverage_override is not None:
            if justification:
                print(f"Using coverage override: {coverage_override}% (was {default_threshold}%)", file=sys.stderr)
                print(f"Justification: {justification}", file=sys.stderr)
            else:
                print(f"Warning: Coverage override {coverage_override}% specified without justification", file=sys.stderr)
            return coverage_override

    return default_threshold


def is_step_complete(step_id: str, state: dict) -> bool:
    """Check if a step is in completed_steps."""
    completed = [s["step"] for s in state.get("completed_steps", [])]
    return step_id in completed


def mark_step_complete(state: dict, step_id: str, output: str = "", agent: str = None) -> dict:
    """Mark a step as complete in state."""
    if "completed_steps" not in state:
        state["completed_steps"] = []

    state["completed_steps"].append(
        {"step": step_id, "completed_at": datetime.now().isoformat(), "output": output, "agent_used": agent}
    )

    # Update current step to next
    next_step = get_next_step(step_id)
    if next_step:
        state["current_step"] = next_step
        state["current_phase"] = get_current_phase(next_step)
        step_info = get_step_info(next_step)
        if step_info:
            state["next_action"] = {
                "step": next_step,
                "description": step_info["description"],
                "required_agent": step_info.get("agent"),
            }
    else:
        # Sprint complete
        state["status"] = "complete"
        state["completed_at"] = datetime.now().isoformat()

    return state


def run_tests() -> tuple[bool, dict]:
    """Run pytest and return (success, results)."""
    result = subprocess.run(["pytest", "tests/", "-q", "--tb=no"], capture_output=True, text=True)

    # Parse output for counts
    output = result.stdout
    passed = failed = skipped = 0

    for line in output.split("\n"):
        if "passed" in line:
            parts = line.split()
            for i, part in enumerate(parts):
                if part == "passed" and i > 0:
                    try:
                        passed = int(parts[i - 1])
                    except ValueError:
                        pass
                elif part == "failed" and i > 0:
                    try:
                        failed = int(parts[i - 1])
                    except ValueError:
                        pass
                elif part == "skipped" and i > 0:
                    try:
                        skipped = int(parts[i - 1])
                    except ValueError:
                        pass

    results = {"passed": passed, "failed": failed, "skipped": skipped, "last_run": datetime.now().isoformat()}

    return result.returncode == 0, results


def run_coverage(threshold: Optional[int] = None, state: Optional[dict] = None) -> tuple[bool, dict]:
    """Run pytest with coverage and check against threshold.

    Args:
        threshold: Minimum coverage percentage required. If None, determines from sprint type.
        state: Sprint state dict (optional, will load from file if not provided)

    Returns:
        Tuple of (meets_threshold, results_dict)
    """
    # Determine threshold if not provided
    if threshold is None:
        threshold = get_coverage_threshold(state)

    result = subprocess.run(
        ["pytest", "tests/", "-q", "--tb=no", "--cov=src/corrdata", "--cov-report=term"], capture_output=True, text=True
    )

    output = result.stdout + result.stderr
    coverage_percentage = 0.0

    # Parse coverage output - look for TOTAL line
    # Format: TOTAL    1234    567    54%
    for line in output.split("\n"):
        if line.startswith("TOTAL") or "TOTAL" in line:
            # Extract percentage from the line
            match = re.search(r"(\d+)%", line)
            if match:
                coverage_percentage = float(match.group(1))
                break

    # Get sprint type for context
    if state is None:
        state = load_state()
    sprint_type = get_sprint_type(state) if state else "fullstack"

    results = {
        "coverage_percentage": coverage_percentage,
        "threshold": threshold,
        "sprint_type": sprint_type,
        "meets_threshold": coverage_percentage >= threshold,
        "last_run": datetime.now().isoformat(),
    }

    return coverage_percentage >= threshold, results


def check_coverage_gate(threshold: Optional[int] = None, state: Optional[dict] = None) -> tuple[bool, str]:
    """Check if coverage meets the gate threshold for committing.

    Args:
        threshold: Minimum coverage percentage required. If None, determines from sprint type.
        state: Sprint state dict (optional, will load from file if not provided)

    Returns:
        Tuple of (passes_gate, message)
    """
    # Determine threshold if not provided
    if threshold is None:
        threshold = get_coverage_threshold(state)

    meets_threshold, results = run_coverage(threshold, state)

    sprint_type = results.get("sprint_type", "unknown")

    if meets_threshold:
        return True, f"Coverage gate passed: {results['coverage_percentage']}% >= {threshold}% (sprint type: {sprint_type})"
    else:
        return False, f"Coverage gate FAILED: {results['coverage_percentage']}% < {threshold}% required (sprint type: {sprint_type})"


def check_git_clean() -> bool:
    """Check if git working directory is clean."""
    result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
    return len(result.stdout.strip()) == 0


def check_no_secrets() -> bool:
    """Check for potential hardcoded secrets."""
    patterns = [
        r"password\s*=\s*['\"][^'\"]+['\"]",
        r"api_key\s*=\s*['\"][^'\"]+['\"]",
        r"secret\s*=\s*['\"][^'\"]+['\"]",
        r"token\s*=\s*['\"][^'\"]+['\"]",
    ]

    result = subprocess.run(
        ["grep", "-rn", "-E", "|".join(patterns), "src/", "--include=*.py"], capture_output=True, text=True
    )

    # Filter out test files and comments
    if result.returncode == 0:  # Found matches
        for line in result.stdout.split("\n"):
            if line and "test" not in line.lower() and not line.strip().startswith("#"):
                return False

    return True


def validate_checklist(state: dict) -> tuple[bool, list[str]]:
    """Validate all pre-flight checklist items."""
    checklist = state.get("pre_flight_checklist", {})
    failures = []

    # Required checks (must be True)
    required = [
        ("tests_passing", "Tests must pass"),
        ("git_status_clean", "Git working directory must be clean"),
        ("no_hardcoded_secrets", "No hardcoded secrets allowed"),
    ]

    # Optional checks (can be True or null/not applicable)
    optional = [
        ("migrations_verified", "Database migrations"),
        ("sample_data_generated", "Sample data"),
        ("mcp_tools_tested", "MCP tools"),
        ("dialog_example_created", "Dialog example"),
        ("sprint_file_updated", "Sprint file"),
        ("code_has_docstrings", "Code docstrings"),
    ]

    for key, name in required:
        if checklist.get(key) is not True:
            failures.append(f"{name}: {'not checked' if checklist.get(key) is None else 'failed'}")

    for key, name in optional:
        value = checklist.get(key)
        if value is False:  # Explicitly failed (not just unchecked)
            failures.append(f"{name}: failed")

    return len(failures) == 0, failures


if __name__ == "__main__":
    # CLI interface for testing
    import argparse

    parser = argparse.ArgumentParser(description="Sprint step validation utilities")
    parser.add_argument("command", choices=["status", "tests", "coverage", "git", "secrets", "checklist", "sprint-type"])
    parser.add_argument("--threshold", type=int, help="Coverage threshold percentage (overrides sprint type default)")
    args = parser.parse_args()

    if args.command == "status":
        state = load_state()
        if state:
            sprint_type = get_sprint_type(state)
            threshold = get_coverage_threshold(state)
            print(f"Sprint {state['sprint_number']}: {state.get('sprint_title', 'Unknown')}")
            print(f"Status: {state['status']}")
            print(f"Current step: {state['current_step']}")
            print(f"Sprint type: {sprint_type}")
            print(f"Coverage threshold: {threshold}%")
        else:
            print("No active sprint")

    elif args.command == "sprint-type":
        state = load_state()
        if state:
            sprint_type = get_sprint_type(state)
            threshold = get_coverage_threshold(state)
            gates = QUALITY_GATES[sprint_type]
            print(f"Sprint type: {sprint_type}")
            print(f"Coverage threshold: {threshold}%")
            print(f"Quality gates:")
            for gate, enabled in gates.items():
                print(f"  - {gate}: {enabled}")
        else:
            print("No active sprint")
            sys.exit(1)

    elif args.command == "tests":
        success, results = run_tests()
        print(f"Tests: {'PASS' if success else 'FAIL'}")
        print(f"  Passed: {results['passed']}")
        print(f"  Failed: {results['failed']}")
        print(f"  Skipped: {results['skipped']}")
        sys.exit(0 if success else 1)

    elif args.command == "coverage":
        state = load_state()
        # Use explicit threshold if provided, otherwise determine from sprint type
        threshold = args.threshold if args.threshold else None
        passes, message = check_coverage_gate(threshold, state)
        print(message)
        sys.exit(0 if passes else 1)

    elif args.command == "git":
        clean = check_git_clean()
        print(f"Git status: {'clean' if clean else 'dirty'}")
        sys.exit(0 if clean else 1)

    elif args.command == "secrets":
        clean = check_no_secrets()
        print(f"Secrets check: {'pass' if clean else 'POTENTIAL SECRETS FOUND'}")
        sys.exit(0 if clean else 1)

    elif args.command == "checklist":
        state = load_state()
        if state:
            success, failures = validate_checklist(state)
            print(f"Checklist: {'PASS' if success else 'FAIL'}")
            for f in failures:
                print(f"  - {f}")
            sys.exit(0 if success else 1)
        else:
            print("No active sprint")
            sys.exit(1)
