# Object Creation Link Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Created-object confirmations across IntexuraOS return full public URLs and use WhatsApp CTA rich-link presentation where the WhatsApp transport supports it.

**Architecture:** Add one shared public web-app URL helper, then have each creation service return absolute object resource links. Intex-agent remains the user-facing formatter: it converts created-object tool results into deterministic text plus `ctaUrl` metadata for WhatsApp, while calendar confirmations use Google Calendar `htmlLink` instead of an internal IntexuraOS calendar page.

**Tech Stack:** TypeScript, Fastify, Vitest, `@intexuraos/common-core`, `@intexuraos/internal-clients`, `@intexuraos/whatsapp-pubsub-client`, Google Calendar `htmlLink`.

## Global Constraints

- Default public web-app base URL is exactly `https://intexuraos.cloud`.
- Preserve configured `INTEXURAOS_WEB_APP_URL` behavior where a service already supports it, with trailing-slash normalization.
- No created-object confirmation or CTA URL may use relative `/#/...` paths.
- Calendar creation links must point to Google Calendar `htmlLink`; do not use `/#/calendar`.
- WhatsApp rich-link presentation uses existing `ctaUrl: { displayText: string; url: string }`.
- CTA URLs must be absolute URLs.
- Keep `ctaUrl.displayText` short enough for WhatsApp CTA labels: `Open Note`, `Open Research`, `View Progress`, `Open Calendar`, `Open Bookmark`.
- Follow test-first implementation and run `pnpm run ci:tracked` before the final implementation PR.

---

## Endpoint Changes

**Modified**

- `POST /internal/code/submit`: `data.resourceUrl` becomes a full public URL.
- Code-agent retry, feedback follow-up, and phase-2 submit responses: `resourceUrl` becomes a full public URL.
- `POST /internal/notes`: `ServiceFeedback.resourceUrl` becomes a full public note URL.
- `POST /internal/research/draft`: `ServiceFeedback.resourceUrl` defaults to a full public research URL even when service config has no base URL.
- `POST /internal/bookmarks`: response adds `resourceUrl` for the bookmark object and preserves the saved target URL on `bookmark.url`.
- `POST /internal/bookmarks/:id/force-refresh`: response adds `resourceUrl` for the bookmark object when returning bookmark link data.
- Calendar action processing: persisted/returned resource link uses Google Calendar `htmlLink` only.
- Intex-agent WhatsApp send path: outgoing Pub/Sub send events may include `ctaUrl` for object creation confirmations.

**Created**

- `@intexuraos/common-core` public URL helper exports.

**Removed**

- Created-object link fallbacks that return relative `/#/...` paths.
- Calendar action fallback to `/#/calendar`.

**Unchanged**

- WhatsApp-service CTA URL transport and `sendCtaUrlMessage` behavior.
- Public CRUD routes for notes, bookmarks, research detail, and calendar event listing.
- Saved bookmark target URLs.

## Parallel Subagent Responsibilities

| Linear | Boundary | Owns | Consumes | Produces |
| --- | --- | --- | --- | --- |
| INT-1705 | `packages/common-core`, `packages/http-contracts`, `packages/internal-clients` | Shared URL helper, bookmark client/contract shape | Existing service response envelopes | `buildWebAppHashUrl(...)`, bookmark `resourceUrl` client contract |
| INT-1706 | `apps/code-agent` | Code-task creation/follow-up `resourceUrl` generation | Shared URL helper contract | Absolute code-task URLs |
| INT-1707 | `apps/notes-agent` | Internal note creation feedback URL | Shared URL helper contract | Absolute note `resourceUrl` |
| INT-1708 | `apps/research-agent` | Draft research creation feedback URL | Shared URL helper contract | Absolute research `resourceUrl` with no relative fallback |
| INT-1709 | `apps/bookmarks-agent` | Bookmark object `resourceUrl` response | Shared URL helper contract | Absolute bookmark object URL while preserving target URL |
| INT-1710 | `apps/calendar-agent` | Calendar create/action resource link semantics | Google Calendar `htmlLink` | Google event links only, no internal calendar page fallback |
| INT-1711 | `apps/intex-agent` | WhatsApp confirmation text and CTA metadata | Service result fields, existing WhatsApp `ctaUrl` transport | Rich-link object creation confirmations |

These subtasks are direct children of INT-1704 and are intentionally independent. Each subagent can work against the contracts listed here without waiting for another subtask to complete; integration resolves imports and final CI.

### Task 1: Shared Public URL Helper And Bookmark Contracts

**Files:**

- Create: `packages/common-core/src/publicUrls.ts`
- Modify: `packages/common-core/src/index.ts`
- Test: `packages/common-core/src/__tests__/publicUrls.test.ts`
- Modify: `packages/http-contracts/src/zod/bookmarks-agent.ts`
- Test: `packages/http-contracts/src/__tests__/zod-contracts.test.ts`
- Modify: `packages/internal-clients/src/bookmarks-agent/types.ts`
- Modify: `packages/internal-clients/src/bookmarks-agent/client.ts`
- Test: `packages/internal-clients/src/bookmarks-agent/__tests__/client.test.ts` or existing `packages/internal-clients/src/bookmarks-agent` client test location

**Interfaces:**

- Consumes: `process.env.INTEXURAOS_WEB_APP_URL` only through optional callers; the helper itself receives optional base URL.
- Produces:

```typescript
export const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';
export function normalizeWebAppUrl(webAppUrl: string): string;
export function resolveWebAppUrl(webAppUrl?: string): string;
export function buildWebAppHashUrl(hashRoute: string, webAppUrl?: string): string;
```

- Produces bookmark client output:

```typescript
export interface CreateBookmarkResponse {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  resourceUrl: string;
}
```

- `url` is the saved target URL.
- `resourceUrl` is the IntexuraOS bookmark object URL.
- Bookmarks-agent route responses keep top-level `url` as the compatibility object URL while adding `resourceUrl`; the internal client maps its output `url` from `bookmark.url` so callers receive the saved external target URL.

- [ ] **Step 1: Write failing common-core helper tests**

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildWebAppHashUrl,
  normalizeWebAppUrl,
  resolveWebAppUrl,
} from '../publicUrls.js';

describe('public URL helpers', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeWebAppUrl('https://dev.intexuraos.cloud/')).toBe(
      'https://dev.intexuraos.cloud'
    );
    expect(normalizeWebAppUrl('https://dev.intexuraos.cloud///')).toBe(
      'https://dev.intexuraos.cloud'
    );
  });

  it('defaults to the production web app URL', () => {
    expect(resolveWebAppUrl()).toBe('https://intexuraos.cloud');
    expect(resolveWebAppUrl('')).toBe('https://intexuraos.cloud');
    expect(resolveWebAppUrl('   ')).toBe('https://intexuraos.cloud');
  });

  it('builds hash route URLs from default and explicit bases', () => {
    expect(buildWebAppHashUrl('/#/notes/note-1')).toBe(
      'https://intexuraos.cloud/#/notes/note-1'
    );
    expect(buildWebAppHashUrl('#/notes/note-1', 'https://dev.intexuraos.cloud/')).toBe(
      'https://dev.intexuraos.cloud/#/notes/note-1'
    );
    expect(buildWebAppHashUrl('/notes/note-1')).toBe(
      'https://intexuraos.cloud/#/notes/note-1'
    );
    expect(buildWebAppHashUrl('notes/note-1')).toBe(
      'https://intexuraos.cloud/#/notes/note-1'
    );
  });
});
```

Run: `pnpm --filter @intexuraos/common-core exec vitest run src/__tests__/publicUrls.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement the helper**

```typescript
export const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

export function normalizeWebAppUrl(webAppUrl: string): string {
  return webAppUrl.replace(/\/+$/u, '');
}

export function resolveWebAppUrl(webAppUrl?: string): string {
  return webAppUrl !== undefined && webAppUrl.trim() !== ''
    ? normalizeWebAppUrl(webAppUrl)
    : DEFAULT_WEB_APP_URL;
}

export function buildWebAppHashUrl(hashRoute: string, webAppUrl?: string): string {
  const route = hashRoute.startsWith('/#/')
    ? hashRoute
    : hashRoute.startsWith('#/')
      ? `/${hashRoute}`
      : hashRoute.startsWith('/')
        ? `/#${hashRoute}`
        : `/#/${hashRoute}`;
  return `${resolveWebAppUrl(webAppUrl)}${route}`;
}
```

Export from `packages/common-core/src/index.ts`:

```typescript
export * from './publicUrls.js';
```

- [ ] **Step 3: Update bookmark contract tests**

Add a parse assertion that includes both URLs:

```typescript
bookmarksCreateBookmarkDataSchema.parse({
  id: 'bookmark-1',
  url: 'https://intexuraos.cloud/#/bookmarks/bookmark-1',
  resourceUrl: 'https://intexuraos.cloud/#/bookmarks/bookmark-1',
  bookmark: {
    id: 'bookmark-1',
    userId: 'user-1',
    status: 'active',
    url: 'https://example.com',
    title: 'Example',
    description: null,
    tags: [],
    ogPreview: null,
    ogFetchedAt: null,
    ogFetchStatus: 'pending',
    aiSummary: null,
    aiSummarizedAt: null,
    source: 'whatsapp',
    sourceId: 'wamid-1',
    archived: false,
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
});
```

Expected: FAIL before adding `resourceUrl` to the schema.

Add an internal-client mapping assertion that proves callers receive the saved external target URL:

```typescript
expect(result.value).toMatchObject({
  id: 'bookmark-1',
  url: 'https://example.com',
  resourceUrl: 'https://intexuraos.cloud/#/bookmarks/bookmark-1',
});
```

- [ ] **Step 4: Update bookmark schemas and internal client mapping**

Schema change:

```typescript
export const bookmarksCreateBookmarkDataSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    resourceUrl: z.string().url().optional(),
    bookmark: bookmarksBookmarkSchema,
  })
  .strict();
```

`resourceUrl` is optional in the schema only for client compatibility with older service responses. Bookmarks-agent must always return it after this change; the fallback below is a transition path for historical responses that pass through the internal client.

Client legacy-compatible mapping:

```typescript
interface LegacyCreateBookmarkData {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  resourceUrl?: string;
}

if ('bookmark' in data) {
  const resourceUrl =
    'resourceUrl' in data && typeof data.resourceUrl === 'string'
      ? data.resourceUrl
      : data.url;
  return ok({
    id: data.id,
    userId: data.bookmark.userId,
    url: data.bookmark.url,
    title: data.bookmark.title,
    resourceUrl,
  });
}

return ok({
  id: data.id,
  userId: data.userId,
  url: data.url,
  title: data.title,
  resourceUrl: data.resourceUrl ?? data.url,
});
```

- [ ] **Step 5: Verify packages**

Run:

```bash
pnpm --filter @intexuraos/common-core typecheck
pnpm --filter @intexuraos/http-contracts test -- src/__tests__/zod-contracts.test.ts
pnpm --filter @intexuraos/internal-clients test -- src/code-agent/__tests__/client.test.ts src/bookmarks-agent/__tests__/client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/common-core packages/http-contracts packages/internal-clients
git commit -m "feat: add public object URL contracts"
```

### Task 2: Code-Agent Absolute Code-Task URLs

**Files:**

- Modify: `apps/code-agent/src/domain/utils/taskUrls.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitDirectCodeTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/dispatchSubmission.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/taskUrls.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/submitDirectCodeTask.test.ts`
- Test: `apps/code-agent/src/__tests__/usecases/retryTask.test.ts`
- Test: `apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts`

**Interfaces:**

- Consumes: `buildWebAppHashUrl('/#/code-tasks/<id>', webAppUrl?)`.
- Produces: all code-task `resourceUrl` responses are absolute.
- Existing `apps/code-agent/src/domain/utils/taskUrls.ts` is the migration point: keep the wrapper API only if needed by callers, but replace its URL construction by delegating to `@intexuraos/common-core` helpers. Do not duplicate `DEFAULT_WEB_APP_URL`, trailing-slash normalization, or hash-route assembly in code-agent.

- [ ] **Step 1: Write failing assertions for absolute resource URLs**

Add or update expectations like:

```typescript
expect(result.value.resourceUrl).toBe('https://intexuraos.cloud/#/code-tasks/task_123');
```

For configured base:

```typescript
process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud/';
expect(buildCodeTaskUrl('task_123')).toBe('https://dev.intexuraos.cloud/#/code-tasks/task_123');
```

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/submitDirectCodeTask.test.ts src/__tests__/usecases/retryTask.test.ts src/__tests__/usecases/submitTaskFeedback.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts
```

Expected: FAIL where code still returns `/#/code-tasks/...`.

- [ ] **Step 2: Adapt the code-task URL wrapper**

```typescript
import {
  buildWebAppHashUrl,
  normalizeWebAppUrl,
  resolveWebAppUrl,
} from '@intexuraos/common-core';

export { normalizeWebAppUrl };

export function resolveConfiguredWebAppUrl(): string {
  return resolveWebAppUrl(process.env['INTEXURAOS_WEB_APP_URL']);
}

export function buildCodeTaskUrl(
  taskId: string,
  webAppUrl: string = resolveConfiguredWebAppUrl()
): string {
  return buildWebAppHashUrl(`/#/code-tasks/${taskId}`, webAppUrl);
}
```

Delete any local `DEFAULT_WEB_APP_URL` or hash-route assembly that remains in `taskUrls.ts`; the wrapper delegates to the shared helper so code-agent does not retain a second implementation.

- [ ] **Step 3: Replace relative resource URL construction**

Replace:

```typescript
resourceUrl: `/#/code-tasks/${task.id}`,
```

with:

```typescript
resourceUrl: buildCodeTaskUrl(task.id),
```

Apply the same replacement for retry tasks, feedback follow-ups, fan-out primary child tasks, parent queued tasks, and phase-2 execution task responses.

- [ ] **Step 4: Verify code-agent**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/utils/taskUrls.test.ts src/__tests__/domain/usecases/submitDirectCodeTask.test.ts src/__tests__/usecases/retryTask.test.ts src/__tests__/usecases/submitTaskFeedback.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent
git commit -m "fix: return absolute code task resource URLs"
```

### Task 3: Notes-Agent Absolute Note URLs

**Files:**

- Modify: `apps/notes-agent/src/routes/internalRoutes.ts`
- Test: `apps/notes-agent/src/__tests__/internalRoutes.test.ts`

**Interfaces:**

- Consumes: `buildWebAppHashUrl('/#/notes/<noteId>')`.
- Produces: `ServiceFeedback.resourceUrl` with an absolute note URL.

- [ ] **Step 1: Write the failing route assertion**

```typescript
expect(body.data.resourceUrl).toMatch(
  /^https:\/\/intexuraos\.cloud\/#\/notes\/.+/u
);
```

Run: `pnpm --filter @intexuraos/notes-agent test -- src/__tests__/internalRoutes.test.ts`

Expected: FAIL because current response is `/#/notes/<id>`.

- [ ] **Step 2: Build the note resource URL with the shared helper**

```typescript
import { buildWebAppHashUrl } from '@intexuraos/common-core';

const resourceUrl = buildWebAppHashUrl(`/#/notes/${noteId}`);
```

- [ ] **Step 3: Verify notes-agent**

Run:

```bash
pnpm --filter @intexuraos/notes-agent test -- src/__tests__/internalRoutes.test.ts
pnpm run verify:workspace:tracked -- notes-agent
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/notes-agent
git commit -m "fix: return absolute note resource URLs"
```

### Task 4: Research-Agent Absolute Research URLs

**Files:**

- Modify: `apps/research-agent/src/routes/internalRoutes.ts`
- Test: `apps/research-agent/src/__tests__/routes.test.ts`

**Interfaces:**

- Consumes: `buildWebAppHashUrl('/#/research/<researchId>', webAppUrl)`.
- Produces: `ServiceFeedback.resourceUrl` with an absolute research URL even when `webAppUrl` is empty.
- Existing local helper `buildWebAppResourceUrl(webAppUrl, path)` in `apps/research-agent/src/routes/internalRoutes.ts` must be removed, not reimplemented as a wrapper, and the draft creation call site should call `buildWebAppHashUrl` directly.

- [ ] **Step 1: Change failing empty-base test expectation**

Replace the existing empty-base expectation with:

```typescript
expect(body.data.resourceUrl).toBe(
  'https://intexuraos.cloud/#/research/generated-id-123'
);
```

Add trailing-slash coverage:

```typescript
getServices().webAppUrl = 'https://app.example.com/';
expect(body.data.resourceUrl).toBe('https://app.example.com/#/research/generated-id-123');
```

Run: `pnpm --filter @intexuraos/research-agent exec vitest run src/__tests__/routes.test.ts`

Expected: FAIL before helper replacement.

- [ ] **Step 2: Delete the local helper and call the shared helper directly**

```typescript
import { buildWebAppHashUrl } from '@intexuraos/common-core';

const resourceUrl = buildWebAppHashUrl(
  `/#/research/${research.id}`,
  getServices().webAppUrl
);
```

- [ ] **Step 3: Verify research-agent**

Run:

```bash
pnpm --filter @intexuraos/research-agent exec vitest run src/__tests__/routes.test.ts
pnpm run verify:workspace:tracked -- research-agent
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/research-agent
git commit -m "fix: return absolute research resource URLs"
```

### Task 5: Bookmarks-Agent Object Resource URLs

**Files:**

- Modify: `apps/bookmarks-agent/src/routes/internalRoutes.ts`
- Test: `apps/bookmarks-agent/src/__tests__/internalRoutes.test.ts`

**Interfaces:**

- Consumes: `buildWebAppHashUrl('/#/bookmarks/<bookmarkId>')`.
- Produces:

```typescript
{
  id: string;
  url: string;
  resourceUrl: string;
  bookmark: { url: string; ... };
}
```

- `url` and `resourceUrl` are the bookmark object URL during compatibility.
- `bookmark.url` remains the saved external target URL.
- Apply the same object URL field shape to `POST /internal/bookmarks/:id/force-refresh` when it returns bookmark link data, so bookmark responses do not diverge.

- [ ] **Step 1: Write failing route assertions**

```typescript
expect(body.data.resourceUrl).toMatch(
  /^https:\/\/intexuraos\.cloud\/#\/bookmarks\/.+/u
);
expect(body.data.url).toBe(body.data.resourceUrl);
expect(body.data.bookmark.url).toBe('https://example.com');
```

Run: `pnpm --filter @intexuraos/bookmarks-agent test -- src/__tests__/internalRoutes.test.ts`

Expected: FAIL because `resourceUrl` is absent and `url` is relative.

- [ ] **Step 2: Build the bookmark object URL**

```typescript
import { buildWebAppHashUrl } from '@intexuraos/common-core';

const bookmarkId = result.value.id;
const resourceUrl = buildWebAppHashUrl(`/#/bookmarks/${bookmarkId}`);

return await reply.ok({
  id: bookmarkId,
  url: resourceUrl,
  resourceUrl,
  bookmark: formatBookmark(result.value),
});
```

For force-refresh responses that include bookmark link data, add the same `resourceUrl` field and keep top-level `url` aligned with the object URL. Do not rewrite `bookmark.url`; it remains the saved external target URL.

- [ ] **Step 3: Verify bookmarks-agent**

Run:

```bash
pnpm --filter @intexuraos/bookmarks-agent test -- src/__tests__/internalRoutes.test.ts
pnpm run verify:workspace:tracked -- bookmarks-agent
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bookmarks-agent
git commit -m "fix: return bookmark object resource URLs"
```

### Task 6: Calendar-Agent Google Event Links

**Files:**

- Modify: `apps/calendar-agent/src/domain/useCases/processCalendarAction.ts`
- Test: `apps/calendar-agent/src/__tests__/domain/useCases/processCalendarAction.test.ts`
- Test: `apps/calendar-agent/src/__tests__/routes/internalRoutes.test.ts`

**Interfaces:**

- Consumes: `createdEvent.htmlLink?: string`.
- Produces: created calendar result/link data with Google Calendar `htmlLink` only.

- [ ] **Step 1: Write failing tests that reject internal calendar fallback**

Update the current fallback test so it expects no internal URL:

```typescript
expect(result.value.status).toBe('completed');
expect(result.value.resourceUrl).toBeUndefined();
expect(savedAction?.resourceUrl).toBeUndefined();
expect(Object.prototype.hasOwnProperty.call(savedAction ?? {}, 'resourceUrl')).toBe(
  false
);
```

For the success case:

```typescript
expect(result.value.resourceUrl).toBe('https://calendar.google.com/event');
expect(savedAction?.resourceUrl).toBe('https://calendar.google.com/event');
```

Run: `pnpm --filter @intexuraos/calendar-agent exec vitest run src/__tests__/domain/useCases/processCalendarAction.test.ts src/__tests__/routes/internalRoutes.test.ts`

Expected: FAIL because current code uses `/#/calendar` when `htmlLink` is missing.

- [ ] **Step 2: Remove the internal calendar fallback**

Replace:

```typescript
const resourceUrl = createdEvent.htmlLink ?? '/#/calendar';
```

with:

```typescript
const resourceUrl = createdEvent.htmlLink;
```

Only include `resourceUrl` in persisted or returned objects when it is defined:

```typescript
await processedActionRepository.create({
  actionId,
  userId,
  eventId: createdEvent.id,
  ...(resourceUrl !== undefined ? { resourceUrl } : {}),
});
```

- [ ] **Step 3: Verify calendar-agent**

Run:

```bash
pnpm --filter @intexuraos/calendar-agent exec vitest run src/__tests__/domain/useCases/processCalendarAction.test.ts src/__tests__/routes/internalRoutes.test.ts
pnpm run verify:workspace:tracked -- calendar-agent
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/calendar-agent
git commit -m "fix: use google calendar event links"
```

### Task 7: Intex-Agent Rich-Link Confirmation Presentation

**Files:**

- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Modify: `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- Modify: `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`
- Test: `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`
- Test: `apps/intex-agent/src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts`

**Interfaces:**

- Consumes tool result fields:
  - `resourceUrl` for notes, research, code tasks, and bookmark objects.
  - `htmlLink` for calendar events.
  - `url` as saved external link fallback for bookmarks only.
- Produces optional CTA:

```typescript
ctaUrl?: { displayText: string; url: string };
```

- [ ] **Step 1: Write failing runner tests for CTA metadata**

Add expectations like:

```typescript
expect(result).toMatchObject({
  outcome: 'completed',
  reply: 'Utworzyłem zadanie programistyczne.',
  ctaUrl: {
    displayText: 'View Progress',
    url: 'https://intexuraos.cloud/#/code-tasks/task-1',
  },
});
```

Calendar assertion:

```typescript
expect(result.ctaUrl).toEqual({
  displayText: 'Open Calendar',
  url: 'https://calendar.google.com/event?eid=calendar-event-1',
});
```

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/intexAgentRunner.test.ts`

Expected: FAIL because `ctaUrl` is not part of the runner result.

- [ ] **Step 2: Extend runner and publisher types**

```typescript
export type IntexAgentRunnerResult =
  | {
      outcome: 'completed';
      reply: string;
      summary?: string;
      toolName?: IntexAgentToolName;
      toolResult?: Record<string, unknown>;
      ctaUrl?: { displayText: string; url: string };
    }
  | ...
```

```typescript
export interface WhatsAppReplyPublisher {
  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
    ctaUrl?: { displayText: string; url: string };
  }): Promise<void>;
}
```

- [ ] **Step 3: Make completed reply formatting return CTA metadata**

```typescript
interface CompletedReplyPresentation {
  reply: string;
  ctaUrl?: { displayText: string; url: string };
}

function buildCompletedReply(
  toolName: IntexAgentToolName,
  result: Record<string, unknown> | undefined,
  fallbackReply: string
): CompletedReplyPresentation {
  if (result === undefined) {
    return { reply: fallbackReply };
  }

  const resourceUrl = readString(result, 'resourceUrl');
  const htmlLink = readString(result, 'htmlLink');
  const url = readString(result, 'url');

  if (toolName === 'create_code_task' && resourceUrl !== undefined) {
    return {
      reply: 'Utworzyłem zadanie programistyczne.',
      ctaUrl: { displayText: 'View Progress', url: resourceUrl },
    };
  }

  if (toolName === 'create_research' && resourceUrl !== undefined) {
    return {
      reply: 'Utworzyłem szkic researchu.',
      ctaUrl: { displayText: 'Open Research', url: resourceUrl },
    };
  }

  if (toolName === 'create_note' && resourceUrl !== undefined) {
    return {
      reply: 'Utworzyłem notatkę.',
      ctaUrl: { displayText: 'Open Note', url: resourceUrl },
    };
  }

  if (toolName === 'create_calendar_event' && htmlLink !== undefined) {
    return {
      reply: 'Utworzyłem wydarzenie w kalendarzu.',
      ctaUrl: { displayText: 'Open Calendar', url: htmlLink },
    };
  }

  if (toolName === 'create_link' && resourceUrl !== undefined) {
    return {
      reply: 'Zapisałem link.',
      ctaUrl: { displayText: 'Open Bookmark', url: resourceUrl },
    };
  }

  if (toolName === 'create_link' && url !== undefined) {
    return {
      reply: 'Zapisałem link.',
      ctaUrl: { displayText: 'Open Link', url },
    };
  }

  const message = readString(result, 'message');
  return { reply: message ?? fallbackReply };
}
```

In `parseRunnerContent`, pass both fields into the completed result.

- [ ] **Step 4: Forward CTA metadata to WhatsApp**

In `handleIncomingMessage.ts`, pass `runnerResult.ctaUrl` into `publishReply`.

In `whatsappReplyPublisher.ts`:

```typescript
const result = await deps.sendPublisher.publishSendMessage({
  userId: input.userId,
  message: input.message,
  replyToMessageId: input.replyToMessageId,
  correlationId: input.correlationId,
  important: true,
  ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl } : {}),
});
```

Add publisher tests in `apps/intex-agent/src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts` for both paths:

```typescript
expect(sentMessage).toMatchObject({
  ctaUrl: {
    displayText: 'Open Note',
    url: 'https://intexuraos.cloud/#/notes/note-1',
  },
});
expect(sentMessageWithoutCta).not.toHaveProperty('ctaUrl');
```

- [ ] **Step 5: Verify Intex-agent**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/intexAgentRunner.test.ts src/__tests__/domain/handleIncomingMessage.test.ts src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts
pnpm run verify:workspace:tracked -- intex-agent
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/intex-agent
git commit -m "feat: send rich link creation confirmations"
```

## Integration Verification

After all subtasks are integrated:

- [ ] Run targeted package/service tests listed above.
- [ ] Audit for remaining relative created-object links:

```bash
rg "resourceUrl: `/#/|resourceUrl: '/#/|/#/calendar|/#/code-tasks" apps packages -n
```

Expected: no remaining created-object response construction that emits a relative URL. Tests may still contain relative strings only when intentionally exercising legacy compatibility.

- [ ] Run full tracked CI:

```bash
pnpm run ci:tracked
```

Expected: PASS.

## PR Handoff Notes

- The implementation PR should mention that WhatsApp-service itself already supports `ctaUrl`; the implementation only needs to pass CTA metadata through Intex-agent.
- If any subtask chooses to add `INTEXURAOS_WEB_APP_URL` as a required env var to notes-agent or bookmarks-agent, it must update `apps/<service>/src/index.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs` in the same subtask. The lower-risk path is using the shared helper default without adding a new required env var.
- Calendar links are intentionally not IntexuraOS links. If Google Calendar does not return `htmlLink`, omit the CTA instead of fabricating a URL.
