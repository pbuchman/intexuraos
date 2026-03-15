# Mobile Notifications Service — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** Auth0 access token, Android device with Tasker or Automate
> **You will learn:** How to pair a device, capture notifications, browse and filter them, and manage saved filters

---

## What You Will Build

A working integration that:

- Pairs an Android device with IntexuraOS via signature token
- Captures mobile notifications through a webhook pipeline
- Lists and filters stored notifications
- Creates and manages saved filter presets

---

## Prerequisites

Before starting, ensure you have:

- [ ] Auth0 access token (Bearer JWT) for public endpoints
- [ ] Internal auth token (for internal query endpoint only)
- [ ] Android device with Tasker or Automate installed
- [ ] Access to the IntexuraOS environment (local or Cloud Run)

**Base URL (local):** `http://localhost:8114`

---

## Part 1: Connect Your Device (5 minutes)

Register your device to receive a signature token.

### Step 1.1: Create a Connection

```bash
curl -X POST http://localhost:8114/mobile-notifications/connect \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceLabel": "Pixel 8 Pro"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "connectionId": "abc123def456",
    "signature": "a1b2c3d4e5f6...64-hex-characters"
  }
}
```

**Important:** Copy the `signature` value immediately. It is shown only once. The service stores only a SHA-256 hash. If you lose this token, you must create a new connection (which deletes the previous one).

### Step 1.2: Verify Connection Status

```bash
curl http://localhost:8114/mobile-notifications/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "configured": true,
    "lastNotificationAt": null
  }
}
```

`lastNotificationAt` is null because no notifications have been received yet.

### What Just Happened?

The service generated a 256-bit random token (64 hex characters), computed its SHA-256 hash, stored the hash in Firestore, and returned the plaintext to you. Any existing signature for your user was deleted first — only one active signature per user at a time.

---

## Part 2: Send a Test Notification (5 minutes)

Simulate what Tasker/Automate sends when a notification appears on your device.

### Step 2.1: Post to the Webhook

```bash
curl -X POST http://localhost:8114/mobile-notifications/webhooks \
  -H "X-Mobile-Notifications-Signature: a1b2c3d4e5f6...your-signature-here" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "tasker",
    "device": "Pixel 8 Pro",
    "app": "com.whatsapp",
    "notification_id": "test-notif-001",
    "title": "Alice: hey!",
    "text": "are you free tonight?",
    "timestamp": 1708345200000,
    "post_time": "2026-02-22 12:00:00"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "status": "accepted",
    "id": "firestore-doc-id"
  }
}
```

### Step 2.2: Test Idempotency

Send the same request again with the same `notification_id`:

```bash
curl -X POST http://localhost:8114/mobile-notifications/webhooks \
  -H "X-Mobile-Notifications-Signature: a1b2c3d4e5f6...your-signature-here" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "tasker",
    "device": "Pixel 8 Pro",
    "app": "com.whatsapp",
    "notification_id": "test-notif-001",
    "title": "Alice: hey!",
    "text": "are you free tonight?",
    "timestamp": 1708345200000,
    "post_time": "2026-02-22 12:00:00"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "status": "ignored",
    "reason": "duplicate"
  }
}
```

The duplicate is silently ignored. No error, no duplicate entry.

**Checkpoint:** Your connection status should now show `lastNotificationAt` with a timestamp.

---

## Part 3: List and Filter Notifications (10 minutes)

### Step 3.1: List All Notifications

```bash
curl "http://localhost:8114/mobile-notifications" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "firestore-doc-id",
        "source": "tasker",
        "device": "Pixel 8 Pro",
        "app": "com.whatsapp",
        "title": "Alice: hey!",
        "text": "are you free tonight?",
        "timestamp": 1708345200000,
        "postTime": "2026-02-22 12:00:00",
        "receivedAt": "2026-02-22T12:00:00.123Z"
      }
    ]
  }
}
```

### Step 3.2: Filter by App

```bash
curl "http://localhost:8114/mobile-notifications?app=com.whatsapp" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Multiple apps use comma separation: `?app=com.whatsapp,com.telegram`

### Step 3.3: Search by Title

```bash
curl "http://localhost:8114/mobile-notifications?title=alice" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Title search is case-insensitive partial match performed in memory after the Firestore query.

### Step 3.4: Paginate Results

```bash
curl "http://localhost:8114/mobile-notifications?limit=2" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

If the response includes `nextCursor`, pass it to get the next page:

```bash
curl "http://localhost:8114/mobile-notifications?limit=2&cursor=CURSOR_VALUE" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Part 4: Manage Saved Filters (5 minutes)

### Step 4.1: View Available Filter Options

```bash
curl "http://localhost:8114/notifications/filters" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "options": {
      "app": ["com.whatsapp"],
      "device": ["Pixel 8 Pro"],
      "source": ["tasker"]
    },
    "savedFilters": [],
    "createdAt": "2026-02-22T12:00:00Z",
    "updatedAt": "2026-02-22T12:00:01Z"
  }
}
```

The `options` arrays auto-populate from received notifications as they arrive.

### Step 4.2: Create a Saved Filter

```bash
curl -X POST "http://localhost:8114/notifications/filters/saved" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Work Chats",
    "app": ["com.slack", "com.microsoft.teams"]
  }'
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid-of-saved-filter",
    "name": "Work Chats",
    "app": ["com.slack", "com.microsoft.teams"],
    "createdAt": "2026-02-22T12:05:00Z"
  }
}
```

### Step 4.3: Delete a Saved Filter

```bash
curl -X DELETE "http://localhost:8114/notifications/filters/saved/uuid-of-saved-filter" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Returns **204 No Content** on success (empty body).

---

## Part 5: Delete a Notification (2 minutes)

```bash
curl -X DELETE "http://localhost:8114/mobile-notifications/firestore-doc-id" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response (200):**

```json
{
  "success": true,
  "data": {}
}
```

Returns 404 if not found, 403 if the notification belongs to another user.

---

## Part 6: Handle Errors (3 minutes)

### Missing Signature Header

```bash
curl -X POST http://localhost:8114/mobile-notifications/webhooks \
  -H "Content-Type: application/json" \
  -d '{ "source": "tasker", "device": "Test", "app": "com.test", "notification_id": "1", "title": "t", "text": "b", "timestamp": 0, "post_time": "now" }'
```

**Response (400):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Missing X-Mobile-Notifications-Signature header"
  }
}
```

### Invalid Signature

**Response (401):**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid signature"
  }
}
```

---

## Response Format

All endpoints return a standardized response contract:

- **Success:** `{ "success": true, "data": { ... } }`
- **Error:** `{ "success": false, "error": { "code": "...", "message": "..." } }`
- **Exception:** `DELETE /notifications/filters/saved/:id` returns 204 No Content (empty body)

---

## Troubleshooting

| Issue                           | Solution                                                |
| ------------------------------- | ------------------------------------------------------- |
| Lost signature                  | Reconnect device (`POST /connect` gives new signature)  |
| Webhook 400 (missing header)    | Ensure `X-Mobile-Notifications-Signature` header is set |
| Webhook 401 (invalid signature) | Signature does not match stored hash; reconnect         |
| Empty filter options            | No notifications received yet; options auto-populate    |
| Duplicate notification ignored  | Normal; `notification_id` deduplication is intentional  |
| 403 on DELETE                   | You do not own that notification                        |

---

## Exercises

Test your understanding:

1. **Easy:** Connect a device, send 3 notifications from different apps, and list them filtered by one app
2. **Medium:** Send 5+ notifications and paginate through them with `limit=2`, following the `nextCursor` chain
3. **Hard:** Create a saved filter for two apps, verify it appears in `GET /notifications/filters`, then delete it

<details>
<summary>Solutions</summary>

### Exercise 1: Connect and Filter

```bash
# Connect
curl -X POST http://localhost:8114/mobile-notifications/connect \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceLabel": "Test Device"}'

# Save the signature from the response, then send 3 notifications from different apps
for APP in com.whatsapp com.telegram com.slack; do
  curl -X POST http://localhost:8114/mobile-notifications/webhooks \
    -H "X-Mobile-Notifications-Signature: $SIGNATURE" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"tasker\",\"device\":\"Test\",\"app\":\"$APP\",\"notification_id\":\"$APP-001\",\"title\":\"Test\",\"text\":\"Hello\",\"timestamp\":$(date +%s)000,\"post_time\":\"$(date)\"}"
done

# Filter by one app
curl "http://localhost:8114/mobile-notifications?app=com.whatsapp" \
  -H "Authorization: Bearer $TOKEN"
```

### Exercise 2: Pagination

```bash
# List with limit=2
curl "http://localhost:8114/mobile-notifications?limit=2" -H "Authorization: Bearer $TOKEN"
# Copy nextCursor from response, then get next page
curl "http://localhost:8114/mobile-notifications?limit=2&cursor=CURSOR" -H "Authorization: Bearer $TOKEN"
```

### Exercise 3: Saved Filters

```bash
# Create saved filter
curl -X POST "http://localhost:8114/notifications/filters/saved" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Messaging","app":["com.whatsapp","com.telegram"]}'

# Verify it appears
curl "http://localhost:8114/notifications/filters" -H "Authorization: Bearer $TOKEN"

# Delete it (use the id from the create response)
curl -X DELETE "http://localhost:8114/notifications/filters/saved/FILTER_ID" \
  -H "Authorization: Bearer $TOKEN"
```

</details>

---

## Next Steps

Now that you understand the basics:

1. Configure Tasker or Automate on your Android device to forward notifications to the webhook endpoint
2. Read the [Technical Reference](technical.md) for full API details and domain model documentation
3. Explore the internal query endpoint for building data aggregation pipelines with the data-insights-agent
