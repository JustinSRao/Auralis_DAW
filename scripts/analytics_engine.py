#!/usr/bin/env python3
"""
Analytics engine for sprint workflow metrics and insights.

Provides analytics computation for sprint execution:
1. Phase timing calculation from completed_steps
2. Historical comparison against sprint type averages
3. Bottleneck identification with recommendations
4. ASCII bar chart rendering for phase breakdown
5. Coverage delta tracking (before/after/delta)
6. Agent execution tracking with timing and token estimation
7. Analytics report generation for completed and in-progress sprints

Functions:
    calculate_phase_timings(completed_steps) -> dict: Calculate time per phase
    calculate_historical_comparison(current_metrics, historical_data) -> dict: Compare to averages
    identify_bottlenecks(current_metrics, historical_data) -> dict: Flag slow phases
    render_phase_breakdown(phase_timings) -> str: ASCII bar charts
    track_coverage_delta(before, after) -> dict: Track coverage changes
    track_agent_execution(...) -> dict: Record agent timing and tokens
    estimate_tokens_from_output(output_length) -> int: Estimate tokens from chars
    generate_analytics_report(project_root, sprint_number) -> dict: Generate full report

Usage:
    from analytics_engine import generate_analytics_report

    report = generate_analytics_report("/path/to/project", sprint_number=5)
    print(report["visualization"])
"""

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


class AnalyticsError(Exception):
    """Base exception for analytics operations."""

    pass


# Phase mapping for step prefixes
PHASE_MAP = {
    "1": "planning",
    "2": "implementation",
    "3": "validation",
    "4": "documentation",
    "5": "commit",
    "6": "completion",
}

# Phase-specific recommendations for bottlenecks
PHASE_RECOMMENDATIONS = {
    "planning": "Consider breaking into smaller planning sessions or using templates to speed up architecture design.",
    "implementation": "Consider breaking into smaller tasks or implementing in parallel where possible.",
    "validation": "Consider automating test runs or running validation checks in parallel.",
    "documentation": "Consider using templates or examples to speed up documentation generation.",
    "commit": "Consider pre-staging files or simplifying commit message generation.",
    "completion": "Review checklist automation opportunities to reduce manual overhead.",
}


def _group_steps_by_phase(
    sorted_steps: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Group completed steps by their workflow phase.

    Args:
        sorted_steps: Steps sorted by completion timestamp

    Returns:
        Dict mapping phase names to list of steps in that phase
    """
    phases: Dict[str, List[Dict[str, Any]]] = {}
    for step in sorted_steps:
        phase_prefix = step["step"].split(".")[0]
        phase_name = PHASE_MAP.get(phase_prefix)
        if phase_name:
            if phase_name not in phases:
                phases[phase_name] = []
            phases[phase_name].append(step)
    return phases


def _calculate_phase_duration(
    phase_steps: List[Dict[str, Any]],
    is_first_phase: bool,
    start_time: Optional[datetime],
) -> float:
    """Calculate duration in hours for a specific phase.

    Args:
        phase_steps: Steps belonging to this phase
        is_first_phase: Whether this is the first phase in the sprint
        start_time: Start time for first phase (from started_at or inferred)

    Returns:
        Duration in hours (0 if cannot be calculated)
    """
    if not phase_steps:
        return 0.0

    last_step_time = _parse_timestamp(phase_steps[-1]["completed_at"])

    if is_first_phase and start_time:
        return (last_step_time - start_time).total_seconds() / 3600
    elif len(phase_steps) > 1:
        first_step_time = _parse_timestamp(phase_steps[0]["completed_at"])
        return (last_step_time - first_step_time).total_seconds() / 3600
    else:
        return 0.0


def calculate_phase_timings(
    completed_steps: List[Dict[str, Any]], started_at: Optional[str] = None
) -> Dict[str, float]:
    """
    Calculate time spent in each workflow phase from completed_steps.

    Maps step prefixes to phases:
    - 1.x -> planning
    - 2.x -> implementation
    - 3.x -> validation
    - 4.x -> documentation
    - 5.x -> commit
    - 6.x -> completion

    Args:
        completed_steps: List of step completions with step and completed_at
        started_at: Optional sprint start timestamp

    Returns:
        Dict mapping phase names to hours spent

    Raises:
        AnalyticsError: If timestamp format is invalid

    Example:
        >>> steps = [
        ...     {"step": "1.1", "completed_at": "2025-12-30T10:00:00Z"},
        ...     {"step": "1.2", "completed_at": "2025-12-30T10:30:00Z"},
        ... ]
        >>> timings = calculate_phase_timings(steps)
        >>> timings["planning"]
        0.5
    """
    if not completed_steps or len(completed_steps) == 1:
        return {}

    # Sort steps by timestamp
    try:
        sorted_steps = sorted(
            completed_steps, key=lambda s: _parse_timestamp(s["completed_at"])
        )
    except (KeyError, ValueError) as e:
        raise AnalyticsError(f"Invalid timestamp in completed_steps: {e}")

    if not sorted_steps:
        return {}

    # Group steps by phase
    phases = _group_steps_by_phase(sorted_steps)

    # Determine start time for first phase
    if started_at:
        start_time = _parse_timestamp(started_at)
    else:
        # Infer from first step: round down to nearest hour
        first_step_time = _parse_timestamp(sorted_steps[0]["completed_at"])
        start_time = first_step_time.replace(minute=0, second=0, microsecond=0)

    # Identify first phase
    first_phase_prefix = sorted_steps[0]["step"].split(".")[0]
    first_phase_name = PHASE_MAP.get(first_phase_prefix)

    # Calculate duration for each phase
    phase_timings: Dict[str, float] = {}
    for phase_name, phase_steps in phases.items():
        is_first = phase_name == first_phase_name
        phase_timings[phase_name] = _calculate_phase_duration(
            phase_steps, is_first, start_time if is_first else None
        )

    return phase_timings


def calculate_historical_comparison(
    current_metrics: Dict[str, Any], historical_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Compare current sprint to historical averages of same type.

    Args:
        current_metrics: Current sprint metrics with type, duration_hours, etc.
        historical_data: Historical sprint data from registry

    Returns:
        Dict with avg_duration, avg_coverage_improvement, duration_percentile, etc.

    Example:
        >>> current = {"type": "fullstack", "duration_hours": 2.5}
        >>> historical = {"sprints": {"1": {"type": "fullstack", "duration_hours": 3.0}}}
        >>> comparison = calculate_historical_comparison(current, historical)
        >>> comparison["avg_duration"]
        3.0
    """
    sprint_type = current_metrics.get("type", "fullstack")
    current_sprint_num = current_metrics.get("sprint_number")

    # Filter sprints of same type, excluding current sprint
    sprints = historical_data.get("sprints", {})
    same_type_sprints = [
        sprint_data
        for sprint_id, sprint_data in sprints.items()
        if sprint_data.get("type") == sprint_type
        and (current_sprint_num is None or int(sprint_id) != current_sprint_num)
    ]

    if not same_type_sprints:
        return {
            "avg_duration": None,
            "avg_coverage_improvement": None,
            "message": f"No historical data for sprint type: {sprint_type}",
        }

    # Calculate averages
    avg_duration = sum(s.get("duration_hours", 0) for s in same_type_sprints) / len(
        same_type_sprints
    )

    coverage_improvements = [
        s.get("coverage_improvement", 0)
        for s in same_type_sprints
        if "coverage_improvement" in s
    ]
    avg_coverage_improvement = (
        sum(coverage_improvements) / len(coverage_improvements)
        if coverage_improvements
        else None
    )

    # Calculate percentile rank for duration (lower is better)
    current_duration = current_metrics.get("duration_hours")
    if current_duration is not None:
        durations = [s.get("duration_hours", 0) for s in same_type_sprints]
        faster_than = sum(1 for d in durations if current_duration < d)
        duration_percentile = (
            int((faster_than / len(durations)) * 100) if durations else 0
        )
    else:
        duration_percentile = None

    # Calculate average phase percentages
    avg_phase_percentages = {}
    if "phase_breakdown" in current_metrics:
        # Get all phases present in historical data
        all_phases = set()
        for sprint in same_type_sprints:
            if "phase_breakdown" in sprint:
                all_phases.update(sprint["phase_breakdown"].keys())

        # Calculate average percentage for each phase
        for phase in all_phases:
            phase_hours = [
                sprint["phase_breakdown"].get(phase, 0)
                for sprint in same_type_sprints
                if "phase_breakdown" in sprint
            ]
            if phase_hours:
                avg_phase_hours = sum(phase_hours) / len(phase_hours)
                # Calculate percentage of total duration
                avg_phase_percentages[phase] = (
                    (avg_phase_hours / avg_duration * 100) if avg_duration > 0 else 0
                )

    return {
        "avg_duration": avg_duration,
        "avg_coverage_improvement": avg_coverage_improvement,
        "duration_percentile": duration_percentile,
        "avg_phase_percentages": avg_phase_percentages,
    }


def identify_bottlenecks(
    current_metrics: Dict[str, Any], historical_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Identify phases exceeding 1.5x historical percentage with recommendations.

    Args:
        current_metrics: Current sprint metrics with phase_breakdown
        historical_data: Historical sprint data for comparison

    Returns:
        Dict with bottlenecks list and recommendations

    Example:
        >>> current = {
        ...     "type": "fullstack",
        ...     "phase_breakdown": {"implementation": 3.0, "planning": 0.5}
        ... }
        >>> bottlenecks = identify_bottlenecks(current, historical_data)
        >>> len(bottlenecks["bottlenecks"]) > 0
        True
    """
    bottlenecks = []

    phase_breakdown = current_metrics.get("phase_breakdown", {})
    if not phase_breakdown:
        return {"bottlenecks": []}

    # Get historical comparison
    comparison = calculate_historical_comparison(current_metrics, historical_data)
    avg_phase_percentages = comparison.get("avg_phase_percentages", {})

    if not avg_phase_percentages:
        return {"bottlenecks": []}

    # Calculate total duration for current sprint
    total_duration = sum(phase_breakdown.values())
    if total_duration == 0:
        return {"bottlenecks": []}

    # Check each phase against threshold
    # A phase is a bottleneck if its percentage of total time exceeds 1.5x the historical average percentage
    # OR if the phase's absolute duration exceeds 1.4x historical duration for that phase
    # (Using 1.4x for absolute hours to catch issues earlier, 1.5x for percentage-based comparison)
    THRESHOLD_HOURS = 1.4
    THRESHOLD_PERCENTAGE = 1.5

    # Get historical data for same type (reuse comparison from above)
    same_type_sprints = [
        sprint_data
        for sprint_id, sprint_data in historical_data.get("sprints", {}).items()
        if sprint_data.get("type") == current_metrics.get("type", "fullstack")
    ]

    # Calculate average absolute hours per phase
    avg_phase_hours = {}
    for phase in phase_breakdown.keys():
        phase_hours_list = [
            s.get("phase_breakdown", {}).get(phase, 0)
            for s in same_type_sprints
            if "phase_breakdown" in s
        ]
        if phase_hours_list:
            avg_phase_hours[phase] = sum(phase_hours_list) / len(phase_hours_list)

    for phase, hours in phase_breakdown.items():
        current_percentage = (hours / total_duration) * 100
        avg_percentage = avg_phase_percentages.get(phase, 0)
        avg_hours = avg_phase_hours.get(phase, 0)

        # Flag if absolute hours exceed 1.4x average OR percentage exceeds 1.5x average
        is_bottleneck = False
        if avg_hours > 0 and hours > (avg_hours * THRESHOLD_HOURS):
            is_bottleneck = True
        elif avg_percentage > 0 and current_percentage > (
            avg_percentage * THRESHOLD_PERCENTAGE
        ):
            is_bottleneck = True

        if is_bottleneck:
            percentage_over = (
                ((current_percentage / avg_percentage) - 1) * 100
                if avg_percentage > 0
                else 0
            )

            bottlenecks.append(
                {
                    "phase": phase,
                    "current_percentage": current_percentage,
                    "avg_percentage": avg_percentage,
                    "percentage_over": percentage_over,
                    "recommendation": PHASE_RECOMMENDATIONS.get(
                        phase, "Consider optimizing this phase."
                    ),
                }
            )

    return {"bottlenecks": bottlenecks}


def render_phase_breakdown(phase_timings: Dict[str, float]) -> str:
    """
    Render ASCII bar chart for phase breakdown.

    Format: Phase         [██░░░░░░░░] XX% (X.XXh)

    Args:
        phase_timings: Dict mapping phase names to hours

    Returns:
        ASCII bar chart as string

    Example:
        >>> timings = {"planning": 0.25, "implementation": 1.0}
        >>> chart = render_phase_breakdown(timings)
        >>> "Planning" in chart or "planning" in chart
        True
    """
    if not phase_timings:
        return ""

    # Calculate total and percentages
    total_hours = sum(phase_timings.values())
    if total_hours == 0:
        return ""

    lines = []
    BAR_LENGTH = 10

    # Sort phases by standard order
    phase_order = [
        "planning",
        "implementation",
        "validation",
        "documentation",
        "commit",
        "completion",
    ]
    sorted_phases = sorted(
        phase_timings.items(),
        key=lambda x: phase_order.index(x[0]) if x[0] in phase_order else 999,
    )

    for phase, hours in sorted_phases:
        percentage = (hours / total_hours) * 100
        filled = int((percentage / 100) * BAR_LENGTH)
        empty = BAR_LENGTH - filled

        bar = "█" * filled + "░" * empty
        phase_name = phase.capitalize()

        # Format: Phase name (15 chars) [bar] percentage (hours)
        line = f"{phase_name:15s} [{bar}] {percentage:3.0f}% ({hours:.2f}h)"
        lines.append(line)

    return "\n".join(lines)


def track_coverage_delta(
    before: Optional[float], after: Optional[float]
) -> Dict[str, Optional[float]]:
    """
    Track coverage delta (before/after/delta).

    Args:
        before: Coverage percentage before sprint
        after: Coverage percentage after sprint

    Returns:
        Dict with before, after, and delta

    Raises:
        AnalyticsError: If coverage values are out of range

    Example:
        >>> delta = track_coverage_delta(73.2, 78.5)
        >>> delta["delta"]
        5.3
    """
    # Validate coverage range
    if before is not None and (before < 0 or before > 100):
        raise AnalyticsError("Coverage must be between 0 and 100")
    if after is not None and (after < 0 or after > 100):
        raise AnalyticsError("Coverage must be between 0 and 100")

    # Calculate delta
    if before is not None and after is not None:
        delta = after - before
    else:
        delta = None

    return {
        "before": before,
        "after": after,
        "delta": delta,
    }


def track_agent_execution(
    agent: str,
    phase: str,
    started_at: str,
    completed_at: str,
    output_length: int,
    files_modified: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Track agent execution with timing and token estimation.

    Args:
        agent: Agent name (e.g., "Plan", "product-engineer")
        phase: Phase identifier (e.g., "1.1", "2.1")
        started_at: ISO timestamp when started
        completed_at: ISO timestamp when completed
        output_length: Character length of output
        files_modified: Number of files modified (optional, will use git diff if None)

    Returns:
        Dict with agent, phase, timing, and token estimates

    Example:
        >>> execution = track_agent_execution(
        ...     agent="Plan",
        ...     phase="1.1",
        ...     started_at="2025-12-30T10:00:00Z",
        ...     completed_at="2025-12-30T10:15:00Z",
        ...     output_length=4800
        ... )
        >>> execution["duration_seconds"]
        900
    """
    # Calculate duration
    start_time = _parse_timestamp(started_at)
    end_time = _parse_timestamp(completed_at)
    duration_seconds = int((end_time - start_time).total_seconds())

    # Estimate tokens
    estimated_tokens = estimate_tokens_from_output(output_length)

    # Get files modified if not provided
    if files_modified is None:
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only"],
                capture_output=True,
                text=True,
                check=True,
            )
            files = [f for f in result.stdout.strip().split("\n") if f]
            files_modified = len(files)
        except Exception:
            files_modified = 0

    return {
        "agent": agent,
        "phase": phase,
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_seconds": duration_seconds,
        "output_length": output_length,
        "estimated_tokens": estimated_tokens,
        "files_modified": files_modified,
    }


def estimate_tokens_from_output(output_length: int) -> int:
    """
    Estimate tokens from output length using chars / 4 heuristic.

    Args:
        output_length: Character length of output

    Returns:
        Estimated token count

    Example:
        >>> estimate_tokens_from_output(4800)
        1200
    """
    return output_length // 4


def generate_analytics_report(
    project_root: Path | str, sprint_number: int
) -> Dict[str, Any]:
    """
    Generate complete analytics report for a sprint.

    Loads state file, calculates all metrics, and generates report with:
    - Phase breakdown and visualization
    - Historical comparison
    - Bottleneck identification
    - Agent execution tracking
    - Coverage delta

    Args:
        project_root: Path to project root
        sprint_number: Sprint number to analyze

    Returns:
        Complete analytics report dict

    Raises:
        AnalyticsError: If state file not found or invalid

    Example:
        >>> report = generate_analytics_report("/path/to/project", 5)
        >>> report["sprint_number"]
        5
    """
    project_root = Path(project_root)

    # Load state file
    state_path = project_root / ".claude" / "sprint-state.json"
    if not state_path.exists():
        raise AnalyticsError(f"State file not found: {state_path}")

    try:
        with open(state_path, "r") as f:
            state = json.load(f)
    except json.JSONDecodeError as e:
        raise AnalyticsError(f"Invalid state file: {e}")

    # Load registry for historical comparison
    registry_path = project_root / "docs" / "sprints" / "registry.json"
    if registry_path.exists():
        with open(registry_path, "r") as f:
            historical_data = json.load(f)
    else:
        historical_data = {"sprints": {}}

    # Extract state data
    completed_steps = state.get("completed_steps", [])
    agent_executions = state.get("agent_executions", [])
    started_at = state.get("started_at")
    completed_at = state.get("completed_at")
    current_step = state.get("current_step")

    # Calculate phase timings
    phase_breakdown = calculate_phase_timings(completed_steps)

    # Calculate duration
    if started_at:
        start_time = _parse_timestamp(started_at)
        if completed_at:
            end_time = _parse_timestamp(completed_at)
            status = "completed"
        else:
            end_time = datetime.now(timezone.utc).replace(tzinfo=None)
            status = "in-progress"
        duration_hours = (end_time - start_time).total_seconds() / 3600
    else:
        duration_hours = 0
        status = "not-started"

    # Build current metrics for comparison
    current_metrics = {
        "type": state.get("type", "fullstack"),
        "duration_hours": duration_hours,
        "phase_breakdown": phase_breakdown,
        "sprint_number": sprint_number,
    }

    if "coverage_delta" in state:
        current_metrics["coverage_improvement"] = state["coverage_delta"].get(
            "delta", 0
        )

    # Generate comparison
    comparison = calculate_historical_comparison(current_metrics, historical_data)

    # Identify bottlenecks
    bottleneck_analysis = identify_bottlenecks(current_metrics, historical_data)

    # Render visualization
    visualization = render_phase_breakdown(phase_breakdown)

    # Build report
    report = {
        "sprint_number": sprint_number,
        "status": status,
        "started_at": started_at,
        "completed_at": completed_at,
        "current_step": current_step,
        "duration_hours": duration_hours,
        "phase_breakdown": phase_breakdown,
        "visualization": visualization,
        "comparison": comparison,
        "bottlenecks": bottleneck_analysis.get("bottlenecks", []),
        "agent_executions": agent_executions,
        "coverage_delta": state.get("coverage_delta"),
    }

    return report


def _parse_timestamp(timestamp_str: str) -> datetime:
    """
    Parse ISO timestamp with various timezone formats and normalize to UTC.

    Args:
        timestamp_str: ISO format timestamp

    Returns:
        datetime object in UTC (timezone-naive)

    Raises:
        AnalyticsError: If timestamp format is invalid
    """
    # Try with fromisoformat first (most flexible)
    try:
        # Normalize 'Z' to '+00:00' for fromisoformat
        normalized = timestamp_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)

        # Convert to UTC and remove timezone info for consistency
        if dt.tzinfo is not None:
            # Convert to UTC
            dt_utc = dt.astimezone(timezone.utc)
            # Remove timezone info (make naive)
            return dt_utc.replace(tzinfo=None)
        return dt
    except (ValueError, AttributeError):
        pass

    # Fallback to manual parsing for simple formats
    formats = [
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(timestamp_str, fmt)
        except ValueError:
            continue

    raise AnalyticsError(f"Invalid timestamp format: {timestamp_str}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python analytics_engine.py <sprint_number>")
        sys.exit(1)

    sprint_num = int(sys.argv[1])

    # Find project root
    from pathlib import Path

    project_root = Path.cwd()
    while project_root != project_root.parent:
        if (project_root / ".claude").exists():
            break
        project_root = project_root.parent

    # Generate report
    report = generate_analytics_report(project_root, sprint_num)

    # Print report
    print(f"\nSprint {sprint_num} Analytics Report")
    print("=" * 60)
    print(f"Status: {report['status']}")
    print(f"Duration: {report['duration_hours']:.2f} hours")
    print("\nPhase Breakdown:")
    print(report["visualization"])

    if report["bottlenecks"]:
        print("\nBottlenecks Identified:")
        for bottleneck in report["bottlenecks"]:
            print(
                f"  - {bottleneck['phase']}: {bottleneck['percentage_over']:.0f}% over average"
            )
            print(f"    {bottleneck['recommendation']}")
