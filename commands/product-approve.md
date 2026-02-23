# Approve Product Planning Gate

Pass the current gate checkpoint in product planning.

## Usage

```
/product-approve              # Approve current gate
/product-approve <comment>    # Approve with comment
```

## Instructions

1. Read `.claude/product-state.json`
2. Check if current step has a gate
3. If at a gate, record approval and advance

## Gate Types

| Gate | After Step | Required Artifacts |
|------|------------|-------------------|
| foundation_complete | 0.3 | service-vision.md, design-brief.md, shadcn-config.md |
| problem_approved | 1.3 | problem-brief.md, user-research.md, success-metrics.md |
| design_approved | 2.5 | solution-spec.md, user-stories.md, ui-spec/* |
| sprints_ready | 3.4 | sprint-roadmap.md, sprint files in docs/sprints/1-todo/ |

## State Update

On approval:
```json
{
  "gates": {
    "[gate_name]": {
      "passed": true,
      "at": "[timestamp]",
      "by": "user",
      "comment": "[optional comment]"
    }
  },
  "completed_steps": [...updated]
}
```

## Output

### If not at a gate:
```
No gate at current step ([X.X] - [Name]).

Use /product-next to advance to the next step.
```

### If at a gate:
```
=== Gate Approved: [Gate Name] ===

Approved at: [timestamp]
Comment: [comment if provided]

Advancing to Phase [N]: [Phase Name]

Next step: [X.X] - [Step Name]

[Begin next step or show instructions]
```
