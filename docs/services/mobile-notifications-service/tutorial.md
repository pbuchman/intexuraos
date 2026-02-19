# Mobile Notifications Service - Tutorial

Push notification gateway for Android devices via Tasker/Automate.

## Prerequisites

- Auth0 access token (Bearer JWT)
- Android device with Tasker or Automate app installed
- Internal auth token (for internal queries only)

## Part 1: Connect Device

Register your device to receive a signature token:

```bash
curl -X POST https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications/connect \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceLabel": "Pixel 8 Pro"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "connectionId": "conn_abc123",
    "signature": "a1b2c3d4..." // Save this - shown only once!
  }
}
```

**Important:** Copy the `signature` immediately. It is shown only once; the service stores only a SHA-256 hash. Creating a new connection also deletes any previous signature for your account — only one active signature per user.

## Part 2: Check Connection Status

Verify the device is connected:

```bash
curl https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "configured": true,
    "lastNotificationAt": "2026-02-19T11:59:00Z"
  }
}
```

## Part 3: Send Notification from Device

Configure Tasker/Automate to POST to the webhook endpoint. The `notification_id` must be unique per user per notification (acts as idempotency key):

```bash
curl -X POST https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications/webhooks \
  -H "X-Mobile-Notifications-Signature: a1b2c3d4..." \
  -H "Content-Type: application/json" \
  -d '{
    "source": "tasker",
    "device": "Pixel 8 Pro",
    "app": "com.whatsapp",
    "notification_id": "unique-id-from-device-001",
    "title": "Alice: hey!",
    "text": "are you free tonight?",
    "timestamp": 1708345200000,
    "post_time": "2026-02-19 12:00:00"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "accepted",
    "id": "notif_xyz789"
  }
}
```

If `notification_id` was already received, `status` will be `"ignored"` with `"reason": "duplicate"`.

## Part 4: List Notifications

Retrieve stored notifications with optional filtering:

```bash
# All notifications, default limit 50
curl "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by app (comma-separated)
curl "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications?app=com.whatsapp,com.telegram&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Title search
curl "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications?title=alice" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notif_xyz789",
        "userId": "user123",
        "source": "tasker",
        "device": "Pixel 8 Pro",
        "app": "com.whatsapp",
        "title": "Alice: hey!",
        "text": "are you free tonight?",
        "timestamp": 1708345200000,
        "postTime": "2026-02-19 12:00:00",
        "receivedAt": "2026-02-19T12:00:00.123Z",
        "notificationId": "unique-id-from-device-001"
      }
    ],
    "nextCursor": "cursor_abc"
  }
}
```

Pass `cursor=cursor_abc` to fetch the next page.

## Part 5: Manage Saved Filters

### Get current filter options

```bash
curl "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/notifications/filters" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "options": {
      "app": ["com.whatsapp", "com.telegram", "com.slack"],
      "device": ["Pixel 8 Pro"],
      "source": ["tasker"]
    },
    "savedFilters": [],
    "createdAt": "2026-02-19T10:00:00Z",
    "updatedAt": "2026-02-19T12:00:00Z"
  }
}
```

`options` auto-populates from received notifications. Empty arrays until first notification arrives.

### Create a saved filter

```bash
curl -X POST "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/notifications/filters/saved" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Work Chats",
    "app": ["com.slack", "com.microsoft.teams"]
  }'
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "filter_abc",
    "name": "Work Chats",
    "app": ["com.slack", "com.microsoft.teams"],
    "createdAt": "2026-02-19T12:00:00Z"
  }
}
```

### Delete a saved filter

```bash
curl -X DELETE "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/notifications/filters/saved/filter_abc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Returns **204 No Content** on success.

## Part 6: Delete a Notification

```bash
curl -X DELETE "https://intexuraos-mobile-notifications-service-cj44trunra-lm.a.run.app/mobile-notifications/notif_xyz789" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{
  "success": true,
  "data": {}
}
```

Returns 403 if the notification belongs to another user, 404 if not found.

## Response Format

All endpoints return a standardized response contract:

- **Success:** `{ "success": true, "data": { ... } }`
- **Error:** `{ "success": false, "error": { "code": "...", "message": "..." } }`
- **Exception:** `DELETE /notifications/filters/saved/:id` returns 204 No Content (empty body)

## Exercises

1. **Connect and test**: Register a connection, send a test webhook, list notifications to verify storage
2. **Pagination**: Send 5+ notifications and paginate through them with `limit=2`
3. **Filtering**: Send from two apps, then list with `app=` filter to verify
4. **Saved filter**: Create a saved filter for your most-used apps, then delete it

## Troubleshooting

| Issue                            | Solution                                              |
| -------------------------------- | ----------------------------------------------------- |
| Lost signature                   | Reconnect device (`POST /connect` → new signature)    |
| Webhook 400 (missing header)     | Ensure `X-Mobile-Notifications-Signature` header sent |
| Webhook 401 (invalid signature)  | Signature doesn't match stored hash; reconnect        |
| Empty filter options             | No notifications received yet; options auto-populate  |
| Duplicate notification ignored   | Normal; `notification_id` deduplication is intentional|
