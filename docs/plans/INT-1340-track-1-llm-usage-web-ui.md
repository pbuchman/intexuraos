# INT-1340 — Track 1: LLM Usage Web UI

## Status
- Linear issue: INT-1340
- Parent epic: INT-1338 (LLM Usage Service Phase 2)
- Dependencies: none (independent; builds directly on Phase 1)
- Blocks: INT-1343 (Track 5 — pricing UI relocation, which reuses the new `/llm-usage` nav section as the mount point for pricing)
- Plan version: 2.0 (updated 2026-04-10 — aligned with INT-1338 decisions doc: no BFF, public Auth0 routes on llm-usage-service, `/llm-usage/*` prefix, web app uses `llmUsageServiceUrl` directly)

## Executive summary

This track delivers the first end-user surface for the new `llm-usage-service`. Phase 1 shipped the ingestion pipeline, daily aggregates, and an internal `POST /internal/usage/query` endpoint, but the web app currently has no way to view or drill into the resulting data. The legacy `LlmCostsPage` reads an old `llm_usage_stats` collection via `app-settings-service` and is completely disconnected from the new `llm_usage_events` / `llm_usage_daily_aggregates` collections owned by `llm-usage-service`. Users therefore cannot answer basic questions like "what did the orchestrator spend on Claude yesterday" without hitting Firestore directly.

Track 1 closes that gap by delivering a new top-level **LLM Usage** nav section with a list view of raw events, a detail view for a single event, and an aggregate/grouping view. Because Phase 1 does not expose raw events (the existing query endpoint only returns grouped aggregates), this track **also** adds three new **public** endpoints directly on `llm-usage-service` — `POST /llm-usage/events/list`, `GET /llm-usage/events/:eventId`, and `POST /llm-usage/query` — secured with Auth0 bearer auth (the same middleware all other user-facing services use). The web app calls `llm-usage-service` directly using `config.llmUsageServiceUrl`; there is no BFF layer.

The design mirrors the existing code-tasks list and detail pages as closely as possible: identical Tailwind conventions, identical filter-tab strip, identical localStorage persistence, identical hash routing, identical `*Keyed` detail-page pattern. The intent is that a user landing on `/#/llm-usage` immediately recognizes the UX vocabulary from `/#/code-tasks` and does not need to learn a new mental model.

## Pre-flight checks

1. Confirm Phase 1 is merged and green: `apps/llm-usage-service` exists and its tests pass. Note: `POST /internal/usage/query` from Phase 1 will be removed in this track and replaced by the public `POST /llm-usage/query`.
2. Confirm `firestore-collections.json` lists `llm_usage_events` with `"owner": "llm-usage-service"` (already present — verified).
3. Confirm the web app uses `HashRouter` and reads service URLs from `apps/web/src/config.ts` (verified: `import.meta.env.INTEXURAOS_*`).
4. Confirm `apps/web/src/config.ts` does NOT yet have `llmUsageServiceUrl` — this track adds it. If it already exists, check the value and skip the config step in Phase 5.
5. Read the `UsageEventInput` TS type in `apps/llm-usage-service/src/domain/models/usageEvent.ts` **before** writing the list-item view model — the event shape is deeply nested (`owner.*`, `source.*`, `request.*`, `usage.*`, `cost.*`, `correlation.*`, `error`) and the detail-view card hierarchy must match.
6. Run `pnpm run ci:tracked` at the start of the branch to establish a clean baseline.

## Context files

### Read before touching the backend
- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts` — read to understand the existing route pattern. The three new public routes go in a new file `publicUsageRoutes.ts` (or alongside the existing routes file — match the naming convention used in that service).
- `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts` — interface extended with `list()` and `getById()`.
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts` — Firestore implementation for the new methods.
- `apps/llm-usage-service/src/domain/models/usageEvent.ts` — canonical `UsageEvent` shape (the list-items return the full event; no projection).
- `apps/llm-usage-service/src/domain/models/usageQuery.ts` — reuses `AggregateMetrics` / `UsageQueryFilters` vocabulary for the list filters.
- `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts` — mirror this test layout (beforeAll/beforeEach/afterEach, `app.inject()`, fake repos via `setServices`). Create a parallel `publicUsageRoutes.test.ts` for the public routes.
- `apps/llm-usage-service/src/__tests__/fakeUsageEventRepository.ts` — extend with in-memory `list()` and `getById()` for tests.
- Check how `llm-usage-service` registers Auth0 bearer auth middleware — it should already exist from Phase 1 (the service serves public pricing). If Auth0 middleware is not yet wired, look at another service (e.g. `app-settings-service`) for the pattern.

### Read before touching the web app
- `apps/web/src/pages/CodeTasksPage.tsx` — design reference for list page. Copy the header, filter-tab strip, sort selector, and localStorage patterns verbatim.
- `apps/web/src/pages/CodeTaskViewPage.tsx` — design reference for detail page, including the `MemoTaskHeader` / `MemoTaskPromptCard` card hierarchy and the `*Keyed` wrapper.
- `apps/web/src/components/Sidebar.tsx` — add a new top-level "LLM Usage" collapsible section modeled on the Code Tasks section (lines 427–477).
- `apps/web/src/App.tsx` — add three new routes (`/llm-usage`, `/llm-usage/:eventId`, plus the `LlmUsageViewPageKeyed` wrapper).
- `apps/web/src/hooks/useIssueGroups.ts` — blueprint for `useLlmUsageEvents` (server-side filtering, cursor-based pagination, 30s poll, tab-visibility refresh, abort on unmount).
- `apps/web/src/services/issueGroupsApi.ts` — blueprint for the new `llmUsageApi.ts`.
- `apps/web/src/services/apiClient.ts` — shared `apiRequest` helper; do not reinvent.
- `apps/web/src/hooks/useApiClient.ts` — `useApiClient()` hook that wraps `apiRequest` with the current access token.
- `apps/web/src/config.ts` — add a new `llmUsageServiceUrl` config key (the web app calls `llm-usage-service` directly; there is no BFF).
- `apps/web/vite.config.ts` — add a new proxy entry for `/api/llm-usage` pointing to the `llm-usage-service` dev port. Do NOT reuse the `/api/settings` proxy.

### Read before touching Firestore indexes
- `firestore-collections.json` — confirm ownership of `llm_usage_events` stays with `llm-usage-service`.
- `migrations/051_code-tasks-status-createdAt-index.mjs` — template for a composite-index migration file (numbered at the repo root, not inside the app).

## Endpoint changes

### Modified
- (none — no existing endpoints change contract)

### Created
**Public routes (`apps/llm-usage-service`) — Auth0 bearer**
- `POST /llm-usage/events/list` — paginated raw events. Body: `{ timeRange: { from, to }, filters?: UsageEventFilters, sortBy?: { field, direction }, limit?, cursor? }`. Response: `{ events: UsageEvent[], nextCursor?: string, totalMatched: number }`. Auth: Auth0 bearer token.
- `GET /llm-usage/events/:eventId` — single raw event. Response: `{ event: UsageEvent }` or 404. Auth: Auth0 bearer token.
- `POST /llm-usage/query` — aggregate query with groupBy. Replaces both the existing internal query endpoint and the previously planned public version. Auth: Auth0 bearer token.

### Removed
- `POST /internal/usage/query` — removed entirely. Only the public `POST /llm-usage/query` exists. The web app calls the public endpoint directly with its Auth0 bearer token.

### Unchanged
- `POST /internal/usage/events` (ingest — internal, X-Internal-Auth)
- All existing `app-settings-service` public routes (no changes to that service in this track)

## Step-by-step implementation

### Phase 1 — Backend: domain model and repository extensions

Write failing tests first (`apps/llm-usage-service/src/__tests__/infra/firestoreUsageEventRepository.test.ts` if it exists, else create; and `apps/llm-usage-service/src/__tests__/fakeUsageEventRepository.ts` needs to implement the new methods).

**Extend the repository interface:**

```ts
// apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts
import type { Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../models/usageEvent.js';

export type CreateEventResult = { status: 'created' } | { status: 'duplicate' };

export interface UsageEventFilters {
  ownerTypes?: ('user' | 'system')[];
  ownerIds?: string[];
  services?: string[];
  components?: string[];
  clients?: string[];
  providers?: string[];
  models?: string[];
  operations?: string[];
  success?: boolean;
}

export interface ListUsageEventsParams {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  sortBy?: {
    field: 'occurredAt' | 'costUsd' | 'totalTokens';
    direction: 'asc' | 'desc';
  };
  limit: number;        // always bounded by MAX_LIST_LIMIT (see below)
  cursor?: string;      // opaque base64 of { lastOccurredAt, lastEventId }
}

export interface ListUsageEventsResult {
  events: UsageEvent[];
  nextCursor?: string;
  totalMatched: number; // count of events matching filters in the time range
}

export interface UsageEventRepository {
  createEvent(
    event: UsageEvent,
  ): Promise<Result<CreateEventResult, { code: string; message: string }>>;

  list(
    params: ListUsageEventsParams,
  ): Promise<Result<ListUsageEventsResult, { code: string; message: string }>>;

  getById(
    eventId: string,
  ): Promise<Result<UsageEvent | null, { code: string; message: string }>>;
}
```

**Constants:** add `MAX_LIST_LIMIT = 200`, `DEFAULT_LIST_LIMIT = 50` to `apps/llm-usage-service/src/domain/models/usageEvent.ts`.

**Cursor design:** opaque, base64-encoded JSON of `{ lastOccurredAt: string, lastEventId: string }`. The repository decodes it and starts the next Firestore query at `.startAfter(lastOccurredAt, lastEventId)`. The `lastEventId` tiebreaker is required because `occurredAt` is not guaranteed unique (a single batch ingest can produce two events with identical `occurredAt` to millisecond precision). Example encoder:

```ts
function encodeCursor(lastOccurredAt: string, lastEventId: string): string {
  return Buffer.from(JSON.stringify({ lastOccurredAt, lastEventId }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { lastOccurredAt: string; lastEventId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded === 'object' && decoded !== null
      && 'lastOccurredAt' in decoded && typeof (decoded as Record<string, unknown>)['lastOccurredAt'] === 'string'
      && 'lastEventId' in decoded && typeof (decoded as Record<string, unknown>)['lastEventId'] === 'string'
    ) {
      return decoded as { lastOccurredAt: string; lastEventId: string };
    }
    return null;
  } catch {
    return null;
  }
}
```

**Firestore implementation (`firestoreUsageEventRepository.ts`):** use a base query of `.collection('llm_usage_events').where('occurredAt', '>=', from).where('occurredAt', '<=', to)`, then append `.where(...)` clauses for each filter, then `.orderBy(field, direction).orderBy('__name__', direction)` for the tiebreaker, then `.startAfter(...)` if cursor present, then `.limit(limit + 1)` (fetch one extra to compute `nextCursor`). If the `limit+1`-th doc exists, strip it and encode its predecessor's `(occurredAt, eventId)` as the cursor.

For `totalMatched`, run a **separate** `.count()` aggregation query with the same `where` clauses. This costs one extra document read per page of results but is required to render "Showing 50 of 2,341 events". If `.count()` proves too expensive in practice we can gate it behind a `?includeCount=true` query param in a follow-up; ⚠ DECISION NEEDED whether to ship with count enabled by default in this track. Recommendation: **ship with count enabled** because the UX degrades noticeably without it and 1 extra read/page on a collection that currently gets maybe 10k events/day is negligible.

**`getById` implementation:** `db.collection('llm_usage_events').doc(eventId).get()`; return `ok(null)` on `!snapshot.exists` (NOT `err`); return `ok(snapshot.data() as UsageEvent)` on success.

### Phase 2 — Backend: new list, getById, and query public routes (test-first)

Write failing tests first in a new file `apps/llm-usage-service/src/__tests__/routes/publicUsageRoutes.test.ts`. Model it on `internalUsageRoutes.test.ts` but use a valid Auth0 bearer token (use the test auth helper pattern already present in the service) instead of `X-Internal-Auth`. Add new `describe` blocks:

- `POST /llm-usage/events/list`
  - returns 200 with paginated events when filters match
  - returns 200 with empty `events` array when no filters match
  - returns 200 with a `nextCursor` when more results exist
  - accepts and decodes a cursor from a previous page
  - filters by `providers`, `components`, `services`, `models`, `ownerIds`
  - respects `sortBy.field=occurredAt` `direction=desc` (default)
  - respects `sortBy.field=costUsd` `direction=desc`
  - respects `sortBy.field=totalTokens` `direction=desc`
  - clamps `limit` to `MAX_LIST_LIMIT` (200)
  - uses `DEFAULT_LIST_LIMIT` (50) when `limit` is not supplied
  - returns 400 for invalid `sortBy.field`
  - returns 400 for malformed cursor (decodeCursor returns null)
  - returns 400 when `timeRange.from > timeRange.to`
  - returns 401 for missing or invalid bearer token

- `GET /llm-usage/events/:eventId`
  - returns 200 with full event when found
  - returns 404 when not found
  - returns 401 for missing or invalid bearer token

- `POST /llm-usage/query`
  - returns 200 with aggregate rows on valid request
  - returns 400 for invalid groupBy value
  - returns 401 for missing or invalid bearer token

Only after all of the above are red, implement the route handlers. Create a new file `apps/llm-usage-service/src/routes/publicUsageRoutes.ts`. Skeleton:

```ts
// apps/llm-usage-service/src/routes/publicUsageRoutes.ts
app.post(
  '/llm-usage/events/list',
  {
    schema: {
      operationId: 'listUsageEvents',
      summary: 'List raw usage events (paginated)',
      tags: ['usage'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['timeRange'],
        additionalProperties: false,
        properties: {
          timeRange: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
          filters: { type: 'object' },
          sortBy: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: ['occurredAt', 'costUsd', 'totalTokens'] },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          cursor: { type: 'string', minLength: 1 },
        },
      },
      response: { /* 200, 400, 401 as in existing public routes */ },
    },
  },
  async (request, reply) => {
    logIncomingRequest(request, { message: 'Public usage events list' });
    // Auth0 bearer auth is applied via the shared requireAuth middleware
    // registered at the route or plugin level — match the pattern used in
    // other public routes on this service.
    const body = request.body as ListUsageEventsBody;
    const { usageEventRepository } = getServices();
    const result = await listUsageEvents(
      { logger: request.log, usageEventRepository },
      body,
    );
    if (!result.ok) {
      return await reply.fail('INVALID_REQUEST', result.error.message);
    }
    return await reply.ok(result.value);
  },
);

app.get<{ Params: { eventId: string } }>(
  '/llm-usage/events/:eventId',
  { schema: { /* ... */ } },
  async (request, reply) => {
    logIncomingRequest(request, { message: 'Public usage event get' });
    const { usageEventRepository } = getServices();
    const result = await usageEventRepository.getById(request.params.eventId);
    if (!result.ok) {
      return await reply.fail('INTERNAL_ERROR', result.error.message);
    }
    if (result.value === null) {
      return await reply.fail('NOT_FOUND', `Event ${request.params.eventId} not found`);
    }
    return await reply.ok({ event: result.value });
  },
);

app.post(
  '/llm-usage/query',
  { schema: { /* mirror the former /internal/usage/query schema */ } },
  async (request, reply) => {
    logIncomingRequest(request, { message: 'Public usage aggregate query' });
    // delegate to the existing queryUsage use case
    const body = request.body as UsageQueryBody;
    const { usageEventRepository } = getServices();
    const result = await queryUsage({ logger: request.log, usageEventRepository }, body);
    if (!result.ok) {
      return await reply.fail('INVALID_REQUEST', result.error.message);
    }
    return await reply.ok(result.value);
  },
);
```

**Remove `POST /internal/usage/query`**: delete the internal query route handler from `internalUsageRoutes.ts` in the same PR. Only the public endpoint above exists going forward.

Create a use case file `apps/llm-usage-service/src/domain/usecases/listUsageEvents.ts` (mirrors `queryUsage.ts`) that does validation, clamping, and delegation to the repo.

### Phase 3 — Backend: Firestore composite indexes (migration)

Create `migrations/086_llm-usage-events-list-indexes.mjs` (next available number — verify no one else grabbed 086 first). Content modeled on `051_code-tasks-status-createdAt-index.mjs`:

```js
export const metadata = {
  id: '086',
  name: 'llm-usage-events-list-indexes',
  description: 'Composite indexes for llm_usage_events list queries (filter + sort combinations)',
  createdAt: '2026-04-10',
};

export const indexes = [
  // Default sort: occurredAt desc, no filter
  // (single-field; already covered by Firestore's implicit index — no entry needed)

  // Filter by source.service, sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.service', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Filter by source.component, sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.component', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Filter by request.provider, sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.provider', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Filter by request.model, sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.model', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Filter by owner.id, sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'owner.id', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Sort by cost.billedUsd desc, no filter
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'cost.billedUsd', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // Sort by usage.totalTokens desc, no filter
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'usage.totalTokens', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events list composite indexes...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
```

⚠ **DECISION NEEDED**: multi-field filter combinations (e.g. `provider + service + occurredAt`) will blow up the index count. Recommendation for this track: **only index single-filter + sort combinations**. If the user selects two filters at once, the repository runs one `where` as an index-hit and the other as a post-fetch in-memory filter, accepting that the response may be smaller than `limit` and that pagination may need extra trips. Document this limit in the list use case and add a TODO for a future track if it hurts in practice.

Alternative: tell the user they can't combine certain filters. The recommendation above is less user-hostile.

### Phase 4 — Web app config and Vite proxy

**Web app config (`apps/web/src/config.ts`):** Add `llmUsageServiceUrl` alongside the other service URL keys:

```ts
// apps/web/src/config.ts
export const config = {
  // ... existing keys ...
  llmUsageServiceUrl: import.meta.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '',
};
```

Add the env var in the three required locations:
1. `apps/web/src/index.ts` (or wherever the web app validates required env) — add `'INTEXURAOS_LLM_USAGE_SERVICE_URL'` to the list.
2. `terraform/environments/dev/main.tf` — add to the web app container's env block. Value: the Cloud Run URL of `llm-usage-service` (already exists as a Terraform output from Phase 1).
3. `ecosystem.config.cjs` — add to the web app PM2 entry's `env` section with the local dev URL (e.g. `http://localhost:8130` or whatever port llm-usage-service listens on in home-dev).

**Vite proxy (`apps/web/vite.config.ts`):** Add a new proxy entry for `/api/llm-usage`:

```ts
// vite.config.ts proxy block
'/api/llm-usage': {
  target: 'http://localhost:<LLM_USAGE_PORT>',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/llm-usage/, ''),
},
```

Look up the actual port from `ecosystem.config.cjs` for the `llm-usage-service` entry before filling in the value.

### Phase 5 — (Removed — no BFF layer)

The original Phase 5 described BFF proxy routes on `app-settings-service`. Per the decisions doc (Decision #3), all public routes go directly on `llm-usage-service` with Auth0 bearer auth. The web app calls `llm-usage-service` directly. No changes to `app-settings-service` in this track.

### Phase 5a — Internal client extension (backend-to-backend only)

This phase documents what gets added to the internal client for **backend services** (e.g. code-agent forwarding usage events). The web app does NOT use `packages/internal-clients` — it uses `llmUsageApi.ts` with the public endpoints.

Extend `packages/internal-clients/src/usage-service/types.ts`:

```ts
export interface UsageEventFilters {
  ownerTypes?: ('user' | 'system')[];
  ownerIds?: string[];
  services?: string[];
  components?: string[];
  clients?: string[];
  providers?: string[];
  models?: string[];
  operations?: string[];
  success?: boolean;
}

export interface ListUsageEventsRequest {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  sortBy?: {
    field: 'occurredAt' | 'costUsd' | 'totalTokens';
    direction: 'asc' | 'desc';
  };
  limit?: number;
  cursor?: string;
}

export interface ListUsageEventsResponse {
  events: UsageEventInput[]; // full event; occurredAt, receivedAt, ingress included
  nextCursor?: string;
  totalMatched: number;
}

// Extend the UsageServiceClient interface with:
export interface UsageServiceClient {
  ingestEvents(/* ... */);
  queryUsage(/* ... */);
  listEvents(
    request: ListUsageEventsRequest,
    options?: { traceId?: string }
  ): Promise<Result<ListUsageEventsResponse, UsageServiceError>>;
  getEvent(
    eventId: string,
    options?: { traceId?: string }
  ): Promise<Result<UsageEventInput | null, UsageServiceError>>;
}
```

Note: the internal client is used by backend services (e.g. code-agent) calling `POST /internal/usage/events` to ingest events. The web app does NOT use this client — it calls the public `/llm-usage/*` endpoints directly using `llmUsageApi.ts`.

Extend `client.ts` with `listEvents` and `getEvent` methods if needed by backend consumers. Add `nock`-based tests to `__tests__/client.test.ts` for any new methods: happy path, non-2xx, network error.

### Phase 6 — Web app API service module

Create `apps/web/src/services/llmUsageApi.ts`:

```ts
import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  ListLlmUsageEventsRequest,
  ListLlmUsageEventsResponse,
  UsageEvent,
  LlmUsageQueryRequest,
  LlmUsageQueryResponse,
} from '@/types/llmUsage';

export async function listLlmUsageEvents(
  accessToken: string,
  request: ListLlmUsageEventsRequest,
): Promise<ListLlmUsageEventsResponse> {
  return await apiRequest<ListLlmUsageEventsResponse>(
    config.llmUsageServiceUrl,
    '/llm-usage/events/list',
    accessToken,
    { method: 'POST', body: request },
  );
}

export async function getLlmUsageEvent(
  accessToken: string,
  eventId: string,
): Promise<{ event: UsageEvent }> {
  return await apiRequest<{ event: UsageEvent }>(
    config.llmUsageServiceUrl,
    `/llm-usage/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );
}

export async function queryLlmUsage(
  accessToken: string,
  request: LlmUsageQueryRequest,
): Promise<LlmUsageQueryResponse> {
  return await apiRequest<LlmUsageQueryResponse>(
    config.llmUsageServiceUrl,
    '/llm-usage/query',
    accessToken,
    { method: 'POST', body: request },
  );
}
```

Create `apps/web/src/types/llmUsage.ts` with the type mirrors. Write **unit tests** for `llmUsageApi.ts` (web app exception says `services/` must have tests). Use nock or the existing `__tests__/` patterns in `apps/web/src/services/__tests__/`.

### Phase 7 — Web app hooks

Create `apps/web/src/hooks/useLlmUsageEvents.ts`. Skeleton mirroring `useIssueGroups.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listLlmUsageEvents } from '@/services/llmUsageApi';
import type {
  UsageEvent,
  ListLlmUsageEventsResponse,
  UsageEventFilters,
  UsageEventSortField,
} from '@/types/llmUsage';

const DEFAULT_LIMIT = 50;
const POLL_INTERVAL_MS = 30000;

export interface UseLlmUsageEventsOptions {
  timeRange: { from: string; to: string };
  filters: UsageEventFilters;
  sortBy: { field: UsageEventSortField; direction: 'asc' | 'desc' };
}

export interface UseLlmUsageEventsResult {
  events: UsageEvent[];
  totalMatched: number;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
}

export function useLlmUsageEvents(
  options: UseLlmUsageEventsOptions,
): UseLlmUsageEventsResult {
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const isMountedRef = useRef(true);

  const refresh = useCallback(/* ... */);
  const loadMore = useCallback(/* ... */);
  // initial load effect
  // tab-visibility refresh effect
  // polling effect (30s when visible)

  return { events, totalMatched, loading, loadingMore, refreshing, error, hasMore, loadMore, refresh };
}
```

Create a second hook `apps/web/src/hooks/useLlmUsageQuery.ts` for the aggregate view (it calls `queryLlmUsage` from `llmUsageApi`). Simpler: no cursor, no polling, just refetch on options change.

Create a third hook `apps/web/src/hooks/useLlmUsageEvent.ts` for the detail view (single event by ID). Mirrors `useTaskView` structure but far simpler — no live log stream.

All three hooks get unit tests (hooks are in the enforced-coverage zone per CLAUDE.md web app exception).

### Phase 8 — Web app list page (LlmUsagePage)

Create `apps/web/src/pages/LlmUsagePage.tsx`. Structure:

```tsx
export function LlmUsagePage(): React.JSX.Element {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(loadTimeRangeFromStorage);
  const [filters, setFilters] = useState<UsageEventFilters>(loadFiltersFromStorage);
  const [sortBy, setSortBy] = useState<{ field: UsageEventSortField; direction: 'asc' | 'desc' }>(loadSortFromStorage);
  const [groupBy, setGroupBy] = useState<GroupByMode>(loadGroupByFromStorage);

  // Two hooks — only one is "active" at a time (the other returns empty state)
  const listHook = useLlmUsageEvents({
    timeRange: resolveTimeRange(timeRange),
    filters,
    sortBy,
  });
  const queryHook = useLlmUsageQuery({
    timeRange: resolveTimeRange(timeRange),
    filters,
    groupBy: resolveGroupByFields(groupBy),
  });

  return (
    <Layout>
      <PageHeader totalMatched={groupBy === 'none' ? listHook.totalMatched : queryHook.totalRows} />

      <TimeRangePicker value={timeRange} onChange={setTimeRange} />

      <FilterTabStrip filters={filters} onChange={setFilters} />

      <GroupBySelector value={groupBy} onChange={setGroupBy} />

      {groupBy !== 'none' ? null : (
        <SortSelector value={sortBy} onChange={setSortBy} />
      )}

      {groupBy === 'none' ? (
        <RawEventsList
          events={listHook.events}
          loading={listHook.loading}
          refreshing={listHook.refreshing}
          error={listHook.error}
          hasMore={listHook.hasMore}
          loadMore={listHook.loadMore}
        />
      ) : (
        <AggregateTable
          rows={queryHook.rows}
          totals={queryHook.totals}
          loading={queryHook.loading}
          error={queryHook.error}
          groupBy={groupBy}
        />
      )}
    </Layout>
  );
}
```

**Filter-tab strip styling** — copy these exact Tailwind classes from `CodeTasksPage.tsx` so the two pages look identical:

```tsx
const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

// active class examples, one per provider color:
const PROVIDER_ACTIVE_CLASSES: Record<LlmProvider, string> = {
  anthropic: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-900/30 dark:text-orange-400',
  openai:    'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400',
  google:    'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  perplexity:'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400',
};

// strip container (copied verbatim from StatusPipeline in CodeTasksPage):
<div className="mb-4 flex flex-wrap items-center gap-2">
  {PROVIDERS.map((provider) => {
    const isActive = filters.providers?.includes(provider) ?? false;
    return (
      <button
        key={provider}
        onClick={(): void => { toggleProvider(provider); }}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
          isActive ? PROVIDER_ACTIVE_CLASSES[provider] : INACTIVE_SEGMENT_CLASS
        }`}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${PROVIDER_DOT_CLASSES[provider]}`} />
        {provider}
      </button>
    );
  })}
</div>
```

The same pattern repeats for filter strips on `component`, `service`, and `model`. All four strips stack vertically above the sort selector.

**Time range presets:** "Today", "Yesterday", "Last 7 days", "Last 30 days", "Custom". Custom opens two `<input type="datetime-local">` fields. Store as `{ preset: 'today' | ... | 'custom', customFrom?, customTo? }`. A pure `resolveTimeRange()` utility in `apps/web/src/utils/llmUsageTimeRange.ts` converts preset → `{ from, to }` ISO strings at call time. This utility is in the `utils/` enforced-coverage zone — write unit tests.

**Group by options:** `none`, `day`, `component`, `service`, `model`. Maps to `groupBy` array passed to `queryLlmUsage`:
- `none` → uses `useLlmUsageEvents` (raw list), not `useLlmUsageQuery`
- `day` → `['day']`
- `component` → `['source.component']`
- `service` → `['source.service']`
- `model` → `['request.model']`

**Sort selector:** only visible when `groupBy === 'none'`. Options: `occurredAt desc` (default), `occurredAt asc`, `costUsd desc`, `totalTokens desc`.

**Raw events list row layout:** single-row summary per event, columns: `occurredAt (relative)`, `provider · model`, `component`, `service`, `totalTokens`, `costUsd`, clickable (navigates to `/#/llm-usage/{eventId}`). Use `Link` from `react-router-dom`.

**localStorage keys:** all four filter/sort/groupBy/timeRange states persist to localStorage with keys prefixed `llm-usage-*` (matches `code-tasks-*` convention). Use a small `loadFromStorage<T>(key, validator, fallback)` helper; put it in `apps/web/src/utils/llmUsageStorage.ts` and unit-test it.

### Phase 9 — Web app detail page (LlmUsageViewPage)

Create `apps/web/src/pages/LlmUsageViewPage.tsx`. Follows the `CodeTaskViewPage` card-stack structure:

```tsx
export function LlmUsageViewPage(): React.JSX.Element {
  const { eventId } = useParams<{ eventId: string }>();
  const { event, loading, error } = useLlmUsageEvent(eventId ?? '');

  if (loading) return <Layout><Loader /></Layout>;
  if (error !== null || event === null) {
    return <Layout><Card variant="error"><p>{error ?? 'Event not found'}</p></Card></Layout>;
  }

  return (
    <Layout>
      <EventHeader event={event} />
      <RequestCard request={event.request} />
      <UsageCard usage={event.usage} />
      <CostCard cost={event.cost} />
      <SourceCard source={event.source} owner={event.owner} />
      <CorrelationCard correlation={event.correlation} />
      {event.error !== null ? <ErrorCard error={event.error} /> : null}
      <RawJsonCard event={event} />
    </Layout>
  );
}
```

Each card uses the existing `Card` component from `@/components` with `text-slate-900 dark:text-slate-100` headings, exactly like `TaskPromptCard` in `CodeTaskViewPage`. The `RawJsonCard` is a `<details><summary>` with a `<pre>` containing `JSON.stringify(event, null, 2)` and a copy-to-clipboard button identical to the one in `MemoTaskPromptCard`.

**`*Keyed` wrapper** — add to `App.tsx` alongside `CodeTaskViewPageKeyed`:

```tsx
function LlmUsageViewPageKeyed(): React.JSX.Element {
  const { eventId } = useParams<{ eventId: string }>();
  return <LlmUsageViewPage key={eventId} />;
}
```

This forces the component to remount when the user navigates from one event to another, matching the code-tasks pattern.

### Phase 10 — Web app nav + routing

**`App.tsx` routes:** add next to the code-tasks routes block:

```tsx
{/* LLM Usage routes */}
<Route path="/llm-usage" element={<ProtectedRoute><LlmUsagePage /></ProtectedRoute>} />
<Route path="/llm-usage/:eventId" element={<ProtectedRoute><LlmUsageViewPageKeyed /></ProtectedRoute>} />
```

Export the two new pages from `apps/web/src/pages/index.ts`.

**`Sidebar.tsx`:** add a new collapsible section between "Code Tasks" and "Retired Scheduler Service". Model it on the Code Tasks section (lines 427–477):

```tsx
const llmUsageItems: NavItem[] = [
  { to: '/llm-usage', label: 'Events', icon: List },
  // Track 5 will add { to: '/llm-usage/pricing', label: 'Pricing', icon: DollarSign } here
];

const [isLlmUsageOpen, setIsLlmUsageOpen] = useState(() =>
  window.location.hash.includes('/llm-usage'),
);

// in the render:
<div className="pt-2">
  <button
    onClick={(): void => {
      if (!isLlmUsageOpen) {
        void navigate(llmUsageItems[0]?.to ?? '/llm-usage');
      }
      setIsLlmUsageOpen(!isLlmUsageOpen);
    }}
    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      location.pathname.startsWith('/llm-usage')
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
    }`}
  >
    <TrendingUp className="h-5 w-5 shrink-0" />
    {!isCollapsed ? (
      <>
        <span className="flex-1 text-left">LLM Usage</span>
        {isLlmUsageOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </>
    ) : null}
  </button>
  {isLlmUsageOpen && !isCollapsed ? (
    <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
      {llmUsageItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/llm-usage'}
          className={/* same pattern as Code Tasks sub-items */}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  ) : null}
</div>
```

The `TrendingUp` icon is already imported in `Sidebar.tsx` (currently used by the `Usage Costs` settings item). No new lucide import needed.

Also add an auto-expand effect to match the Code Tasks one at line 238–241:

```tsx
useEffect(() => {
  if (location.pathname.startsWith('/llm-usage')) {
    setIsLlmUsageOpen(true);
  }
}, [location.pathname]);
```

### Phase 11 — Use case validation

Walk through each target scenario end-to-end to prove the UI shape is correct. **Do this in the PR description**, not just in tests.

**Use case 1: "Show all orchestrator Claude calls on a specific day, grouped by day"**
1. User clicks "LLM Usage" → "Events" in the sidebar.
2. User picks "Custom" time range and enters `2026-04-10T00:00:00Z` → `2026-04-10T23:59:59Z`.
3. User clicks `anthropic` in the Provider filter strip → `filters.providers = ['anthropic']`.
4. User clicks `claude-worker` in the Component filter strip → `filters.components = ['claude-worker']`.
5. User clicks `orchestrator` in the Service filter strip → `filters.services = ['orchestrator']`.
6. User clicks "day" in the Group by selector → UI switches to the `AggregateTable` (driven by `useLlmUsageQuery`).
7. Under the hood: the web app calls `POST /llm-usage/query` directly on `llm-usage-service` with body `{ timeRange: {from, to}, filters: { providers: ['anthropic'], components: ['claude-worker'], services: ['orchestrator'] }, groupBy: ['day'] }`.
8. Result: a single row with `group.day = '2026-04-10'` and aggregated metrics.

**Use case 2: "Show all Gemini calls without grouping"**
1. User selects "Last 7 days" time range.
2. User clicks `google` in the Provider filter strip → `filters.providers = ['google']`.
3. User confirms Group by is "none" (default).
4. User confirms Sort is "occurredAt desc" (default).
5. Under the hood: the web app calls `POST /llm-usage/events/list` directly on `llm-usage-service` with body `{ timeRange, filters: { providers: ['google'] }, sortBy: { field: 'occurredAt', direction: 'desc' }, limit: 50 }`.
6. Result: up to 50 events in a raw list, newest first, with a "Load more" button if `nextCursor` is present.
7. User clicks any event row → navigates to `/#/llm-usage/{eventId}` → detail page loads via `GET /llm-usage/events/{eventId}` directly on `llm-usage-service`.

**Use case 3: "Show cost per LLM from the orchestrator this week, grouped by model"**
1. User picks "Last 7 days".
2. User clicks `orchestrator` in the Service filter strip → `filters.services = ['orchestrator']`.
3. User clicks "model" in the Group by selector → switches to `AggregateTable`.
4. The sort selector is hidden (grouping defaults to `costUsd desc` for the aggregate endpoint).
5. Under the hood: the web app calls `POST /llm-usage/query` directly on `llm-usage-service` with body `{ timeRange, filters: { services: ['orchestrator'] }, groupBy: ['request.model'], sortBy: { field: 'costUsd', direction: 'desc' } }`.
6. Result: one row per model, sorted by cost descending. The `totals` are rendered in a "Grand total" footer row.

All three cases must work on the first deployment of this track. If any of them require extra endpoints or filters not listed in Phase 2/4/5, the plan is incomplete — escalate.

## Test plan

### Backend (`apps/llm-usage-service`)
- `src/__tests__/routes/publicUsageRoutes.test.ts` — new file with 15+ test cases covering list, getById, and query happy paths, filters, sorting, cursor roundtrip, error cases, and Auth0 bearer auth.
- `src/__tests__/domain/usecases/listUsageEvents.test.ts` — new file, unit tests for validation + limit clamping + cursor encode/decode.
- `src/__tests__/fakeUsageEventRepository.ts` — extend with in-memory `list()` and `getById()` implementing the same semantics as the Firestore version.
- `src/__tests__/infra/firestoreUsageEventRepository.test.ts` — if an emulator-backed test already exists, extend it; otherwise rely on the fake-repo tests + manual smoke test in staging.

### Web app
- `src/services/__tests__/llmUsageApi.test.ts` — required (services/ is in the enforced-coverage zone). Tests call `llm-usage-service` directly at `config.llmUsageServiceUrl` — use nock against the llm-usage-service port.
- `src/hooks/__tests__/useLlmUsageEvents.test.ts` — required (hooks/ is enforced).
- `src/hooks/__tests__/useLlmUsageQuery.test.ts` — required.
- `src/hooks/__tests__/useLlmUsageEvent.test.ts` — required.
- `src/utils/__tests__/llmUsageTimeRange.test.ts` — required (utils/ is enforced).
- `src/utils/__tests__/llmUsageStorage.test.ts` — required.
- `src/pages/LlmUsagePage.tsx` — optional (UI not enforced).
- `src/pages/LlmUsageViewPage.tsx` — optional.

### CI gate
`pnpm run ci:tracked` must pass end-to-end before commit. Backend coverage must be ≥95% branch. Web utils/services/hooks must be ≥95% branch.

## Rollout plan

1. **Backend first:** merge the llm-usage-service changes (Phases 1–3) and the new migration alone. Deploy to dev. Verify the new public endpoints return correct data using curl with a valid bearer token.
2. **Run the migration:** `node migrations/086_llm-usage-events-list-indexes.mjs up` from the repo root on dev. Wait for index builds to finish (monitor via `gcloud firestore indexes composite list --project=intexuraos-dev-pbuchman`). This can take 5–30 minutes on non-empty collections.
3. **Web app:** merge Phases 4–10 (config, vite proxy, API service, hooks, pages, nav). Verify in dev UI that all three use cases from Phase 11 work end-to-end.
4. **Promote to prod** in the same order (backend → web app) only after dev has soaked for 24h without errors in Sentry or Cloud Run logs.
5. Update the Linear issue INT-1340 with a link to the merged PR and screenshots of the three use cases.

## Acceptance criteria

- [ ] `POST /llm-usage/events/list` exists on `llm-usage-service`, accepts `{ timeRange, filters, sortBy, limit, cursor }`, returns `{ events, nextCursor, totalMatched }`, secured with Auth0 bearer auth, has ≥95% branch coverage.
- [ ] `GET /llm-usage/events/:eventId` exists on `llm-usage-service`, returns full `UsageEvent` or 404, secured with Auth0 bearer auth.
- [ ] `POST /llm-usage/query` exists on `llm-usage-service` as the single (public) aggregate query endpoint; `POST /internal/usage/query` is removed.
- [ ] Firestore composite indexes for the seven filter+sort combinations in Phase 3 exist in `migrations/086_*.mjs` and are deployed to dev.
- [ ] The web app has a new top-level "LLM Usage" nav section with an "Events" sub-item.
- [ ] `/#/llm-usage` renders the list page with four filter strips (provider, component, service, model), a time-range picker, a group-by selector, and a sort selector.
- [ ] The list page persists filter/sort/groupBy/timeRange choices to localStorage under `llm-usage-*` keys.
- [ ] `/#/llm-usage/{eventId}` renders the detail page with cards for request, usage, cost, source+owner, correlation, error, and raw JSON.
- [ ] Use cases 1, 2, and 3 from Phase 11 work end-to-end against real data in dev.
- [ ] `pnpm run ci:tracked` passes green.
- [ ] No existing endpoints change contract (except removal of `POST /internal/usage/query` which is explicitly superseded).
- [ ] `INTEXURAOS_LLM_USAGE_SERVICE_URL` is declared in all three required locations for the **web app** (not app-settings-service).
- [ ] `apps/web/src/config.ts` has `llmUsageServiceUrl` and `vite.config.ts` has a proxy entry for `/api/llm-usage`.

## Risks

1. **Cursor pagination edge cases.** If two events share the exact same `occurredAt` timestamp (millisecond precision), the `__name__` tiebreaker in the composite index is required for deterministic ordering. Without it, a "Load more" click may skip or duplicate an event at the boundary. **Mitigation:** every composite index in Phase 3 explicitly includes `{ fieldPath: '__name__', order: 'DESCENDING' }` and the Firestore query chains `.orderBy('__name__', direction)` after the primary sort. This must be tested with a fake repo that returns two events with identical `occurredAt`.

2. **`.count()` cost.** Running a `.count()` aggregation per page doubles Firestore reads. At the current volume (10k events/day) this is negligible; at 1M events/day it becomes material. **Mitigation:** hide the total-matched counter behind a `?includeCount=true` flag if cost becomes a problem, defaulting to `true` in Track 1 and reconsidering in Track 4 (observability).

3. **Index count explosion.** Every additional filter-sort combination needs its own composite index. Firestore caps at 200 composite indexes per project. We currently have ~85 migration files, each adding a few. **Mitigation:** Phase 3 limits indexes to single-filter + sort combinations. Multi-filter queries fall back to post-fetch in-memory filtering, which caps at `MAX_LIST_LIMIT` rows per Firestore read. Document this limitation clearly in the list use case.

4. **Auth0 JWKS cold-start latency.** On llm-usage-service startup, the first request to a public route triggers JWKS key fetch. Subsequent requests use the cached keys. **Mitigation:** verify the Auth0 middleware has JWKS caching enabled (should already be the case on all other services); no additional work needed.

5. **Schema drift between the stored `UsageEvent` and the web app type mirror.** `apps/web/src/types/llmUsage.ts` re-defines types to avoid cross-workspace imports. If the llm-usage-service team changes the schema without updating the mirror, the web app will silently truncate fields. **Mitigation:** add a comment in `apps/web/src/types/llmUsage.ts` pointing at the canonical source (`apps/llm-usage-service/src/domain/models/usageEvent.ts`).

6. **Vite proxy for `/api/llm-usage` must point to the correct port.** If the port in `vite.config.ts` does not match the port llm-usage-service listens on in `ecosystem.config.cjs`, dev calls will return connection-refused errors. **Mitigation:** cross-check the port in `ecosystem.config.cjs` before writing the proxy entry; document in the PR description that `pnpm --filter llm-usage-service build && pnpm dev` must be run after checkout.

7. **Composite index build time on a non-empty collection.** If `llm_usage_events` already has millions of docs in dev, building 7 new composite indexes can take 30+ minutes. **Mitigation:** run the migration at the start of the backend phase and proceed with web app work in parallel; don't block the PR on index builds.

## Out of scope (explicitly not in this track)

- **Pricing UI relocation** — moved to Track 5 (INT-1343). The `LLM Usage` sidebar section is built with an array that Track 5 can extend.
- **Charts, timeseries, vega-lite visualizations** — aggregate view is a plain table in Track 1. Visualizations are a potential Phase 3.
- **Real-time updates / SSE / websockets** — the list page polls every 30s on tab focus, like `CodeTasksPage`. No live stream.
- **Per-user quota views** — the detail page shows cost but does not compare against a quota.
- **Export to CSV / JSON** — a "copy raw JSON" button on the detail page is the only export mechanism.
- **User-scoping on public routes** — `POST /llm-usage/events/list` returns ALL events the caller requests, with no implicit `ownerId = currentUser` filter. This is a deliberate choice because the dashboard is admin-facing (there is only one admin user). If that changes, a future track will add the scoping at the route handler level.
- **Custom index-aware query planner** — multi-filter queries fall back to post-fetch filtering. A future track can add a proper planner.
- **Soft delete / archiving of events** — events are immutable once ingested. No archive UI.
- **Editing pricing on the detail page** — Track 5 handles pricing surface area.
- **Breadcrumbs / back button wiring beyond the sidebar NavLink** — follow the code-tasks convention (no explicit back button).
- **Mobile-optimized table layout** — the list renders on mobile but uses a condensed one-line-per-event style; a proper responsive card layout is out of scope.
- **Integration tests that boot the full stack** — unit + route-level fake-repo tests are sufficient for Track 1.
- **Metrics/Sentry instrumentation on the new endpoints** — Track 4 (observability) adds structured metrics and alerting.

---

## Appendix A — Open decisions flagged in this plan

All `⚠ DECISION NEEDED` markers have been resolved by the decisions doc (`INT-1338-decisions.md`):

1. **Phase 1 / `.count()` default:** ship enabled by default (Decision #9).
2. **Phase 3 / composite index scope:** single-filter + sort combinations only (Decision #10 — research exact requirements via context7 before writing migration).
3. **Auth model:** Auth0 bearer on all public routes, no BFF (Decision #3).
4. **Route prefix:** `/llm-usage/*` (Decision #17).
5. **Internal query endpoint:** removed; only public `POST /llm-usage/query` exists (Decision #14).

## Appendix B — Files to be created (summary list)

**Backend:**
- `apps/llm-usage-service/src/routes/publicUsageRoutes.ts`
- `apps/llm-usage-service/src/domain/usecases/listUsageEvents.ts`
- `apps/llm-usage-service/src/__tests__/routes/publicUsageRoutes.test.ts`
- `apps/llm-usage-service/src/__tests__/domain/usecases/listUsageEvents.test.ts`

**Migrations:**
- `migrations/086_llm-usage-events-list-indexes.mjs`

**Web app:**
- `apps/web/src/pages/LlmUsagePage.tsx`
- `apps/web/src/pages/LlmUsageViewPage.tsx`
- `apps/web/src/services/llmUsageApi.ts`
- `apps/web/src/services/__tests__/llmUsageApi.test.ts`
- `apps/web/src/hooks/useLlmUsageEvents.ts`
- `apps/web/src/hooks/useLlmUsageQuery.ts`
- `apps/web/src/hooks/useLlmUsageEvent.ts`
- `apps/web/src/hooks/__tests__/useLlmUsageEvents.test.ts`
- `apps/web/src/hooks/__tests__/useLlmUsageQuery.test.ts`
- `apps/web/src/hooks/__tests__/useLlmUsageEvent.test.ts`
- `apps/web/src/utils/llmUsageTimeRange.ts`
- `apps/web/src/utils/llmUsageStorage.ts`
- `apps/web/src/utils/__tests__/llmUsageTimeRange.test.ts`
- `apps/web/src/utils/__tests__/llmUsageStorage.test.ts`
- `apps/web/src/types/llmUsage.ts`

**Files to be modified (summary list):**
- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts` (remove `POST /internal/usage/query`)
- `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts`
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts`
- `apps/llm-usage-service/src/domain/models/usageEvent.ts` (add MAX_LIST_LIMIT / DEFAULT_LIST_LIMIT)
- `apps/llm-usage-service/src/__tests__/fakeUsageEventRepository.ts`
- `apps/web/src/config.ts` (add `llmUsageServiceUrl`)
- `apps/web/src/App.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/pages/index.ts`
- `apps/web/vite.config.ts` (add `/api/llm-usage` proxy)
- `terraform/environments/dev/main.tf` (add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to web app env)
- `ecosystem.config.cjs` (add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to web app PM2 entry)
