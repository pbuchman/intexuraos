# Fishing Knowledge Base Timestamp Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `Invalid time value` UI error when opening the existing Fishing Assistant knowledge base by returning and consuming valid ISO timestamp strings.

**Architecture:** Keep Firestore `Timestamp` values inside the fishing-assistant domain/repositories, but serialize all HTTP response DTOs at the route boundary. Add a web compatibility parser for the legacy JSON Firestore timestamp object shape so the UI stays functional during rollout and so tests cover the exact failing payload shape.

**Tech Stack:** Fastify routes in `apps/fishing-assistant-service`, Firestore `Timestamp` from `@intexuraos/infra-firestore`, React/Vite web client in `apps/web`, Vitest.

---

## Investigation Findings

Root cause: `apps/fishing-assistant-service` returns domain models containing Firestore `Timestamp` instances directly from the route handlers. Fastify/JSON serializes those instances as objects like:

```json
{"_seconds":1778157296,"_nanoseconds":789000000}
```

`apps/web/src/services/fishingAssistantApi.ts` expects timestamps to be strings, `Date`s, or in-memory objects with `toDate()`. Over HTTP, the object has no `toDate()`, so the fallback runs:

```typescript
new Date(String(value)).toISOString()
```

For the JSON object payload, `String(value)` is `[object Object]`; `new Date('[object Object]')` is invalid; `toISOString()` throws `RangeError: Invalid time value`.

Evidence gathered on 2026-05-07:

- Production Firestore documents in `fishing_knowledge_folders` and `fishing_knowledge_pages` store valid Firestore `Timestamp` values for `createdAt` and `updatedAt`.
- Local serialization reproduction with the same `@google-cloud/firestore` `Timestamp` package produced `{"_seconds":...,"_nanoseconds":...}` and then reproduced `RangeError: Invalid time value` with the current web fallback.
- Cloud Run logs for `intexuraos-fishing-assistant-service` show the service is healthy; no matching backend `Invalid time value` errors appear. The exception is client-side after a successful API response.
- The same timestamp contract leak exists in Fishing Assistant chat routes, so the route-boundary serializer should cover knowledge folders, knowledge pages, chats, and chat messages together.

No data migration is needed. Stored data is valid; only HTTP serialization is wrong.

## Endpoint Changes

Modified:

- `GET /fishing/folders`: `items[].createdAt` and `items[].updatedAt` become ISO 8601 strings.
- `POST /fishing/folders`: `folder.createdAt` and `folder.updatedAt` become ISO 8601 strings.
- `PATCH /fishing/folders/:folderId`: `folder.createdAt` and `folder.updatedAt` become ISO 8601 strings.
- `GET /fishing/pages`: `items[].createdAt` and `items[].updatedAt` become ISO 8601 strings.
- `POST /fishing/pages`: `page.createdAt` and `page.updatedAt` become ISO 8601 strings.
- `GET /fishing/pages/:pageId`: `page.createdAt` and `page.updatedAt` become ISO 8601 strings.
- `PATCH /fishing/pages/:pageId`: `page.createdAt` and `page.updatedAt` become ISO 8601 strings.
- `POST /fishing/pages/:pageId/reindex`: `page.createdAt` and `page.updatedAt` become ISO 8601 strings.
- `GET /fishing/chats`: `items[].lastMessageAt`, `items[].createdAt`, and `items[].updatedAt` become ISO 8601 strings.
- `POST /fishing/chats`: `chat.lastMessageAt`, `chat.createdAt`, and `chat.updatedAt` become ISO 8601 strings.
- `GET /fishing/chats/:chatId`: `chat.lastMessageAt`, `chat.createdAt`, and `chat.updatedAt` become ISO 8601 strings.
- `GET /fishing/chats/:chatId/messages`: `items[].createdAt` becomes an ISO 8601 string.
- `POST /fishing/chats/:chatId/messages`: `chat.*At` and `message.createdAt` become ISO 8601 strings.

Created: none.

Removed: none.

Unchanged:

- Request payloads.
- Auth requirements.
- Status codes and error envelopes.
- Firestore schema and repository/domain timestamp types.
- Digest routes, because their date fields are already string-based external data.

## Files

- Create: `apps/fishing-assistant-service/src/routes/responseSerializers.ts`
  - Owns API DTO types and route-boundary conversion from domain models with Firestore `Timestamp` values to JSON-safe timestamp strings.
- Modify: `apps/fishing-assistant-service/src/routes/foldersRoutes.ts`
  - Uses `serializeKnowledgeFolder()` before `reply.ok()`.
- Modify: `apps/fishing-assistant-service/src/routes/pagesRoutes.ts`
  - Uses `serializeKnowledgePage()` before `reply.ok()`.
- Modify: `apps/fishing-assistant-service/src/routes/chatsRoutes.ts`
  - Uses `serializeFishingChat()` and `serializeFishingChatMessage()` before `reply.ok()`.
- Modify: `apps/fishing-assistant-service/src/__tests__/knowledgeRoutes.test.ts`
  - Asserts knowledge route responses expose ISO strings, not Firestore JSON objects.
- Modify: `apps/fishing-assistant-service/src/__tests__/chatRoutes.test.ts`
  - Asserts chat route responses expose ISO strings, not Firestore JSON objects.
- Modify: `apps/web/src/services/fishingAssistantApi.ts`
  - Adds backward-compatible parsing for legacy Firestore JSON timestamp objects.
- Modify: `apps/web/src/services/__tests__/fishingAssistantApi.test.ts`
  - Covers the exact `_seconds`/`_nanoseconds` payload shape that caused the UI error.

## Tasks

### Task 1: Add Route Response Serializers

**Files:**

- Create: `apps/fishing-assistant-service/src/routes/responseSerializers.ts`

- [ ] **Step 1: Create the serializer module**

Add:

```typescript
import type { Timestamp } from '@intexuraos/infra-firestore';
import type { KnowledgeFolder, KnowledgePage } from '../domain/models/knowledge.js';
import type { FishingChat, FishingChatMessage } from '../domain/models/chat.js';

function timestampToIso(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString();
}

export interface KnowledgeFolderResponse {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgePageResponse {
  readonly id: string;
  readonly userId: string;
  readonly folderId: string;
  readonly title: string;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly contentType: KnowledgePage['contentType'];
  readonly indexingStatus: KnowledgePage['indexingStatus'];
  readonly chunkCount: number;
  readonly indexingError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingChatResponse {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly lastMessagePreview: string;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingChatMessageResponse {
  readonly id: string;
  readonly chatId: string;
  readonly userId: string;
  readonly role: FishingChatMessage['role'];
  readonly content: string;
  readonly citations: FishingChatMessage['citations'];
  readonly confidence?: FishingChatMessage['confidence'];
  readonly createdAt: string;
}

export function serializeKnowledgeFolder(folder: KnowledgeFolder): KnowledgeFolderResponse {
  return {
    id: folder.id,
    userId: folder.userId,
    name: folder.name,
    parentId: folder.parentId,
    sortOrder: folder.sortOrder,
    pageCount: folder.pageCount,
    createdAt: timestampToIso(folder.createdAt),
    updatedAt: timestampToIso(folder.updatedAt),
  };
}

export function serializeKnowledgePage(page: KnowledgePage): KnowledgePageResponse {
  return {
    id: page.id,
    userId: page.userId,
    folderId: page.folderId,
    title: page.title,
    rawText: page.rawText,
    normalizedText: page.normalizedText,
    contentType: page.contentType,
    indexingStatus: page.indexingStatus,
    chunkCount: page.chunkCount,
    ...(page.indexingError !== undefined ? { indexingError: page.indexingError } : {}),
    createdAt: timestampToIso(page.createdAt),
    updatedAt: timestampToIso(page.updatedAt),
  };
}

export function serializeFishingChat(chat: FishingChat): FishingChatResponse {
  return {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    lastMessagePreview: chat.lastMessagePreview,
    lastMessageAt: timestampToIso(chat.lastMessageAt),
    createdAt: timestampToIso(chat.createdAt),
    updatedAt: timestampToIso(chat.updatedAt),
  };
}

export function serializeFishingChatMessage(message: FishingChatMessage): FishingChatMessageResponse {
  return {
    id: message.id,
    chatId: message.chatId,
    userId: message.userId,
    role: message.role,
    content: message.content,
    citations: message.citations,
    ...(message.confidence !== undefined ? { confidence: message.confidence } : {}),
    createdAt: timestampToIso(message.createdAt),
  };
}
```

- [ ] **Step 2: Run the service typecheck to catch DTO typing issues**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service typecheck
```

Expected: fails only if imports or exact optional property typing are wrong. Fix the serializer until typecheck passes.

### Task 2: Use Serializers in Knowledge Routes

**Files:**

- Modify: `apps/fishing-assistant-service/src/routes/foldersRoutes.ts`
- Modify: `apps/fishing-assistant-service/src/routes/pagesRoutes.ts`
- Test: `apps/fishing-assistant-service/src/__tests__/knowledgeRoutes.test.ts`

- [ ] **Step 1: Write failing route assertions for folder timestamps**

In `knowledgeRoutes.test.ts`, add this helper near the existing test helpers:

```typescript
function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
}
```

In `creates, lists, updates, and deletes folders for the authenticated user`, after the existing `toMatchObject` assertions, add:

```typescript
const createdFolder = createResponse.json().data.folder as {
  createdAt: unknown;
  updatedAt: unknown;
};
const listedFolder = listResponse.json().data.items[0] as {
  createdAt: unknown;
  updatedAt: unknown;
};
const updatedFolder = updateResponse.json().data.folder as {
  createdAt: unknown;
  updatedAt: unknown;
};

for (const value of [
  createdFolder.createdAt,
  createdFolder.updatedAt,
  listedFolder.createdAt,
  listedFolder.updatedAt,
  updatedFolder.createdAt,
  updatedFolder.updatedAt,
]) {
  expectIsoTimestamp(value);
}
```

- [ ] **Step 2: Write failing route assertions for page timestamps**

In `creates, lists, reads, updates, reindexes, and deletes pages`, after the existing page assertions, add:

```typescript
const createdPage = createResponse.json().data.page as {
  createdAt: unknown;
  updatedAt: unknown;
};
const listedPage = listResponse.json().data.items[0] as {
  createdAt: unknown;
  updatedAt: unknown;
};
const listedAllPage = listAllResponse.json().data.items[0] as {
  createdAt: unknown;
  updatedAt: unknown;
};
const readPage = getResponse.json().data.page as {
  createdAt: unknown;
  updatedAt: unknown;
};
const updatedPage = updateResponse.json().data.page as {
  createdAt: unknown;
  updatedAt: unknown;
};
const reindexedPage = reindexResponse.json().data.page as {
  createdAt: unknown;
  updatedAt: unknown;
};

for (const value of [
  createdPage.createdAt,
  createdPage.updatedAt,
  listedPage.createdAt,
  listedPage.updatedAt,
  listedAllPage.createdAt,
  listedAllPage.updatedAt,
  readPage.createdAt,
  readPage.updatedAt,
  updatedPage.createdAt,
  updatedPage.updatedAt,
  reindexedPage.createdAt,
  reindexedPage.updatedAt,
]) {
  expectIsoTimestamp(value);
}
```

- [ ] **Step 3: Verify the tests fail before implementation**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/knowledgeRoutes.test.ts
```

Expected: FAIL because current route responses contain timestamp objects instead of strings.

- [ ] **Step 4: Update folder routes to serialize responses**

In `foldersRoutes.ts`, import:

```typescript
import { serializeKnowledgeFolder } from './responseSerializers.js';
```

Change each successful response:

```typescript
return await reply.ok({ items: result.value.map(serializeKnowledgeFolder) });
return await reply.ok({ folder: serializeKnowledgeFolder(result.value) });
```

- [ ] **Step 5: Update page routes to serialize responses**

In `pagesRoutes.ts`, import:

```typescript
import { serializeKnowledgePage } from './responseSerializers.js';
```

Change each successful response:

```typescript
return await reply.ok({ items: result.value.map(serializeKnowledgePage) });
return await reply.ok({ page: serializeKnowledgePage(result.value) });
```

Apply that to list, create, get, patch, and reindex. Do not change delete responses.

- [ ] **Step 6: Verify knowledge route tests pass**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/knowledgeRoutes.test.ts
```

Expected: PASS.

### Task 3: Use Serializers in Chat Routes

**Files:**

- Modify: `apps/fishing-assistant-service/src/routes/chatsRoutes.ts`
- Test: `apps/fishing-assistant-service/src/__tests__/chatRoutes.test.ts`

- [ ] **Step 1: Write failing chat route timestamp assertions**

In `chatRoutes.test.ts`, add the same helper:

```typescript
function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
}
```

In `creates a chat and lists it for the authenticated user`, add:

```typescript
const createdChat = createResponse.json().data.chat as {
  lastMessageAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
const listedChat = listResponse.json().data.items[0] as {
  lastMessageAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

for (const value of [
  createdChat.lastMessageAt,
  createdChat.createdAt,
  createdChat.updatedAt,
  listedChat.lastMessageAt,
  listedChat.createdAt,
  listedChat.updatedAt,
]) {
  expectIsoTimestamp(value);
}
```

In `sends a message, stores assistant output, and derives the title from the first user message`, add:

```typescript
const sentChat = sendResponse.json().data.chat as {
  lastMessageAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
const sentMessage = sendResponse.json().data.message as { createdAt: unknown };
const listedMessages = messagesResponse.json().data.items as Array<{ createdAt: unknown }>;
const readChat = chatResponse.json().data.chat as {
  lastMessageAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

for (const value of [
  sentChat.lastMessageAt,
  sentChat.createdAt,
  sentChat.updatedAt,
  sentMessage.createdAt,
  ...listedMessages.map((message) => message.createdAt),
  readChat.lastMessageAt,
  readChat.createdAt,
  readChat.updatedAt,
]) {
  expectIsoTimestamp(value);
}
```

- [ ] **Step 2: Verify the tests fail before implementation**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/chatRoutes.test.ts
```

Expected: FAIL because current chat route responses contain timestamp objects instead of strings.

- [ ] **Step 3: Update chat routes to serialize responses**

In `chatsRoutes.ts`, import:

```typescript
import {
  serializeFishingChat,
  serializeFishingChatMessage,
} from './responseSerializers.js';
```

Change successful responses:

```typescript
return await reply.ok({ items: result.value.map(serializeFishingChat) });
return await reply.ok({ chat: serializeFishingChat(result.value) });
return await reply.ok({ items: result.value.map(serializeFishingChatMessage) });
return await reply.ok({
  chat: serializeFishingChat(result.value.chat),
  message: serializeFishingChatMessage(result.value.message),
});
```

- [ ] **Step 4: Verify chat route tests pass**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/chatRoutes.test.ts
```

Expected: PASS.

### Task 4: Add Web Backward Compatibility for Legacy Timestamp JSON

**Files:**

- Modify: `apps/web/src/services/fishingAssistantApi.ts`
- Test: `apps/web/src/services/__tests__/fishingAssistantApi.test.ts`

- [ ] **Step 1: Write the failing web API test for the exact legacy shape**

In `fishingAssistantApi.test.ts`, replace the `timestampLike()` helper inside `normalizes Firestore timestamp-like dates in knowledge and chat responses` with:

```typescript
const firestoreJsonTimestamp = (iso: string): { _seconds: number; _nanoseconds: number } => {
  const millis = Date.parse(iso);
  return {
    _seconds: Math.floor(millis / 1000),
    _nanoseconds: (millis % 1000) * 1_000_000,
  };
};
```

Replace each `timestampLike('...')` call in that test with `firestoreJsonTimestamp('...')`.

- [ ] **Step 2: Verify the test fails before implementation**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/fishingAssistantApi.test.ts
```

Expected: FAIL with `RangeError: Invalid time value`.

- [ ] **Step 3: Update the web timestamp normalizer**

In `apps/web/src/services/fishingAssistantApi.ts`, replace the current `TimestampLike` and `toIsoString()` implementation with:

```typescript
interface TimestampLike {
  toDate: () => Date;
}

interface FirestoreJsonTimestamp {
  _seconds?: number;
  _nanoseconds?: number;
  seconds?: number;
  nanoseconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRecord(value) && 'toDate' in value && typeof value['toDate'] === 'function') {
    const timestamp = value as unknown as TimestampLike;
    return timestamp.toDate().toISOString();
  }
  if (isRecord(value)) {
    const timestamp = value as FirestoreJsonTimestamp;
    const seconds =
      typeof timestamp._seconds === 'number'
        ? timestamp._seconds
        : typeof timestamp.seconds === 'number'
          ? timestamp.seconds
          : undefined;
    const nanoseconds =
      typeof timestamp._nanoseconds === 'number'
        ? timestamp._nanoseconds
        : typeof timestamp.nanoseconds === 'number'
          ? timestamp.nanoseconds
          : 0;

    if (seconds !== undefined) {
      return new Date((seconds * 1000) + Math.floor(nanoseconds / 1_000_000)).toISOString();
    }
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid Fishing Assistant timestamp value');
  }
  return parsed.toISOString();
}
```

This client change is backward compatibility only. The server route serializers remain the root fix because HTTP API contracts should not expose Firestore SDK JSON internals.

- [ ] **Step 4: Verify the web API test passes**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/fishingAssistantApi.test.ts
```

Expected: PASS.

### Task 5: Full Verification

**Files:**

- Verify: `apps/fishing-assistant-service`
- Verify: `apps/web`
- Verify: tracked repo changes

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/knowledgeRoutes.test.ts
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/chatRoutes.test.ts
pnpm --filter @intexuraos/web test -- src/services/__tests__/fishingAssistantApi.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run workspace verification for touched workspaces**

Run:

```bash
pnpm run verify:workspace:tracked -- fishing-assistant-service
pnpm run verify:workspace:tracked -- web
```

Expected: both PASS.

- [ ] **Step 3: Run tracked CI before committing implementation**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS. Commit only after this passes completely.

## Acceptance Criteria

- Opening an existing Fishing Assistant knowledge base no longer throws `Invalid time value`.
- Knowledge folder/page API responses expose `createdAt` and `updatedAt` as ISO 8601 strings.
- Fishing chat/message API responses expose their timestamp fields as ISO 8601 strings.
- Web API code handles the legacy Firestore JSON timestamp object shape during rollout.
- No Firestore migration or data backfill is introduced.
- Focused tests, workspace verification, and `pnpm run ci:tracked` pass.
