---
description: "Advance to next sprint step after validating current step is complete"
allowed-tools: [Bash]
---

# Advance to Next Sprint Step

Run the advance-step automation command:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py advance-step $ARGUMENTS
```

This command:
- Validates current step is complete
- Reads sprint-steps.json for workflow definition
- Advances to next step in step_order
- Updates state file with new step
- Marks current step as completed with timestamp

**Usage:**
```
/sprint-next <sprint-number>
```

**Examples:**
```
/sprint-next 2          # Advance sprint 2 to next step
/sprint-next 5 --dry-run  # Preview step advancement
```

**What It Does:**

1. **Read State**: Loads `.claude/sprint-{N}-state.json` to get current step
2. **Find Next**: Looks up current step in sprint-steps.json and finds next step
3. **Update State**: Marks current step completed and advances to next step
4. **Phase Update**: Updates current_phase based on step number (e.g., step "2.3" → phase 2)

**Validation:**

- Sprint must be started (state file exists)
- Current step must be in workflow definition
- Cannot advance past final step (use /sprint-complete instead)

**State Changes:**

```json
{
  "current_step": "2.1",  // Updated to next step
  "current_phase": 2,     // Updated based on step
  "completed_steps": [    // Current step added
    {"step": "1.4", "completed_at": "2025-01-01T10:00:00"}
  ]
}
```

**Workflow Steps:**

See `~/.claude/sprint-steps.json` for complete workflow definition with 4 phases:
- Phase 1: Planning (steps 1.1-1.4)
- Phase 2: Test-First Implementation (steps 2.1-2.4)
- Phase 3: Validation & Refactoring (steps 3.1-3.4)
- Phase 4: Documentation (step 4.1)

**Next Actions:**

After each phase:
- End of Phase 1 (step 1.4): Begin implementation with tests
- End of Phase 2 (step 2.4): Run tests and fix failures
- End of Phase 3 (step 3.4): Generate documentation
- End of Phase 4 (step 4.1): Use /sprint-complete to finish
