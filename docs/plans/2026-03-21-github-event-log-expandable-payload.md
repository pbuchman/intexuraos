# GitHub Event Log — Expandable Rows with Raw Webhook Payload

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each GitHub Event Log row expandable so users can view the raw webhook payload as formatted JSON.

**Architecture:** A new JWT-authenticated GET endpoint in code-agent returns the raw payload for a given event log entry. The frontend adds click-to-expand behavior to each row, lazy-loads the payload on first expand, caches it in component state, and renders it as formatted JSON below the row.

**Tech Stack:** Fastify (backend), React + TailwindCSS (frontend), Firestore (`github-webhook-audit-events` collection), lucide-react icons.

---

## Design Decisions

### Endpoint path: `/code/github-event-log/:id/payload` (not `/internal/.../:deliveryId/...`)

The original issue suggested `GET /internal/github-event-log/:deliveryId/payload`. This plan uses `GET /code/github-event-log/:id/payload` instead, for two reasons:

1. **Auth model:** The frontend calls this endpoint — it needs JWT authentication (the `/code/` prefix pattern), not internal service-to-service auth (`/internal/` prefix with `X-Internal-Auth`).
2. **Lookup efficiency:** The audit event document ID in `github-webhook-audit-events` matches the event log entry ID. Using the entry's `id` (which the frontend already has as `row.id`) enables a direct Firestore document lookup. Using `deliveryId` would require a Firestore field query, and `deliveryId` can be `null` for some entries.

### Payload caching

Payload is cached in component-level React state inside `GitHubEventLogTableRow`. No hook or context needed — each row manages its own payload independently. This avoids re-fetching on collapse/re-expand.

---

## Endpoint Changes

**Created:**
- `GET /code/github-event-log/:id/payload` — Returns the raw webhook payload for an event log entry. JWT-authenticated. Returns `{ success: true, data: { payload: unknown } }` on success, 404 if the audit event doesn't exist or has no payload.

**Modified:** None
**Removed:** None
**Unchanged:** `GET /code/github-event-log`, `POST /code/github-event-log/rows`

---

## File Structure

### Backend (code-agent)

| File                                                                 | Action   | Responsibility                                                                                          |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/code/github-event-log.ts`                | Modify   | Add `GET /code/github-event-log/:id/payload` route handler inside the existing `secured` register block |
| `apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts` | Modify   | Add test cases for the new payload endpoint                                                             |

### Frontend (web)

| File                                                   | Action   | Responsibility                                             |
| ------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `apps/web/src/services/codeAgentApi.ts`                | Modify   | Add `getGitHubEventLogPayload(accessToken, id)` function   |
| `apps/web/src/components/GitHubEventLogTableRow.tsx`   | Modify   | Add expand/collapse toggle, payload fetching, JSON display |
| `apps/web/src/services/__tests__/codeAgentApi.test.ts` | Modify   | Add tests for the new API function                         |

---

## Contract Between Subtasks

The two subtasks (backend and frontend) share this contract and can be implemented in parallel:

### API Contract

```
GET /code/github-event-log/:id/payload
Authorization: Bearer <JWT>

Success (200):
{
  "success": true,
  "data": {
    "payload": <any valid JSON value — the raw webhook body>
  }
}

Not Found (404):
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Audit event not found for entry <id>"
  }
}

Unauthorized (401):
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "..."
  }
}

Internal Error (500):
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "..."
  }
}
```

### Shared Types (already exist)

- `GitHubEventLogRow.id: string` — the entry ID, used as the `:id` URL parameter
- `GitHubEventLogRow.deliveryId: string | null` — informational only, not used for lookup
- Error/success response shapes follow the existing `rowsResponseSchema` / `errorResponseSchema` patterns

---

## Task 1: Backend — Payload Endpoint (apps/code-agent)

**Files:**
- Modify: `apps/code-agent/src/routes/code/github-event-log.ts`
- Modify: `apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts`

### Step 1.1: Write failing test — returns payload for valid entry ID

- [ ] Add a new `describe('GET /code/github-event-log/:id/payload')` block in the existing test file.

```typescript
describe('GET /code/github-event-log/:id/payload', () => {
  it('returns raw payload for a valid entry ID with existing audit event', async () => {
    // Seed an audit event with a known payload
    const entryId = 'test-entry-id';
    const testPayload = {
      action: 'opened',
      pull_request: { number: 42, title: 'Test PR' },
    };

    await fakeFirestore
      .collection('github-webhook-audit-events')
      .doc(entryId)
      .set({
        deliveryId: 'gh-delivery-123',
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'owner/repo',
        repositoryId: 1,
        pullRequestNumber: 42,
        pullRequestId: 100,
        senderLogin: 'testuser',
        senderId: 1,
        senderType: 'User',
        authPassedAt: new Date(),
        receivedAt: new Date(),
        normalizationStatus: 'normalized',
        payload: testPayload,
      });

    const response = await server.inject({
      method: 'GET',
      url: `/code/github-event-log/${entryId}/payload`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { payload: unknown } };
    expect(body.success).toBe(true);
    expect(body.data.payload).toEqual(testPayload);
  });
});
```

- [ ] Run test to verify it fails:

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts -t "returns raw payload"
```

Expected: FAIL — route not found (404 from Fastify routing, not our custom 404).

### Step 1.2: Write failing test — returns 404 for unknown entry ID

- [ ] Add test case in the same describe block:

```typescript
it('returns 404 when audit event does not exist', async () => {
  const response = await server.inject({
    method: 'GET',
    url: '/code/github-event-log/nonexistent-id/payload',
    headers: { authorization: 'Bearer valid-token' },
  });

  expect(response.statusCode).toBe(404);
  const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('NOT_FOUND');
});
```

### Step 1.3: Write failing test — requires authentication

- [ ] Add test case:

```typescript
it('returns 401 when no auth token is provided', async () => {
  const response = await server.inject({
    method: 'GET',
    url: '/code/github-event-log/some-id/payload',
  });

  expect(response.statusCode).toBe(401);
});
```

### Step 1.4: Write failing test — returns null payload when audit event exists but payload is null

- [ ] Add test case:

```typescript
it('returns null payload when audit event exists with null payload', async () => {
  const entryId = 'entry-null-payload';

  await fakeFirestore
    .collection('github-webhook-audit-events')
    .doc(entryId)
    .set({
      deliveryId: null,
      githubEventName: 'pull_request',
      eventType: 'pull_request',
      action: 'opened',
      repository: 'owner/repo',
      repositoryId: 1,
      pullRequestNumber: null,
      pullRequestId: null,
      senderLogin: null,
      senderId: null,
      senderType: null,
      authPassedAt: new Date(),
      receivedAt: new Date(),
      normalizationStatus: 'normalized',
      payload: null,
    });

  const response = await server.inject({
    method: 'GET',
    url: `/code/github-event-log/${entryId}/payload`,
    headers: { authorization: 'Bearer valid-token' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body) as { success: boolean; data: { payload: unknown } };
  expect(body.success).toBe(true);
  expect(body.data.payload).toBeNull();
});
```

### Step 1.5: Write failing test — returns 500 when audit event repo is not configured

- [ ] Add test case:

```typescript
it('returns 500 when audit event repository is not configured', async () => {
  setServices({ ...baseServices, gitHubWebhookAuditEventRepo: undefined });
  server = await buildServer();

  const response = await server.inject({
    method: 'GET',
    url: '/code/github-event-log/some-id/payload',
    headers: { authorization: 'Bearer valid-token' },
  });

  expect(response.statusCode).toBe(500);
  const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('INTERNAL_ERROR');
});
```

### Step 1.6: Implement the route handler

- [ ] In `apps/code-agent/src/routes/code/github-event-log.ts`, add the following inside the `secured.register()` callback, after the existing `secured.post(...)` block:

```typescript
const payloadParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
};

const payloadResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      properties: {
        payload: {},  // any JSON value
      },
      required: ['payload'],
    },
  },
  required: ['success', 'data'],
};

secured.get<{
  Params: { id: string };
}>(
  '/code/github-event-log/:id/payload',
  {
    schema: {
      params: payloadParamsSchema,
      response: {
        200: payloadResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  },
  async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    logIncomingRequest(request, {
      message: 'Received request to GET /code/github-event-log/:id/payload',
    });

    const { gitHubWebhookAuditEventRepo } = getServices();
    if (gitHubWebhookAuditEventRepo === undefined) {
      return await reply.fail('INTERNAL_ERROR', 'Audit event repository is not configured');
    }

    const result = await gitHubWebhookAuditEventRepo.findByIds([request.params.id]);
    if (!result.ok) {
      request.log.error({ error: result.error }, 'Failed to load audit event');
      return await reply.fail('INTERNAL_ERROR', 'Failed to load audit event');
    }

    const auditEvent = result.value[0];
    if (auditEvent === undefined) {
      return await reply.fail('NOT_FOUND', `Audit event not found for entry ${request.params.id}`);
    }

    return await reply.ok({ payload: auditEvent.payload });
  }
);
```

- [ ] Run all tests to verify they pass:

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts
```

Expected: ALL PASS.

### Step 1.7: Verify coverage

- [ ] Run coverage check:

```bash
cd /repo && pnpm run verify:workspace:tracked -- code-agent
```

Expected: Coverage thresholds met. If any branch is uncovered, add appropriate `/* v8 ignore */` with valid category and blocker reason.

### Step 1.8: Commit

```bash
git add apps/code-agent/src/routes/code/github-event-log.ts apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts
git commit -m "feat(code-agent): add GET /code/github-event-log/:id/payload endpoint

Returns raw webhook payload for a given event log entry by looking up the
audit event in github-webhook-audit-events. JWT-authenticated, returns 404
if the audit event doesn't exist.

INT-1027"
```

---

## Task 2: Frontend — Expandable Rows with Payload Display (apps/web)

**Files:**
- Modify: `apps/web/src/services/codeAgentApi.ts`
- Modify: `apps/web/src/services/__tests__/codeAgentApi.test.ts`
- Modify: `apps/web/src/components/GitHubEventLogTableRow.tsx`

### Step 2.1: Add API function — `getGitHubEventLogPayload`

- [ ] In `apps/web/src/services/codeAgentApi.ts`, add the following after `hydrateGitHubEventLogRows`:

```typescript
export interface GitHubEventLogPayloadResponse {
  success: boolean;
  data: {
    payload: unknown;
  };
}

export async function getGitHubEventLogPayload(
  accessToken: string,
  id: string
): Promise<GitHubEventLogPayloadResponse> {
  return await apiRequest<GitHubEventLogPayloadResponse>(
    config.codeAgentUrl,
    `/code/github-event-log/${encodeURIComponent(id)}/payload`,
    accessToken,
  );
}
```

- [ ] Add the type export to `apps/web/src/types/index.ts` if needed (or keep it co-located in `codeAgentApi.ts` since it's only used there).

### Step 2.2: Add test for the new API function

- [ ] In `apps/web/src/services/__tests__/codeAgentApi.test.ts`, add:

```typescript
import { getGitHubEventLogPayload } from '../codeAgentApi.js';

describe('getGitHubEventLogPayload', () => {
  it('fetches payload for a given entry ID', async () => {
    const mockPayload = { action: 'opened', number: 42 };

    // Mock uses the same vi.mock('../apiClient.js') pattern at the top of this test file.
    // apiRequest is already mocked — set return value for this test:
    const { apiRequest } = await import('../apiClient.js');
    const mockedApiRequest = vi.mocked(apiRequest);
    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: { payload: mockPayload },
    });

    const result = await getGitHubEventLogPayload('test-token', 'entry-123');
    expect(result.data.payload).toEqual(mockPayload);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      expect.any(String),
      '/code/github-event-log/entry-123/payload',
      'test-token',
    );
  });

  it('encodes the ID in the URL path', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const mockedApiRequest = vi.mocked(apiRequest);
    mockedApiRequest.mockResolvedValueOnce({
      success: true,
      data: { payload: null },
    });

    await getGitHubEventLogPayload('test-token', 'id/with/slashes');
    expect(mockedApiRequest).toHaveBeenCalledWith(
      expect.any(String),
      '/code/github-event-log/id%2Fwith%2Fslashes/payload',
      'test-token',
    );
  });
});
```

**Note:** The import of `getGitHubEventLogPayload` must also be added to the existing import block at the top of the test file.

- [ ] Run tests:

```bash
cd /repo && pnpm vitest run apps/web/src/services/__tests__/codeAgentApi.test.ts
```

### Step 2.3: Add expand/collapse + payload display to GitHubEventLogTableRow

- [ ] Modify `apps/web/src/components/GitHubEventLogTableRow.tsx`:

**Add imports:**
```typescript
import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/context';
import { getGitHubEventLogPayload } from '@/services/codeAgentApi';
```

**Replace the component function** with expand/collapse logic:

Key changes:
1. Add state: `isExpanded`, `payload`, `payloadFetched`, `payloadLoading`, `payloadError`
2. Add a click handler that toggles `isExpanded` and lazy-fetches payload on first expand
3. Add a chevron icon (rotates when expanded) as the first element in the row
4. Add an expanded section below the row with formatted JSON in `<pre><code>`
5. Update the grid columns to accommodate the chevron (add a small column at the start)
6. Cache payload in state so re-expand doesn't re-fetch (use `payloadFetched` flag, NOT `payload === null`, because the backend can legitimately return `null` as the payload value)
7. Show loading spinner while fetching, error message on failure

**Desktop grid column update:**
```
lg:grid-cols-[24px_80px_160px_120px_100px_1fr_220px]
```
(Added 24px column for the chevron.)

**Chevron element (first column):**
```tsx
<button
  type="button"
  onClick={handleToggle}
  className="flex h-full items-center justify-center text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
  aria-label={isExpanded ? 'Collapse payload' : 'Expand payload'}
>
  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
</button>
```

**Expanded payload section (rendered ONCE, after BOTH the desktop `hidden lg:grid` div and the mobile `lg:hidden` div, inside the outer container div):**

**Important:** Do NOT duplicate this section for desktop and mobile. Place it once after both layout divs — it will be visible regardless of viewport because it's not wrapped in any responsive visibility class.
```tsx
{isExpanded ? (
  <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
    {payloadLoading ? (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading payload…
      </div>
    ) : payloadError !== null ? (
      <p className="text-xs text-red-500">{payloadError}</p>
    ) : (
      <pre className="max-h-96 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <code>{JSON.stringify(payload, null, 2)}</code>
      </pre>
    )}
  </div>
) : null}
```

**Toggle handler:**

**Important:** `useAuth()` returns `getAccessToken: () => Promise<string>`, NOT an `accessToken` property. Every component in the codebase uses this async pattern.

```typescript
const { getAccessToken } = useAuth();

const [isExpanded, setIsExpanded] = useState(false);
const [payload, setPayload] = useState<unknown>(null);
const [payloadFetched, setPayloadFetched] = useState(false);
const [payloadLoading, setPayloadLoading] = useState(false);
const [payloadError, setPayloadError] = useState<string | null>(null);

const handleToggle = async (): Promise<void> => {
  // Use payloadFetched flag (NOT payload === null) because the backend
  // can legitimately return null as the payload value.
  if (!isExpanded && !payloadFetched && !payloadLoading) {
    setPayloadLoading(true);
    setPayloadError(null);
    try {
      const token = await getAccessToken();
      const result = await getGitHubEventLogPayload(token, row.id);
      setPayload(result.data.payload);
      setPayloadFetched(true);
    } catch {
      setPayloadError('Failed to load payload');
    } finally {
      setPayloadLoading(false);
    }
  }
  setIsExpanded((prev) => !prev);
};
```

**Important memo update:** The `memo` equality check at the bottom needs updating. Since the component now has internal state (expand/payload), the memo check remains on `prevProps.row === nextProps.row` — internal state changes are handled by React's own state mechanism, not props. No change needed to the memo wrapper.

**Mobile row:** Add the same chevron `<button>` as the first element in the mobile `lg:hidden` flex layout. The expanded payload section is already shared between both layouts (rendered once after both divs), so no duplication is needed.

### Step 2.4: Update ColumnHeader in GitHubEventLogPage

- [ ] In `apps/web/src/pages/GitHubEventLogPage.tsx`, update the `ColumnHeader` component's grid to match the new column layout:

```
lg:grid-cols-[24px_80px_160px_120px_100px_1fr_220px]
```

Add an empty first header cell for the chevron column.

### Step 2.5: Verify the build compiles

```bash
cd /repo && pnpm build --filter=web
```

Expected: Build succeeds with no TypeScript errors.

### Step 2.6: Commit

```bash
git add apps/web/src/services/codeAgentApi.ts apps/web/src/services/__tests__/codeAgentApi.test.ts apps/web/src/components/GitHubEventLogTableRow.tsx apps/web/src/pages/GitHubEventLogPage.tsx
git commit -m "feat(web): add expandable rows to GitHub Event Log with raw payload

Each row in the event log can now be clicked to expand and show the raw
webhook payload as formatted JSON. Payload is lazy-loaded on first expand
and cached in component state.

INT-1027"
```

---

## Final Verification

After both tasks are complete:

```bash
cd /repo && pnpm run ci:tracked
```

Expected: All checks pass across all workspaces.
