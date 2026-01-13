# Notion Service - Technical Reference

## Overview

Notion-service manages the lifecycle of Notion integrations - connection validation, token storage, and disconnection.

## API Endpoints

| Method   | Path                 | Description                | Auth         |
| --------  | --------------------  | --------------------------  | ------------  |
| POST     | `/notion/connect`    | Connect Notion integration | Bearer token |
| GET      | `/notion/status`     | Get integration status     | Bearer token |
| DELETE   | `/notion/disconnect` | Disconnect integration     | Bearer token |

### Connect Request

```typescript
{
  notionToken: string  // Notion integration token
}
```

### Connect Response

```typescript
{
  connectionId: string,
  workspaceName: string,
  workspaceIcon: string | null,
  workspaceId: string
}
```

### Status Response

```typescript
{
  connected: boolean,
  workspaceName?: string,
  workspaceIcon?: string,
  workspaceId?: string
}
```

### Disconnect Response

```typescript
{
  message: "Notion integration disconnected"
}
```

## Error Codes

| Code               | HTTP Status   | Description              |
| ------------------  | -------------  | ------------------------  |
| `VALIDATION_ERROR` | 400           | Invalid token format     |
| `INVALID_TOKEN`    | 401           | Token rejected by Notion |
| `DOWNSTREAM_ERROR` | 502           | Notion API error         |

## Dependencies

**Infrastructure:**
- Firestore (`notion_connections` collection) - Connection storage

**External APIs:**
- Notion API - Token validation and workspace info

## Configuration

| Environment Variable             | Required   | Description                     |
| --------------------------------  | ----------  | -------------------------------  |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes        | Shared secret for internal auth |

## Gotchas

**Token validation** - Connect calls Notion API to validate. Invalid tokens return 401.

**One integration per user** - Reconnecting replaces existing connection.

**Cascading delete** - Disconnecting affects PromptVault which depends on Notion.

**Workspace detection** - Uses Notion's search API to find workspace info.

## File Structure

```
apps/notion-service/src/
  domain/integration/
    usecases/
      connectNotion.ts
      disconnectNotion.ts
      getNotionStatus.ts
  infra/
    firestore/
      notionConnectionRepository.ts
    notion/
      notionApi.ts
  routes/
    integrationRoutes.ts   # Connect/status/disconnect
    webhookRoutes.ts        # Notion webhooks
    internalRoutes.ts
  services.ts
  server.ts
```
