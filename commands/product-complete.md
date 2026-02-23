# Complete Product Planning

Finalize product planning and confirm sprints are ready for execution.

## Usage

```
/product-complete
/product-complete <product-name>
```

## Prerequisites

- All phases (1-3) complete
- All gates passed
- Sprint files generated in `docs/sprints/1-todo/`

## Instructions

1. Read `.claude/product-state.json`
2. Verify all gates passed for the product
3. Verify sprint files exist
4. Update product status to "complete"
5. Display summary and next steps

## Validation Checklist

- [ ] Problem Brief approved (Gate: problem_approved)
- [ ] Solution Spec complete
- [ ] User Stories with acceptance criteria
- [ ] UI Spec reviewed (Gate: design_approved)
- [ ] Sprint Roadmap created
- [ ] Sprint files generated (Gate: sprints_ready)

## State Update

```json
{
  "products": {
    "<product-name>": {
      "status": "complete",
      "completed_at": "[timestamp]",
      "sprints": [N, N+1, N+2, ...]
    }
  },
  "active_product": null
}
```

## Output

```
=== Product Planning Complete: <product-name> ===

Completed: [timestamp]

Artifacts:
  - docs/product/products/<product-name>/problem-brief.md
  - docs/product/products/<product-name>/solution-spec.md
  - docs/product/products/<product-name>/user-stories.md
  - docs/product/products/<product-name>/ui-spec/screens.md
  - docs/product/products/<product-name>/ui-spec/flows.md
  - docs/product/products/<product-name>/sprint-roadmap.md

Sprints Generated:
  - Sprint N: [Title]
  - Sprint N+1: [Title]
  - Sprint N+2: [Title]

=== Ready for Execution ===

To begin implementation:
  /sprint-start N

To plan another product:
  /product-new <name>
```

## If Not Ready

```
Cannot complete: Product planning is not finished.

Missing:
  - [ ] [Gate or artifact not complete]

Current step: [X.X] - [Name]

To continue: /product-next
```
