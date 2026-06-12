# mobile-notifications-service — Agent Interface

> Machine-readable specification for AI agent integration

---

## Identity

| Attribute | Value                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Name      | mobile-notifications-service                                                                                               |
| Role      | Mobile notification capture, storage, and WhatsApp group digest generation                                                 |
| Goal      | Capture device notifications, query them for analysis, and produce AI-generated daily digests from WhatsApp group messages |
| Port      | 8114                                                                                                                       |
| Public URL | `https://intexuraos.cloud/api/notifications`                                                                              |

---

## Capabilities

### List Digest Subscriptions (Internal)

**Endpoint:** `POST /internal/notifications/digest-subscriptions/list`

**When to use:** When Fishing Assistant or another internal consumer needs to discover which digest groups are available for a user before querying digest evidence.

**Auth:** `X-Internal-Auth` header with shared secret

**Input Schema:**

```typescript
interface ListDigestSubscriptionsInput {
  userId: string;
}
```

**Output Schema:**

```typescript
interface ListDigestSubscriptionsOutput {
  items: Array<{
    groupKey: string;
    displayName: string;
  }>;
}
```

### Query Digest Evidence (Internal)

**Endpoint:** `POST /internal/notifications/digests/query`

**When to use:** When Fishing Assistant needs persisted daily digest summaries as evidence over a date range.

**Auth:** `X-Internal-Auth` header with shared secret

**Input Schema:**

```typescript
interface QueryDigestEvidenceInput {
  userId: string;
  groupKey: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  terms?: string[];
  limit?: number;   // 1-100, default 30
  cursor?: string;
}
```

**Output Schema:**

```typescript
interface QueryDigestEvidenceOutput {
  items: DigestEvidenceItem[];
  truncated: boolean;
  nextCursor?: string;
}

interface DigestEvidenceItem {
  groupKey: string;
  date: string;
  title: string;
  summaryMarkdown: string;
  messageCount: number;
}
```

### Get Digest Evidence (Internal)

**Endpoint:** `POST /internal/notifications/digests/get`

**When to use:** When an internal consumer needs one digest evidence item by exact group and date.

**Auth:** `X-Internal-Auth` header with shared secret. Returns 404 if no digest exists for that date.

**Input Schema:**

```typescript
interface GetDigestEvidenceInput {
  userId: string;
  groupKey: string;
  date: string; // YYYY-MM-DD
}
```

**Output Schema:** `DigestEvidenceItem`

### Get Latest Digest State (Internal)

**Endpoint:** `POST /internal/notifications/digest-state/get`

**When to use:** When Fishing Assistant needs the latest group state context for a digest group.

**Auth:** `X-Internal-Auth` header with shared secret. Returns 404 if no state exists.

**Input Schema:**

```typescript
interface GetDigestStateInput {
  userId: string;
  groupKey: string;
}
```

**Output Schema:** `GetDigestStateResponse` with `identityLedger`, `moderatorEvents`, `openThreads`, and `recentSummaryDates`.

### Query Group Messages (Internal)

**Endpoint:** `POST /internal/notifications/group-messages/query`

**When to use:** When Fishing Assistant needs cleaned WhatsApp messages as supporting evidence, especially for questions that require more detail than the daily digest.

**Auth:** `X-Internal-Auth` header with shared secret

**Input Schema:**

```typescript
interface QueryGroupMessagesInput {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number; // 1-500, default 100
  cursor?: string;
}
```

Call with either `date` or `dateFrom`/`dateTo`, not both.

**Output Schema:**

```typescript
interface QueryGroupMessagesOutput {
  messages: GroupMessageEvidence[];
  totalRaw: number;
  totalCleaned: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}

interface GroupMessageEvidence {
  messageRef: string;
  groupKey: string;
  date: string;
  postTimeSec: number;
  senderLabel?: string | null;
  text: string;
  quote: string;
}
```

### Query Notifications (Internal)

**Endpoint:** `POST /internal/mobile-notifications/query`

**When to use:** When you need to retrieve a user's mobile notifications for data aggregation, composite feeds, or analytics.

**Auth:** `X-Internal-Auth` header with shared secret

**Input Schema:**

```typescript
interface QueryNotificationsInput {
  userId: string;
  filter?: {
    app?: string[];   // OR logic across apps
    source?: string;  // Single value match
    title?: string;   // Case-insensitive substring match
  };
  limit?: number;     // 1-1000, default 50
}
```

**Output Schema:**

```typescript
interface QueryNotificationsOutput {
  notifications: InternalNotification[];
}

interface InternalNotification {
  id: string;
  app: string;
  title: string;
  body: string;      // Mapped from notification.text
  timestamp: string; // Mapped from notification.receivedAt (ISO 8601)
  source: string;
}
```

**Example:**

```json
// Request
{
  "userId": "user-abc-123",
  "filter": { "app": ["com.whatsapp", "com.telegram"] },
  "limit": 20
}

// Response
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notif-xyz-789",
        "app": "com.whatsapp",
        "title": "Alice: hey!",
        "body": "are you free tonight?",
        "timestamp": "2026-02-22T12:00:00.123Z",
        "source": "tasker"
      }
    ]
  }
}
```

### List Notifications (Public)

**Endpoint:** `GET /`

**When to use:** When displaying notifications to the authenticated user.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface ListNotificationsParams {
  limit?: number;   // 1-100, default 50
  cursor?: string;  // Pagination cursor from previous response
  source?: string;  // Comma-separated source filter
  app?: string;     // Comma-separated app filter
  title?: string;   // Case-insensitive partial match
}
```

**Output Schema:**

```typescript
interface ListNotificationsOutput {
  notifications: MobileNotification[];
  nextCursor?: string;
}

interface MobileNotification {
  id: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number;   // Unix seconds from device
  postTime: string;
  receivedAt: string;  // ISO 8601 server-side receipt time
}
```

### Create Connection

**Endpoint:** `POST /connect`

**When to use:** When pairing a new device for notification capture.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface ConnectInput {
  deviceLabel?: string;
}
```

**Output Schema:**

```typescript
interface ConnectOutput {
  connectionId: string;
  signature: string;  // Plaintext, shown only once — store securely
}
```

### Get Connection Status

**Endpoint:** `GET /status`

**When to use:** When checking if a user has an active device connection.

**Auth:** Bearer JWT

**Output Schema:**

```typescript
interface StatusOutput {
  configured: boolean;
  lastNotificationAt: string | null;
}
```

### Receive Webhook

**Endpoint:** `POST /webhooks`

**Public URL:** `https://intexuraos.cloud/api/notifications/webhooks`

**When to use:** Called by mobile automation apps (Tasker/Automate) to forward device notifications.

**Auth:** `X-Mobile-Notifications-Signature` header (plaintext — hashed server-side)

**Input Schema:**

```typescript
interface WebhookPayload {
  source: string;
  device: string;
  app: string;
  notification_id: string;
  title: string;
  text: string;
  timestamp: number;   // Unix seconds from device
  post_time: string;   // Unix seconds as string
}
```

**Output Schema:**

```typescript
interface WebhookOutput {
  status: 'accepted' | 'ignored';
  id?: string;     // Present when accepted
  reason?: string; // Present when ignored: 'duplicate'
}
```

### List Digests

**Endpoint:** `GET /digests`

**When to use:** When displaying AI-generated daily summaries for a WhatsApp group over a date range.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface ListDigestsParams {
  groupKey: string;           // Required
  fromDate: string;           // YYYY-MM-DD, required
  toDate: string;             // YYYY-MM-DD, required
  limit?: number;             // 1-100, default 30
  cursor?: string;            // Pagination cursor
}
```

**Output Schema:**

```typescript
interface ListDigestsOutput {
  items: PersistedDailySummary[];
  nextCursor?: string;
}

interface PersistedDailySummary {
  summary: DailySummary;
  generation: number;
  generatedAt: string;  // ISO 8601
  modelId: string;
}

interface DailySummary {
  date: string;         // YYYY-MM-DD (CET)
  groupKey: string;
  messageCount: number;
  headline: string;     // Max 200 chars
  bullets: string[];    // 3-7 items, max 300 chars each
  threads: Thread[];
  moderatorPosts: ModeratorPost[];
  openQuestions: string[];
  activityOutliers: ActivityOutlier[];
}
```

### Get Single Digest

**Endpoint:** `GET /digests/:groupKey/:date`

**When to use:** When displaying a specific day's digest.

**Auth:** Bearer JWT. Returns 404 if no digest exists for that date.

### Run Digest (User)

**Endpoint:** `POST /digests/run`

**When to use:** When the user wants to regenerate a digest for a specific group and date.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface UserRunDigestInput {
  groupKey: string;    // Min length 1
  date: string;        // YYYY-MM-DD
}
```

**Output Schema:**

```typescript
interface RunDigestOutput {
  summaryDocId: string;
  generation: number;
  messageCount: number;
  modelId: string;
  regenerated: boolean;
  lockSkipped?: boolean;  // True if lock was held by another run
}
```

### Start Backfill

**Endpoint:** `POST /digests/backfill`

**When to use:** When generating digests for a historical date range.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface StartBackfillInput {
  groupKey: string;
  fromDate: string;   // YYYY-MM-DD, must be <= toDate
  toDate: string;     // YYYY-MM-DD
}
```

**Output Schema:**

```typescript
interface StartBackfillOutput {
  runId: string;
  queuedDates: string[];  // Dates that will be processed
}
```

### Get Backfill Status

**Endpoint:** `GET /digests/backfill/:runId`

**When to use:** When polling for backfill progress.

**Auth:** Bearer JWT. Returns 404 if run not found.

**Output Schema:**

```typescript
interface BackfillRun {
  runId: string;
  userId: string;
  groupKey: string;
  fromDate: string;
  toDate: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalDates: number;
  completedDates: string[];
  failedDates: { date: string; error: string }[];
  currentDate: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

### Run Digest (Internal)

**Endpoint:** `POST /internal/notifications/digest/run`

**When to use:** Internal only — called by the backfill chain or for programmatic digest generation.

**Auth:** `X-Internal-Auth` header

Digest subscriptions use this shape:

```typescript
interface DigestSubscription {
  userId: string;
  groupKey: string;
  groupTitlePrefix: string;
  outputLanguage: 'English' | 'Polish';
}
```

### Run Yesterday Digest (Internal/Cron)

**Endpoint:** `POST /internal/notifications/digest/run-yesterday`

**When to use:** Called by Cloud Scheduler daily to generate digests for all subscriptions.

**Auth:** OIDC Bearer token (Cloud Scheduler) or `X-Internal-Auth` header

### Get Filter Options

**Endpoint:** `GET /filters`

**Auth:** Bearer JWT. Returns empty options arrays (never 404) when no notifications received yet.

**Output Schema:**

```typescript
interface FiltersOutput {
  userId: string;
  options: {
    app: string[];
    device: string[];
    source: string[];
  };
  savedFilters: SavedFilter[];
  createdAt: string;
  updatedAt: string;
}

interface SavedFilter {
  id: string;
  name: string;
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
  createdAt: string;
}
```

### Create Saved Filter

**Endpoint:** `POST /filters/saved`

**Auth:** Bearer JWT. Returns 201 Created.

**Input Schema:**

```typescript
interface CreateSavedFilterInput {
  name: string;     // 1-100 characters, required
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
}
```

### Delete Saved Filter

**Endpoint:** `DELETE /filters/saved/:id`

**Auth:** Bearer JWT. Returns 204 No Content on success, 404 if not found.

### Delete Notification

**Endpoint:** `DELETE /:notification_id`

**Auth:** Bearer JWT. Returns 200 `{ success: true, data: {} }` on success, 403 if not owner, 404 if not found.

---

## Constraints

**Do NOT:**

- Call the internal query endpoint without `X-Internal-Auth` header — returns 401
- Query digest evidence for a `(userId, groupKey)` pair that is not present in `DIGEST_SUBSCRIPTIONS` — returns 400
- Call `POST /internal/notifications/group-messages/query` with both `date` and `dateFrom`/`dateTo` — returns 400
- Expect the plaintext signature after the initial `POST /connect` response — it is never re-shown
- Send notifications without the `X-Mobile-Notifications-Signature` header — returns 400
- Call `GET /filters` expecting 404 for new users — returns empty arrays instead
- Run a digest for a group the user is not subscribed to — returns 400
- Expect WhatsApp notifications on digest regeneration — only first generation triggers notifications

**Requires:**

- User must be authenticated (Bearer JWT) for all public endpoints
- Device must have a valid active signature for webhook ingestion
- Internal auth token for `POST /internal/mobile-notifications/query`, `POST /internal/notifications/digest/run`, and Fishing Assistant digest evidence routes
- OIDC token or internal auth for `POST /internal/notifications/digest/run-yesterday`
- Digest subscription must exist for the (userId, groupKey) pair

For fishing digest language fixes, regenerate the affected date range after deploy. The hard-coded `grupa-wedkarska-skool` subscription uses `outputLanguage: 'Polish'`, so regenerated summaries, state carry-forward text, and internal fishing digest Markdown labels should be Polish.

---

## Usage Patterns

### Pattern 1: Query for Composite Feed

```
1. Call POST /internal/mobile-notifications/query with userId and filter
2. Merge results with other data sources
3. Present combined feed to user
```

### Pattern 2: Check Device Setup

```
1. Call GET /status
2. If configured === false, prompt user to connect device via POST /connect
3. If configured === true, proceed to show notification feed
```

### Pattern 3: Filtered Browsing

```
1. Call GET /filters to get available options
2. Let user select filters
3. Call GET / with selected filters as query params
4. Optionally save filter as preset via POST /filters/saved
```

### Pattern 4: Browse Daily Digests

```
1. Call GET /digests with groupKey, fromDate, toDate
2. Display headline and bullets for each day
3. On click, call GET /digests/:groupKey/:date for full detail
```

### Pattern 5: Backfill Historical Digests

```
1. Call POST /digests/backfill with groupKey, fromDate, toDate
2. Store returned runId
3. Poll GET /digests/backfill/:runId until status === 'completed' or 'failed'
4. On completion, browse digests via Pattern 4
```

### Pattern 6: Fishing Assistant Evidence Retrieval

```
1. Call POST /internal/notifications/digest-subscriptions/list for the user
2. For each returned groupKey, call POST /internal/notifications/digests/query with date range and optional terms
3. In parallel, call POST /internal/notifications/group-messages/query for supporting message evidence
4. Use returned digest and message evidence as citation sources
```

---

## Events Published

| Event                        | When                         | Payload                                                                                                   |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| WhatsApp send (digest-ready) | First-generation digest save | `{ userId, message, ctaUrl, correlationId, important: true }` via `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` |

---

## Error Handling

| Error Code | Meaning                                     | Recovery Action                            |
| ---------- | ------------------------------------------- | ------------------------------------------ |
| 400        | Missing signature header or invalid request | Add required header or fix request payload |
| 401        | Invalid signature/token                     | Reconnect device or refresh JWT            |
| 403        | Not owner                                   | Verify you own the resource                |
| 404        | Not found                                   | Verify resource ID exists                  |
| 500        | Internal error                              | Retry with backoff                         |

---

## Dependencies

| Service                 | Why Needed            | Failure Behavior                       |
| ----------------------- | --------------------- | -------------------------------------- |
| Firestore               | Persistent storage    | Endpoint returns 500                   |
| Auth0 (JWKS)            | JWT validation        | Public endpoints fail                  |
| Internal Auth           | Service-to-service    | Internal endpoint 401                  |
| OpenRouter              | LLM digest generation | Digest run fails (lock released)       |
| llm-usage-service       | LLM usage reporting   | Fire-and-forget via sink               |
| Pub/Sub (WhatsApp Send) | Digest delivery       | Logged warning; digest still persisted |

---

**Last updated:** 2026-06-12
