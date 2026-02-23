---
description: "Run postmortem analysis after sprint completion"
allowed-tools: [Bash]
---

# Generate Sprint Postmortem

Run the generate-postmortem automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py generate-postmortem $ARGUMENTS
```

This command creates a **separate postmortem file** linked from the sprint file.

**Usage:**
```
/sprint-postmortem <sprint-number>
```

**Examples:**
```
/sprint-postmortem 2            # Generate postmortem for sprint 2
/sprint-postmortem 5 --dry-run  # Preview postmortem generation
```

**What It Creates:**

1. **Postmortem File**: `sprint-{N}_postmortem.md` in same directory as sprint file
2. **Link in Sprint**: Adds/updates "## Postmortem" section with link

**Postmortem Template:**

The generated file includes:

```markdown
# Sprint N Postmortem: {title}

## Metrics
- Started / Completed timestamps
- Duration in hours
- Steps completed
- Files changed (TODO: fill in with git diff)
- Tests added (TODO: count)
- Coverage delta (TODO: compare)

## What Went Well
<!-- TODO: Add positives -->

## What Could Improve
<!-- TODO: Add improvements -->

## Blockers Encountered
<!-- TODO: Document blockers -->

## Technical Insights
<!-- TODO: Add learnings -->

## Process Insights
<!-- TODO: Add process learnings -->

## Patterns Discovered
<!-- TODO: Add code patterns -->

## Action Items for Next Sprint
- [ ] TODO: Add follow-up tasks

## Notes
<!-- TODO: Additional observations -->
```

**Metrics Calculated:**

- **Duration**: Calculated from state file timestamps (started_at → completed_at)
- **Steps**: Count of completed_steps in state file
- **Files/Tests/Coverage**: Template placeholders for manual completion

**Sprint File Updates:**

Adds or replaces the Postmortem section:

```markdown
## Postmortem

See [Sprint N Postmortem](./sprint-{N}_postmortem.md)
```

**When to Run:**

- After sprint is complete and moved to done/
- Before or after final commit
- Can be run multiple times (updates existing postmortem file)

**Next Steps After Generation:**

1. Review the postmortem file
2. Fill in TODO sections with actual analysis
3. Run `git diff --stat` for file change metrics
4. Count test functions added
5. Compare coverage reports if available
6. Document learnings and action items
