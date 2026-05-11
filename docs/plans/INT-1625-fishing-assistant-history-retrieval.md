# INT-1625 Fishing Assistant History Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fishing Assistant retrieval can search all available historical digest summaries and raw group messages, while still sending a ranked, bounded evidence set and the full current chat history to the answer prompt.

**Architecture:** The producer side is `mobile-notifications-service`, which must expose cursor-based access to digest summaries and group messages through the shared `@intexuraos/internal-clients` contract. The consumer side is `fishing-assistant-service`, which must page through the complete available historical range for every user digest group, rank evidence locally, and keep the prompt payload bounded. The two subtasks can run in parallel because the request/response contract below is fixed.

**Tech Stack:** TypeScript, Fastify, Firestore, `@intexuraos/internal-clients`, Vitest, `pnpm run ci:tracked`.

---

## Current vs Target Access

| Data source | Current behavior | Target behavior |
| --- | --- | --- |
| Current Fishing chat messages | `sendChatMessage` calls `listMessagesForChat` after storing the user message and passes every returned message to `fishingAnswerPrompt.build`. | Keep this behavior and add regression coverage proving all repository-returned chat messages reach the prompt. |
| Knowledge base chunks | Embeds the question, reads 20 nearest chunks, keeps up to 12 ranked chunks. | Keep bounded vector retrieval; this issue is about historical notification data. |
| Digest groups | `retrieveEvidence` scans only `listDigestSubscriptions(...).items.slice(0, 8)`. | Scan every digest subscription returned for the user. |
| Digest date range | Explicit dates in the question are used; otherwise only the rolling last 90 days are queried. | Explicit dates still narrow the search; otherwise query from a historical floor through `now` so all stored digests are reachable. |
| Digest summaries | Calls `queryDigests` once per group with `limit: 8`; no cursor is available to continue. | Page through `queryDigests` until `nextCursor` is absent, using a page limit of 100. |
| Raw group messages | Reads raw messages only for the top 3 digest dates and only 12 messages per date. | Page through `queryGroupMessages` for every digest group over the same historical range, using terms and cursor-based continuation until `nextCursor` is absent. |
| Final prompt evidence | Sorts all collected evidence and sends the top 16 items. | Keep a bounded final evidence limit, but choose the top items after scanning full historical digest/message data. |

## Parallel Breakdown

| Subtask | Owner boundary | Contract |
| --- | --- | --- |
| INT-1626 | `apps/mobile-notifications-service` plus `packages/internal-clients/src/mobile-notifications-service` | Produce paginated `queryDigests` and `queryGroupMessages` responses with optional `nextCursor`. No Fishing Assistant code changes. |
| INT-1627 | `apps/fishing-assistant-service` | Consume the paginated contract, scan all groups/history, rank evidence, and preserve full current-chat prompt history. No mobile route changes. |

Implementation agents must use subagents for these subtasks. There are no Linear dependencies between INT-1626 and INT-1627; each subtask owns its files and codes against the contract in this plan.

## Endpoint Changes

| Category | Endpoint | Change |
| --- | --- | --- |
| Modified | `POST /internal/notifications/digests/query` | Request accepts optional `cursor`; response includes optional `nextCursor`; `truncated` remains backward compatible. |
| Modified | `POST /internal/notifications/group-messages/query` | Request accepts optional `cursor`; long historical ranges are reachable through raw notification pagination; response includes optional `nextCursor`. |
| Unchanged | `POST /internal/notifications/digest-subscriptions/list` | Still returns every configured digest group for a user. |
| Unchanged | `POST /internal/notifications/digests/get` | Single-date lookup unchanged. |
| Unchanged | `POST /internal/notifications/digest-state/get` | State lookup unchanged. |
| Unchanged | Fishing Assistant user-facing routes under `/fishing/*` | No new user-facing HTTP surface is required. |
| Created | None | No new endpoint. |
| Removed | None | No route removal. |

## Shared Contract

The mobile subtask implements these shared type changes in `packages/internal-clients/src/mobile-notifications-service/types.ts`:

```typescript
export interface QueryDigestsRequest {
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryDigestsResponse {
  items: DigestEvidenceItem[];
  truncated: boolean;
  nextCursor?: string;
}

export interface QueryGroupMessagesRequest {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryGroupMessagesResponse {
  messages: GroupMessageEvidence[];
  totalRaw: number;
  totalCleaned: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}
```

## File Structure

- Modify `packages/internal-clients/src/mobile-notifications-service/types.ts` for the optional cursor contract.
- Modify `packages/internal-clients/src/mobile-notifications-service/client.ts` only if request body handling needs adjustment; it currently passes request bodies through unchanged.
- Modify `packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts` for cursor request/response coverage.
- Modify `apps/mobile-notifications-service/src/routes/internalRoutes.ts` to accept and return cursors for digest and group-message queries.
- Modify `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts` so timestamp-range notification queries use a Firestore-compatible order and stable cursor.
- Modify `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts` for timestamp-range pagination, cursor stability, and mismatch between `timestamp` and `receivedAt` ordering.
- Modify `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts` for digest cursor propagation, group-message cursor propagation, and long-range historical message access.
- Create a migration such as `migrations/107_mobile-notifications-timestamp-range-pagination-index.mjs` plus a migration test under `migrations/__tests__/` for the raw-message timestamp-range query index.
- Modify `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts` to scan all digest groups and all paginated historical digest/message pages.
- Modify `apps/fishing-assistant-service/src/domain/usecases/sendChatMessage.ts` only if dependency typing needs a local paginated mobile client port.
- Modify `apps/fishing-assistant-service/src/domain/prompts/buildFishingAnswerPrompt.ts` only if prompt wording changes; if changed, bump the prompt semver version because `PromptBuilder` prompts require semver versioning.
- Modify tests under `apps/fishing-assistant-service/src/__tests__/retrieval.test.ts`, `apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts`, and `apps/fishing-assistant-service/src/__tests__/promptAndRanking.test.ts` as needed.

---

## Task 1: Mobile Historical Query Contract (INT-1626)

**Files:**
- Modify: `packages/internal-clients/src/mobile-notifications-service/types.ts`
- Modify: `packages/internal-clients/src/mobile-notifications-service/client.ts`
- Modify: `packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts`
- Modify: `apps/mobile-notifications-service/src/routes/internalRoutes.ts`
- Modify: `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`
- Create: `migrations/107_mobile-notifications-timestamp-range-pagination-index.mjs`
- Create: `migrations/__tests__/107-mobile-notifications-timestamp-range-pagination-index.test.ts`

- [ ] **Step 1: Add failing internal-client tests for cursors**

In `packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts`, update the `queryDigests sends auth and uses the exact internal path` test request and response:

```typescript
const request = {
  userId: 'u',
  groupKey: 'g',
  dateFrom: '2026-04-15',
  dateTo: '2026-04-16',
  limit: 5,
  cursor: '2026-04-15',
};
const response = {
  items: [
    {
      groupKey: 'g',
      date: '2026-04-15',
      title: 'Spring bait',
      summaryMarkdown: '# Spring bait',
      messageCount: 12,
    },
  ],
  truncated: true,
  nextCursor: '2026-04-14',
};
```

Update the `queryGroupMessages sends auth and preserves optional terms` test request and response:

```typescript
const request = {
  userId: 'u',
  groupKey: 'g',
  dateFrom: '2026-01-01',
  dateTo: '2026-04-15',
  terms: ['spring', 'bait'],
  limit: 10,
  cursor: 'raw-cursor-1',
};
const response = {
  messages: [
    {
      messageRef: 'g:2026-04-15:1:abc',
      groupKey: 'g',
      date: '2026-04-15',
      postTimeSec: 1776200400,
      senderLabel: null,
      text: 'Spring bait worked',
      quote: 'Spring bait worked',
    },
  ],
  totalRaw: 3,
  totalCleaned: 1,
  returned: 1,
  truncated: true,
  nextCursor: 'raw-cursor-2',
};
```

- [ ] **Step 2: Run client tests and confirm they fail on missing types**

Run:

```bash
pnpm vitest run packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts
```

Expected: TypeScript or test failure because `cursor` and `nextCursor` are not in the shared mobile notification client types.

- [ ] **Step 3: Add failing mobile route tests for digest cursor propagation**

In `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`, add a test near the existing digest query tests:

```typescript
it('propagates digest query cursor and returns nextCursor', async () => {
  setInternalAuth();
  let capturedInput: Parameters<DigestRepository['findInRange']>[0] | null = null;
  const digestRepository = makeDigestRepository({
    findInRange: async (input) => {
      capturedInput = input;
      return ok({
        items: [{ summary: makeSummary(), generation: 1, generatedAt: '2026-04-15T20:00:00.000Z', modelId: 'm' }],
        nextCursor: '2026-04-14',
      });
    },
  });
  setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

  const response = await ctx.app.inject({
    method: 'POST',
    url: '/internal/notifications/digests/query',
    headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    payload: {
      userId: 'u',
      groupKey: 'g',
      dateFrom: '2026-01-01',
      dateTo: '2026-04-15',
      limit: 10,
      cursor: '2026-04-15',
    },
  });

  expect(response.statusCode).toBe(200);
  expect(capturedInput).toEqual({
    userId: 'u',
    groupKey: 'g',
    fromDate: '2026-01-01',
    toDate: '2026-04-15',
    limit: 10,
    cursor: '2026-04-15',
  });
  const body = JSON.parse(response.body) as SuccessResponse<{
    items: { title: string }[];
    truncated: boolean;
    nextCursor?: string;
  }>;
  expect(body.data.nextCursor).toBe('2026-04-14');
  expect(body.data.truncated).toBe(true);
});
```

- [ ] **Step 4: Add failing repository tests for timestamp-range raw-message pagination**

In `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts`, add repository-level tests before the route tests. These tests must exercise the same path that `/internal/notifications/group-messages/query` uses:

- `findByUserIdPaginated` with `filter: { app: ['com.whatsapp'], title: 'Group prefix', postTimeSecFrom, postTimeSecTo }` returns results ordered by notification `timestamp` descending, not by `receivedAt`.
- Pagination round-trips with this timestamp-range filter and returns no duplicate notification IDs across pages.
- A dataset where `receivedAt` ordering differs from `timestamp` ordering still returns all in-range rows in stable `timestamp desc` order.

Example assertion shape:

```typescript
const firstPage = await repository.findByUserIdPaginated('user-history', {
  limit: 2,
  filter: {
    app: ['com.whatsapp'],
    title: 'Fishing Group',
    postTimeSecFrom: 100,
    postTimeSecTo: 500,
  },
});
expect(firstPage.ok).toBe(true);
if (!firstPage.ok) return;
expect(firstPage.value.notifications.map((n) => n.timestamp)).toEqual([400, 300]);
expect(firstPage.value.nextCursor).toBeDefined();

const cursor = firstPage.value.nextCursor;
if (cursor === undefined) throw new Error('Expected nextCursor');
const secondPage = await repository.findByUserIdPaginated('user-history', {
  limit: 2,
  cursor,
  filter: {
    app: ['com.whatsapp'],
    title: 'Fishing Group',
    postTimeSecFrom: 100,
    postTimeSecTo: 500,
  },
});
expect(secondPage.ok).toBe(true);
if (!secondPage.ok) return;
expect(secondPage.value.notifications.map((n) => n.timestamp)).toEqual([200, 100]);
expect(new Set([...firstPage.value.notifications, ...secondPage.value.notifications].map((n) => n.id)).size).toBe(4);
```

Expected: fail because the current Firestore repository applies `timestamp` range filters but orders and cursors by `receivedAt`.

- [ ] **Step 5: Add failing migration test for the timestamp-range pagination index**

Create a migration test asserting the new migration declares the composite index needed by historical raw-message paging. The index must cover the exact DB-level filters and ordering used by the repository path:

```typescript
expect(indexes).toContainEqual({
  collectionGroup: 'mobile_notifications',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'app', order: 'ASCENDING' },
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'timestamp', order: 'DESCENDING' },
  ],
});
```

If the implementation explicitly orders by document ID as a tie-breaker and the migration framework supports declaring it, include the `__name__` field in the test. If Firestore's generated index treats document ID as the implicit final tie-breaker, document that in the migration comment and keep the test focused on `app`, `userId`, and `timestamp`.

- [ ] **Step 6: Redesign `findByUserIdPaginated` for timestamp-range queries**

In `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts`, keep the existing `receivedAt` pagination for normal notification lists, but branch when `postTimeSecFrom` or `postTimeSecTo` is present:

- Apply DB filters for `userId`, `app`, and the `timestamp` range.
- Order by `timestamp` descending for timestamp-range queries so Firestore accepts the inequality query and pages by the same field being ranged.
- Add a stable tie-breaker to the cursor. Prefer encoding both `{ timestamp, id }` and using a matching tie-break order; keep the old `{ receivedAt, id }` cursor shape for non-range list queries.
- Continue applying `title` filtering in memory unless a separate indexed title-prefix design is introduced.
- Preserve the scan safety guard and ensure `nextCursor` tracks DB position, not only matched title-filtered rows.

The route must not paper over repository errors; this repository path has to be Firestore-compatible for the full-history Fishing Assistant query shape.

- [ ] **Step 7: Add the timestamp-range pagination migration**

Create `migrations/107_mobile-notifications-timestamp-range-pagination-index.mjs` for the raw-message historical paging query shape. The migration comment must name the call path:

```text
/internal/notifications/group-messages/query -> NotificationRepository.findByUserIdPaginated
filter: app + userId + timestamp range, order: timestamp desc
```

This is separate from migration 096, which documents the existing `receivedAt`-ordered digest query shape and does not prove the new full-history raw-message pagination shape.

- [ ] **Step 8: Run repository and migration tests and confirm they fail**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts migrations/__tests__/107-mobile-notifications-timestamp-range-pagination-index.test.ts
```

Expected: fail until the repository query/cursor redesign and migration are implemented.

- [ ] **Step 9: Add failing mobile route tests for group-message cursor propagation**

Add a route test that configures `ctx.notificationRepo.findByUserIdPaginated` to capture the incoming cursor and return a `nextCursor`:

```typescript
it('propagates group-message cursor and returns nextCursor for historical paging', async () => {
  setInternalAuth();
  const capturedOptions: PaginationOptions[] = [];
  const notificationRepo = {
    ...ctx.notificationRepo,
    findByUserIdPaginated: async (_userId: string, options: PaginationOptions) => {
      capturedOptions.push(options);
      return ok({
        notifications: [
          {
            id: 'n1',
            userId: 'u',
            app: 'com.whatsapp',
            title: 'Group title',
            text: 'Spring bait worked',
            postTime: '2026-04-15T08:00:00.000Z',
            postTimeSec: 1776236400,
            createdAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        nextCursor: 'raw-cursor-2',
      });
    },
  };
  setMockServices({ notificationRepository: notificationRepo });

  const response = await ctx.app.inject({
    method: 'POST',
    url: '/internal/notifications/group-messages/query',
    headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    payload: {
      userId: 'u',
      groupKey: 'g',
      dateFrom: '2026-01-01',
      dateTo: '2026-04-15',
      terms: ['spring'],
      limit: 10,
      cursor: 'raw-cursor-1',
    },
  });

  expect(response.statusCode).toBe(200);
  expect(capturedOptions[0]?.cursor).toBe('raw-cursor-1');
  expect(capturedOptions[0]?.filter?.postTimeSecFrom).toBe(bounds.fromSec);
  expect(capturedOptions[0]?.filter?.postTimeSecTo).toBe(bounds.toSec);
  const body = JSON.parse(response.body) as SuccessResponse<{
    messages: { text: string }[];
    nextCursor?: string;
    truncated: boolean;
  }>;
  expect(body.data.messages[0]?.text).toBe('Spring bait worked');
  expect(body.data.nextCursor).toBe('raw-cursor-2');
  expect(body.data.truncated).toBe(true);
});
```

Also add an internal route integration-style test that uses the real fake notification repository with several WhatsApp notifications whose `timestamp` order differs from insertion/`receivedAt` order, requests a historical range with `limit: 1`, follows `nextCursor`, and asserts every in-range matching message is reachable without duplicate `messageRef` values. This catches regressions where the route contract is green but the repository query/cursor shape is still unstable.

- [ ] **Step 10: Run mobile route tests and confirm they fail**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
```

Expected: fail because schemas reject `cursor` and responses do not include `nextCursor`.

- [ ] **Step 11: Update shared client types**

In `packages/internal-clients/src/mobile-notifications-service/types.ts`, apply the shared contract from this plan:

```typescript
export interface QueryDigestsRequest {
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryDigestsResponse {
  items: DigestEvidenceItem[];
  truncated: boolean;
  nextCursor?: string;
}

export interface QueryGroupMessagesRequest {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryGroupMessagesResponse {
  messages: GroupMessageEvidence[];
  totalRaw: number;
  totalCleaned: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}
```

`packages/internal-clients/src/mobile-notifications-service/client.ts` should continue to pass request bodies through with `withRequestOptions`; no filtering should be introduced.

- [ ] **Step 12: Update mobile internal route body types and schemas**

In `apps/mobile-notifications-service/src/routes/internalRoutes.ts`, add cursor fields:

```typescript
interface DigestQueryBody {
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}

interface GroupMessagesQueryBody {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
  cursor?: string;
}
```

In both JSON schemas, add:

```typescript
cursor: { type: 'string', minLength: 1 },
```

- [ ] **Step 13: Return digest `nextCursor`**

In the `/internal/notifications/digests/query` handler, pass the cursor into the repository and include the response cursor:

```typescript
const result = await getServices().digestRepository.findInRange({
  userId,
  groupKey,
  fromDate: dateFrom,
  toDate: dateTo,
  limit,
  ...(request.body.cursor !== undefined ? { cursor: request.body.cursor } : {}),
});
if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);

const terms = normalizeTerms(request.body.terms as string[]);
const matchedItems = result.value.items
  .map((doc) => toDigestEvidenceItem(doc, subscription.outputLanguage))
  .filter((item) => textMatchesTerms(`${item.title}\n${item.summaryMarkdown}`, terms));
const items = matchedItems.slice(0, limit);

return await reply.ok({
  items,
  truncated: matchedItems.length > limit || result.value.nextCursor !== undefined,
  ...(result.value.nextCursor !== undefined ? { nextCursor: result.value.nextCursor } : {}),
});
```

- [ ] **Step 14: Return group-message `nextCursor`**

In the `/internal/notifications/group-messages/query` handler, seed raw pagination with `request.body.cursor`, keep the existing scan budget per request, and return continuation when there is more raw history:

```typescript
let cursor = request.body.cursor;
let nextCursor: string | undefined;
let rawScanTruncated = false;

do {
  const pageLimit = Math.min(
    RAW_NOTIFICATION_PAGE_SIZE,
    MAX_RAW_NOTIFICATIONS_TO_SCAN - rawNotifications.length
  );
  const options: PaginationOptions = {
    limit: pageLimit,
    filter: {
      app: ['com.whatsapp'],
      title: subscription.groupTitlePrefix,
      postTimeSecFrom: fromBounds.fromSec,
      postTimeSecTo: toBounds.toSec,
    },
    ...(cursor !== undefined ? { cursor } : {}),
  };

  const page = await getServices().notificationRepository.findByUserIdPaginated(
    userId,
    options
  );
  if (!page.ok) return await reply.fail('INTERNAL_ERROR', page.error.message);

  rawNotifications.push(...page.value.notifications);
  cursor = page.value.nextCursor;
  nextCursor = page.value.nextCursor;
  if (cursor !== undefined && rawNotifications.length >= MAX_RAW_NOTIFICATIONS_TO_SCAN) {
    rawScanTruncated = true;
    break;
  }
} while (cursor !== undefined && rawNotifications.length < MAX_RAW_NOTIFICATIONS_TO_SCAN);
```

Return:

```typescript
return await reply.ok({
  messages,
  totalRaw: rawNotifications.length,
  totalCleaned: cleaned.length,
  returned: messages.length,
  truncated: rawScanTruncated || matched.length > limit || nextCursor !== undefined,
  ...(nextCursor !== undefined ? { nextCursor } : {}),
});
```

Do not apply the `MAX_GROUP_MESSAGE_RANGE_DAYS` limit to internal historical paging if `cursor` support is present. The historical range is protected by cursor pagination and the per-request raw scan budget, but only after the repository timestamp-range query path from Steps 4-7 is implemented.

- [ ] **Step 15: Run focused tests for the producer contract**

Run:

```bash
pnpm vitest run packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts migrations/__tests__/107-mobile-notifications-timestamp-range-pagination-index.test.ts
```

Expected: pass.

- [ ] **Step 16: Run workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- mobile-notifications-service
pnpm run verify:workspace:tracked -- internal-clients
```

Expected: both pass.

---

## Task 2: Fishing Assistant Full-History Consumer (INT-1627)

**Files:**
- Modify: `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts`
- Modify: `apps/fishing-assistant-service/src/domain/usecases/sendChatMessage.ts` only if dependency typing needs a local port
- Modify: `apps/fishing-assistant-service/src/__tests__/retrieval.test.ts`
- Modify: `apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts`
- Modify: `apps/fishing-assistant-service/src/__tests__/promptAndRanking.test.ts` if prompt evidence assertions need adjustment

- [ ] **Step 1: Add failing retrieval tests for all groups**

In `apps/fishing-assistant-service/src/__tests__/retrieval.test.ts`, replace the existing cap test with a test that expects every group to be queried:

```typescript
it('queries every digest subscription instead of capping group fan-out', async () => {
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'embed failed' } }),
  };
  const chunkRepository = makeChunkRepository({ ok: true, value: [] });
  const groups = Array.from({ length: 10 }, (_, index) => ({
    groupKey: `group-${String(index + 1)}`,
    displayName: `Group ${String(index + 1)}`,
  }));
  const mobileNotificationsClient = {
    listDigestSubscriptions: vi.fn().mockResolvedValue({ ok: true, value: { items: groups } }),
    queryDigests: vi.fn().mockResolvedValue({ ok: true, value: { items: [], truncated: false } }),
    queryGroupMessages: vi.fn().mockResolvedValue({
      ok: true,
      value: { messages: [], totalRaw: 0, totalCleaned: 0, returned: 0, truncated: false },
    }),
  };

  await retrieveEvidence(
    { embeddingClient, chunkRepository, mobileNotificationsClient, now: new Date('2026-05-05T12:00:00Z') },
    { userId: 'user-1', question: 'recent feeder reports' }
  );

  expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledTimes(10);
  expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledTimes(10);
});
```

- [ ] **Step 2: Add failing retrieval tests for full default historical range**

Add a test that expects no rolling 90-day lower bound:

```typescript
it('uses the full historical range when the question has no explicit dates', async () => {
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
  };
  const chunkRepository = makeChunkRepository({ ok: true, value: [makeChunk()] });
  const mobileNotificationsClient = {
    listDigestSubscriptions: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
    }),
    queryDigests: vi.fn().mockResolvedValue({ ok: true, value: { items: [], truncated: false } }),
    queryGroupMessages: vi.fn().mockResolvedValue({
      ok: true,
      value: { messages: [], totalRaw: 0, totalCleaned: 0, returned: 0, truncated: false },
    }),
  };

  await retrieveEvidence(
    { embeddingClient, chunkRepository, mobileNotificationsClient, now: new Date('2026-05-05T12:00:00Z') },
    { userId: 'user-1', question: 'where should I fish now' }
  );

  expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledWith(
    {
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '1970-01-01',
      dateTo: '2026-05-05',
      terms: ['where', 'should', 'fish', 'now'],
      limit: 100,
    },
    { timeoutMs: 5000 }
  );
  expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
    {
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '1970-01-01',
      dateTo: '2026-05-05',
      terms: ['where', 'should', 'fish', 'now'],
      limit: 500,
    },
    { timeoutMs: 5000 }
  );
});
```

- [ ] **Step 3: Add failing retrieval tests for digest pagination**

Add:

```typescript
it('paginates digest evidence until no nextCursor remains', async () => {
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'embed failed' } }),
  };
  const chunkRepository = makeChunkRepository({ ok: true, value: [] });
  const mobileNotificationsClient = {
    listDigestSubscriptions: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
    }),
    queryDigests: vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [{ groupKey: 'feeder', date: '2026-05-02', title: 'May 2', summaryMarkdown: 'Pinka worked', messageCount: 14 }],
          truncated: true,
          nextCursor: '2026-05-01',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [{ groupKey: 'feeder', date: '2026-05-01', title: 'May 1', summaryMarkdown: 'Groundbait worked', messageCount: 10 }],
          truncated: false,
        },
      }),
    queryGroupMessages: vi.fn().mockResolvedValue({
      ok: true,
      value: { messages: [], totalRaw: 0, totalCleaned: 0, returned: 0, truncated: false },
    }),
  };

  const result = await retrieveEvidence(
    { embeddingClient, chunkRepository, mobileNotificationsClient, now: new Date('2026-05-05T12:00:00Z') },
    { userId: 'user-1', question: 'what bait worked' }
  );

  expect(mobileNotificationsClient.queryDigests).toHaveBeenNthCalledWith(
    2,
    {
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '1970-01-01',
      dateTo: '2026-05-05',
      terms: ['what', 'bait', 'worked'],
      limit: 100,
      cursor: '2026-05-01',
    },
    { timeoutMs: 5000 }
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.filter((item) => item.sourceType === 'digest')).toHaveLength(2);
});
```

- [ ] **Step 4: Add failing retrieval tests for raw-message pagination**

Add:

```typescript
it('paginates raw group-message evidence across the full historical range', async () => {
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'embed failed' } }),
  };
  const chunkRepository = makeChunkRepository({ ok: true, value: [] });
  const mobileNotificationsClient = {
    listDigestSubscriptions: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
    }),
    queryDigests: vi.fn().mockResolvedValue({ ok: true, value: { items: [], truncated: false } }),
    queryGroupMessages: vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [{ messageRef: 'msg-1', groupKey: 'feeder', date: '2026-05-02', postTimeSec: 123, senderLabel: 'Piotr', text: 'Use pinka', quote: 'Use pinka' }],
          totalRaw: 5000,
          totalCleaned: 1,
          returned: 1,
          truncated: true,
          nextCursor: 'raw-cursor-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [{ messageRef: 'msg-2', groupKey: 'feeder', date: '2026-04-01', postTimeSec: 122, senderLabel: 'Jan', text: 'Use caster', quote: 'Use caster' }],
          totalRaw: 10,
          totalCleaned: 1,
          returned: 1,
          truncated: false,
        },
      }),
  };

  const result = await retrieveEvidence(
    { embeddingClient, chunkRepository, mobileNotificationsClient, now: new Date('2026-05-05T12:00:00Z') },
    { userId: 'user-1', question: 'what bait did they use' }
  );

  expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenNthCalledWith(
    2,
    {
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '1970-01-01',
      dateTo: '2026-05-05',
      terms: ['what', 'bait', 'they', 'use'],
      limit: 500,
      cursor: 'raw-cursor-2',
    },
    { timeoutMs: 5000 }
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.filter((item) => item.sourceType === 'raw_message')).toHaveLength(2);
});
```

- [ ] **Step 5: Add a full current-chat prompt history regression test**

In `apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts`, add or update a test to prove all repository-returned messages are passed into `fishingAnswerPrompt.build`. Use the existing fake repository/test patterns in that file. The assertion should capture the generated prompt or the prompt builder input and verify three stored messages are present:

```typescript
expect(capturedPrompt).toContain('[stored user message] first historical question');
expect(capturedPrompt).toContain('[stored assistant message] first historical answer');
expect(capturedPrompt).toContain('[stored user message] newest question');
```

This protects the "assistant has access to historical chat messages" part without adding cross-chat history that the issue did not specify.

- [ ] **Step 6: Run focused Fishing tests and confirm they fail**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts
```

Expected: fail because retrieval still caps groups, uses a 90-day default range, does not page digests, and only queries raw messages for top digest dates.

- [ ] **Step 7: Replace retrieval caps with paginated helpers**

In `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts`, replace the 90-day default and hard caps with constants:

```typescript
const MOBILE_NOTIFICATIONS_TIMEOUT_MS = 5_000;
const HISTORICAL_DATE_FLOOR = '1970-01-01';
const DIGEST_PAGE_LIMIT = 100;
const GROUP_MESSAGE_PAGE_LIMIT = 500;
const FINAL_EVIDENCE_LIMIT = 16;
```

Change `extractDateRange` so no-date questions use all available history:

```typescript
function extractDateRange(question: string, now: Date): { dateFrom: string; dateTo: string } {
  const matches = [...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (matches.length >= 2 && matches[0] !== undefined && matches[1] !== undefined) {
    return { dateFrom: matches[0], dateTo: matches[1] };
  }
  if (matches.length === 1 && matches[0] !== undefined) {
    return { dateFrom: matches[0], dateTo: matches[0] };
  }
  return {
    dateFrom: HISTORICAL_DATE_FLOOR,
    dateTo: now.toISOString().slice(0, 10),
  };
}
```

Add local structural types if the shared client task is not merged yet. The fallback must widen both request inputs and successful response values so INT-1627 can compile independently before INT-1626 lands:

```typescript
type PaginatedQueryDigestsRequest =
  Parameters<MobileNotificationsServiceClient['queryDigests']>[0] & { cursor?: string };
type PaginatedQueryGroupMessagesRequest =
  Parameters<MobileNotificationsServiceClient['queryGroupMessages']>[0] & { cursor?: string };
type PaginatedQueryDigestsResponse = QueryDigestsResponse & { nextCursor?: string };
type PaginatedQueryGroupMessagesResponse = QueryGroupMessagesResponse & { nextCursor?: string };
```

If TypeScript rejects `cursor` or `nextCursor` before the shared package lands, introduce a local port:

```typescript
interface PaginatedMobileNotificationsClient {
  listDigestSubscriptions: MobileNotificationsServiceClient['listDigestSubscriptions'];
  queryDigests: (
    input: PaginatedQueryDigestsRequest,
    options?: Parameters<MobileNotificationsServiceClient['queryDigests']>[1]
  ) => Promise<MobileNotificationsServiceResult<PaginatedQueryDigestsResponse>>;
  queryGroupMessages: (
    input: PaginatedQueryGroupMessagesRequest,
    options?: Parameters<MobileNotificationsServiceClient['queryGroupMessages']>[1]
  ) => Promise<MobileNotificationsServiceResult<PaginatedQueryGroupMessagesResponse>>;
}
```

Then use `PaginatedMobileNotificationsClient` in `RetrieveEvidenceDeps`. If the local port is needed, import the response/result types from `@intexuraos/internal-clients/mobile-notifications-service` alongside `MobileNotificationsServiceClient`.

- [ ] **Step 8: Implement digest and raw-message collectors**

Add helper functions:

```typescript
async function collectDigestEvidence(input: {
  client: RetrieveEvidenceDeps['mobileNotificationsClient'];
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms: string[];
}): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  let cursor: string | undefined;
  do {
    const digestResult = await input.client.queryDigests(
      {
        userId: input.userId,
        groupKey: input.groupKey,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        terms: input.terms,
        limit: DIGEST_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      },
      { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
    );
    if (!digestResult.ok) return evidence;
    evidence.push(
      ...digestResult.value.items.map((item) => rankDigestEvidence(item, input.terms))
    );
    cursor = digestResult.value.nextCursor;
  } while (cursor !== undefined);
  return evidence;
}

async function collectRawMessageEvidence(input: {
  client: RetrieveEvidenceDeps['mobileNotificationsClient'];
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms: string[];
}): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];
  let cursor: string | undefined;
  do {
    const rawResult = await input.client.queryGroupMessages(
      {
        userId: input.userId,
        groupKey: input.groupKey,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        terms: input.terms,
        limit: GROUP_MESSAGE_PAGE_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      },
      { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
    );
    if (!rawResult.ok) return evidence;
    evidence.push(
      ...rawResult.value.messages.map((message) => rankRawMessageEvidence(message, input.terms))
    );
    cursor = rawResult.value.nextCursor;
  } while (cursor !== undefined);
  return evidence;
}
```

- [ ] **Step 9: Use collectors for every group**

Replace the current digest group block with:

```typescript
const groupsResult = await deps.mobileNotificationsClient.listDigestSubscriptions(
  { userId: input.userId },
  { timeoutMs: MOBILE_NOTIFICATIONS_TIMEOUT_MS }
);

if (groupsResult.ok) {
  const range = extractDateRange(input.question, deps.now);
  for (const group of groupsResult.value.items) {
    const [groupDigestEvidence, groupRawEvidence] = await Promise.all([
      collectDigestEvidence({
        client: deps.mobileNotificationsClient,
        userId: input.userId,
        groupKey: group.groupKey,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        terms,
      }),
      collectRawMessageEvidence({
        client: deps.mobileNotificationsClient,
        userId: input.userId,
        groupKey: group.groupKey,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        terms,
      }),
    ]);
    evidence.push(...groupDigestEvidence, ...groupRawEvidence);
  }
}
```

Remove `MAX_DIGEST_GROUPS`, `topDigestDates`, and the old top-3 date loop.

- [ ] **Step 10: Keep final ranking bounded**

Keep final selection bounded after full history has been scanned:

```typescript
const ranked = evidence
  .sort((left, right) => right.score - left.score)
  .slice(0, FINAL_EVIDENCE_LIMIT);
```

This gives the assistant access to all historical candidates during retrieval without dumping unbounded text into the model prompt.

- [ ] **Step 11: Run focused Fishing tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts apps/fishing-assistant-service/src/__tests__/promptAndRanking.test.ts
```

Expected: pass.

- [ ] **Step 12: Run workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- fishing-assistant-service
```

Expected: pass.

---

## Task 3: Integration Verification

**Files:**
- No additional files unless integration reveals type drift between subtasks.

- [ ] **Step 1: Confirm shared types and Fishing local types match**

After both subtasks are merged together, remove any temporary local structural workaround from `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts` if the shared `MobileNotificationsServiceClient` type now includes `cursor` and `nextCursor`.

- [ ] **Step 2: Run producer and consumer focused tests together**

Run:

```bash
pnpm vitest run packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/fishing-assistant-service/src/__tests__/sendChatMessage.test.ts apps/fishing-assistant-service/src/__tests__/promptAndRanking.test.ts
```

Expected: pass.

- [ ] **Step 3: Run tracked workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- internal-clients
pnpm run verify:workspace:tracked -- mobile-notifications-service
pnpm run verify:workspace:tracked -- fishing-assistant-service
```

Expected: pass.

- [ ] **Step 4: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: pass before any implementation PR is marked ready.

## Self-Review Checklist

- [ ] The plan removes every current retrieval limitation named in the issue analysis.
- [ ] The plan keeps prompt evidence bounded after full-history retrieval.
- [ ] The plan includes an "Endpoint Changes" section because HTTP endpoints change.
- [ ] The two subtasks are direct children of INT-1625 and have independent service/package ownership.
- [ ] No subtask depends on another Linear issue; both work from the explicit shared contract in this document.
