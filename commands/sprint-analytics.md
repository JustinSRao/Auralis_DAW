---
description: "Generate analytics report for a sprint"
allowed-tools: [Bash]
---

# Sprint Analytics

Generate a comprehensive analytics report for a completed or in-progress sprint.

Run the analytics engine:

```bash
python3 scripts/analytics_engine.py $ARGUMENTS
```

This command generates:
- **Phase Breakdown**: Time spent in each workflow phase with ASCII visualization
- **Historical Comparison**: Compare to sprint type averages
- **Bottleneck Identification**: Phases exceeding 1.5x historical percentage
- **Agent Execution Metrics**: Timing and token estimates per agent
- **Coverage Delta**: Test coverage improvement tracking

**Usage:**
```
/sprint-analytics <N>
```

**Example:**
```
/sprint-analytics 5
```

## Report Contents

### Phase Breakdown Visualization
ASCII bar charts showing time distribution:
```
Planning       [██░░░░░░░░] 14% (0.25h)
Implementation [████████░░] 80% (1.50h)
Validation     [█░░░░░░░░░]  6% (0.10h)
```

### Historical Comparison
- Average duration for sprint type
- Coverage improvement vs. historical average
- Duration percentile rank

### Bottleneck Detection
Identifies phases taking >1.5x average time with actionable recommendations:
- Planning: Use templates for faster architecture design
- Implementation: Break into smaller tasks or parallelize
- Validation: Automate test execution

### Agent Metrics
- Execution duration per agent
- Token estimates (chars / 4)
- Files modified count

## Data Source

Analytics are computed from:
- `.claude/sprint-state.json` - Current sprint state
- `docs/sprints/registry.json` - Historical sprint data

## Use Cases

1. **Post-Sprint Review**: Identify what took longer than expected
2. **Process Improvement**: Find recurring bottlenecks across sprints
3. **Estimation**: Use historical data to estimate future sprint duration
4. **Quality Tracking**: Monitor coverage improvement trends

## Schema

Sprint state follows JSON schema: `.claude/sprint-state.schema.json`
