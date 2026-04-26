# @intexuraos/code-task-domain

Code task domain primitives shared across IntexuraOS services. Extracted from `@intexuraos/common-core` to keep the leaf package free of code-task-specific knowledge.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## Exports

| Entry Point | Path        | Contents                                                                  |
| ----------- | ----------- | ------------------------------------------------------------------------- |
| Main        | `.` (index) | Worker type catalog, runtime guards, plan-document path resolution helper |

## API Reference

### Worker Type Catalog (`codeTaskWorkerTypes.ts`)

```typescript
const CODE_TASK_WORKER_TYPES: readonly CodeTaskWorkerType[];
type CodeTaskWorkerType = (typeof CODE_TASK_WORKER_TYPES)[number];
function isCodeTaskWorkerType(value: unknown): value is CodeTaskWorkerType;
```

The single source of truth for the set of supported code-task worker identifiers (e.g. `claude`, `codex`, `glm`, `kimi`, `auto`). Used by orchestrator dispatch, code-agent routing, and the web app's worker-settings UI to validate user-supplied values.

### Plan Document Path Resolver (`planPathResolver.ts`)

```typescript
type PlanResolutionContext = {
  readonly issueIdentifier: string;
  readonly issueDescription: string | undefined;
  readonly attachments?: readonly { url: string }[];
};

function resolvePlanDocumentPathFromLinearContext(
  ctx: PlanResolutionContext,
): string | undefined;
```

Given a Linear issue's identifier, description, and attachments, returns the repo-relative path to the plan document (e.g. `docs/plans/INT-1520-…`) when one is referenced, or `undefined` otherwise. Used by the orchestrator to seed code-task workers with the correct plan file.

## Why this is a separate package

`code-task-domain` is structurally isolated so that `@intexuraos/common-core` can stay free of feature-specific knowledge. Apps that need code-task primitives import from this package directly rather than pulling worker-type symbols through the leaf utility package.

## Related Packages

- `@intexuraos/common-core` — generic primitives (Result, Logger, tracing) consumed by every package.
- `@intexuraos/linear-domain` — Linear-specific label utilities consumed alongside this package by the code-agent and orchestrator.
