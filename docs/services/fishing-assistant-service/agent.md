# Agent Context: fishing-assistant-service

> **System Note:** This file is optimized for LLM consumption. Load this into context when an agent needs to interact with `fishing-assistant-service`.

## Identity

- **Name:** `fishing-assistant-service`
- **Role:** User-scoped Fishing Assistant chat, knowledge-base, and digest API.
- **Primary Goal:** Answer fishing questions from stored knowledge and mobile notification context with validated citations.

## Capabilities

### HTTP Endpoints

| Method | Path | Purpose | Input Schema |
| :--- | :--- | :--- | :--- |
| GET | `/status` | Service readiness response. | None |
| GET | `/chats` | List the user's chats. | None |
| POST | `/chats` | Create a chat. | None |
| GET | `/chats/:chatId` | Load one user-owned chat. | Path `chatId` |
| GET | `/chats/:chatId/messages` | List messages for one user-owned chat. | Path `chatId` |
| POST | `/chats/:chatId/messages` | Send a user message and store a generated assistant reply. | Path `chatId`, body `{ message: string }` |
| GET | `/folders` | List knowledge folders. | None |
| POST | `/folders` | Create a knowledge folder. | Body `{ name: string; parentId?: string | null; sortOrder?: number }` |
| PATCH | `/folders/:folderId` | Update a knowledge folder. | Path `folderId`, body `{ name: string; parentId?: string | null; sortOrder?: number }` |
| DELETE | `/folders/:folderId` | Delete an empty knowledge folder. | Path `folderId` |
| GET | `/pages` | List knowledge pages, optionally by folder. | Query `{ folderId?: string }` |
| POST | `/pages` | Create and index a knowledge page. | Body `{ folderId: string; rawText: string }` |
| GET | `/pages/:pageId` | Load one user-owned page. | Path `pageId` |
| PATCH | `/pages/:pageId` | Update and reindex page text. | Path `pageId`, body `{ rawText: string }` |
| DELETE | `/pages/:pageId` | Delete a page and its chunks. | Path `pageId` |
| POST | `/pages/:pageId/reindex` | Reindex a page's current raw text. | Path `pageId` |
| GET | `/digest-groups` | List mobile notification digest subscriptions. | None |
| GET | `/digests` | Query digests. | Query `{ groupKey: string; dateFrom: string; dateTo: string; terms?: string; limit?: string }` |
| GET | `/digests/:groupKey/:date` | Load one digest and digest state. | Path `groupKey`, `date` |

### Pub/Sub Events

- **Publishes:** None.
- **Subscribes:** None.

## Critical Rules and Constraints

1. Do not invent Fishing Assistant endpoints; route files define the current HTTP surface.
2. Treat all folder, page, chat, and message access as user-scoped. Repositories check `userId` before returning data.
3. Chat generation requires the user's OpenRouter API key from user-service; missing keys are a handled `NO_API_KEY` error.
4. Knowledge pages are authoritative evidence when present; digest and raw-message evidence are supporting context.
5. Assistant citations must reference known evidence source IDs. Prompt aliases are remapped before storage.
6. Firestore timestamps in route responses are serialized to ISO strings.
7. Use `logIncomingRequest()` on new routes and keep `bodyPreviewLength: 0` for raw message/page text bodies.

## Storage Ownership

- `fishing_knowledge_folders`
- `fishing_knowledge_pages`
- `fishing_knowledge_chunks`
- `fishing_chats`
- `fishing_chat_messages`

## Dependencies

- Firestore repositories in `src/infra/firestore`.
- OpenAI embeddings through `src/infra/llm/embeddingClient.ts`.
- Fixed chat model adapter in `src/infra/llm/fixedGeminiFlashClient.ts`.
- user-service for user OpenRouter keys.
- mobile-notifications-service for digest subscriptions, digest pages, digest state, and raw group messages.
- llm-usage-service through `HttpInternalAuthUsageSink`.

## Usage Patterns

**User Request:** "Add a fishing note and ask a question about it."

**Agent Action:**

```json
{
  "service": "fishing-assistant-service",
  "steps": [
    { "method": "POST", "path": "/folders", "body": { "name": "Notes" } },
    { "method": "POST", "path": "/pages", "body": { "folderId": "folder-id", "rawText": "source text" } },
    { "method": "POST", "path": "/chats" },
    { "method": "POST", "path": "/chats/chat-id/messages", "body": { "message": "question" } }
  ]
}
```

**User Request:** "Show me what the assistant said earlier."

**Agent Action:**

```json
{
  "service": "fishing-assistant-service",
  "method": "GET",
  "path": "/chats/chat-id/messages"
}
```
