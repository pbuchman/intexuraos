# notion-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with notion-service.

---

## Identity

| Field    | Value                                                            |
| --------  | ----------------------------------------------------------------  |
| **Name** | notion-service                                                   |
| **Role** | Notion Integration Service                                       |
| **Goal** | Connect and manage Notion workspaces for prompt and data storage |

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
  workspaceName: string;
  workspaceIcon?: string;
}

interface StatusResult {
  connected: boolean;
  workspaceName?: string;
  workspaceIcon?: string;
  connectedAt?: string;
}

interface DisconnectResult {
  disconnected: boolean;
}
```

---

## Constraints

| Rule                      | Description                                      |
| -------------------------  | ------------------------------------------------  |
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
// result.workspaceName: "My Workspace"
```

### Check Connection Status

```typescript
const status = await getNotionStatus();
if (status.connected) {
  console.log(`Connected to ${status.workspaceName}`);
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
                                              │ promptvault-    │
                                              │ service         │
                                              │ (uses token)    │
                                              └─────────────────┘
```

---

## Internal Endpoints

| Method | Path                     | Purpose                                          |
| ------  | ------------------------  | ------------------------------------------------  |
| GET    | `/internal/notion/token` | Get Notion token (called by promptvault-service) |
| POST   | `/webhook`               | Handle Notion webhook events                     |

---

## Used By

- **promptvault-service** - Stores prompts in Notion databases
- **research-agent** - Can export research to Notion pages

---

**Last updated:** 2026-01-19
