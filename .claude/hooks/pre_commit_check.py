#!/usr/bin/env python3
"""
Pre-commit hook to verify sprint prerequisites before allowing commit.

Exit codes:
- 0: Allow commit
- 1: Error (but allow commit)
- 2: Block commit (Claude Code specific)
"""

import json
import subprocess
import sys
from pathlib import Path

STATE_FILE = Path(".claude/sprint-state.json")


def main():
    # Check if we're in a sprint
    if not STATE_FILE.exists():
        # No active sprint, allow commit
        print("No active sprint - commit allowed")
        return 0

    with open(STATE_FILE) as f:
        state = json.load(f)

    # Check sprint status
    status = state.get("status", "unknown")
    if status != "in_progress":
        print(f"Sprint status is '{status}' - commit allowed")
        return 0

    # Must be at step 5.1 (Commit) or later to commit
    current_step = state.get("current_step", "1.1")
    phase = int(current_step.split(".")[0])

    if phase < 5:
        print("=" * 60)
        print("COMMIT BLOCKED: Sprint workflow enforcement")
        print("=" * 60)
        print()
        print(f"Current sprint: {state.get('sprint_number')}")
        print(f"Current phase: {phase} of 6")
        print(f"Current step: {current_step}")
        print()
        print("You must complete phases 1-4 before committing:")
        print("  Phase 1: Planning")
        print("  Phase 2: Test-First Implementation")
        print("  Phase 3: Validation")
        print("  Phase 4: Documentation")
        print("  Phase 5: Commit  <-- You are here")
        print()
        print("Use /sprint-status to see current progress.")
        print("Use /sprint-next to advance after completing each step.")
        print()
        return 2  # Block commit

    # If at phase 5+, verify tests pass AND coverage meets 75% threshold
    print("Verifying tests and coverage before commit...")

    # Run tests with coverage
    result = subprocess.run(
        ["pytest", "tests/", "-q", "--tb=no", "--cov=src/corrdata", "--cov-report=term"], capture_output=True, text=True
    )

    if result.returncode != 0:
        print("=" * 60)
        print("COMMIT BLOCKED: Tests must pass")
        print("=" * 60)
        print()
        print("Test output:")
        print(result.stdout)
        if result.stderr:
            print(result.stderr)
        print()
        print("Fix failing tests before committing.")
        print()
        return 2  # Block commit

    # Parse coverage from output
    import re

    output = result.stdout + result.stderr
    coverage_percentage = 0.0

    for line in output.split("\n"):
        if "TOTAL" in line:
            match = re.search(r"(\d+)%", line)
            if match:
                coverage_percentage = float(match.group(1))
                break

    # Enforce 75% coverage gate
    COVERAGE_THRESHOLD = 75
    if coverage_percentage < COVERAGE_THRESHOLD:
        print("=" * 60)
        print("COMMIT BLOCKED: Coverage gate not met")
        print("=" * 60)
        print()
        print(f"Current coverage: {coverage_percentage}%")
        print(f"Required coverage: {COVERAGE_THRESHOLD}%")
        print(f"Gap: {COVERAGE_THRESHOLD - coverage_percentage:.1f}%")
        print()
        print("Add more tests to increase coverage before committing.")
        print()
        return 2  # Block commit

    print(f"Coverage: {coverage_percentage}% (>= {COVERAGE_THRESHOLD}% required)")
    print("Pre-commit checks passed - commit allowed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
