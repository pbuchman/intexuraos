# Notion Service - Tutorial

Notion integration management.

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

## Troubleshooting

| Error            | Cause            | Solution             |
| ----------------  | ----------------  | --------------------  |
| INVALID_TOKEN    | Bad token        | Regenerate in Notion |
| DOWNSTREAM_ERROR | Notion API issue | Retry later          |
