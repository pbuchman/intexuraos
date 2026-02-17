# INT-443: Add Internal Issues API to linear-agent

## Summary

Add two internal API endpoints to `linear-agent` that `code-agent` needs:

1. `POST /internal/issues` — Create a Linear issue
2. `PATCH /internal/issues/:issueId/state` — Update issue state

## Pre-Conditions

- [ ] `pnpm run ci:tracked` passes before starting
- [ ] On `development` branch with clean working directory
- [ ] Run `pnpm build` to ensure packages are built

---

## Phase 1: Extend LinearApiClient with updateIssueState

The existing `LinearApiClient` interface needs a new method to update issue state.

### Task 1.1: Add updateIssueState to domain ports

**File:** `apps/linear-agent/src/domain/ports.ts`

**Action:** Add a new method to the `LinearApiClient` interface (after `getIssue` method, around line 93):

```typescript
/** Update an issue's state */
updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string
): Promise<Result<LinearIssue, LinearError>>;
```

**Note:** The Linear SDK uses `stateId` (not state name). The route handler will need to map state names to state IDs.

### Task 1.2: Implement updateIssueState in linearApiClient.ts

**File:** `apps/linear-agent/src/infra/linear/linearApiClient.ts`

**Location:** Add after the `getIssue` method (around line 345)

**Implementation pattern:** Follow the same pattern as `createIssue`:

1. Get or create cached client using `getOrCreateClient(apiKey)`
2. Call `client.updateIssue(issueId, { stateId })`
3. Check `payload.success`
4. Fetch updated issue with `payload.issue`
5. Map to `LinearIssue` using `mapSingleIssue`
6. Return `ok(mapped)` or `err(mapLinearError(error))`

**Example structure:**

```typescript
async updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string
): Promise<Result<LinearIssue, LinearError>> {
  try {
    logger.info({ issueId, stateId }, 'Updating Linear issue state');
    const client = getOrCreateClient(apiKey);
    const payload = await client.updateIssue(issueId, { stateId });

    if (!payload.success) {
      return err({ code: 'API_ERROR', message: 'Failed to update issue state' });
    }

    const issue = await payload.issue;
    if (issue === undefined) {
      return err({ code: 'API_ERROR', message: 'Issue updated but could not fetch details' });
    }

    const mapped = await mapSingleIssue(issue);
    logger.info({ issueId, newState: mapped.state.name }, 'Issue state updated');
    return ok(mapped);
  } catch (error) {
    logger.error({ error: getErrorMessage(error) }, 'Failed to update Linear issue state');
    return err(mapLinearError(error));
  }
}
```

### Task 1.3: Update FakeLinearApiClient

**File:** `apps/linear-agent/src/__tests__/fakes.ts`

**Action:** Add `updateIssueState` method to `FakeLinearApiClient` class (after `getIssue` method):

```typescript
async updateIssueState(
  _apiKey: string,
  issueId: string,
  stateId: string
): Promise<Result<LinearIssue, LinearError>> {
  if (this.shouldFail) return err(this.failError);

  const issue = this.issues.find((i) => i.id === issueId);
  if (!issue) {
    return err({ code: 'API_ERROR', message: 'Issue not found' });
  }

  // Update the state (use stateId as name for simplicity in tests)
  issue.state = { id: stateId, name: stateId, type: 'started' };
  issue.updatedAt = new Date().toISOString();

  return ok(issue);
}
```

---

## Phase 2: Add Internal Routes

### Task 2.1: Create internalIssuesRoutes.ts

**File:** `apps/linear-agent/src/routes/internalIssuesRoutes.ts` (NEW FILE)

**Purpose:** Handle `POST /internal/issues` and `PATCH /internal/issues/:issueId/state`

**Structure:**

```typescript
/**
 * Internal API routes for issue management (service-to-service).
 * Used by code-agent to create and update Linear issues.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

// Types for request bodies
interface CreateIssueBody {
  title: string;
  description: string;
  labels?: string[];
}

interface UpdateStateBody {
  state: 'backlog' | 'in_progress' | 'in_review' | 'qa';
}

interface IssueIdParams {
  issueId: string;
}

export const internalIssuesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/issues - Create issue
  // PATCH /internal/issues/:issueId/state - Update state

  done();
};
```

### Task 2.2: Implement POST /internal/issues

**File:** `apps/linear-agent/src/routes/internalIssuesRoutes.ts`

**Logic flow:**

1. Call `logIncomingRequest(request)`
2. Validate internal auth with `validateInternalAuth(request)`
3. Extract `userId` from `request.headers['x-user-id']` (code-agent must send this)
4. Get services: `connectionRepository` and `linearApiClient`
5. Get user's API key: `connectionRepository.getApiKey(userId)`
6. Get user's connection for `teamId`: `connectionRepository.getFullConnection(userId)`
7. If not connected, return 403 with `NOT_CONNECTED` error
8. Create issue via `linearApiClient.createIssue(apiKey, { teamId, title, description, priority: 0 })`
9. Return success response matching code-agent's expected format:
   ```json
   {
     "success": true,
     "data": {
       "id": "issue-uuid",
       "identifier": "INT-123",
       "title": "Issue title",
       "url": "https://linear.app/..."
     }
   }
   ```

**OpenAPI schema properties:**

- operationId: `createIssueInternal`
- summary: `Create a Linear issue (internal)`
- tags: `['internal']`
- Request body: `{ title: string, description: string, labels?: string[] }`
- Response 200: `{ success: true, data: { id, identifier, title, url } }`
- Response 401: Unauthorized
- Response 403: Not connected to Linear
- Response 500: Internal error

**Headers to expect:**

- `X-Internal-Auth`: Internal auth token (validated by `validateInternalAuth`)
- `X-User-Id`: User ID for whose Linear connection to use

### Task 2.3: Implement PATCH /internal/issues/:issueId/state

**File:** `apps/linear-agent/src/routes/internalIssuesRoutes.ts`

**Logic flow:**

1. Call `logIncomingRequest(request)`
2. Validate internal auth with `validateInternalAuth(request)`
3. Extract `userId` from `request.headers['x-user-id']`
4. Extract `issueId` from `request.params.issueId`
5. Extract `state` from `request.body.state`
6. Get user's API key and connection
7. Map state name to Linear state ID (need to fetch team's workflow states)
8. Call `linearApiClient.updateIssueState(apiKey, issueId, stateId)`
9. Return `{ success: true, data: {} }`

**State mapping challenge:**
Linear uses workflow state IDs, not names. Options:

- **Option A (simpler):** Fetch team's states on each request, find matching state by name
- **Option B (better perf):** Cache team states, refresh periodically

For initial implementation, use Option A. The flow:

1. Get team workflow states: `client.workflowStates({ filter: { team: { id: { eq: teamId } } } })`
2. Find state matching the requested state name (map `in_progress` → "In Progress", etc.)
3. Use that state's ID

**State name mapping:**
| Request state | Linear state name (typical) |
| --------------- | --------------------------- |
| `backlog` | "Backlog" |
| `in_progress` | "In Progress" |
| `in_review` | "In Review" |
| `qa` | "QA" or "In QA" |

### Task 2.4: Add helper for state lookup

**File:** `apps/linear-agent/src/infra/linear/linearApiClient.ts`

**Add new method to LinearApiClient interface** in `ports.ts`:

```typescript
/** Get workflow states for a team */
getWorkflowStates(apiKey: string, teamId: string): Promise<Result<WorkflowState[], LinearError>>;
```

**Add WorkflowState type** to `models.ts`:

```typescript
export interface WorkflowState {
  id: string;
  name: string;
  type: IssueStateCategory;
}
```

**Implement in linearApiClient.ts:**

```typescript
async getWorkflowStates(
  apiKey: string,
  teamId: string
): Promise<Result<WorkflowState[], LinearError>> {
  try {
    const client = getOrCreateClient(apiKey);
    const states = await client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
    });

    return ok(states.nodes.map(s => ({
      id: s.id,
      name: s.name,
      type: mapIssueStateType(s.type),
    })));
  } catch (error) {
    return err(mapLinearError(error));
  }
}
```

### Task 2.5: Register routes in server.ts

**File:** `apps/linear-agent/src/server.ts`

**Action:** Import and register the new routes:

1. Add import at top:

   ```typescript
   import { internalIssuesRoutes } from './routes/internalIssuesRoutes.js';
   ```

2. Register after existing routes (look for where `internalRoutes` is registered):
   ```typescript
   await fastify.register(internalIssuesRoutes);
   ```

---

## Phase 3: Update code-agent HTTP Client

### Task 3.1: Add X-User-Id header to requests

**File:** `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`

**Problem:** The current client doesn't send the user ID. The linear-agent needs to know which user's Linear connection to use.

**Action:** Update `LinearAgentHttpClientConfig` interface to include `userId` callback or pass it per-request.

**Option A (per-request userId):** Change the interface methods to accept userId:

```typescript
createIssue(userId: string, request: CreateIssueRequest): Promise<...>
```

**Option B (cleaner):** Keep userId in request object. Update `CreateIssueRequest`:

```typescript
export interface CreateIssueRequest {
  userId: string; // ADD THIS
  title: string;
  description: string;
  labels?: string[];
}
```

Then in the fetch call, add header:

```typescript
headers: {
  'Content-Type': 'application/json',
  'X-Internal-Auth': internalAuthToken,
  'X-User-Id': request.userId,  // ADD THIS
},
```

### Task 3.2: Update CreateIssueRequest type

**File:** `apps/code-agent/src/domain/ports/linearAgentClient.ts`

**Action:** Add `userId` field to `CreateIssueRequest`:

```typescript
export interface CreateIssueRequest {
  userId: string;
  title: string;
  description: string;
  labels?: string[];
}
```

### Task 3.3: Update callers of createIssue

**Search for:** `linearAgentClient.createIssue` or `createIssue({`

**Files likely affected:**

- Use case that creates Linear issues for code tasks
- Tests that mock the client

---

## Phase 4: Write Tests

### Task 4.1: Create internalIssuesRoutes.test.ts

**File:** `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts` (NEW FILE)

**Test cases for POST /internal/issues:**

1. Success - creates issue and returns expected response format
2. Returns 401 when X-Internal-Auth is missing
3. Returns 403 when user not connected to Linear
4. Returns 400 when title is missing
5. Returns 500 when Linear API fails

**Test cases for PATCH /internal/issues/:issueId/state:**

1. Success - updates state and returns success
2. Returns 401 when X-Internal-Auth is missing
3. Returns 403 when user not connected
4. Returns 400 when state is invalid
5. Returns 404 when issue not found
6. Returns 500 when Linear API fails

**Test setup pattern:** Follow existing patterns from `apps/linear-agent/src/__tests__/routes/linearRoutes.test.ts`:

- Use `setServices()` with fakes in `beforeEach`
- Use `resetServices()` in `afterEach`
- Use `app.inject()` for route testing

### Task 4.2: Add FakeLinearApiClient.getWorkflowStates

**File:** `apps/linear-agent/src/__tests__/fakes.ts`

**Action:** Add method to FakeLinearApiClient:

```typescript
private workflowStates: WorkflowState[] = [
  { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
  { id: 'state-progress', name: 'In Progress', type: 'started' },
  { id: 'state-review', name: 'In Review', type: 'started' },
  { id: 'state-qa', name: 'QA', type: 'started' },
];

async getWorkflowStates(
  _apiKey: string,
  _teamId: string
): Promise<Result<WorkflowState[], LinearError>> {
  if (this.shouldFail) return err(this.failError);
  return ok(this.workflowStates);
}
```

### Task 4.3: Update code-agent tests

**Files to update:**

- `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`

**Action:** Update tests to include `userId` in request objects and verify the header is sent.

---

## Phase 5: Final Verification

### Task 5.1: Run targeted verification

```bash
pnpm run verify:workspace:tracked -- linear-agent
pnpm run verify:workspace:tracked -- code-agent
```

### Task 5.2: Run full CI

```bash
pnpm run ci:tracked
```

### Task 5.3: Manual integration test

1. Start local dev: `pnpm run dev`
2. Verify routes exist:
   ```bash
   curl -X POST http://localhost:8126/internal/issues \
     -H "Content-Type: application/json" \
     -H "X-Internal-Auth: test-internal-token" \
     -H "X-User-Id: test-user" \
     -d '{"title": "Test", "description": "Test desc"}'
   ```
   Expected: 403 (not connected) or success if user is connected

---

## File Summary

| File                                                                     | Action                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `apps/linear-agent/src/domain/ports.ts`                                  | Add `updateIssueState`, `getWorkflowStates` to interface |
| `apps/linear-agent/src/domain/models.ts`                                 | Add `WorkflowState` type                                 |
| `apps/linear-agent/src/infra/linear/linearApiClient.ts`                  | Implement new methods                                    |
| `apps/linear-agent/src/routes/internalIssuesRoutes.ts`                   | NEW: Create internal issues routes                       |
| `apps/linear-agent/src/server.ts`                                        | Register new routes                                      |
| `apps/linear-agent/src/__tests__/fakes.ts`                               | Update FakeLinearApiClient                               |
| `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`    | NEW: Route tests                                         |
| `apps/code-agent/src/domain/ports/linearAgentClient.ts`                  | Add `userId` to request                                  |
| `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`                | Send `X-User-Id` header                                  |
| `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts` | Update tests                                             |

---

## Commit Strategy

1. **Commit 1:** Phase 1 - Extend LinearApiClient
2. **Commit 2:** Phase 2 - Add internal routes
3. **Commit 3:** Phase 3 - Update code-agent client
4. **Commit 4:** Phase 4 - Add tests

Each commit should pass `pnpm run ci:tracked` before proceeding.
