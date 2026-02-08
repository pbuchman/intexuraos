# notion-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with notion-service.

---

## Identity

| Field    | Value                                                                    |
| -------- | ------------------------------------------------------------------------ |
| **Name** | notion-service                                                           |
| **Role** | Notion Integration Service                                               |
| **Goal** | Connect and manage Notion workspaces for research export and page access |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface NotionServiceTools {
  // Connect Notion integration
  connectNotion(params: { notionToken: string }): Promise<ConnectResult>;

  // Get integration status
  getNotionStatus(): Promise<StatusResult>;

  // Disconnect integration
  disconnectNotion(): Promise<DisconnectResult>;
}
```

### Types

```typescript
interface ConnectResult {
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StatusResult {
  configured: boolean;
  connected: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface PagePreview {
  title: string;
  url: string;
}
```

---

## Constraints

| Rule                      | Description                                      |
| ------------------------- | ------------------------------------------------ |
| **Notion Token Required** | User must provide valid Notion integration token |
| **Single Workspace**      | One Notion workspace per user                    |
| **Token Validation**      | Token validated with Notion API before storing   |

---

## Usage Patterns

### Connect Notion Workspace

```typescript
const result = await connectNotion({
  notionToken: 'secret_...',
});
// result.connected: true
// result.createdAt: "2026-02-08T10:00:00Z"
```

### Check Connection Status

```typescript
const status = await getNotionStatus();
if (status.connected) {
  console.log(`Connected since ${status.createdAt}`);
}
```

### Disconnect Integration

```typescript
await disconnectNotion();
// Removes stored token and connection
```

---

## Integration Flow

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    User      │────▶│ Notion OAuth     │────▶│ notion-service  │
│              │     │ (get token)      │     │ (validate/store)│
└──────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │ research-agent  │
                                              │ (uses token)    │
                                              └─────────────────┘
```

---

## Internal Endpoints

| Method | Path                                                           | Purpose                                        |
| ------ | -------------------------------------------------------------- | ---------------------------------------------- |
| GET    | `/internal/notion/users/:userId/context`                       | Get connection context and token               |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview`         | Get page preview (title and URL)               |

---

## Used By

- **research-agent** - Exports research to Notion pages, validates page access via preview endpoint

---

**Last updated:** 2026-02-08
