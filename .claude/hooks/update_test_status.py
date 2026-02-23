#!/usr/bin/env python3
"""
Hook to update sprint state with test results after test-runner subagent completes.

This hook is called by SubagentStop event when a test-runner agent finishes.
It parses test output and updates the sprint state file.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

STATE_FILE = Path(".claude/sprint-state.json")


def parse_pytest_output(output: str) -> dict:
    """Parse pytest output for test counts."""
    results = {
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "errors": 0,
        "last_run": datetime.now().isoformat()
    }

    # Pattern: "X passed, Y failed, Z skipped"
    # or: "X passed in Ys"
    patterns = [
        (r"(\d+) passed", "passed"),
        (r"(\d+) failed", "failed"),
        (r"(\d+) skipped", "skipped"),
        (r"(\d+) error", "errors"),
    ]

    for pattern, key in patterns:
        match = re.search(pattern, output)
        if match:
            results[key] = int(match.group(1))

    return results


def main():
    # Read test output from stdin (provided by Claude Code hook system)
    test_output = sys.stdin.read() if not sys.stdin.isatty() else ""

    if not STATE_FILE.exists():
        print("No active sprint - skipping state update")
        return 0

    with open(STATE_FILE) as f:
        state = json.load(f)

    # Parse test results
    if test_output:
        results = parse_pytest_output(test_output)
    else:
        # No output provided, run tests ourselves
        import subprocess
        result = subprocess.run(
            ["pytest", "tests/", "-q", "--tb=no"],
            capture_output=True,
            text=True
        )
        results = parse_pytest_output(result.stdout)

    # Update state
    state["test_results"] = results

    # Update checklist item
    if "pre_flight_checklist" not in state:
        state["pre_flight_checklist"] = {}

    state["pre_flight_checklist"]["tests_passing"] = results["failed"] == 0

    # Save state
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

    # Report
    print(f"Test results updated:")
    print(f"  Passed: {results['passed']}")
    print(f"  Failed: {results['failed']}")
    print(f"  Skipped: {results['skipped']}")

    if results["failed"] > 0:
        print(f"\nWARNING: {results['failed']} tests failed")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
