# Product Planning Status

Show current state of product planning workflow.

## Usage

```
/product-status              # Show overall status
/product-status <product>    # Show status for specific product
```

## Instructions

1. Read `.claude/product-state.json`
2. Read workflow definition from `~/.claude/product-steps.json`
3. Display formatted status

## Output Format

```
=== Product Planning Status ===

Service: [service_name]
Foundation: [Complete / In Progress (step X.X)]

Active Product: [product_name]
Phase: [phase_number] - [phase_name]
Step: [step_number] - [step_name]
Status: [In Progress / Waiting for approval]

Gates:
  [x] Foundation Complete (YYYY-MM-DD)
  [x] Problem Approved (YYYY-MM-DD)
  [ ] Design Approved
  [ ] Sprints Ready

Artifacts Created:
  - docs/product/service-vision.md
  - docs/product/design/design-brief.md
  - docs/product/products/[name]/problem-brief.md
  ...

Next Action: [description of what to do next]
Command: [suggested command or "Continue with current step"]

Products:
  - core-platform: Complete (Sprints 1-15)
  - mobile-field-app: In Progress (Phase 2, Step 2.4)
  - analytics-dashboard: Not Started
```

## If No State File

Display:
```
No product planning in progress.

To start: /product-start
```
