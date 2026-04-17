# INT-1412 — Digest Backfill 500 Investigation & Fix Plan

**Linear:** [INT-1412](https://linear.app/pbuchman/issue/INT-1412/fix-500-error-when-generating-date-range-summaries)
**Service:** `mobile-notifications-service`
**Endpoint:** `POST /notifications/digests/backfill`
**Error surfaced in UI:** `kick-off POST returned 500`
**Observed in production:** `2026-04-17T15:26:40Z` (dev GCP project `intexuraos-dev-pbuchman`).

---

## 1. User-visible symptom

In the web app (`https://intexuraos.cloud/#/notifications/digests`), opening the "Uzupełnij podsumowania z zakresu dat" modal (component: `apps/web/src/components/notification-digests/BackfillRangeModal.tsx`), selecting a range (e.g. `2026-04-10 → 2026-04-17`) for `groupKey=grupa-wedkarska-skool`, and clicking **Rozpocznij** returns the string:

> `kick-off POST returned 500`

The HTTP trace observed: `POST https://intexuraos-mobile-notifications-service-…a.run.app/notifications/digests/backfill` → `500` (latency 551 ms).

## 2. Request/response flow (code path)

1. **Web** → `startBackfill(...)` in `apps/web/src/services/notificationDigestsApi.ts:97` → `POST /notifications/digests/backfill`.
2. **mobile-notifications-service** user-facing handler (`apps/mobile-notifications-service/src/routes/digestRoutes.ts:461`):
   - validates the Auth0 JWT;
   - enumerates the date range via `listDates(...)`;
   - creates a backfill run doc via `BackfillRunRepository.create(...)`;
   - kicks off day 1 by POSTing `/internal/notifications/digest/run` to itself (a.k.a. the "kick-off POST").
3. The kick-off handler (`digestRoutes.ts:164` `fastify.post('/internal/notifications/digest/run', …)`):
   - validates `x-internal-auth`;
   - resolves the digest subscription;
   - builds an LLM client;
   - calls `runDigestForGroup(...)` (`apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts:40`).
4. `runDigestForGroup` issues three parallel Firestore queries, including:
   ```ts
   services.notificationRepository.findByUserIdPaginated(input.userId, {
     limit: 1000,
     filter: {
       title: input.groupTitlePrefix,
       app: ['com.whatsapp'],
       postTimeSecFrom: bounds.fromSec,
       postTimeSecTo: bounds.toSec,
     },
   })
   ```
   (`runDigestForGroup.ts:64-72`).
5. `FirestoreNotificationRepository.findByUserIdPaginated` (`apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts:131-240`) translates this into:
   ```ts
   db.collection('mobile_notifications')
     .where('userId', '==', userId)
     .where('app', 'in', ['com.whatsapp'])
     .where('timestamp', '>=', fromSec * 1000)
     .where('timestamp', '<',  toSec   * 1000)
     .orderBy('receivedAt', 'desc')
     .limit(batchSize)
   ```

## 3. Root cause — evidence from production logs

Cloud Logging query (project `intexuraos-dev-pbuchman`, service `intexuraos-mobile-notifications-service`, window `2026-04-17T15:26:40Z`, request IDs `req-42` → `req-43`) returned the following chain:

| time (UTC)            | reqId   | url                                                          | status  | note                                                                                      |
| --------------------- | ------- | ------------------------------------------------------------ | :-----: | ----------------------------------------------------------------------------------------- |
| 15:26:40.146          | req-42  | `POST /notifications/digests/backfill`                       | –       | body `{"groupKey":"grupa-wedkarska-skool","fromDate":"2026-04-10","toDate":"2026-04-17"}` |
| 15:26:40.315          | req-43  | `POST /internal/notifications/digest/run`                    | –       | kick-off — body includes `chainNext` with remaining 7 dates                               |
| 15:26:40.446          | req-43  | `Querying notifications` (`FirestoreNotificationRepository`) | –       | `userId=google-oauth2\                                                                    | …`, `limit=1000`, `hasTitleFilter=true` |
| 15:26:40.536 ❌        | req-43  | `Failed to list notifications` (level 50)                    | –       | see full gRPC error below                                                                 |
| 15:26:40.691          | req-43  | request completed                                            | **500** | 376 ms                                                                                    |
| 15:26:40.695          | req-42  | request completed                                            | **500** | 550 ms                                                                                    |

**The failing Firestore error (verbatim from log entry `69e2513000083150ca9659f3`):**

> `9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/intexuraos-dev-pbuchman/firestore/indexes?create_composite=CmRwcm9qZWN0cy9pbnRleHVyYW9zLWRldi1wYnVjaG1hbi9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvbW9iaWxlX25vdGlmaWNhdGlvbnMvaW5kZXhlcy9fEAEaBwoDYXBwEAEaCgoGdXNlcklkEAEaDgoKcmVjZWl2ZWRBdBACGg0KCXRpbWVzdGFtcBACGgwKCF9fbmFtZV9fEAI .`
>
> `The query contains range and inequality filters on multiple fields, please refer to the documentation for index selection best practices: https://cloud.google.com/firestore/docs/query-data/multiple-range-fields.`

Decoding the Firestore "create_composite" suggestion yields the exact index Firestore wants:

```
collectionGroup: mobile_notifications
fields:
  - app        ASC
  - userId     ASC
  - receivedAt DESC
  - timestamp  DESC
  - __name__   DESC
```

Why the existing indexes do not satisfy this query (`firestore.indexes.json`):

| existing index on `mobile_notifications`                                        | covers new query? | reason                                                      |
| ------------------------------------------------------------------------------- | :---------------: | ----------------------------------------------------------- |
| `app ASC, userId ASC, receivedAt DESC`                                          | ❌                 | missing `timestamp` inequality field                        |
| `source ASC, userId ASC, receivedAt DESC`                                       | ❌                 | wrong equality field (`source` vs `app`)                    |
| `userId ASC, source ASC, app ASC, receivedAt DESC`                              | ❌                 | missing `timestamp`; extra `source` that we don't filter on |
| `userId ASC, receivedAt DESC`                                                   | ❌                 | missing `app` and `timestamp`                               |
| `userId ASC, updatedAt DESC`                                                    | ❌                 | wrong ordering field                                        |

## 4. Why this broke now

- The digest backfill UI and `runDigestForGroup` were introduced by plan `docs/superpowers/plans/2026-04-17-digest-rewrite-and-ui.md` (merged today, `2026-04-17`).
- That plan added the new `timestamp` range filter (`postTimeSecFrom` / `postTimeSecTo`) to `FilterOptions` and extended `firestoreNotificationRepository.buildQuery` accordingly — but no corresponding migration was added to `migrations/` to deploy the new composite index.
- Since Firestore's "range and inequality filters on multiple fields" hard-requires that every inequality-filtered field appear in the composite index alongside the equality fields and the `orderBy` field, the query fails on the very first kick-off. The user-facing handler propagates that failure as `500 INTERNAL_ERROR` with message `kick-off POST returned 500`.

## 5. Fix plan (to be executed in a follow-up code-worker task)

**Primary fix — add the missing Firestore composite index via a new migration.**

### 5.1 New migration file

Create `migrations/096_mobile-notifications-digest-time-range-index.mjs` with the exact index Firestore requested:

```js
/**
 * Migration 096: Composite index for digest time-range queries
 *
 * Required by mobile-notifications-service runDigestForGroup for:
 *   findByUserIdPaginated with filter: { app: ['com.whatsapp'],
 *                                        postTimeSecFrom, postTimeSecTo }
 *
 * Firestore error: "9 FAILED_PRECONDITION: The query requires an index"
 * Observed in dev 2026-04-17 15:26:40 UTC (trace 76fb31300b10d8477e0cf4e46ab9e07c).
 *
 * See INT-1412 for context.
 */
export const metadata = {
  id: '096',
  name: 'mobile-notifications-digest-time-range-index',
  description: 'Composite index for app + userId + receivedAt + timestamp digest query',
  createdAt: '2026-04-17',
};

export const indexes = [
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'app',        order: 'ASCENDING'  },
      { fieldPath: 'userId',     order: 'ASCENDING'  },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
      { fieldPath: 'timestamp',  order: 'DESCENDING' },
    ],
  },
];

export const collections = ['mobile_notifications'];

export async function up(context) {
  console.log('  Deploying mobile_notifications digest time-range composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
```

Notes:
- `__name__` does not have to be declared explicitly; Firestore appends it to every composite index automatically.
- The aggregated `firestore.indexes.json` must be regenerated (per `migrations/README.md` the file is committed in this repo despite the README noting it is normally gitignored — `.gitignore:61` has `# firestore.indexes.json - tracked in git for version control`). Running `pnpm run migrate` against dev will both deploy the index and refresh the file. The refreshed `firestore.indexes.json` must be committed with the migration.

### 5.2 Steps (for the code-worker agent)

- [ ] **Step 1** — Branch off `development` as `fix/int-1412-digest-backfill-index`.
- [ ] **Step 2** — Create the migration file shown above at `migrations/096_mobile-notifications-digest-time-range-index.mjs`.
- [ ] **Step 3** — Run `node scripts/migrate.mjs --dry-run --project intexuraos-dev-pbuchman` and confirm the diff output shows exactly one new index added for `mobile_notifications`.
- [ ] **Step 4** — Run `pnpm run migrate -- --project intexuraos-dev-pbuchman` to deploy the index. Firestore will return `202 Accepted`; index build is async and typically completes in 1-5 minutes for a <1M-doc collection. Poll with `gcloud firestore indexes composite list --project=intexuraos-dev-pbuchman --database="(default)"` until `state=READY`.
- [ ] **Step 5** — Commit the new migration and the regenerated `firestore.indexes.json`.
- [ ] **Step 6** — Write a regression test in `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts` that covers `findByUserIdPaginated` with **all four filter keys populated simultaneously** (`app`, `title`, `postTimeSecFrom`, `postTimeSecTo`). The in-memory Firestore mock does not surface missing-index errors, so the test verifies the translated query shape (fields / operators / orderBy) rather than index existence; add a comment pointing to this migration.
- [ ] **Step 7** — Run `pnpm run ci:tracked` at repo root; fix anything it complains about.
- [ ] **Step 8** — Manual smoke test against dev: from `https://intexuraos.cloud`, open the digest backfill modal, pick `2026-04-10 → 2026-04-17`, submit, and confirm the API returns `200` with a `runId` and `queuedDates` array (the per-day chain may still succeed or fail on subsequent business logic, but the kick-off 500 must be gone).
- [ ] **Step 9** — Open a PR `[INT-1412] fix: add mobile_notifications digest time-range index`, targeting `development`. Body must include the log quote from §3 as evidence.

### 5.3 Non-goals / explicitly out of scope

- No code change to `firestoreNotificationRepository.ts` — the query is correct, only the index is missing.
- No change to the chain-post behaviour or to the backfill run state machine.
- No retry/backoff added to `startDigestBackfill` — masking the original error with a retry would hide the real operational contract (indexes must be deployed before code).
- No changes to the web modal or to `useBackfillRun` — the web app surfaces the error faithfully and will automatically succeed once the backend query works.

### 5.4 Rollback

If the index build causes unexpected Firestore cost or write-path contention, delete it via the Firebase console (link is in the migration's `down()` log line) and revert the migration commit. Rollback does not require a data migration because composite indexes are query-time artefacts only.

## 6. Endpoint Changes

**Modified:** none.
**Created:** none.
**Removed:** none.
**Unchanged:** `POST /notifications/digests/backfill`, `POST /internal/notifications/digest/run`, `GET /notifications/digests/backfill/:runId`, `GET /notifications/digests`, `GET /notifications/digests/:groupKey/:date`, `POST /notifications/digests/run`, `GET /notifications/digests/:groupKey/:date/state`.

## 7. Linked artefacts

- Production trace: `projects/intexuraos-dev-pbuchman/traces/76fb31300b10d8477e0cf4e46ab9e07c` (spans `c3683390a15cb7a8` for the outer request, `290901f40f94f83c` for the internal kick-off).
- Latest deployed revision at time of failure: `intexuraos-mobile-notifications-service-00586-b88`.
- Predecessor plan that introduced the broken query: `docs/superpowers/plans/2026-04-17-digest-rewrite-and-ui.md`.
- Existing indexes file: `firestore.indexes.json` (no `timestamp` field present anywhere before this change).
