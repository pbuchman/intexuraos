# mobile-notifications-service — Agent Interface

## Identity

| Attribute | Value |
| --- | --- |
| Name | `mobile-notifications-service` |
| Role | Android notification capture, storage, filtering, and query |
| Production port | `8114` |
| Public prefix | `/api/notifications` |

Use this service for captured Android notification data only. For scheduled WhatsApp summaries use `message-digest-service`; for private WhatsApp messages and delivery use `whatsapp-service`.

## Internal query capability

**Endpoint:** `POST /internal/mobile-notifications/query`

**Authentication:** `X-Internal-Auth` with the shared internal token.

**Input:**

```typescript
interface QueryNotificationsInput {
  userId: string;
  filter?: {
    app?: string[];
    source?: string;
    title?: string;
  };
  limit?: number; // 1-1000, default 50
}
```

**Output:**

```typescript
interface QueryNotificationsOutput {
  notifications: Array<{
    id: string;
    app: string;
    title: string;
    body: string;
    timestamp: string;
    source: string;
  }>;
}
```

Use the smallest practical limit and explicit filters. The caller is responsible for authorizing why it may query the supplied user.

## User capabilities

User-facing routes derive ownership from the bearer JWT:

- `POST /connect` creates and returns a one-time signature;
- `GET /status` reads connection state;
- `GET /` lists owned notifications;
- `DELETE /:notification_id` deletes an owned notification;
- `GET /filters`, `POST /filters/saved`, and `DELETE /filters/saved/:id` manage filters.

`POST /webhooks` is for the connected Android automation and authenticates with the one-time mobile signature.

## Safety rules

- Never request or log the plaintext connection signature.
- Never infer a user identity from webhook content.
- Never return another user's notification.
- Treat notification bodies as private user data.
- Do not use this service as a WhatsApp conversation source.
- Do not ask this service to generate or deliver summaries.
