# List Products

Show all products in the service and their planning status.

## Usage

```
/product-list
```

## Instructions

1. Read `.claude/product-state.json`
2. Scan `docs/product/products/` for product folders
3. Display status of each product

## Output Format

```
=== Products: [Service Name] ===

Foundation: [Complete / In Progress]

| Product | Type | Phase | Status | Sprints |
|---------|------|-------|--------|---------|
| core-platform | Core | Complete | Done | 1-15 |
| mobile-field-app | Add-on | 2 - Solution | Design Review | - |
| analytics-dashboard | Feature | - | Not Started | - |

Active: [active_product or "None"]

Commands:
  /product-start <name>    Start/resume a product
  /product-new <name>      Create new product
  /product-status <name>   View product details
```

## Status Values

- **Not Started**: Folder exists but no artifacts
- **Phase N - Step Name**: Currently in progress
- **Waiting for Approval**: At a gate
- **Complete**: All phases done, sprints generated
