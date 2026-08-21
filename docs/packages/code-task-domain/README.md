# @intexuraos/code-task-domain

Code-task domain primitives shared across IntexuraOS services: the canonical worker-type catalog, runtime guards, and Linear-context plan-document path resolution.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf domain package)

## Why It Exists

Multiple services (`code-agent`, `linear-agent`, `workers/orchestrator`) need to agree on (a) which worker types are valid and (b) how to extract the canonical plan-document path from a Linear issue. Before this package, these were duplicated as inline string unions and ad-hoc regexes — drift between services caused dispatch routing bugs and missing-plan failures. `code-task-domain` collapses both concerns into one source of truth.

## Exports

| Entry Point   | Path                             | Contents                                              |
| ------------- | -------------------------------- | ----------------------------------------------------- |
| Main          | `.` (index)                      | Re-exports both worker-type catalog and plan resolver |
| Worker types  | `./worker-types`                 | Just the worker-type catalog (lighter import)         |

## API Reference

### Worker Types (`codeTaskWorkerTypes.ts`)

```typescript
const CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'codex',
  'codex-xhigh',
  'openrouter-free',
] as const;

type CodeTaskWorkerType = (typeof CODE_TASK_WORKER_TYPES)[number];

function isCodeTaskWorkerType(value: string): value is CodeTaskWorkerType;
```

`isCodeTaskWorkerType` is the runtime guard used at every service boundary that accepts a worker-type string (HTTP routes, Pub/Sub messages, `@worker` directive parsing). The catalog is intentionally limited to subscription-authenticated Claude and Codex runtimes plus the OpenRouter API route.

### Plan Document Path Resolution (`planPathResolver.ts`)

```typescript
interface PlanResolutionContext {
  description: string | undefined;
  comments: { body: string }[];
}

function resolvePlanDocumentPathFromLinearContext(
  context: PlanResolutionContext,
): string | undefined;
```

Extracts a `docs/plans/*.md` path from a Linear issue's description and comments. Resolution order:

1. Canonical `Plan document: docs/plans/...` line in the description.
2. Canonical line in any comment (most-recent first by caller convention).
3. Fallback: any `docs/plans/*.md` mention anywhere in the description.
4. Fallback: any such mention in any comment.

The resolver normalizes paths via `posix.normalize`, rejects absolute paths, parent-directory traversal, and anything outside `docs/plans/*.md` — preventing path-injection attacks via Linear content.

## Usage

```typescript
import {
  isCodeTaskWorkerType,
  resolvePlanDocumentPathFromLinearContext,
} from '@intexuraos/code-task-domain';

if (!isCodeTaskWorkerType(input)) {
  return err({ code: 'INVALID_WORKER_TYPE' });
}

const planPath = resolvePlanDocumentPathFromLinearContext({
  description: issue.description,
  comments: issue.comments,
});
```

## Layering

This package is a **leaf** in the domain layer — no infra, no I/O, no Result wrapping. Both consumers (apps, workers) compose it with their own logger, repositories, and service container.
