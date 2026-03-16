# notion-service — Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute | Value                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| Name      | notion-service                                                               |
| Role      | Manage Notion integration lifecycle and validate page access                 |
| Goal      | Provide secure token storage, connection state tracking, and page validation |

## Capabilities

### Connect Notion Integration

**Endpoint:** `POST /notion/connect`

**When to use:** When a user provides a Notion integration token and wants to link their workspace.

**Input Schema:**

```typescript
interface ConnectInput {
  notionToken: string; // Notion integration token (starts with secret_)
}
```

**Output Schema:**

```typescript
interface ConnectOutput {
  connected: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

**Example:**

```json
// Request
{ "notionToken": "secret_abc123def456" }

// Response
{
  "success": true,
  "data": {
    "connected": true,
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:00:00.000Z"
  }
}
```

### Get Connection Status

**Endpoint:** `GET /notion/status`

**When to use:** When displaying Notion integration state in UI or checking before operations.

**Output Schema:**

```typescript
interface StatusOutput {
  configured: boolean; // Connection doc exists in Firestore
  connected: boolean;  // Connection is active
  createdAt: string | null;
  updatedAt: string | null;
}
```

**Example:**

```json
// Response (connected)
{
  "success": true,
  "data": {
    "configured": true,
    "connected": true,
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:00:00.000Z"
  }
}

// Response (never connected)
{
  "success": true,
  "data": {
    "configured": false,
    "connected": false,
    "createdAt": null,
    "updatedAt": null
  }
}
```

### Disconnect Integration

**Endpoint:** `DELETE /notion/disconnect`

**When to use:** When a user wants to remove their Notion integration.

**Output Schema:**

```typescript
// Returns empty data object
interface DisconnectOutput {} // {}
```

**Example:**

```json
// Response
{ "success": true, "data": {} }
```

### Get Connection Context (Internal)

**Endpoint:** `GET /internal/notion/users/:userId/context`

**When to use:** When another service needs to check if a user has an active Notion connection and retrieve the token for API calls.

**Auth:** `X-Internal-Auth` header with shared secret.

**Output Schema:**

```typescript
interface ContextOutput {
  connected: boolean;
  token: string | null; // Notion API token (null if not connected)
}
```

**Example:**

```json
// Response (connected)
{ "success": true, "data": { "connected": true, "token": "secret_abc123" } }

// Response (not connected)
{ "success": true, "data": { "connected": false, "token": null } }
```

### Get Page Preview (Internal)

**Endpoint:** `GET /internal/notion/users/:userId/pages/:pageId/preview`

**When to use:** When validating that a user's Notion token can access a specific page before performing exports or reads.

**Auth:** `X-Internal-Auth` header with shared secret.

**Output Schema:**

```typescript
interface PagePreviewOutput {
  title: string;
  url: string;
}
```

**Example:**

```json
// Response (page accessible)
{
  "success": true,
  "data": {
    "title": "My Research Notes",
    "url": "https://notion.so/abc-page-id"
  }
}

// Response (page not accessible)
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Page not found or not accessible" }
}
```

### Receive Webhook (Stub)

**Endpoint:** `POST /notion-webhooks`

**When to use:** Do not actively call this endpoint. It exists as a receiver for Notion-initiated webhook events. Currently a stub that logs payloads only.

**Auth:** None required.

**Output Schema:**

```typescript
interface WebhookOutput {
  received: boolean; // Always true
}
```

## Constraints

**Do NOT:**

- Call connect without a valid `secret_*` token — the service validates eagerly and rejects bad tokens
- Assume token persistence after disconnect — disconnected users return `token: null` from the context endpoint
- Expect webhook side effects — `POST /notion-webhooks` is a logging stub with no processing

**Requires:**

- Bearer JWT token (public endpoints) or X-Internal-Auth (internal endpoints)
- User must generate a Notion integration token manually at notion.so/my-integrations
- For page preview: user must have an active connection (`connected: true`)

## Usage Patterns

### Pattern 1: Connection Lifecycle

```
1. POST /notion/connect with { notionToken: "secret_..." }
2. GET /notion/status to verify connected: true
3. (Later) DELETE /notion/disconnect to remove
```

### Pattern 2: Research Export Preparation (service-to-service)

```
1. GET /internal/notion/users/:userId/context
2. If connected: false, abort export and notify user
3. GET /internal/notion/users/:userId/pages/:pageId/preview
4. If NOT_FOUND, notify user to share page with integration
5. If success, proceed with export using the returned title/url
```

### Pattern 3: Check Before UI Render

```
1. GET /notion/status
2. If configured: false -> show "Set up Notion" button
3. If configured: true, connected: false -> show "Reconnect" prompt
4. If connected: true -> show "Connected" badge with timestamps
```

## Error Handling

| Error Code         | HTTP | Meaning                            | Recovery Action                               |
| ------------------ | ---- | ---------------------------------- | --------------------------------------------- |
| INVALID_REQUEST    | 400  | Missing or malformed token         | Check request body has notionToken field      |
| UNAUTHORIZED       | 401  | Token rejected by Notion API       | Generate new token at notion.so               |
| NOT_FOUND          | 404  | No connection or page inaccessible | Connect first, or share page with integration |
| DOWNSTREAM_ERROR   | 502  | Notion API or Firestore error      | Retry with backoff                            |

## Events Published

None. This service does not publish Pub/Sub events.

## Dependencies

| Service          | Why Needed                     | Failure Behavior            |
| ---------------- | ------------------------------ | --------------------------- |
| Notion API       | Token validation, page access  | Return DOWNSTREAM_ERROR     |
| Firestore        | Connection state storage       | Return DOWNSTREAM_ERROR     |

## Used By

| Service        | Endpoint Used                                              | Purpose                             |
| -------------- | ---------------------------------------------------------- | ----------------------------------- |
| research-agent | `GET /internal/notion/users/:userId/context`               | Get token for Notion export         |
| research-agent | `GET /internal/notion/users/:userId/pages/:pageId/preview` | Validate page access before export  |

---

**Last updated:** 2026-03-15
