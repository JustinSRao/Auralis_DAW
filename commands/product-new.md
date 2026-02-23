# Create New Product

Create a new product within the service and begin planning.

## Usage

```
/product-new <product-name>
```

## Prerequisites

- Foundation (Phase 0) must be complete
- Service vision and design system must exist

## Instructions

1. Read `.claude/product-state.json`
2. Verify foundation_complete is true
3. Create product folder structure
4. Initialize product in state
5. Begin Phase 1 (Problem)

## Folder Structure Created

```
docs/product/products/<product-name>/
├── problem-brief.md       # Created in Phase 1
├── user-research.md       # Created in Phase 1
├── success-metrics.md     # Created in Phase 1
├── solution-spec.md       # Created in Phase 2
├── user-stories.md        # Created in Phase 2
├── ui-spec/               # Created in Phase 2
│   ├── screens.md
│   ├── flows.md
│   └── component-mapping.md
└── sprint-roadmap.md      # Created in Phase 3
```

## State Update

```json
{
  "active_product": "<product-name>",
  "current_phase": 1,
  "current_step": "1.1",
  "products": {
    "<product-name>": {
      "type": null,
      "status": "in_progress",
      "started_at": "[timestamp]",
      "current_phase": 1,
      "current_step": "1.1",
      "artifacts": {},
      "sprints": []
    }
  }
}
```

## Output

```
=== New Product: <product-name> ===

Created: docs/product/products/<product-name>/

Beginning Phase 1: Problem

Step 1.1: Problem Brief

[Begin interactive prompts]
```

## If Foundation Not Complete

```
Cannot create product: Foundation (Phase 0) is not complete.

Current step: [X.X] - [Step Name]

To continue: /product-start
```
