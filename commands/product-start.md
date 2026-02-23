# Start Product Planning

Initialize or resume product planning workflow.

## Usage

```
/product-start                    # Start foundation (Phase 0) if not done
/product-start <product-name>     # Start planning for a specific product
```

## Workflow

1. **Check for existing state**: Read `.claude/product-state.json` if it exists
2. **Foundation check**: If Phase 0 not complete, start there
3. **Product initialization**: Create product folder and begin Phase 1

## State File Location

`.claude/product-state.json`

## Instructions

Read the workflow definition from `~/.claude/product-steps.json` and templates from `~/.claude/product-templates.json`.

### If no state file exists (new service):

1. Create `.claude/product-state.json` with initial state
2. Create `docs/product/` directory structure
3. Begin Phase 0, Step 0.1 (Service Vision)
4. Guide user through interactive prompts
5. Update state after each step

### If state file exists but Phase 0 incomplete:

1. Resume at current step in Phase 0
2. Guide through remaining foundation steps

### If state file exists and Phase 0 complete:

1. If product name provided, check if it exists in `docs/product/products/`
2. If new product, create folder and begin Phase 1
3. If existing product, resume at current step
4. Update `active_product` in state

## State File Schema

```json
{
  "version": "1.0",
  "service_name": "",
  "foundation_complete": false,
  "active_product": null,
  "current_phase": 0,
  "current_step": "0.1",
  "started_at": "",
  "products": {},
  "completed_steps": [],
  "gates": {
    "foundation_complete": {"passed": false},
    "problem_approved": {"passed": false},
    "design_approved": {"passed": false},
    "sprints_ready": {"passed": false}
  }
}
```

## Output

After initialization, display:
- Current phase and step
- Next action required
- Files created

Then begin interactive facilitation for the current step.
