#!/usr/bin/env python3
"""
Sprint completion hook to validate pre-flight checklist.

Exit codes:
- 0: All checks pass, allow completion
- 1: Error
- 2: Block completion (checks failed)
"""

import json
import subprocess
import sys
from pathlib import Path

# Import sprint type utilities
try:
    from validate_step import get_sprint_type, get_coverage_threshold, QUALITY_GATES
except ImportError:
    # If running from different directory, try absolute import
    import importlib.util
    spec = importlib.util.spec_from_file_location("validate_step", Path(__file__).parent / "validate_step.py")
    validate_step = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validate_step)
    get_sprint_type = validate_step.get_sprint_type
    get_coverage_threshold = validate_step.get_coverage_threshold
    QUALITY_GATES = validate_step.QUALITY_GATES

STATE_FILE = Path(".claude/sprint-state.json")
SPRINT_LIFECYCLE = Path("scripts/sprint_lifecycle.py")


def run_tests() -> tuple[bool, str]:
    """Run tests and return (passed, output)."""
    result = subprocess.run(
        ["pytest", "tests/", "-q", "--tb=no"],
        capture_output=True,
        text=True
    )
    return result.returncode == 0, result.stdout


def check_git_clean() -> tuple[bool, str]:
    """Check git working directory is clean."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True
    )
    clean = len(result.stdout.strip()) == 0
    return clean, result.stdout if not clean else "Clean"


def check_no_secrets() -> tuple[bool, str]:
    """Check for hardcoded secrets."""
    result = subprocess.run(
        ["grep", "-rn", "-E",
         r"(password|secret|api_key|token)\s*=\s*['\"][^'\"]+['\"]",
         "src/", "--include=*.py"],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:  # grep found nothing
        return True, "No secrets found"

    # Filter out test files and comments
    suspicious = []
    for line in result.stdout.split("\n"):
        if line and "test" not in line.lower() and "#" not in line:
            suspicious.append(line)

    if suspicious:
        return False, "\n".join(suspicious)

    return True, "No secrets found (filtered)"


def check_automation_utilities() -> tuple[bool, str]:
    """Check that sprint lifecycle automation utilities exist."""
    if not SPRINT_LIFECYCLE.exists():
        return False, f"Missing automation utility: {SPRINT_LIFECYCLE}"

    # Check if script is executable
    if not SPRINT_LIFECYCLE.stat().st_mode & 0o111:
        return False, f"Automation utility not executable: {SPRINT_LIFECYCLE}"

    # Validate script has required functions
    try:
        with open(SPRINT_LIFECYCLE) as f:
            content = f.read()

        required_functions = [
            "def move_to_done(",
            "def update_registry(",
            "def check_epic_completion(",
            "def create_git_tag("
        ]

        missing = []
        for func in required_functions:
            if func not in content:
                missing.append(func.replace("def ", "").replace("(", "()"))

        if missing:
            return False, f"Missing functions in {SPRINT_LIFECYCLE}: {', '.join(missing)}"

        return True, "Automation utilities ready"

    except Exception as e:
        return False, f"Error validating automation utilities: {e}"


def main():
    if not STATE_FILE.exists():
        print("No active sprint")
        return 1

    with open(STATE_FILE) as f:
        state = json.load(f)

    sprint_num = state.get("sprint_number", "?")
    sprint_type = get_sprint_type(state)
    coverage_threshold = get_coverage_threshold(state)
    quality_gates = QUALITY_GATES[sprint_type]

    print(f"Running pre-flight checklist for Sprint {sprint_num}...")
    print(f"Sprint type: {sprint_type}")
    print(f"Coverage threshold: {coverage_threshold}%")
    print()

    failures = []

    # 0. Automation utilities exist
    print("0. Checking automation utilities...", end=" ")
    utils_ok, utils_output = check_automation_utilities()
    if utils_ok:
        print("PASS")
    else:
        print("FAIL")
        failures.append(("Automation utilities", utils_output))

    # 1. Tests passing
    print("1. Checking tests...", end=" ")
    tests_pass, test_output = run_tests()
    if tests_pass:
        print("PASS")
    else:
        print("FAIL")
        failures.append(("Tests", test_output))

    # 2. Git status clean
    print("2. Checking git status...", end=" ")
    git_clean, git_output = check_git_clean()
    if git_clean:
        print("PASS")
    else:
        print("FAIL")
        failures.append(("Git status", f"Uncommitted changes:\n{git_output}"))

    # 3. No hardcoded secrets
    print("3. Checking for secrets...", end=" ")
    no_secrets, secrets_output = check_no_secrets()
    if no_secrets:
        print("PASS")
    else:
        print("FAIL")
        failures.append(("Secrets", f"Potential secrets found:\n{secrets_output}"))

    # 4-9 are checked from state file (set by earlier steps)
    checklist = state.get("pre_flight_checklist", {})

    # Base optional checks
    optional_checks = [
        ("migrations_verified", "4. Database migrations"),
        ("sample_data_generated", "5. Sample data"),
        ("mcp_tools_tested", "6. MCP tools"),
        ("sprint_file_updated", "8. Sprint file updated"),
        ("code_has_docstrings", "9. Code docstrings"),
    ]

    # Type-specific checks
    if quality_gates.get("documentation"):
        # Research and spike sprints REQUIRE documentation
        optional_checks.insert(3, ("dialog_example_created", "7. Dialog example (REQUIRED)"))
    else:
        # Other sprint types have documentation as optional
        optional_checks.insert(3, ("dialog_example_created", "7. Dialog example"))

    if quality_gates.get("integration_tests"):
        optional_checks.append(("integration_tests_passing", "10. Integration tests"))

    if quality_gates.get("visual_regression"):
        optional_checks.append(("visual_regression_tested", "11. Visual regression tests"))

    if quality_gates.get("smoke_tests"):
        optional_checks.append(("smoke_tests_passing", "12. Smoke tests"))

    for key, name in optional_checks:
        value = checklist.get(key)
        print(f"{name}...", end=" ")

        # For REQUIRED items (research/spike documentation)
        if quality_gates.get("documentation") and key == "dialog_example_created":
            if value is True:
                print("PASS")
            else:
                print("FAIL")
                failures.append((name, "Documentation is REQUIRED for research/spike sprints"))
        # For regular optional items
        elif value is True:
            print("PASS")
        elif value is False:
            print("FAIL")
            failures.append((name, "Explicitly marked as failed"))
        else:
            print("SKIP (not applicable)")

    print()

    if failures:
        print("=" * 60)
        print("PRE-FLIGHT CHECKLIST FAILED")
        print("=" * 60)
        print()
        for name, detail in failures:
            print(f"FAILED: {name}")
            if detail:
                for line in detail.split("\n")[:5]:  # Limit output
                    print(f"  {line}")
            print()
        print("Sprint cannot be marked complete until all checks pass.")
        print()
        return 2  # Block completion

    print("=" * 60)
    print("PRE-FLIGHT CHECKLIST PASSED")
    print("=" * 60)
    print()
    print(f"Sprint {sprint_num} is ready to be marked complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
