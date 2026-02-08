# INT-134: Linear API Usage Investigation

## Executive Summary

**Root Cause Identified:** The excessive Linear API usage (5000+ calls) is caused by **N+1 query pattern** in the `@linear/sdk`. Each issue's state is fetched via a separate GraphQL query, resulting in ~100 API calls per dashboard load.

**Key Finding:** For a dashboard with 30 issues (10 open, 20 closed in 3 days), the current implementation makes **31 API calls minimum** per load. With 1-minute polling, this exceeds 40,000 calls/day per user.

---

## Investigation Details

### 1. Dashboard Data Flow

```
LinearIssuesPage.tsx
    │
    ├── loadIssues() called on:
    │   ├── Initial page load
    │   └── Every 60 seconds (POLLING_INTERVAL_MS = 60_000)
    │
    └── listLinearIssues(token)
            │
            └── GET /linear/issues
                    │
                    └── listIssues() use case
                            │
                            └── linearApiClient.listIssues()
                                    │
                                    ├── 1 API call: client.issues({ filter, first: 100 })
                                    │
                                    └── mapIssuesWithBatchedStates(issues)
                                            │
                                            └── N API calls: await issue.state (for each issue)
```

### 2. The N+1 Query Problem

**Location:** `apps/linear-agent/src/infra/linear/linearApiClient.ts:86-112`

```typescript
async function mapIssuesWithBatchedStates(issues: Issue[]): Promise<LinearIssue[]> {
  const statePromises = issues.map(async (issue) => {
    const state = issue.state;
    return state !== undefined ? await state : null; // ← Each await = 1 GraphQL query
  });
  const states = await Promise.all(statePromises); // ← Parallel, but still N queries
  // ...
}
```

**Problem:** The `@linear/sdk` uses lazy-loading for relations. When `issue.state` is awaited, it triggers a separate GraphQL query to fetch that issue's state. Even though `Promise.all()` runs them in parallel, **each issue still requires its own API call**.

### 3. API Calls Calculation

#### Per Dashboard Load

| Operation          | API Calls | Notes                                   |
| ------------------ | --------- | --------------------------------------- |
| List issues        | 1         | `client.issues({ filter, first: 100 })` |
| Fetch states       | N         | One per issue returned                  |
| **Total per load** | **N + 1** |                                         |

#### For 30-Issue Dashboard (Scenario in Issue)

| Metric                   | Value  | Calculation                |
| ------------------------ | ------ | -------------------------- |
| Issues returned          | 30     | 10 open + 20 closed/3 days |
| API calls per load       | 31     | 1 (list) + 30 (states)     |
| Loads per hour (polling) | 60     | 1 per minute               |
| API calls per hour       | 1,860  | 31 × 60                    |
| API calls per 8-hour day | 14,880 | 1,860 × 8                  |

#### For 100 Issues (Current `first: 100` Limit)

| Metric                   | Value  | Calculation             |
| ------------------------ | ------ | ----------------------- |
| API calls per load       | 101    | 1 (list) + 100 (states) |
| API calls per hour       | 6,060  | 101 × 60                |
| API calls per 8-hour day | 48,480 | 6,060 × 8               |

### 4. Why Caching Doesn't Help

The current caching implementation has two components:

| Cache Type    | TTL        | Purpose                           | Effectiveness |
| ------------- | ---------- | --------------------------------- | ------------- |
| Client cache  | 5 minutes  | Reuse LinearClient instances      | ✅ Helps       |
| Request dedup | 10 seconds | Prevent duplicate in-flight calls | ❌ Not enough  |

**Problem:** The 10-second dedup TTL is shorter than the 60-second polling interval. Each poll is a fresh request, triggering full N+1 queries again.

### 5. Other API Call Sources

| Endpoint                      | API Calls | Frequency        |
| ----------------------------- | --------- | ---------------- |
| `/linear/connection`          | 0         | Firestore only   |
| `/linear/connection/validate` | 2         | On connect       |
| `/linear/failed-issues`       | 0         | Firestore only   |
| `/linear/issues`              | N+1       | Every 60 seconds |

---

## Linear API Rate Limits

Linear's API has these constraints:

- **Complexity-based limits**: Each query has a complexity cost
- **Rate limit**: ~5,000 requests per hour (varies by plan)
- **Monthly allowance**: Plan-dependent

Reference: https://developers.linear.app/docs/graphql/working-with-the-graphql-api#rate-limiting

---

## Recommendations

### Short-term (Low Effort, High Impact)

1. **Reduce polling frequency** from 60 seconds to 5-10 minutes
   - File: `apps/web/src/pages/LinearIssuesPage.tsx:21`
   - Impact: 6-10x reduction in API calls

2. **Extend dedup cache TTL** to match polling interval
   - File: `apps/linear-agent/src/infra/linear/linearApiClient.ts:27`
   - Change `DEDUP_TTL_MS` from 10s to 120s or more
   - Impact: Prevents duplicate requests within polling window

3. **Add response caching** in `listIssues` with configurable TTL
   - Cache the mapped issues for 1-5 minutes
   - Return cached data for repeated requests

### Medium-term (Higher Effort, Eliminates Root Cause)

4. **Request state data in initial query** using GraphQL fragments
   - The `@linear/sdk` supports including relations in the initial query
   - Example: `client.issues({ include: { state: true } })`
   - Impact: Reduces N+1 to 1 query

5. **Use webhook-based updates** instead of polling
   - Linear supports webhooks for issue changes
   - Subscribe to issue updates and maintain local cache
   - Impact: Near-zero API calls for reads

### Long-term (Architectural)

6. **Implement issues cache with pub/sub invalidation**
   - Store issues in Firestore
   - Update via webhooks
   - Serve dashboard from cache
   - Impact: Eliminates all polling API calls

---

## Files Analyzed

| File                                                                  | Purpose                 |
| --------------------------------------------------------------------- | ----------------------- |
| `apps/linear-agent/src/infra/linear/linearApiClient.ts`               | Linear SDK wrapper      |
| `apps/linear-agent/src/domain/useCases/listIssues.ts`                 | Dashboard data use case |
| `apps/linear-agent/src/routes/linearRoutes.ts`                        | HTTP endpoints          |
| `apps/web/src/pages/LinearIssuesPage.tsx`                             | Dashboard UI + polling  |
| `apps/web/src/services/linearApi.ts`                                  | Web API client          |
| `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts` | Connection storage      |

---

## Conclusion

The 5000+ API calls are caused by:

1. **N+1 query pattern**: Each issue requires a separate state fetch
2. **Aggressive polling**: 60-second intervals with no response caching
3. **Ineffective dedup cache**: TTL too short to span polling intervals

The caching introduced in INT-95 helps with concurrent requests but doesn't address the fundamental N+1 problem or inter-poll caching.

**Immediate action:** Increase `DEDUP_TTL_MS` and `POLLING_INTERVAL_MS` to reduce API calls by ~90%.

**Root fix:** Modify the GraphQL query to include state data upfront, eliminating the N+1 pattern entirely.
