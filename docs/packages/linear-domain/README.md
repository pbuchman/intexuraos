# @intexuraos/linear-domain

Linear-specific domain helpers used across IntexuraOS services to interpret Linear issue labels in a consistent way.

**Package:** `@intexuraos/linear-domain` | **Type:** ESM | **Node:** >=22.0.0

## Overview

Linear labels are free-form strings, but IntexuraOS treats a few of them as routing signals (e.g. `code-task`, `planning-task`, `complex-task`). To avoid each service re-implementing the matching rules, this package centralises:

- A normalisation function that lowercases and trims whitespace consistently.
- Boolean detectors for the routing labels the platform cares about today.

Any service that consumes Linear webhooks or queries Linear's API should depend on this package rather than checking label strings inline.

## Exports

| Symbol                  | Source file | Purpose                                                                                   |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `normalizeLabel`        | `labels.ts` | Returns a canonical lowercase, trimmed form of a label string (used as a comparison key). |
| `hasCodeTaskLabel`      | `labels.ts` | Returns `true` when the label set contains the `code-task` label (case-insensitive).      |
| `hasPlanningTaskLabel`  | `labels.ts` | Returns `true` when the label set contains the `planning-task` label.                     |
| `hasComplexTaskLabel`   | `labels.ts` | Returns `true` when the label set contains the `complex-task` label.                      |

## Usage

```ts
import { hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/linear-domain';

if (hasCodeTaskLabel(issue.labels)) {
  await dispatchCodeAgent(issue);
}

if (hasPlanningTaskLabel(issue.labels)) {
  await dispatchPlanningAgent(issue);
}
```

## Build Output

This package follows the **source-exports default** — `package.json#exports` points at `./src/index.ts`, no `dist/` is emitted. See [`docs/architecture/package-build-output.md`](../../architecture/package-build-output.md).

## Testing

```bash
pnpm vitest run packages/linear-domain
```

Tests cover label normalisation edge cases (whitespace, mixed case, empty input) and each detector's positive and negative paths.
