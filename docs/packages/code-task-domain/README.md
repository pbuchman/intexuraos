# @intexuraos/code-task-domain

Code-task domain primitives shared across IntexuraOS services: the worker-type catalogue, runtime guards, and plan-document path resolution.

**Package:** `@intexuraos/code-task-domain` | **Type:** ESM | **Node:** >=22.0.0

## Overview

Several services (`code-agent`, `orchestrator`, `linear-agent`, `commands-agent`) need to agree on:

- Which worker types exist for code tasks (`auto`, `claude`, `codex`, `cursor`, ...).
- How to map a Linear context (issue identifier, branch, PR title) to the canonical plan document path under `docs/plans/`.

This package is the single source of truth for those values. It is a leaf package with zero infrastructure dependencies — depend on it freely from any layer (apps, workers, packages).

## Exports

| Symbol                                     | Source file              | Purpose                                                                                          |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `CODE_TASK_WORKER_TYPES`                   | `codeTaskWorkerTypes.ts` | Readonly tuple of supported worker-type identifiers.                                             |
| `isCodeTaskWorkerType`                     | `codeTaskWorkerTypes.ts` | Type-guard narrowing an arbitrary string to `CodeTaskWorkerType`.                                |
| `CodeTaskWorkerType`                       | `codeTaskWorkerTypes.ts` | Union type derived from `CODE_TASK_WORKER_TYPES`.                                                |
| `resolvePlanDocumentPathFromLinearContext` | `planPathResolver.ts`    | Maps a `PlanResolutionContext` to the conventional `docs/plans/<INT-XXX>-<slug>.md` path.        |
| `PlanResolutionContext`                    | `planPathResolver.ts`    | Input shape for the resolver: `{ linearIssueIdentifier?, prTitle?, branchName? }`.               |

## Usage

```ts
import {
  CODE_TASK_WORKER_TYPES,
  isCodeTaskWorkerType,
  resolvePlanDocumentPathFromLinearContext,
} from '@intexuraos/code-task-domain';

if (!isCodeTaskWorkerType(input)) {
  throw new Error(`Unknown worker type: ${input}. Allowed: ${CODE_TASK_WORKER_TYPES.join(', ')}`);
}

const planPath = resolvePlanDocumentPathFromLinearContext({
  linearIssueIdentifier: 'INT-1557',
  prTitle: '[INT-1557] Slim http-server',
});
```

## Build Output

This package follows the **source-exports default** — `package.json#exports` points at `./src/index.ts`, no `dist/` is emitted. See [`docs/architecture/package-build-output.md`](../../architecture/package-build-output.md).

## Testing

```bash
pnpm vitest run packages/code-task-domain
```

Tests cover the worker-type guard table and the plan-path resolution rules (issue identifier, branch fallback, PR-title fallback, slugification).
