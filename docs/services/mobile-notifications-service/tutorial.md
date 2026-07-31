# Mobile Notifications Service — Tutorial

This tutorial connects an Android automation, sends one notification, verifies deduplication, and creates a saved filter.

## Prerequisites

- An IntexuraOS bearer token.
- An Android device with Tasker, Automate, or a compatible webhook client.
- The production base URL `https://intexuraos.cloud/api/notifications` or its development equivalent.

```bash
export NOTIFICATIONS_URL="https://intexuraos.cloud/api/notifications"
```

## 1. Create a connection

```bash
curl -X POST "$NOTIFICATIONS_URL/connect" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"deviceLabel":"Android phone"}'
```

Copy the returned signature immediately. It is shown once and replaces any older connection for the user.

## 2. Configure the phone

Create an automation triggered by a new notification. Send a JSON webhook to `$NOTIFICATIONS_URL/webhooks` with the connection signature in the documented mobile-signature header. Map the source, device, app package, notification identity, title, text, and source timestamp.

Keep the signature in the automation's protected secret storage. Do not place it in screenshots, logs, or shared configuration.

## 3. Verify capture

```bash
curl "$NOTIFICATIONS_URL/status" \
  -H "Authorization: Bearer <access-token>"

curl "$NOTIFICATIONS_URL/?limit=20&app=com.example.app" \
  -H "Authorization: Bearer <access-token>"
```

The first endpoint confirms the connection and latest receive time. The second returns the user's matching notification history.

Send the same webhook identity twice. The second response should report an ignored duplicate and the list should still contain one row.

## 4. Create a saved filter

```bash
curl -X POST "$NOTIFICATIONS_URL/filters/saved" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Delivery alerts","app":["com.example.delivery"]}'
```

Read `/filters` to see discovered options and saved presets. Delete a preset with `DELETE /filters/saved/:id`.

## 5. Delete a notification

```bash
curl -X DELETE "$NOTIFICATIONS_URL/<notification-id>" \
  -H "Authorization: Bearer <access-token>"
```

Only the owner can delete the row.

## WhatsApp summaries

To configure a scheduled group or direct-chat summary, use **WhatsApp → Message Digests** in the web application. That workflow uses private WhatsApp data and does not depend on captured Android notifications.
