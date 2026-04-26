# @intexuraos/linear-domain

Linear-specific domain helpers shared across IntexuraOS services. Extracted from `@intexuraos/common-core` to keep the leaf package free of integration-specific knowledge.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## Exports

| Entry Point | Path        | Contents                            |
| ----------- | ----------- | ----------------------------------- |
| Main        | `.` (index) | Label normalization + label probes  |

## API Reference

### Label Helpers (`labels.ts`)

```typescript
function normalizeLabel(label: string): string;
function hasCodeTaskLabel(labels: readonly string[]): boolean;
function hasPlanningTaskLabel(labels: readonly string[]): boolean;
function hasComplexTaskLabel(labels: readonly string[]): boolean;
```

`normalizeLabel` lowercases and trims a Linear label so that case/whitespace variations compare equal. The `has*Label` helpers accept an array of label names and return whether any of them match the corresponding canonical Linear label (`code-task`, `planning-task`, `complex-task`) after normalization.

Used by the linear-agent and code-agent to gate routing decisions on issue labels without re-implementing string comparison rules across services.

## Why this is a separate package

`linear-domain` keeps Linear-specific vocabulary out of `@intexuraos/common-core`. Apps that integrate with Linear import from this package directly; apps that don't (e.g. `mobile-notifications-service`) carry no Linear knowledge.

## Related Packages

- `@intexuraos/common-core` — generic primitives (Result, Logger, tracing) consumed by every package.
- `@intexuraos/code-task-domain` — code-task worker types and plan-path resolution consumed alongside this package by the code-agent and orchestrator.
