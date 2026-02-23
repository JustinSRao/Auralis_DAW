# Advance Product Planning

Validate current step is complete and advance to next step.

## Usage

```
/product-next
```

## Instructions

1. Read `.claude/product-state.json`
2. Read workflow from `~/.claude/product-steps.json`
3. Get current step definition
4. Validate current step is complete (check validation rules)
5. If valid, advance to next step
6. If at a gate, check gate conditions

## Validation Rules

Based on step definition's `validation.type`:

- **file_exists**: Check if output file(s) exist
- **files_exist**: Check if multiple output files exist
- **user_approval**: Require explicit user confirmation
- **state_field**: Check if state field has expected value
- **file_content**: Check file contains expected content

## Gate Handling

If current step has `gate: true`:
1. Display gate message
2. Require explicit approval before proceeding
3. Record gate passage in state with timestamp

## State Update

On successful advance:
```json
{
  "current_step": "[next_step]",
  "current_phase": [next_phase],
  "completed_steps": [
    ...existing,
    {
      "step": "[completed_step]",
      "completed_at": "[timestamp]",
      "output": "[summary]"
    }
  ]
}
```

## Output

### If validation fails:
```
Cannot advance: Step [X.X] - [Name] is not complete.

Missing:
  - [validation failure reason]

To complete this step:
  [instructions]
```

### If at gate requiring approval:
```
=== GATE: [Gate Name] ===

[gate_message]

To proceed, confirm you have:
  - [checklist item]
  - [checklist item]

Reply "approved" to pass this gate, or describe what needs to change.
```

### If successful:
```
Step [X.X] - [Name] complete.

Advancing to Step [Y.Y] - [Next Name]

[Begin interactive prompts for next step if applicable]
```
