# INT-1340 — Track 1: LLM Usage Web UI

## Status
- Linear issue: INT-1340
- Parent epic: INT-1338 (LLM Usage Service Phase 2)
- Dependencies: none (independent; builds directly on Phase 1)
- Blocks: INT-1343 (Track 5 — pricing UI relocation, which reuses the new `/llm-usage` nav section as the mount point for pricing)
- Plan version: 1.0

## Executive summary

This track delivers the first end-user surface for the new `llm-usage-service`. Phase 1 shipped the ingestion pipeline, daily aggregates, and an internal `POST /internal/usage/query` endpoint, but the web app currently has no way to view or drill into the resulting data. The legacy `LlmCostsPage` reads an old `llm_usage_stats` collection via `app-settings-service` and is completely disconnected from the new `llm_usage_events` / `llm_usage_daily_aggregates` collections owned by `llm-usage-service`. Users therefore cannot answer basic questions like "what did the orchestrator spend on Claude yesterday" without hitting Firestore directly.

Track 1 closes that gap by delivering a new top-level **LLM Usage** nav section with a list view of raw events, a detail view for a single event, and an aggregate/grouping view driven by the existing `/internal/usage/query` endpoint. Because Phase 1 does not expose raw events (the existing query endpoint only returns grouped aggregates), this track **also** adds two new backend endpoints — `POST /internal/usage/events/list` and `GET /internal/usage/events/:eventId` — together with the supporting repository methods, Firestore composite indexes, internal-client extensions, and BFF proxies on `app-settings-service`.

The design mirrors the existing code-tasks list and detail pages as closely as possible: identical Tailwind conventions, identical filter-tab strip, identical localStorage persistence, identical hash routing, identical `*Keyed` detail-page pattern. The intent is that a user landing on `/#/llm-usage` immediately recognizes the UX vocabulary from `/#/code-tasks` and does not need to learn a new mental model.

## Pre-flight checks

1. Confirm Phase 1 is merged and green: `apps/llm-usage-service` exists and `POST /internal/usage/query` passes its tests.
2. Confirm `firestore-collections.json` lists `llm_usage_events` with `"owner": "llm-usage-service"` (already present — verified).
3. Confirm `packages/internal-clients/src/usage-service/client.ts` exports `createUsageServiceClient` and has exactly two methods today (`ingestEvents`, `queryUsage`). Any additional methods already merged mean this plan is stale — stop and re-read.
4. Confirm the web app uses `HashRouter` and reads service URLs from `apps/web/src/config.ts` (verified: `import.meta.env.INTEXURAOS_*`).
5. Confirm `app-settings-service` currently serves `/settings/usage-costs` and therefore already has auth, services.ts DI, and public-routes plumbing that can be extended (verified).
6. Read the `UsageEventInput` TS type in `apps/llm-usage-service/src/domain/models/usageEvent.ts` **before** writing the list-item view model — the event shape is deeply nested (`owner.*`, `source.*`, `request.*`, `usage.*`, `cost.*`, `correlation.*`, `error`) and the detail-view card hierarchy must match.
7. Run `pnpm run ci:tracked` at the start of the branch to establish a clean baseline.

## Context files

### Read before touching the backend
- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts` — both new routes live here alongside `/internal/usage/query`.
- `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts` — interface extended with `list()` and `getById()`.
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts` — Firestore implementation for the new methods.
- `apps/llm-usage-service/src/domain/models/usageEvent.ts` — canonical `UsageEvent` shape (the list-items return the full event; no projection).
- `apps/llm-usage-service/src/domain/models/usageQuery.ts` — reuses `AggregateMetrics` / `UsageQueryFilters` vocabulary for the list filters.
- `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts` — mirror this test layout (beforeAll/beforeEach/afterEach, `app.inject()`, fake repos via `setServices`).
- `apps/llm-usage-service/src/__tests__/fakeUsageEventRepository.ts` — extend with in-memory `list()` and `getById()` for tests.

### Read before touching the internal client
- `packages/internal-clients/src/usage-service/client.ts` — add two methods next to `queryUsage`.
- `packages/internal-clients/src/usage-service/types.ts` — add request/response DTOs for list/getById; re-export the full `UsageEvent` shape.
- `packages/internal-clients/src/usage-service/__tests__/client.test.ts` — extend with `nock`-based tests for the new methods.

### Read before touching the BFF
- `apps/app-settings-service/src/routes/publicRoutes.ts` — add `GET /settings/llm-usage/events` and `GET /settings/llm-usage/events/:eventId` and `POST /settings/llm-usage/query` alongside `/settings/usage-costs`.
- `apps/app-settings-service/src/services.ts` — add a `usageServiceClient` to the DI container.
- `apps/app-settings-service/src/index.ts` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL` + `INTEXURAOS_INTERNAL_AUTH_TOKEN` to `REQUIRED_ENV`.
- `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts` — mirror for new routes with a fake `UsageServiceClient`.

### Read before touching the web app
- `apps/web/src/pages/CodeTasksPage.tsx` — design reference for list page. Copy the header, filter-tab strip, sort selector, and localStorage patterns verbatim.
- `apps/web/src/pages/CodeTaskViewPage.tsx` — design reference for detail page, including the `MemoTaskHeader` / `MemoTaskPromptCard` card hierarchy and the `*Keyed` wrapper.
- `apps/web/src/components/Sidebar.tsx` — add a new top-level "LLM Usage" collapsible section modeled on the Code Tasks section (lines 427–477).
- `apps/web/src/App.tsx` — add three new routes (`/llm-usage`, `/llm-usage/:eventId`, plus the `LlmUsageViewPageKeyed` wrapper).
- `apps/web/src/hooks/useIssueGroups.ts` — blueprint for `useLlmUsageEvents` (server-side filtering, cursor-based pagination, 30s poll, tab-visibility refresh, abort on unmount).
- `apps/web/src/services/issueGroupsApi.ts` — blueprint for the new `llmUsageApi.ts`.
- `apps/web/src/services/apiClient.ts` — shared `apiRequest` helper; do not reinvent.
- `apps/web/src/hooks/useApiClient.ts` — `useApiClient()` hook that wraps `apiRequest` with the current access token.
- `apps/web/src/config.ts` — the `appSettingsServiceUrl` field already exists; new pages use it (the llm-usage-service is NOT exposed directly to the SPA).
- `apps/web/vite.config.ts` — the `/api/settings` proxy (port 8122) already exists and is reused as-is. **No new vite proxy entry is needed** because all web traffic goes through `app-settings-service`, which in turn calls `llm-usage-service` server-to-server.

### Read before touching Firestore indexes
- `firestore-collections.json` — confirm ownership of `llm_usage_events` stays with `llm-usage-service`.
- `migrations/051_code-tasks-status-createdAt-index.mjs` — template for a composite-index migration file (numbered at the repo root, not inside the app).

## Endpoint changes

### Modified
- (none — no existing endpoints change contract)

### Created
**Backend (`apps/llm-usage-service`)**
- `POST /internal/usage/events/list` — paginated raw events. Body: `{ timeRange: { from, to }, filters?: UsageEventFilters, sortBy?: { field, direction }, limit?, cursor? }`. Response: `{ events: UsageEvent[], nextCursor?: string, totalMatched: number }`. Auth: `X-Internal-Auth`.
- `GET /internal/usage/events/:eventId` — single raw event. Response: `{ event: UsageEvent }` or 404. Auth: `X-Internal-Auth`.

**BFF (`apps/app-settings-service`)**
- `POST /settings/llm-usage/events` — proxies `POST /internal/usage/events/list` on `llm-usage-service`. Auth: user bearer token via `requireAuth`; no user-scoping is applied at the BFF layer in this track (see "Out of scope"). Response mirrors the upstream.
- `GET /settings/llm-usage/events/:eventId` — proxies `GET /internal/usage/events/:eventId`. Auth: user bearer token.
- `POST /settings/llm-usage/query` — proxies the existing `POST /internal/usage/query`. Auth: user bearer token. (Added now so the web app has a single BFF entry point per concern; avoids coupling the SPA to two different service URLs.)

### Removed
- (none)

### Unchanged
- `POST /internal/usage/events` (webhook ingest)
- `POST /internal/usage/events/orchestrator` (orchestrator webhook)
- `POST /internal/usage/query` (still internal; the BFF above is a thin wrapper, not a replacement)
- All existing `app-settings-service` public routes (`/settings/pricing`, `/settings/usage-costs`, etc.)

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

### Phase 2 — Backend: new list + getById routes (test-first)

Write failing tests first in `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts`. The existing file is the template; add new `describe` blocks:

- `POST /internal/usage/events/list`
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
  - returns 401 for missing `X-Internal-Auth` header

- `GET /internal/usage/events/:eventId`
  - returns 200 with full event when found
  - returns 404 when not found
  - returns 401 for missing `X-Internal-Auth` header

Only after all of the above are red, implement the route handlers. Skeleton:

```ts
// apps/llm-usage-service/src/routes/internalUsageRoutes.ts  (new routes)
app.post(
  '/internal/usage/events/list',
  {
    schema: {
      operationId: 'internalListUsageEvents',
      summary: 'List raw usage events (internal, paginated)',
      tags: ['usage'],
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
      response: { /* 200, 400, 401 as in existing routes */ },
    },
  },
  async (request, reply) => {
    logIncomingRequest(request, { message: 'Internal usage events list' });
    const authResult = validateInternalAuth(request);
    if (!authResult.valid) {
      request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
      return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
    }
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
  '/internal/usage/events/:eventId',
  { schema: { /* ... */ } },
  async (request, reply) => {
    logIncomingRequest(request, { message: 'Internal usage event get' });
    const authResult = validateInternalAuth(request);
    if (!authResult.valid) {
      return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
    }
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
```

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

### Phase 4 — Internal client extension

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

Note: the client returns `UsageEventInput` rather than `UsageEvent` to avoid leaking the `receivedAt`/`ingress` internals into the BFF DTO. If the UI needs those fields, widen the type — but verify the caller actually uses them first.

Extend `client.ts` with `listEvents` and `getEvent` methods modeled on `queryUsage`. Add `nock`-based tests to `__tests__/client.test.ts` for all three: happy path, non-2xx, network error.

### Phase 5 — Web app BFF proxy routes

Add to `apps/app-settings-service/src/services.ts`:

```ts
import { createUsageServiceClient } from '@intexuraos/internal-clients/usage-service';
import type { UsageServiceClient } from '@intexuraos/internal-clients/usage-service';

export interface ServiceContainer {
  pricingRepository: PricingRepository;
  usageStatsRepository: UsageStatsRepository;
  usageServiceClient: UsageServiceClient;
}

export function getServices(): ServiceContainer {
  container ??= {
    pricingRepository: new FirestorePricingRepository(),
    usageStatsRepository: new FirestoreUsageStatsRepository(),
    usageServiceClient: createUsageServiceClient({
      baseUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL']!,
      internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']!,
      logger: createAppLogger({ name: 'app-settings-service.usageServiceClient' }),
    }),
  };
  return container;
}
```

Add to `apps/app-settings-service/src/routes/publicRoutes.ts` (next to `/settings/usage-costs`):

- `POST /settings/llm-usage/events` — validates body with Fastify JSON schema mirroring `ListUsageEventsRequest`, calls `usageServiceClient.listEvents(body, { traceId: request.id })`, returns 200 with `{ events, nextCursor, totalMatched }`. No user-scoping in this track.
- `GET /settings/llm-usage/events/:eventId` — calls `usageServiceClient.getEvent(eventId)`, returns 200 `{ event }` or 404.
- `POST /settings/llm-usage/query` — calls `usageServiceClient.queryUsage(body)`. Pass through the response verbatim.

Every new route MUST call `logIncomingRequest(request, { message: '...' })` and `requireAuth(request, reply)` (not `validateInternalAuth` — this is the public-facing BFF).

Add env vars in three places (per CLAUDE.md rules):
1. `apps/app-settings-service/src/index.ts` — add `'INTEXURAOS_LLM_USAGE_SERVICE_URL'` and `'INTEXURAOS_INTERNAL_AUTH_TOKEN'` to `REQUIRED_ENV` (the second may already be present — check before adding).
2. `terraform/environments/dev/main.tf` — add the same vars to the `app-settings-service` Cloud Run container's `env` block. The URL should point to the `llm-usage-service` Cloud Run service URL output.
3. `ecosystem.config.cjs` — add to the `app-settings-service` PM2 entry's `env` section for home-dev.

⚠ **DECISION NEEDED**: `INTEXURAOS_LLM_USAGE_SERVICE_URL` for the dev environment. Look up the actual service URL from `terraform/environments/dev/main.tf` — it likely exists as a Terraform output from the Phase 1 deployment. If it doesn't yet, add the output first.

Write tests in `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts` using a `FakeUsageServiceClient` that implements the `UsageServiceClient` interface with in-memory data. Tests must cover: happy path, upstream 404 → BFF 404, upstream 500 → BFF 500, missing auth → BFF 401, invalid body → BFF 400.

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
    config.appSettingsServiceUrl,
    '/settings/llm-usage/events',
    accessToken,
    { method: 'POST', body: request },
  );
}

export async function getLlmUsageEvent(
  accessToken: string,
  eventId: string,
): Promise<{ event: UsageEvent }> {
  return await apiRequest<{ event: UsageEvent }>(
    config.appSettingsServiceUrl,
    `/settings/llm-usage/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );
}

export async function queryLlmUsage(
  accessToken: string,
  request: LlmUsageQueryRequest,
): Promise<LlmUsageQueryResponse> {
  return await apiRequest<LlmUsageQueryResponse>(
    config.appSettingsServiceUrl,
    '/settings/llm-usage/query',
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

**`Sidebar.tsx`:** add a new collapsible section between "Code Tasks" and "Cron Agent". Model it on the Code Tasks section (lines 427–477):

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
7. Under the hood: the web app calls `POST /settings/llm-usage/query` with body `{ timeRange: {from, to}, filters: { providers: ['anthropic'], components: ['claude-worker'], services: ['orchestrator'] }, groupBy: ['day'] }`.
8. The BFF forwards to `POST /internal/usage/query` on `llm-usage-service`.
9. Result: a single row with `group.day = '2026-04-10'` and aggregated metrics.

**Use case 2: "Show all Gemini calls without grouping"**
1. User selects "Last 7 days" time range.
2. User clicks `google` in the Provider filter strip → `filters.providers = ['google']`.
3. User confirms Group by is "none" (default).
4. User confirms Sort is "occurredAt desc" (default).
5. Under the hood: the web app calls `POST /settings/llm-usage/events` with body `{ timeRange, filters: { providers: ['google'] }, sortBy: { field: 'occurredAt', direction: 'desc' }, limit: 50 }`.
6. The BFF forwards to `POST /internal/usage/events/list` on `llm-usage-service`.
7. Result: up to 50 events in a raw list, newest first, with a "Load more" button if `nextCursor` is present.
8. User clicks any event row → navigates to `/#/llm-usage/{eventId}` → detail page loads via `GET /settings/llm-usage/events/{eventId}`.

**Use case 3: "Show cost per LLM from the orchestrator this week, grouped by model"**
1. User picks "Last 7 days".
2. User clicks `orchestrator` in the Service filter strip → `filters.services = ['orchestrator']`.
3. User clicks "model" in the Group by selector → switches to `AggregateTable`.
4. The sort selector is hidden (grouping defaults to `costUsd desc` for the aggregate endpoint).
5. Under the hood: `POST /settings/llm-usage/query` body `{ timeRange, filters: { services: ['orchestrator'] }, groupBy: ['request.model'], sortBy: { field: 'costUsd', direction: 'desc' } }`.
6. Result: one row per model, sorted by cost descending. The `totals` are rendered in a "Grand total" footer row.

All three cases must work on the first deployment of this track. If any of them require extra endpoints or filters not listed in Phase 2/4/5, the plan is incomplete — escalate.

## Test plan

### Backend (`apps/llm-usage-service`)
- `src/__tests__/routes/internalUsageRoutes.test.ts` — extended with 15+ new test cases covering list + getById happy paths, filters, sorting, cursor roundtrip, error cases, auth.
- `src/__tests__/domain/usecases/listUsageEvents.test.ts` — new file, unit tests for validation + limit clamping + cursor encode/decode.
- `src/__tests__/fakeUsageEventRepository.ts` — extend with in-memory `list()` and `getById()` implementing the same semantics as the Firestore version.
- `src/__tests__/infra/firestoreUsageEventRepository.test.ts` — if an emulator-backed test already exists, extend it; otherwise rely on the fake-repo tests + manual smoke test in staging.

### Internal client (`packages/internal-clients`)
- `src/usage-service/__tests__/client.test.ts` — extend with 6 new `nock`-backed tests: listEvents happy, listEvents 404, listEvents network error, getEvent happy, getEvent not-found, getEvent network error.

### BFF (`apps/app-settings-service`)
- `src/__tests__/routes/publicRoutes.test.ts` — extend with a new `describe('/settings/llm-usage/*')` block:
  - POST /settings/llm-usage/events happy path
  - POST /settings/llm-usage/events upstream error
  - GET /settings/llm-usage/events/:eventId happy path
  - GET /settings/llm-usage/events/:eventId 404
  - POST /settings/llm-usage/query happy path
  - All routes: 401 when no bearer
  - All routes: 400 when body invalid (Fastify schema)
- Add `FakeUsageServiceClient` helper in `src/__tests__/fakes/fakeUsageServiceClient.ts`.

### Web app
- `src/services/__tests__/llmUsageApi.test.ts` — required (services/ is in the enforced-coverage zone).
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

1. **Backend first:** merge the llm-usage-service changes (Phases 1–3) and the new migration alone. Deploy to dev. Verify the new endpoints return correct data against real Firestore.
2. **Run the migration:** `node migrations/086_llm-usage-events-list-indexes.mjs up` from the repo root on dev. Wait for index builds to finish (monitor via `gcloud firestore indexes composite list --project=intexuraos-dev-pbuchman`). This can take 5–30 minutes on non-empty collections.
3. **Internal client + BFF:** merge Phases 4–5. Redeploy `app-settings-service` to dev. Hit `POST /settings/llm-usage/events` with curl using a fresh bearer token and verify it round-trips.
4. **Web app:** merge Phases 6–10. Verify in dev UI that all three use cases from Phase 11 work end-to-end.
5. **Promote to prod** in the same order (backend → BFF → web app) only after dev has soaked for 24h without errors in Sentry or Cloud Run logs.
6. Update the Linear issue INT-1340 with a link to the merged PR and screenshots of the three use cases.

## Acceptance criteria

- [ ] `POST /internal/usage/events/list` exists, accepts `{ timeRange, filters, sortBy, limit, cursor }`, returns `{ events, nextCursor, totalMatched }`, has ≥95% branch coverage.
- [ ] `GET /internal/usage/events/:eventId` exists, returns full `UsageEvent` or 404.
- [ ] Firestore composite indexes for the seven filter+sort combinations in Phase 3 exist in `migrations/086_*.mjs` and are deployed to dev.
- [ ] `UsageServiceClient.listEvents` and `UsageServiceClient.getEvent` are exported and tested with nock.
- [ ] `app-settings-service` proxies `POST /settings/llm-usage/events`, `GET /settings/llm-usage/events/:eventId`, `POST /settings/llm-usage/query` to `llm-usage-service` via the internal client.
- [ ] The web app has a new top-level "LLM Usage" nav section with an "Events" sub-item.
- [ ] `/#/llm-usage` renders the list page with four filter strips (provider, component, service, model), a time-range picker, a group-by selector, and a sort selector.
- [ ] The list page persists filter/sort/groupBy/timeRange choices to localStorage under `llm-usage-*` keys.
- [ ] `/#/llm-usage/{eventId}` renders the detail page with cards for request, usage, cost, source+owner, correlation, error, and raw JSON.
- [ ] Use cases 1, 2, and 3 from Phase 11 work end-to-end against real data in dev.
- [ ] `pnpm run ci:tracked` passes green.
- [ ] No existing endpoints change contract.
- [ ] `INTEXURAOS_LLM_USAGE_SERVICE_URL` is declared in all three required locations.

## Risks

1. **Cursor pagination edge cases.** If two events share the exact same `occurredAt` timestamp (millisecond precision), the `__name__` tiebreaker in the composite index is required for deterministic ordering. Without it, a "Load more" click may skip or duplicate an event at the boundary. **Mitigation:** every composite index in Phase 3 explicitly includes `{ fieldPath: '__name__', order: 'DESCENDING' }` and the Firestore query chains `.orderBy('__name__', direction)` after the primary sort. This must be tested with a fake repo that returns two events with identical `occurredAt`.

2. **`.count()` cost.** Running a `.count()` aggregation per page doubles Firestore reads. At the current volume (10k events/day) this is negligible; at 1M events/day it becomes material. **Mitigation:** hide the total-matched counter behind a `?includeCount=true` flag if cost becomes a problem, defaulting to `true` in Track 1 and reconsidering in Track 4 (observability).

3. **Index count explosion.** Every additional filter-sort combination needs its own composite index. Firestore caps at 200 composite indexes per project. We currently have ~85 migration files, each adding a few. **Mitigation:** Phase 3 limits indexes to single-filter + sort combinations. Multi-filter queries fall back to post-fetch in-memory filtering, which caps at `MAX_LIST_LIMIT` rows per Firestore read. Document this limitation clearly in the list use case.

4. **BFF double-hop latency.** `web → app-settings-service → llm-usage-service → firestore` adds ~30ms over `web → llm-usage-service → firestore`. **Mitigation:** acceptable — matches the existing `/settings/pricing` and `/settings/usage-costs` patterns. Do not optimize prematurely.

5. **Schema drift between the stored `UsageEvent` and the client-side type mirror.** The internal client re-defines `UsageEventInput` to avoid cross-app imports. If the llm-usage-service team changes the schema without updating the mirror, the BFF will silently truncate fields. **Mitigation:** add a comment in `packages/internal-clients/src/usage-service/types.ts` pointing at the canonical source (`apps/llm-usage-service/src/domain/models/usageEvent.ts`) and a compile-time assertion via `satisfies` once the types are importable.

6. **Web app dev proxy assumes `/api/settings`.** The Vite proxy already routes `/api/settings` → port 8122. No change needed, but if a dev forgets to re-build `app-settings-service` after adding the new routes, they'll get 404s in dev. **Mitigation:** document in the PR description that `pnpm --filter app-settings-service build && pnpm dev` must be run in that order on first checkout.

7. **Composite index build time on a non-empty collection.** If `llm_usage_events` already has millions of docs in dev, building 7 new composite indexes can take 30+ minutes. **Mitigation:** run the migration at the start of the backend phase and proceed with web app work in parallel; don't block the PR on index builds.

## Out of scope (explicitly not in this track)

- **Pricing UI relocation** — moved to Track 5 (INT-1343). The `LLM Usage` sidebar section is built with an array that Track 5 can extend.
- **Charts, timeseries, vega-lite visualizations** — aggregate view is a plain table in Track 1. Visualizations are a potential Phase 3.
- **Real-time updates / SSE / websockets** — the list page polls every 30s on tab focus, like `CodeTasksPage`. No live stream.
- **Per-user quota views** — the detail page shows cost but does not compare against a quota.
- **Export to CSV / JSON** — a "copy raw JSON" button on the detail page is the only export mechanism.
- **User-scoping in the BFF** — `/settings/llm-usage/*` returns ALL events the caller requests, with no implicit `ownerId = currentUser` filter. This is a deliberate choice because the dashboard is admin-facing (there is only one admin user). If that changes, Track 4 (observability + access control) will add the scoping.
- **Custom index-aware query planner** — multi-filter queries fall back to post-fetch filtering. A future track can add a proper planner.
- **Soft delete / archiving of events** — events are immutable once ingested. No archive UI.
- **Editing pricing on the detail page** — Track 5 handles pricing surface area.
- **Breadcrumbs / back button wiring beyond the sidebar NavLink** — follow the code-tasks convention (no explicit back button).
- **Mobile-optimized table layout** — the list renders on mobile but uses a condensed one-line-per-event style; a proper responsive card layout is out of scope.
- **Integration tests that boot the full stack** — unit + route-level fake-repo tests are sufficient for Track 1.
- **Metrics/Sentry instrumentation on the new endpoints** — Track 4 (observability) adds structured metrics and alerting.

---

## Appendix A — Open decisions flagged in this plan

All `⚠ DECISION NEEDED` markers:

1. **Phase 1:** whether to ship with `.count()` enabled by default on the list endpoint (recommended: yes).
2. **Phase 3:** whether to index single-filter or multi-filter combinations (recommended: single-filter only, document the limit).
3. **Phase 5:** the exact value of `INTEXURAOS_LLM_USAGE_SERVICE_URL` for dev — pull from the existing Terraform output or add one if missing.

## Appendix B — Files to be created (summary list)

**Backend:**
- `apps/llm-usage-service/src/domain/usecases/listUsageEvents.ts`
- `apps/llm-usage-service/src/__tests__/domain/usecases/listUsageEvents.test.ts`

**Migrations:**
- `migrations/086_llm-usage-events-list-indexes.mjs`

**BFF:**
- `apps/app-settings-service/src/__tests__/fakes/fakeUsageServiceClient.ts`

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
- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts`
- `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts`
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts`
- `apps/llm-usage-service/src/domain/models/usageEvent.ts` (add MAX_LIST_LIMIT / DEFAULT_LIST_LIMIT)
- `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts`
- `apps/llm-usage-service/src/__tests__/fakeUsageEventRepository.ts`
- `packages/internal-clients/src/usage-service/client.ts`
- `packages/internal-clients/src/usage-service/types.ts`
- `packages/internal-clients/src/usage-service/__tests__/client.test.ts`
- `apps/app-settings-service/src/services.ts`
- `apps/app-settings-service/src/routes/publicRoutes.ts`
- `apps/app-settings-service/src/index.ts` (REQUIRED_ENV)
- `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/pages/index.ts`
- `terraform/environments/dev/main.tf`
- `ecosystem.config.cjs`
