# Notion Service — Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Node.js 22+, Auth0 access token, Notion integration token
> **You will learn:** How to connect a Notion workspace, check status, validate page access, and disconnect

---

## What You Will Build

A working integration that:

- Connects your Notion workspace to IntexuraOS
- Queries connection status
- Validates page access via the internal API
- Disconnects cleanly

---

## Prerequisites

Before starting, ensure you have:

- [ ] A valid Auth0 JWT token (Bearer token)
- [ ] A Notion integration token from [notion.so/my-integrations](https://www.notion.so/my-integrations)
- [ ] The notion-service running locally (`PORT=8112`) or access to the Cloud Run instance

---

## Part 1: Connect Notion (5 minutes)

### Step 1.1: Generate a Notion Integration Token

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it (e.g., "IntexuraOS")
4. Copy the "Internal Integration Token" (starts with `secret_`)

### Step 1.2: Connect

```bash
curl -X POST http://localhost:8112/notion/connect \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notionToken": "secret_abc123..."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:00:00.000Z"
  }
}
```

### What Just Happened?

The service received your Notion token, called the Notion API to validate it (via the `users.me` endpoint), then stored the token securely in Firestore along with a `connected: true` flag and timestamps.

---

## Part 2: Check Status (3 minutes)

### Step 2.1: Query Connection Status

```bash
curl -X GET http://localhost:8112/notion/status \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "configured": true,
    "connected": true,
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:00:00.000Z"
  }
}
```

**Checkpoint:** `configured: true` means a connection document exists. `connected: true` means it is active.

### Step 2.2: Check Status for a User Who Never Connected

If you use a token for a different user who has no Notion connection:

```json
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

---

## Part 3: Handle Errors (5 minutes)

### Common Error: Invalid Token

If you provide a token Notion does not recognize:

```bash
curl -X POST http://localhost:8112/notion/connect \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notionToken": "invalid_token_here"
  }'
```

**Response (401):**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid Notion token. Please check your integration token."
  }
}
```

**Solution:** Generate a new token at notion.so/my-integrations. Tokens start with `secret_`.

### Common Error: Missing Token

```bash
curl -X POST http://localhost:8112/notion/connect \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response (400):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "body must have required property 'notionToken'"
  }
}
```

**Solution:** Include the `notionToken` field in the request body.

### Common Error: No Auth Token

```bash
curl -X GET http://localhost:8112/notion/status
```

**Response (401):**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid authorization token"
  }
}
```

**Solution:** Include a valid `Authorization: Bearer <token>` header.

---

## Part 4: Real-World Scenario — Research Export Validation (5 minutes)

This scenario demonstrates how research-agent uses the internal endpoints to validate page access before exporting research results to Notion.

### Step 4.1: Get Connection Context (Internal)

Other services call this endpoint to check if a user has an active Notion connection and retrieve the token:

```bash
curl -X GET http://localhost:8112/internal/notion/users/user-123/context \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "token": "secret_abc123..."
  }
}
```

### Step 4.2: Validate Page Access (Internal)

Before exporting, verify the user's token can access the target Notion page:

```bash
curl -X GET http://localhost:8112/internal/notion/users/user-123/pages/abc-page-id/preview \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN"
```

**Response (page accessible):**

```json
{
  "success": true,
  "data": {
    "title": "My Research Notes",
    "url": "https://notion.so/abc-page-id"
  }
}
```

**Response (page not accessible):**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Page not found or not accessible"
  }
}
```

**Checkpoint:** If the page preview succeeds, the export can proceed. If it returns NOT_FOUND, the user needs to share the page with their Notion integration.

---

## Part 5: Disconnect (2 minutes)

### Step 5.1: Remove the Integration

```bash
curl -X DELETE http://localhost:8112/notion/disconnect \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {}
}
```

### Step 5.2: Verify Disconnection

```bash
curl -X GET http://localhost:8112/notion/status \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "configured": true,
    "connected": false,
    "createdAt": "2026-02-22T10:00:00.000Z",
    "updatedAt": "2026-02-22T10:05:00.000Z"
  }
}
```

Note: `configured: true` because the document still exists, but `connected: false`.

---

## Troubleshooting

| Error              | Cause                        | Solution                                      |
| ------------------ | ---------------------------- | --------------------------------------------- |
| `INVALID_REQUEST`  | Bad token format or missing  | Check token starts with `secret_`             |
| `UNAUTHORIZED`     | Token rejected by Notion     | Regenerate at notion.so/my-integrations       |
| `DOWNSTREAM_ERROR` | Notion API unreachable       | Retry later; check Notion status page         |
| `NOT_FOUND`        | No connection or page access | Connect first, or share page with integration |
| 401 (no token)     | Missing Authorization header | Include `Bearer <token>` header               |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Swagger UI](http://localhost:8112/docs) for interactive API testing
2. Read the [Technical Reference](technical.md) for full endpoint schemas and architecture
3. Check how [research-agent](../research-agent/features.md) uses the page preview endpoint for Notion exports

---

## Exercises

Test your understanding:

1. **Easy:** Connect your Notion workspace and verify the status shows `configured: true`
2. **Medium:** Disconnect, then reconnect with a different token. Verify that `createdAt` is preserved from the first connection while `updatedAt` reflects the reconnection time
3. **Hard:** Use the internal page preview endpoint to verify access to a Notion page, then share a new page with the integration and verify access to that one too

<details>
<summary>Solutions</summary>

### Exercise 1: Connect and Verify

```bash
# Connect
curl -X POST http://localhost:8112/notion/connect \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notionToken": "secret_your_token"}'

# Verify
curl -X GET http://localhost:8112/notion/status \
  -H "Authorization: Bearer $AUTH_TOKEN"
# Expect: configured: true, connected: true
```

### Exercise 2: Reconnect and Check Timestamps

```bash
# Disconnect
curl -X DELETE http://localhost:8112/notion/disconnect \
  -H "Authorization: Bearer $AUTH_TOKEN"

# Reconnect with new token
curl -X POST http://localhost:8112/notion/connect \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notionToken": "secret_new_token"}'

# Check status -- createdAt should be the original timestamp
curl -X GET http://localhost:8112/notion/status \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

### Exercise 3: Page Access Validation

```bash
# Find a Notion page ID from your workspace URL
# notion.so/My-Page-abc123def456 -> page ID is abc123def456

# Verify access
curl -X GET http://localhost:8112/internal/notion/users/$USER_ID/pages/$PAGE_ID/preview \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN"

# Share a new page: in Notion, click "..." > "Connections" > select your integration
# Then verify access to the newly shared page
curl -X GET http://localhost:8112/internal/notion/users/$USER_ID/pages/$NEW_PAGE_ID/preview \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN"
```

</details>
