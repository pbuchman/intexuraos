# Notion Service - Tutorial

Notion integration management and page access validation.

## Prerequisites

- Auth0 access token
- Notion integration token (from notion.so/my-integrations)

## Part 1: Connect Notion

1. Generate token in Notion (notion.so/my-integrations)
2. Connect:

```bash
curl -X POST https://notion-service.intexuraos.com/notion/connect \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notionToken": "secret_xxx..."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "createdAt": "2026-02-08T10:00:00Z",
    "updatedAt": "2026-02-08T10:00:00Z"
  }
}
```

## Part 2: Check Status

```bash
curl -X GET https://notion-service.intexuraos.com/notion/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Part 3: Disconnect

```bash
curl -X DELETE https://notion-service.intexuraos.com/notion/disconnect \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Note:** Disconnect returns an empty data object (`{}`).

## Troubleshooting

| Error            | Cause                       | Solution                       |
| ---------------- | --------------------------- | ------------------------------ |
| INVALID_REQUEST  | Bad token format            | Check token starts with secret_|
| UNAUTHORIZED     | Bad token                   | Regenerate in Notion           |
| DOWNSTREAM_ERROR | Notion API issue            | Retry later                    |
| NOT_FOUND        | No connection or page issue | Connect first or check page ID |
