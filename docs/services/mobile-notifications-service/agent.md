# mobile-notifications-service — Agent Interface

> Machine-readable specification for AI agent integration

---

## Identity

| Attribute | Value                                                 |
| --------- | ----------------------------------------------------- |
| Name      | mobile-notifications-service                          |
| Role      | Mobile notification capture and storage service       |
| Goal      | Capture, store, and query mobile device notifications |
| Port      | 8114                                                  |

---

## Capabilities

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
  limit?: number;     // 1–1000, default 50
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

**Endpoint:** `GET /mobile-notifications`

**When to use:** When displaying notifications to the authenticated user.

**Auth:** Bearer JWT

**Input Schema:**

```typescript
interface ListNotificationsParams {
  limit?: number;   // 1–100, default 50
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
  timestamp: number;   // Unix milliseconds from device
  postTime: string;
  receivedAt: string;  // ISO 8601 server-side receipt time
}
```

### Create Connection

**Endpoint:** `POST /mobile-notifications/connect`

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

**Endpoint:** `GET /mobile-notifications/status`

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

**Endpoint:** `POST /mobile-notifications/webhooks`

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
  timestamp: number;
  post_time: string;
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

### Get Filter Options

**Endpoint:** `GET /notifications/filters`

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

**Endpoint:** `POST /notifications/filters/saved`

**Auth:** Bearer JWT. Returns 201 Created.

**Input Schema:**

```typescript
interface CreateSavedFilterInput {
  name: string;     // 1–100 characters, required
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
}
```

### Delete Saved Filter

**Endpoint:** `DELETE /notifications/filters/saved/:id`

**Auth:** Bearer JWT. Returns 204 No Content on success, 404 if not found.

### Delete Notification

**Endpoint:** `DELETE /mobile-notifications/:notification_id`

**Auth:** Bearer JWT. Returns 200 `{ success: true, data: {} }` on success, 403 if not owner, 404 if not found.

---

## Constraints

**Do NOT:**

- Call the internal query endpoint without `X-Internal-Auth` header — returns 401
- Expect the plaintext signature after the initial `POST /connect` response — it is never re-shown
- Send notifications without the `X-Mobile-Notifications-Signature` header — returns 400
- Call `GET /notifications/filters` expecting 404 for new users — returns empty arrays instead

**Requires:**

- User must be authenticated (Bearer JWT) for all public endpoints
- Device must have a valid active signature for webhook ingestion
- Internal auth token for `POST /internal/mobile-notifications/query`

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
1. Call GET /mobile-notifications/status
2. If configured === false, prompt user to connect device via POST /mobile-notifications/connect
3. If configured === true, proceed to show notification feed
```

### Pattern 3: Filtered Browsing

```
1. Call GET /notifications/filters to get available options
2. Let user select filters
3. Call GET /mobile-notifications with selected filters as query params
4. Optionally save filter as preset via POST /notifications/filters/saved
```

---

## Error Handling

| Error Code | Meaning                  | Recovery Action                             |
| ---------- | ------------------------ | ------------------------------------------- |
| 400        | Missing signature header | Add X-Mobile-Notifications-Signature header |
| 401        | Invalid signature/token  | Reconnect device or refresh JWT             |
| 403        | Not owner                | Verify you own the resource                 |
| 404        | Not found                | Verify resource ID exists                   |
| 500        | Internal error           | Retry with backoff                          |

---

## Dependencies

| Service       | Why Needed         | Failure Behavior      |
| ------------- | ------------------ | --------------------- |
| Firestore     | Persistent storage | Endpoint returns 500  |
| Auth0 (JWKS)  | JWT validation     | Public endpoints fail |
| Internal Auth | Service-to-service | Internal endpoint 401 |

---

**Last updated:** 2026-03-15
