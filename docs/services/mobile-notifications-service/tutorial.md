# Mobile Notifications Service - Tutorial

Push notification gateway for mobile apps.

## Prerequisites

- Auth0 access token
- Mobile app with webhook capability

## Part 1: Connect Device

```bash
curl -X POST https://mobile-notifications.intexuraos.com/mobile-notifications/connect \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceLabel": "iPhone 15 Pro"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "conn_123",
    "signature": "abc123...",  // Save this - shown only once
    "deviceLabel": "iPhone 15 Pro",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Important:** The `signature` is shown only once. Store it securely in your app.

## Part 2: Configure Filters

```bash
curl -X PATCH https://mobile-notifications.intexuraos.com/mobile-notifications/filters/filter_id \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false
  }'
```

## Troubleshooting

| Issue          | Solution                                   |
| --------------  | ------------------------------------------  |
| Lost signature | Reconnect device (new signature generated) |
| Not receiving  | Check filter settings                      |
