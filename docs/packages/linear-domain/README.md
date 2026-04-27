# @intexuraos/linear-domain

Linear-issue label utilities: normalization and well-known label detectors used wherever IntexuraOS classifies a Linear issue.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf domain package)

## Why It Exists

Label classification was duplicated in at least four places before this package:

- `apps/code-agent/src/domain/utils/labelUtils.ts`
- `workers/orchestrator/src/services/task-dispatcher.ts` (private method)
- `workers/orchestrator/src/services/system-prompt.ts` (inline)
- `apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts` (local function)

Each copy normalized labels slightly differently (some only lowercased, some replaced spaces but not underscores, etc.). Issues authored with `Code_Task`, `code task`, or `code-task` would route inconsistently. This package provides one canonical normalizer plus the three label predicates the dispatch pipeline actually checks.

## Exports

| Entry Point | Path        | Contents                                                                            |
| ----------- | ----------- | ----------------------------------------------------------------------------------- |
| Main        | `.` (index) | `normalizeLabel`, `hasCodeTaskLabel`, `hasPlanningTaskLabel`, `hasComplexTaskLabel` |

## API Reference

```typescript
function normalizeLabel(label: string): string;
function hasCodeTaskLabel(labels: string[]): boolean;
function hasPlanningTaskLabel(labels: string[]): boolean;
function hasComplexTaskLabel(labels: string[]): boolean;
```

### `normalizeLabel`

Lower-cases, trims, and converts both underscores and spaces to hyphens. The result is the canonical comparison form for every other utility in this package.

```typescript
normalizeLabel(' Code_Task ');     // 'code-task'
normalizeLabel('Planning Task');   // 'planning-task'
normalizeLabel('complex-task');    // 'complex-task'
```

### `hasCodeTaskLabel` / `hasPlanningTaskLabel` / `hasComplexTaskLabel`

Each returns `true` if any element of `labels`, after normalization, matches the corresponding canonical label (`code-task`, `planning-task`, `complex-task`). Use these to drive dispatch decisions rather than inlining a string compare.

## Usage

```typescript
import { hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/linear-domain';

if (hasPlanningTaskLabel(issue.labels)) {
  return dispatchPlanning(issue);
}
if (hasCodeTaskLabel(issue.labels)) {
  return dispatchExecution(issue);
}
```

## Layering

Pure functions, no I/O, no `Result` wrapping. Adding a new well-known label is a one-line addition; callers do not need to learn yet another string convention.
