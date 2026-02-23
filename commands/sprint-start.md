---
description: "Start a sprint with automated workflow execution"
allowed-tools: [Bash, Read, Glob, Grep, Task, Edit, Write, AskUserQuestion]
---

# Start Sprint (Automated Workflow)

This command starts a sprint and automatically executes the workflow through implementation, pausing only for:
1. **Clarification questions** (Step 1.3) - User must review and approve
2. **Completion** (Phase 6) - User runs `/sprint-complete` when ready

## Instructions

### 1. Initialize Sprint

Run the start-sprint automation:

```bash
python3 ~/.claude/scripts/sprint_lifecycle.py start-sprint $ARGUMENTS
```

If sprint is already started, continue from current step.

### 2. Execute Phase 1: Planning (Steps 1.1-1.2)

**Step 1.1 - Read Sprint File:**
- Read the sprint file from the state
- Understand requirements, scope, and technical approach
- Advance step: `python3 ~/.claude/scripts/sprint_lifecycle.py advance-step $ARGUMENTS`

**Step 1.2 - Spawn Plan Agent:**
- Use Task tool with subagent_type="Plan" to design implementation
- Prompt should include sprint requirements and ask for:
  - Files to create/modify
  - Architecture decisions
  - Test strategy
- Advance step after plan is complete

### 3. PAUSE at Step 1.3: Clarify Requirements

**CRITICAL: Stop and ask user questions using AskUserQuestion tool.**

Based on the sprint requirements and plan, identify:
- Ambiguous requirements that need clarification
- Edge cases that need decisions
- Implementation preferences (e.g., library choices, patterns)
- Any open questions from the sprint file

Present 1-4 focused questions. Wait for user response before continuing.

After user responds, advance step.

### 4. Execute Steps 1.4 through 5.2 (Automated)

**Step 1.4 - Mark Start:** Update sprint file status (advance step)

**Phase 1.5 - Interface Contract (fullstack only):**
- 1.5.1: Define interface contract if fullstack sprint
- 1.5.2: Validate contract

**Phase 2 - Test-First Implementation:**
- 2.1: Write failing tests using product-engineer agent
- 2.2: Implement feature using product-engineer agent
- 2.3: Run tests using test-runner agent
- 2.4: Fix failures if any (skip if tests pass)

**Phase 3 - Validation & Refactoring:**
- 3.1: Verify migrations (skip if none)
- 3.2: Quality review using quality-engineer agent
- 3.3: Refactoring based on review
- 3.4: Re-run tests after refactoring

**Phase 4 - Documentation:**
- 4.1: Generate documentation if significant new capability

**Phase 5 - Commit:**
- 5.1: Verify coverage gate meets sprint type threshold
- 5.2: Git commit all changes

### 5. Stop Before Phase 6

After completing step 5.2, report:

```
============================================================
Sprint $N: $TITLE - READY FOR COMPLETION
============================================================
All implementation steps complete.
Tests: PASSING
Coverage: XX%
Commit: <hash>

Run `/sprint-complete` to finalize the sprint.
============================================================
```

DO NOT execute Phase 6 steps. User controls completion.

## Execution Pattern

For each step:
1. Execute the step's work (agent, validation, etc.)
2. Run `python3 ~/.claude/scripts/sprint_lifecycle.py advance-step $ARGUMENTS`
3. Continue to next step (unless at 1.3 pause or 5.2 stop)

## Error Handling

If any step fails:
- Report the error clearly
- Do NOT advance to next step
- Suggest fix or ask user for guidance
- User can retry with `/sprint-start $ARGUMENTS` to resume from current step
