# Research List Performance Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the `GET /research` list endpoint latency from 500-1400ms to under 200ms by eliminating full-document transfers and optimizing Firestore query patterns.

**Architecture:** Introduce a "summary" projection for list queries that returns only the 8 fields needed by the UI (instead of all 35+ fields including huge text blobs). Merge the two-query favourite/non-favourite pattern into a single Firestore query. Add optimistic UI updates on the frontend to eliminate unnecessary full-list re-fetches.

**Tech Stack:** Firestore (Node.js Admin SDK), Fastify, React, TypeScript

---

## Current Performance Benchmarks (Production)

| Metric                                  | Current Value                    | Target                 |
| --------------------------------------- | -------------------------------- | ---------------------- |
| `GET /research?limit=50` latency (warm) | 500-1400ms                       | < 200ms                |
| `GET /research/:id` latency             | 40-130ms                         | No change needed       |
| Cold start penalty                      | 15-26s                           | Out of scope (infra)   |
| Response payload size (50 items)        | ~500KB-2MB (full docs)           | ~15-30KB (summaries)   |
| Firestore reads per list request        | 2 queries + 0-2 cursor doc reads | 1 query                |
| Full re-fetch after favourite toggle    | Yes (full list reload)           | No (optimistic update) |

## Root Cause Analysis

### Problem 1: Full Document Transfer (CRITICAL - ~70% of latency)

**File:** `apps/research-agent/src/infra/research/FirestoreResearchRepository.ts:51-155`

The `findByUserId()` method reads entire Research documents from Firestore. Each document contains:

- `synthesizedResult`: Tens of thousands of characters of markdown (the full synthesis output)
- `llmResults[].result`: Full LLM response text for each of 2-5 models (each can be 5,000-20,000+ chars)
- `inputContexts[].content`: Up to 5 contexts x 60,000 characters each (max 300KB per document!)
- `researchContext`: Complex nested object with domain analysis
- `prompt`: Full research question text

**The list page only uses these fields from each Research:** `id`, `title`, `status`, `selectedModels`, `startedAt`, `completedAt`, `favourite`

**Impact:** Firestore charges per document read regardless of fields, but network transfer and JSON serialization of 50 full documents (potentially megabytes) dominates the 500-1400ms latency. There is no `.select()` field projection anywhere in the research-agent codebase (confirmed by grep).

### Problem 2: Two-Query Pagination Pattern (MODERATE - ~20% of latency)

**File:** `apps/research-agent/src/infra/research/FirestoreResearchRepository.ts:82-134`

Every list request executes TWO Firestore queries:
1. **Favourites query** (line 84-88): `where(userId) + where(favourite==true) + orderBy(startedAt, desc)`
2. **Non-favourites query** (line 116-120): `where(userId) + where(favourite==false) + orderBy(startedAt, desc)`

Additionally, when paginating with a cursor, EXTRA `.get()` calls fetch the cursor document (lines 91, 124) to use `startAfter()`.

**Impact:** 2 round-trips to Firestore per page load (3-4 when paginating). Could be reduced to 1 with a single unified query that sorts favourites first using the existing composite index `(userId, favourite ASC, startedAt DESC)`.

### Problem 3: Full List Re-fetch After Favourite Toggle (MODERATE - UX impact)

**File:** `apps/web/src/pages/ResearchListPage.tsx:347-361`

`handleToggleFavourite` calls `await refresh()` after each toggle. The `refresh()` function (in `useResearches` hook, line 221-255) re-fetches the entire first page of 50 full research documents from the API. The toggle API (`PATCH /research/:id/favourite`) already returns the updated Research object, but this response is discarded.

**Impact:** Every star click triggers a 500-1400ms full reload. Should be an instant optimistic UI update.

### Problem 4: No API Response Projection (MODERATE - bandwidth)

**File:** `apps/research-agent/src/routes/schemas/common.ts:125-176`

The `researchSchema` used for list responses includes every field. The route handler at `apps/research-agent/src/routes/researchRoutes.ts:705` sends `result.value` as-is with no field stripping. Even if Firestore projection is added, the JSON serialization overhead of unnecessary fields remains.

### Problem 5: Visibility Change Full Refresh (OUT OF SCOPE)

**File:** `apps/web/src/hooks/useResearch.ts:267-279`

Every tab switch triggers `refresh(false)` which re-fetches the full list. With the summary endpoint this becomes significantly cheaper (~15-30KB vs ~500KB-2MB), which reduces the impact from MODERATE to LOW.

> **Out of scope:** A debounce or stale-while-revalidate optimization is deferred to a follow-up Linear issue. The summary projection already mitigates the worst of this problem (payload reduction makes the refresh near-instant). A follow-up issue should be created during implementation to track this.

## Existing Indexes (Confirmed in `firestore.indexes.json`)

| Index              | Fields                                        | Used By                                   |
| ------------------ | --------------------------------------------- | ----------------------------------------- |
| Index 1 (line 146) | `(userId ASC, startedAt DESC)`                | Legacy list query                         |
| Index 2 (line 160) | `(userId ASC, status ASC, createdAt DESC)`    | Status filtering (unused in current list) |
| Index 3 (line 417) | `(userId ASC, favourite ASC, startedAt DESC)` | Current favourite-first pagination        |

**Missing index:** None needed. Index 3 already supports a single unified query with `orderBy('favourite', 'desc').orderBy('startedAt', 'desc')` which would sort favourites first and then by date — replacing the two-query pattern. However, the current index has `favourite ASC` — we need it to be `favourite DESC` for favourites-first. **A new composite index is needed: `(userId ASC, favourite DESC, startedAt DESC)`.**

---

## Endpoint Changes

### Modified
- `GET /research` — Returns summary projections instead of full documents for list items

### Created
- None (we modify the existing endpoint behavior)

### Removed
- None

### Unchanged
- `GET /research/:id` — Still returns full research document
- All other endpoints

---

## Task 1: Backend — Add Summary Projection to Repository (research-agent)

**Files:**
- Modify: `apps/research-agent/src/domain/research/ports/repository.ts`
- Modify: `apps/research-agent/src/domain/research/models/Research.ts`
- Modify: `apps/research-agent/src/infra/research/FirestoreResearchRepository.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/listResearches.ts`
- Modify: `apps/research-agent/src/routes/schemas/common.ts`
- Modify: `apps/research-agent/src/routes/schemas/researchSchemas.ts`
- Modify: `apps/research-agent/src/routes/researchRoutes.ts`
- Create: `migrations/XXX_research-list-optimized-index.mjs` (for new composite index)
- Modify: `firestore.indexes.json`
- Test: `apps/research-agent/src/infra/research/FirestoreResearchRepository.test.ts`
- Test: `apps/research-agent/src/domain/research/usecases/listResearches.test.ts`
- Test: `apps/research-agent/src/routes/researchRoutes.test.ts`

### Step 1.1: Define `ResearchSummary` type

- [ ] **Add `ResearchSummary` type to the domain model**

In `apps/research-agent/src/domain/research/models/Research.ts`, add:

```typescript
/**
 * Lightweight projection of Research for list views.
 * Contains only the fields needed to render a research card in the list page.
 * Avoids transferring large text fields (synthesizedResult, llmResults[].result, inputContexts[].content).
 */
export interface ResearchSummary {
  id: string;
  userId: string;
  title: string;
  status: ResearchStatus;
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel;
  startedAt: string;
  completedAt?: string;
  favourite?: boolean;
  /** Model-level statuses for progress indication (no result text) */
  llmResultStatuses: { provider: LlmProvider; model: string; status: LlmResultStatus }[];
  totalCostUsd?: number;
  partialFailure?: PartialFailure;
}
```

Export it from `apps/research-agent/src/domain/research/models/index.ts`.

### Step 1.2: Update repository port

- [ ] **Add `findSummariesByUserId` to repository interface**

In `apps/research-agent/src/domain/research/ports/repository.ts`, add:

```typescript
import type { ResearchSummary } from '../models/index.js';

// Add to ResearchRepository interface:
findSummariesByUserId(
  userId: string,
  options?: { limit?: number; cursor?: string }
): Promise<Result<{ items: ResearchSummary[]; nextCursor?: string }, RepositoryError>>;
```

### Step 1.3: Implement with `.select()` and single-query pagination

- [ ] **Write failing test for `findSummariesByUserId`**

The test should verify:
1. Returns only summary fields (not `synthesizedResult`, not `llmResults[].result`, not `inputContexts`)
2. Returns favourites first, then non-favourites, both sorted by `startedAt` desc
3. Cursor-based pagination works across a single query
4. `llmResultStatuses` contains only provider/model/status (no result text)

- [ ] **Run test to verify it fails**

Run: `pnpm --filter research-agent test -- --run -t "findSummariesByUserId"`
Expected: FAIL

- [ ] **Implement `findSummariesByUserId` in `FirestoreResearchRepository`**

```typescript
async findSummariesByUserId(
  userId: string,
  options?: { limit?: number; cursor?: string }
): Promise<Result<{ items: ResearchSummary[]; nextCursor?: string }, RepositoryError>> {
  try {
    const db = getFirestore();
    const collection = db.collection(this.collectionName);
    const limit = options?.limit ?? 50;

    // Single unified query: favourites first (DESC), then by startedAt DESC
    // Uses composite index: (userId ASC, favourite DESC, startedAt DESC)
    let query = collection
      .where('userId', '==', userId)
      .orderBy('favourite', 'desc')
      .orderBy('startedAt', 'desc')
      .select(
        'id', 'userId', 'title', 'status', 'selectedModels', 'synthesisModel',
        'startedAt', 'completedAt', 'favourite', 'llmResults', 'totalCostUsd',
        'partialFailure'
      )
      .limit(limit + 1);

    if (options?.cursor !== undefined && options.cursor !== '') {
      const startDoc = await collection.doc(options.cursor).get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.map((doc) => {
      const data = doc.data() as Research;
      const summary: ResearchSummary = {
        id: data.id,
        userId: data.userId,
        title: data.title,
        status: data.status,
        selectedModels: data.selectedModels,
        synthesisModel: data.synthesisModel,
        startedAt: data.startedAt,
        favourite: data.favourite,
        llmResultStatuses: (data.llmResults ?? []).map((r) => ({
          provider: r.provider,
          model: r.model,
          status: r.status,
        })),
        totalCostUsd: data.totalCostUsd,
        partialFailure: data.partialFailure,
      };
      if (data.completedAt !== undefined) {
        summary.completedAt = data.completedAt;
      }
      return summary;
    });

    const items = docs.slice(0, limit);
    const lastItem = items[items.length - 1];
    const nextCursor = docs.length > limit && lastItem !== undefined
      ? lastItem.id
      : undefined;

    return nextCursor !== undefined
      ? ok({ items, nextCursor })
      : ok({ items });
  } catch (error) {
    return err({
      code: 'FIRESTORE_ERROR',
      message: getErrorMessage(error, 'Failed to list research summaries'),
    });
  }
}
```

**Key changes from current `findByUserId`:**
1. **Single query** instead of two (favourites + non-favourites) — uses `orderBy('favourite', 'desc')` to sort favourites first
2. **`.select()` projection** — only fetches fields needed for summaries (still fetches `llmResults` for status extraction, but Firestore returns the full array; the mapping strips the `result` text before sending over the wire)
3. **Simplified cursor** — just document ID, no `fav:/non:` prefix encoding needed

**Note on `.select()` and `llmResults`:** Firestore's `.select()` cannot project into array sub-fields. The full `llmResults` array must be fetched, but we strip the `.result` text field in the mapping step before it leaves the server. The biggest bandwidth savings come from NOT transferring `synthesizedResult`, `inputContexts`, `researchContext`, and `prompt`.

- [ ] **Run test to verify it passes**

Run: `pnpm --filter research-agent test -- --run -t "findSummariesByUserId"`
Expected: PASS

- [ ] **Commit**

```bash
git add apps/research-agent/src/domain/research/models/Research.ts \
  apps/research-agent/src/domain/research/models/index.ts \
  apps/research-agent/src/domain/research/ports/repository.ts \
  apps/research-agent/src/infra/research/FirestoreResearchRepository.ts \
  apps/research-agent/src/infra/research/FirestoreResearchRepository.test.ts
git commit -m "feat(research-agent): add findSummariesByUserId with select projection"
```

### Step 1.4: Update `listResearches` use case

- [ ] **Write failing test for summary list use case**

Test that `listResearches` calls `findSummariesByUserId` and returns `ResearchSummary[]`. The use case always returns summaries — there is no `summary` flag or dual-path logic.

- [ ] **Run test to verify it fails**

- [ ] **Update `listResearches` use case**

In `apps/research-agent/src/domain/research/usecases/listResearches.ts`:

```typescript
import type { ResearchSummary } from '../models/index.js';

export interface ListResearchesParams {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface ListResearchesResult {
  items: ResearchSummary[];
  nextCursor?: string;
}

export async function listResearches(
  params: ListResearchesParams,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<ListResearchesResult, RepositoryError>> {
  const options: { limit?: number; cursor?: string } = {};
  if (params.limit !== undefined) {
    options.limit = params.limit;
  }
  if (params.cursor !== undefined) {
    options.cursor = params.cursor;
  }

  return await deps.researchRepo.findSummariesByUserId(params.userId, options);
}
```

> **Design decision:** The list endpoint permanently returns `ResearchSummary[]` — there is no union type or `summary` flag. Callers that need full `Research` documents (e.g., the detail page) use `GET /research/:id` directly. This avoids a discriminant-less union that would require unsafe casts under strict TypeScript mode.

- [ ] **Run test to verify it passes**

- [ ] **Commit**

### Step 1.5: Add summary response schema and update route

- [ ] **Add `researchSummarySchema` to `common.ts`**

In `apps/research-agent/src/routes/schemas/common.ts`:

```typescript
export const llmResultStatusSchema = {
  type: 'object',
  properties: {
    provider: storedLlmProviderSchema,
    model: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
  },
  required: ['provider', 'model', 'status'],
} as const;

export const researchSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    status: researchStatusSchema,
    selectedModels: { type: 'array', items: storedModelSchema },
    synthesisModel: storedModelSchema,
    startedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
    favourite: { type: 'boolean', nullable: true },
    llmResultStatuses: { type: 'array', items: llmResultStatusSchema },
    totalCostUsd: { type: 'number', nullable: true },
    partialFailure: { ...partialFailureSchema, nullable: true },
  },
  required: ['id', 'userId', 'title', 'status', 'selectedModels', 'synthesisModel', 'startedAt', 'llmResultStatuses'],
} as const;
```

- [ ] **Update `listResearchesResponseSchema` in `researchSchemas.ts`**

Replace the items schema reference to use `researchSummarySchema`:

```typescript
export const listResearchesResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: researchSummarySchema,
        },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;
```

- [ ] **Update route handler (no flag needed)**

In `apps/research-agent/src/routes/researchRoutes.ts`, the `GET /research` handler (line 699) calls `listResearches(params, { researchRepo })` — no changes needed since the use case always returns summaries now. Verify the existing call compiles with the updated `ListResearchesParams` type (the `summary` field was removed).

- [ ] **Update route tests**

Verify the route returns `ResearchSummary` objects (no `synthesizedResult`, no `llmResults[].result`, no `inputContexts`).

- [ ] **Run full test suite**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: All tests pass

- [ ] **Commit**

```bash
git commit -m "feat(research-agent): return summary projections from GET /research"
```

### Step 1.6: Add new Firestore composite index

- [ ] **Create migration file**

Create `migrations/XXX_research-list-optimized-index.mjs` (use the next available migration number):

```javascript
/**
 * Migration: Add composite index for optimized research list query.
 * Supports single-query pagination with favourites-first ordering:
 * (userId ASC, favourite DESC, startedAt DESC)
 *
 * This replaces the two-query pattern (favourites + non-favourites)
 * with a single query using orderBy('favourite', 'desc').
 */
export const description = 'Add optimized research list composite index (favourite DESC)';

export async function up() {
  // Index is defined in firestore.indexes.json and deployed via:
  // firebase deploy --only firestore:indexes
  console.log('Index defined in firestore.indexes.json — deploy with: firebase deploy --only firestore:indexes');
}
```

- [ ] **Add index to `firestore.indexes.json`**

Add after the existing `researches` indexes:

```json
{
  "collectionGroup": "researches",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "userId",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "favourite",
      "order": "DESCENDING"
    },
    {
      "fieldPath": "startedAt",
      "order": "DESCENDING"
    }
  ]
}
```

- [ ] **Commit**

```bash
git add migrations/ firestore.indexes.json
git commit -m "feat: add composite index for optimized research list (favourite DESC)"
```

---

## Task 2: Frontend — Use Summary Type and Optimistic Updates (web)

**Files:**
- Modify: `apps/web/src/services/researchAgentApi.types.ts`
- Modify: `apps/web/src/services/researchAgentApi.ts`
- Modify: `apps/web/src/hooks/useResearch.ts`
- Modify: `apps/web/src/pages/ResearchListPage.tsx`
- Modify: `apps/web/src/components/research/shared.tsx` (if any type references need update)

### Step 2.1: Add `ResearchSummary` type to frontend

- [ ] **Add `ResearchSummary` and `LlmResultStatus` types**

In `apps/web/src/services/researchAgentApi.types.ts`, add:

```typescript
/**
 * Lightweight status info for each LLM model in a research.
 * Used in list view to show per-model progress without transferring result text.
 */
export interface LlmResultStatusInfo {
  provider: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * Summary projection of a Research for list views.
 * Contains only the fields needed to render a research card.
 * Full document fetched separately when opening research detail.
 */
export interface ResearchSummary {
  id: string;
  userId: string;
  title: string;
  status: ResearchStatus;
  selectedModels: StoredResearchModel[];
  synthesisModel: StoredResearchModel;
  startedAt: string;
  completedAt?: string;
  favourite?: boolean;
  llmResultStatuses: LlmResultStatusInfo[];
  totalCostUsd?: number;
  partialFailure?: PartialFailure;
}

/**
 * Response from listing researches (summary projection).
 */
export interface ListResearchSummariesResponse {
  items: ResearchSummary[];
  nextCursor?: string;
}
```

- [ ] **Commit**

### Step 2.2: Update API client to use summary response

- [ ] **Update `listResearches` function**

In `apps/web/src/services/researchAgentApi.ts`, update the return type:

```typescript
import type {
  // ... existing imports ...
  ListResearchSummariesResponse,
} from './researchAgentApi.types.js';

/**
 * List researches for the current user (summary projection).
 */
export async function listResearches(
  accessToken: string,
  cursor?: string,
  limit = 50
): Promise<ListResearchSummariesResponse> {
  const params = new URLSearchParams();
  if (cursor !== undefined && cursor !== '') {
    params.set('cursor', cursor);
  }
  params.set('limit', String(limit));

  const query = params.toString();
  const path = query !== '' ? `/research?${query}` : '/research';

  return await apiRequest<ListResearchSummariesResponse>(config.ResearchAgentUrl, path, accessToken);
}
```

- [ ] **Commit**

### Step 2.3: Update `useResearches` hook to use `ResearchSummary`

- [ ] **Update the hook's state and return types**

In `apps/web/src/hooks/useResearch.ts`, update `useResearches`:

```typescript
import type {
  CreateResearchRequest,
  Research,
  ResearchSummary,
  SaveDraftRequest,
} from '@/services/researchAgentApi.types';

export function useResearches(): {
  researches: ResearchSummary[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteResearch: (id: string) => Promise<void>;
  createResearch: (request: CreateResearchRequest) => Promise<Research>;
  saveDraft: (request: SaveDraftRequest) => Promise<{ id: string }>;
  updateResearchLocally: (id: string, updates: Partial<ResearchSummary>) => void;
} {
  const { getAccessToken } = useAuth();
  const [researches, setResearches] = useState<ResearchSummary[]>([]);
  // ... rest unchanged except state type
```

Add a new `updateResearchLocally` function for optimistic updates:

```typescript
const updateResearchLocally = useCallback(
  (id: string, updates: Partial<ResearchSummary>): void => {
    setResearches((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  },
  []
);
```

- [ ] **Commit**

### Step 2.4: Implement optimistic favourite toggle

- [ ] **Update `ResearchListPage.tsx` favourite handler**

In `apps/web/src/pages/ResearchListPage.tsx`, replace the `handleToggleFavourite` function:

```typescript
const { researches, loading, loadingMore, error, hasMore, loadMore, deleteResearch, refresh, updateResearchLocally } =
  useResearches();

const handleToggleFavourite = (researchId: string, favourite: boolean): void => {
  setUpdatingFavourite(researchId);
  setFavouriteError(null);

  // Optimistic update - immediately update UI
  updateResearchLocally(researchId, { favourite });

  void (async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      await toggleResearchFavourite(token, researchId, favourite);
      // No need to refresh - optimistic update already applied
    } catch (err) {
      // Revert optimistic update on failure
      updateResearchLocally(researchId, { favourite: !favourite });
      setFavouriteError(err instanceof Error ? err.message : 'Failed to update favourite');
    } finally {
      setUpdatingFavourite(null);
    }
  })();
};
```

**Impact:** Eliminates the 500-1400ms full list re-fetch on every favourite toggle. Star click now feels instant.

- [ ] **Commit**

### Step 2.5: Update `ResearchListPage` and `ResearchRow` types

- [ ] **Update component props to use `ResearchSummary`**

In `apps/web/src/pages/ResearchListPage.tsx`:

```typescript
import { type ResearchSummary } from '@/services/researchAgentApi.types';

// Update ResearchRowProps:
interface ResearchRowProps {
  research: ResearchSummary;
  onDelete: () => Promise<void>;
  onToggleFavourite: (researchId: string, favourite: boolean) => void;
  updatingFavourite: string | null;
}
```

Update `sortResearches` parameter type:

```typescript
function sortResearches(items: ResearchSummary[], sort: ResearchSortOption): ResearchSummary[] {
  // ... same logic, works because ResearchSummary has startedAt, completedAt, favourite
}
```

Update `getUniqueResearchProviders` calls — currently it takes `research.selectedModels`. Since `ResearchSummary` still has `selectedModels`, this continues to work unchanged.

- [ ] **Update `shared.tsx` if needed**

Check if `getUniqueResearchProviders` or `deriveGroupStatus` reference any fields not on `ResearchSummary`. Both only use `selectedModels` and `status` respectively — both present on `ResearchSummary`. No changes needed.

- [ ] **Run the web app locally to verify**

Run: `pnpm --filter web dev`
Expected: Research list page loads with summary data, favourite toggle is instant

- [ ] **Commit**

```bash
git commit -m "feat(web): use ResearchSummary for list page with optimistic favourite toggle"
```

### Step 2.6: Run full CI

- [ ] **Run full CI**

Run: `pnpm run ci:tracked`
Expected: All tests pass, all workspaces build

- [ ] **Final commit if any adjustments needed**

---

## Contract Between Tasks

The two tasks (backend and frontend) can be executed in parallel by independent agents. The contract between them is:

### API Contract: `GET /research?limit=50&cursor=<optional>`

**Response body (after optimization):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "abc123",
        "userId": "user1",
        "title": "Research about AI alignment",
        "status": "completed",
        "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-5"],
        "synthesisModel": "claude-opus-4-5",
        "startedAt": "2026-03-28T10:00:00.000Z",
        "completedAt": "2026-03-28T10:05:00.000Z",
        "favourite": true,
        "llmResultStatuses": [
          { "provider": "google", "model": "gemini-2.5-pro", "status": "completed" },
          { "provider": "anthropic", "model": "claude-sonnet-4-5", "status": "completed" }
        ],
        "totalCostUsd": 0.0234,
        "partialFailure": null
      }
    ],
    "nextCursor": "def456"
  }
}
```

**Cursor format change:** The cursor is now a plain document ID (e.g., `"def456"`) instead of the previous `"fav:def456"` / `"non:def456"` format. The frontend already treats the cursor as an opaque string, so this is backwards-compatible from the frontend's perspective.

> **Deployment transition note:** During the deployment window, active browser sessions may hold old-format cursors (`"fav:abc123"` / `"non:abc123"`). If sent to the new endpoint, `collection.doc("fav:abc123").get()` returns a non-existent document, causing pagination to silently reset to the beginning of the list. This is graceful degradation (no crash, no error) — the user simply sees the first page again. This is acceptable for a deployment window and resolves itself when the user refreshes.

**Fields removed from list response:** `prompt`, `originalPrompt`, `synthesizedResult`, `synthesisError`, `llmResults` (replaced by `llmResultStatuses`), `inputContexts`, `researchContext`, `shareInfo`, `notionExportInfo`, `sourceActionId`, `sourceResearchId`, `skipSynthesis`, `userName`, `userEmail`, `totalDurationMs`, `totalInputTokens`, `totalOutputTokens`, `auxiliaryCostUsd`, `sourceLlmCostUsd`, `attributionStatus`.

**Fields added:** `llmResultStatuses` (lightweight model status array without result text).

### Shared Types

Both agents need to agree on the `ResearchSummary` shape. The backend defines it in `apps/research-agent/src/domain/research/models/Research.ts` and the frontend defines a matching type in `apps/web/src/services/researchAgentApi.types.ts`. These must stay in sync. The contract above is the source of truth.

### Backwards Compatibility

- `GET /research/:id` continues to return full `Research` objects unchanged
- The `toggleResearchFavourite` API (`PATCH /research/:id/favourite`) continues to return full `Research` objects — the frontend just doesn't use the response for list updates anymore
- All create/update/delete endpoints unchanged

---

## Expected Outcome

| Metric                           | Before                 | After                          | Improvement             |
| -------------------------------- | ---------------------- | ------------------------------ | ----------------------- |
| `GET /research?limit=50` latency | 500-1400ms             | ~100-200ms                     | 3-7x faster             |
| Response payload (50 items)      | ~500KB-2MB             | ~15-30KB                       | 20-60x smaller          |
| Firestore queries per list       | 2 (+ 0-2 cursor reads) | 1                              | 50% fewer               |
| Favourite toggle UX              | 500-1400ms re-fetch    | Instant (optimistic)           | Eliminates wait         |
| Firestore read cost              | Same (full doc reads)  | Lower (`.select()` projection) | ~30% fewer bytes billed |
