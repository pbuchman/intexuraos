# Fishing Assistant Service - Tutorial

Getting started with the Fishing Assistant service HTTP surface.

## Prerequisites

- IntexuraOS dev environment running.
- Bearer token for the user whose fishing data you want to access.
- `INTEXURAOS_OPENAI_APP_API_KEY` configured for knowledge embeddings.
- The user has an OpenRouter key in user-service before sending chat messages that require LLM generation.

## Part 1: Create Knowledge

### Step 1: Create a folder

```bash
curl -X POST "$FISHING_ASSISTANT_URL/folders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Groundbait recipes","sortOrder":10}'
```

**Expected response shape:**

```json
{
  "ok": true,
  "data": {
    "folder": {
      "id": "folder-id",
      "userId": "user-id",
      "name": "Groundbait recipes",
      "parentId": null,
      "sortOrder": 10,
      "pageCount": 0,
      "createdAt": "2026-05-05T12:00:00.000Z",
      "updatedAt": "2026-05-05T12:00:00.000Z"
    }
  }
}
```

### Step 2: Add a knowledge page

```bash
curl -X POST "$FISHING_ASSISTANT_URL/pages" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "folderId": "folder-id",
    "rawText": "River roach groundbait\nUse fine breadcrumb, coriander, and hemp. Feed lightly in cold water."
  }'
```

The service normalizes the text, infers a title, classifies the content, splits it into chunks, creates embeddings, and stores chunks for retrieval. If embeddings fail, the page response can contain `indexingStatus: "failed"` and `indexingError`.

## Part 2: Chat With Sources

### Step 1: Create a chat

```bash
curl -X POST "$FISHING_ASSISTANT_URL/chats" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Step 2: Send a message

```bash
curl -X POST "$FISHING_ASSISTANT_URL/chats/$CHAT_ID/messages" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"What should I use for roach in cold river water?"}'
```

The response returns the updated chat and the stored assistant message. Assistant messages include `citations` and `confidence` when evidence is available.

### Step 3: Retrieve history

```bash
curl -X GET "$FISHING_ASSISTANT_URL/chats/$CHAT_ID/messages" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Messages are returned in creation order. The same history is used as prompt context for later messages in the chat.

## Part 3: Digest Context

These compatibility endpoints retain the existing Fishing Assistant UI contract. They read migrated summaries from Message Digest Service; supporting raw-message evidence used by chat is queried directly from the source-fenced private WhatsApp API.

### List digest groups

```bash
curl -X GET "$FISHING_ASSISTANT_URL/digest-groups" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Query digests

```bash
curl -X GET "$FISHING_ASSISTANT_URL/digests?groupKey=$GROUP_KEY&dateFrom=2026-05-01&dateTo=2026-05-05&terms=roach,river&limit=25" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Load one digest

```bash
curl -X GET "$FISHING_ASSISTANT_URL/digests/$GROUP_KEY/2026-05-05" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Troubleshooting

| Issue | Symptom | What to check |
| ----- | ------- | ------------- |
| Missing message body | `INVALID_REQUEST`, `message is required.` | Send non-empty `message` in `POST /chats/:chatId/messages`. |
| Missing folder/page text | `INVALID_REQUEST` | `POST /pages` needs `folderId` and non-empty `rawText`; `PATCH /pages/:pageId` needs non-empty `rawText`. |
| No OpenRouter key | `NO_API_KEY` | Add the user's OpenRouter key in user-service. |
| Folder contains pages | `FOLDER_NOT_EMPTY` | Delete or move pages before deleting a folder. |
| Digest not found | `NOT_FOUND` from `/digests/:groupKey/:date` | Verify the group key and date. |
| Digest dependency unavailable | `DOWNSTREAM_ERROR` | Check message-digest-service health and the configured internal service URL. |
