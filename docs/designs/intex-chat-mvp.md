# Intex Chat — MVP Design

> In-app AI assistant for IntexuraOS documentation and command creation.

**Created:** 2026-01-31
**Status:** COMPLETED — Implementation lives in `apps/retired-chat-service/`

---

## Overview

### What We're Building

An in-app AI chat assistant named **"Intex"** that:

- Answers questions about IntexuraOS documentation and APIs
- Creates commands on user confirmation (via text like "yes")
- Lives as a floating chat widget accessible from anywhere in the app

### MVP Scope

| In Scope                             | Out of Scope (Post-MVP)                    |
| ------------------------------------ | ------------------------------------------ |
| Documentation Q&A                    | Codebase knowledge                         |
| API specs knowledge                  | Direct system interactions beyond commands |
| Command creation (text confirmation) | Button-based confirmations                 |
| Session-based history (localStorage) | Persistent cross-device history            |
| 20-message sliding window            | Conversation summarization                 |
| Manual embedding via GitHub Action   | Auto-embedding on deploy                   |

### Success Criteria

1. User can ask "How do I create a todo via API?" and get accurate answer with endpoint details
2. User can say "Create a todo to buy groceries" → confirm with "yes" → command created
3. Chat works on mobile (bottom sheet) and desktop (floating panel)
4. Response quality matches or exceeds what a custom GPT would provide

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (web)                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │  Chat FAB   │───▶│ Chat Panel  │───▶│ Chat Service (API calls)│  │
│  └─────────────┘    └─────────────┘    └───────────┬─────────────┘  │
│                                                     │                │
│                           ┌─────────────────────────┼────────┐       │
│                           │                         │        │       │
│                           ▼                         ▼        │       │
│                    ┌─────────────┐          ┌─────────────┐  │       │
│                    │ retired-chat-service  │          │commands-agent│ │       │
│                    │   (RAG)     │          │  (direct)    │ │       │
│                    └──────┬──────┘          └─────────────┘  │       │
└───────────────────────────┼──────────────────────────────────┘       │
                            │                                          │
                            ▼                                          │
┌─────────────────────────────────────────────────────────────────────┐
│                         Firestore                                    │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐ │
│  │  retired-document-embeddings     │    │  (existing collections)              │ │
│  │  - content          │    │  - commands, actions, todos, etc.   │ │
│  │  - embedding vector │    └─────────────────────────────────────┘ │
│  │  - filePath         │                                            │
│  │  - section          │                                            │
│  │  - docType          │                                            │
│  └─────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                    | Responsibility                                         |
| ---------------------------- | ------------------------------------------------------ |
| **Chat FAB**                 | Floating button to open/close chat                     |
| **Chat Panel**               | UI for conversation, message input, controls           |
| **Chat Service (frontend)**  | API calls to retired-chat-service, session storage               |
| **retired-chat-service (backend)**     | RAG pipeline: embed query → search → generate response |
| **commands-agent**           | Command creation (called directly by frontend)         |
| **Firestore retired-document-embeddings** | Vector storage for documentation chunks                |

### New Service: retired-chat-service

```
apps/retired-chat-service/
├── src/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── chatMessage.ts
│   │   │   └── docChunk.ts
│   │   ├── ports/
│   │   │   └── embeddingRepository.ts
│   │   └── usecases/
│   │       ├── generateResponse.ts
│   │       └── searchDocumentation.ts
│   ├── infra/
│   │   ├── firestore/
│   │   │   └── embeddingRepository.ts
│   │   └── llm/
│   │       └── embeddingClient.ts
│   ├── routes/
│   │   └── chatRoutes.ts
│   ├── services.ts
│   ├── server.ts
│   └── index.ts
├── Dockerfile
├── package.json
└── vitest.config.ts
```

---

## Knowledge Base

### Documentation Sources

| Source            | Location                                       | Estimated Size          |
| ----------------- | ---------------------------------------------- | ----------------------- |
| All markdown docs | `docs/**/*.md`                                 | 158 files, ~500k tokens |
| OpenAPI specs     | Fetched from deployed services `/openapi.json` | ~15 services            |

### Embedding Strategy

**Model:** `text-embedding-3-small` (OpenAI)

- 1536 dimensions
- Excellent multilingual support (English + Polish)
- Cost: ~$0.04 for full docs (negligible)

**Chunking:** By markdown headers

```
# Document Title           → chunk boundary
## Section                 → chunk boundary
### Subsection             → chunk boundary
Content within section...  → included in chunk above
```

**Storage:** Firestore collection `retired-document-embeddings`

```typescript
interface DocChunk {
  id: string; // auto-generated
  content: string; // chunk text
  embedding: number[]; // 1536-dim vector
  filePath: string; // "docs/services/retired-checklist-service/API.md"
  section: string; // "POST /commands"
  docType: 'markdown' | 'openapi';
  createdAt: Timestamp;
}
```

### Embedding Generation

**Trigger:** Manual GitHub Action (run on releases)

**Process:**

1. Parse all `docs/**/*.md` files
2. Chunk by markdown headers
3. Fetch `/openapi.json` from each deployed service
4. Chunk OpenAPI by endpoint
5. Generate embeddings via OpenAI API
6. Upsert to Firestore `retired-document-embeddings` collection

---

## RAG Pipeline

### Query Flow

```
User: "How do I create a todo?"
           │
           ▼
┌─────────────────────────┐
│ 1. Embed query          │
│    text-embedding-3-small
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. Vector search        │
│    Firestore KNN        │
│    Top 5-10 chunks      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 3. Build prompt         │
│    System + Context +   │
│    History + Query      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 4. Generate response    │
│    User's gen model     │
└───────────┬─────────────┘
            │
            ▼
       Response to user
```

### Prompt Structure

```
┌─────────────────────────────────────────────────┐
│  System Prompt                                   │
│  - Intex personality (friendly technical expert) │
│  - Response guidelines                           │
│  - Command creation rules                        │
├─────────────────────────────────────────────────┤
│  Retrieved Documentation (RAG context)           │
│  [Chunk 1: docs/services/retired-checklist-service/API.md]    │
│  [Chunk 2: docs/services/commands-agent/...]    │
│  ...                                            │
├─────────────────────────────────────────────────┤
│  Conversation History (last 20 messages)         │
│  User: ...                                       │
│  Intex: ...                                      │
├─────────────────────────────────────────────────┤
│  Current User Message                            │
└─────────────────────────────────────────────────┘
```

### Fallback Behavior

When no relevant documentation is found:

1. **Try docs first** — Vector search with confidence threshold
2. **If low confidence** — Answer using LLM general knowledge
3. **Mark clearly** — "I don't have specific IntexuraOS docs on this, but generally..."

---

## Command Creation Flow

### User Journey

```
User: "Create a todo to buy groceries"
           │
           ▼
Intex: "I'll create a todo: 'buy groceries'.
        Please confirm by saying 'yes'."
           │
           ▼
User: "yes"
           │
           ▼
Frontend calls commands-agent directly:
POST /commands { text: "buy groceries", source: "pwa-shared" }
           │
           ▼
Intex: "✓ Created as todo (92% confident): 'buy groceries'
        [View in Inbox →]"
```

### Key Design Decisions

| Decision                               | Rationale                                    |
| -------------------------------------- | -------------------------------------------- |
| Text confirmation only                 | Simpler MVP, conversational feel             |
| Frontend calls commands-agent directly | retired-chat-service doesn't proxy, cleaner separation |
| Show confidence                        | Transparency about classification            |
| Link to Inbox                          | User can verify result                       |

### Confirmation Detection

Intex recognizes affirmative responses:

- "yes", "yeah", "yep", "sure", "ok", "okay", "do it", "confirm", "go ahead"
- Polish: "tak", "jasne", "zrób to", "potwierdź"

---

## Frontend Components

### Chat FAB (Floating Action Button)

**Position:** Bottom-right, stacked above DevBar (if visible)

**States:**

| State  | Appearance                      |
| ------ | ------------------------------- |
| Closed | Chat bubble icon, primary color |
| Open   | Highlighted/active state        |
| Unread | Badge with count (post-MVP)     |

**Z-index:** Above DevBar (z-50 + 1)

### Chat Panel (Desktop)

**Behavior:** Content-adaptive height

- Starts at ~200px (few messages)
- Grows with content up to 60vh max
- Toggle button in header for full-height mode (100vh - header)

**Layout:**

```
┌─────────────────────────────────────┐
│ Intex                    [↕] [×]   │  ← Header (name, expand, close)
├─────────────────────────────────────┤
│                                     │
│  [Intex] Welcome! How can I help?   │
│                                     │
│                    [User] How do I  │
│                    create a todo?   │
│                                     │
│  [Intex] To create a todo...        │
│                              [copy] │
│                                     │
├─────────────────────────────────────┤
│ [Type a message...]        [Send]   │  ← Input area
├─────────────────────────────────────┤
│ [Clear conversation]                │  ← Footer actions
└─────────────────────────────────────┘
```

**Position:** Fixed, bottom-right corner (above FAB position)

### Chat Panel (Mobile)

**Behavior:** Expandable bottom sheet

- Initial height: ~60% of viewport
- Drag handle at top to expand to full-screen
- Swipe down to minimize/dismiss
- Keyboard-aware (adjusts when keyboard opens)

**Gestures:**

| Gesture                  | Action                     |
| ------------------------ | -------------------------- |
| Tap FAB                  | Open at 60% height         |
| Drag handle up           | Expand to full-screen      |
| Drag handle down         | Collapse to 60% or dismiss |
| Swipe down (when at 60%) | Close chat                 |

### Message Components

**User Message:**

```
┌─────────────────────────────────────┐
│                    How do I create  │
│                    a todo via API?  │
│                           10:32 AM  │
└─────────────────────────────────────┘
```

**Intex Message:**

````
┌─────────────────────────────────────┐
│ [I] Intex                           │
├─────────────────────────────────────┤
│ To create a todo, use the           │
│ retired-checklist-service API:                    │
│                                     │
│ ```bash                             │
│ POST /todos                         │
│ { "title": "Buy groceries" }        │
│ ```                                 │
│                                     │
│ 10:32 AM                     [📋]   │  ← Copy button
└─────────────────────────────────────┘
````

**Features:**

- Markdown rendering (code blocks, links, lists, bold/italic)
- Timestamps on each message
- Copy button on Intex responses
- Typing indicator ("..." animation) while generating

### UI Polish Checklist

- [x] Typing indicator while waiting for response
- [x] Markdown rendering in responses
- [x] Copy button on assistant messages
- [x] Message timestamps
- [x] Clear conversation button
- [x] Inline error messages

---

## Backend API

### retired-chat-service Endpoints

#### POST /chat

Send a message and get a response.

**Request:**

```json
{
  "message": "How do I create a todo?",
  "conversationHistory": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "response": "To create a todo, use the retired-checklist-service API...",
    "sources": [{ "filePath": "docs/services/retired-checklist-service/API.md", "section": "POST /todos" }],
    "suggestedAction": null
  }
}
```

**Response with command suggestion:**

```json
{
  "success": true,
  "data": {
    "response": "I'll create a todo: 'buy groceries'. Please confirm by saying 'yes'.",
    "sources": [],
    "suggestedAction": {
      "type": "create_command",
      "payload": {
        "text": "buy groceries",
        "source": "pwa-shared"
      },
      "awaitingConfirmation": true
    }
  }
}
```

#### GET /health

Standard health check endpoint.

### Authentication

- **Auth0 JWT** via `fastifyAuthPlugin` (same as other services)
- User ID extracted from token for any user-specific operations

---

## Intex Personality

### System Prompt

```
You are Intex, the IntexuraOS assistant. You help users understand
the platform's documentation and APIs, and can create commands on their behalf.

Personality:
- Friendly and approachable, but technically precise
- Assume the user is competent; don't over-explain basics
- Use clear, concise language
- When showing code or API examples, be specific and accurate

Capabilities:
- Answer questions about IntexuraOS documentation
- Explain API endpoints, parameters, and responses
- Help users understand how different services work together
- Create commands (todos, notes, bookmarks, etc.) when requested

Command Creation:
- When user wants to create something, propose the command clearly
- Always ask for confirmation before creating
- Accept: "yes", "yeah", "ok", "sure", "tak", "zrób to"
- After confirmation, respond with the action taken

Limitations:
- You can only create commands (not edit or delete)
- You cannot access user data directly
- If unsure about something, say so
```

### Response Guidelines

| Scenario               | Response Style                                      |
| ---------------------- | --------------------------------------------------- |
| Documentation question | Direct answer with code examples if relevant        |
| API question           | Show endpoint, method, request/response format      |
| Command request        | Propose clearly, ask for confirmation               |
| No docs found          | Acknowledge, offer general guidance with disclaimer |
| Ambiguous request      | Ask clarifying question                             |

---

## Data Flow

### Session Storage (Frontend)

```typescript
interface ChatSession {
  messages: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sources?: DocSource[];
  pendingAction?: SuggestedAction;
}

// Stored in localStorage
// Key: 'intex-chat-session'
// Cleared on logout or explicit clear
```

### Conversation Context

- **Window size:** Last 20 messages
- **Sent to backend:** Full window on each request
- **Token estimate:** ~4,000-8,000 tokens for history

---

## Error Handling

### Error Types

| Error                   | User Message                                           | Technical Handling                  |
| ----------------------- | ------------------------------------------------------ | ----------------------------------- |
| LLM timeout             | "Sorry, I'm taking too long. Please try again."        | Retry once, then show error         |
| LLM error               | "I encountered an error. Please try again."            | Log to Sentry, show generic message |
| No auth                 | "Please log in to use the chat."                       | Redirect to login                   |
| Vector search failed    | "I'm having trouble searching docs. Please try again." | Fallback to no-context response     |
| Command creation failed | "Couldn't create the command: [error message]"         | Show commands-agent error           |

### Error Display

Errors appear as inline chat messages from Intex:

```
┌─────────────────────────────────────┐
│ [I] Intex                           │
├─────────────────────────────────────┤
│ ⚠️ Sorry, I encountered an error    │
│ processing your request. Please     │
│ try again.                          │
│                                     │
│ 10:35 AM                            │
└─────────────────────────────────────┘
```

---

## Infrastructure

### New Resources

| Resource         | Type                 | Purpose                  |
| ---------------- | -------------------- | ------------------------ |
| `retired-chat-service`         | Cloud Run service    | Backend API              |
| `retired-document-embeddings` | Firestore collection | Vector storage           |
| Retired documentation indexer  | GitHub Action        | Manual embedding trigger |

### Environment Variables

**retired-chat-service:**

| Variable                        | Description                      |
| ------------------------------- | -------------------------------- |
| `INTEXURAOS_OPENAI_APP_API_KEY` | For embedding queries at runtime |
| `INTEXURAOS_FIRESTORE_PROJECT`  | Firestore project ID             |

**Note:** Generation uses user's configured API key (fetched from user settings).

### Firestore Collection

```
retired-document-embeddings/
├── {chunkId}/
│   ├── content: string
│   ├── embedding: vector<1536>
│   ├── filePath: string
│   ├── section: string
│   ├── docType: string
│   └── createdAt: timestamp
```

**Index:** Vector index on `embedding` field for KNN search.

---

## Retired Documentation Embedding Workflow

### Workflow

```yaml
name: Embed Documentation

on:
  workflow_dispatch: # Manual trigger

jobs:
  embed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: pnpm install

      - name: Generate embeddings
        run: pnpm run retired-doc-indexer
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_SA_KEY }}

      - name: Upload to Firestore
        run: pnpm run upload-embeddings
```

### Embedding Script

The implementation was retired with the chat surface:

1. Read all `docs/**/*.md` files
2. Chunk by markdown headers
3. Fetch OpenAPI specs from deployed services
4. Chunk by endpoint
5. Generate embeddings
6. Write to `retired-document-embeddings` collection

---

## Implementation Phases

### Phase 1: Foundation

- [ ] Create `retired-chat-service` service scaffold
- [ ] Set up Firestore `retired-document-embeddings` collection
- [ ] Implement embedding generation script
- [ ] Create GitHub Action for manual embedding

### Phase 2: RAG Pipeline

- [ ] Implement vector search in retired-chat-service
- [ ] Build prompt construction logic
- [ ] Integrate with user's generation model
- [ ] Add fallback for no-docs-found

### Phase 3: Frontend Chat UI

- [ ] Create Chat FAB component
- [ ] Build Chat Panel (desktop)
- [ ] Build Bottom Sheet (mobile)
- [ ] Implement session storage
- [ ] Add markdown rendering

### Phase 4: Command Creation

- [ ] Detect command intent in responses
- [ ] Implement confirmation flow
- [ ] Integrate frontend → commands-agent
- [ ] Display creation result

### Phase 5: Polish

- [ ] Typing indicator
- [ ] Copy button
- [ ] Timestamps
- [ ] Clear conversation
- [ ] Error handling
- [ ] Testing

---

## Post-MVP Roadmap

| Feature                    | Description                               | Priority |
| -------------------------- | ----------------------------------------- | -------- |
| Codebase knowledge         | Embed source code with AST-aware chunking | High     |
| Persistent history         | Store conversations in Firestore          | Medium   |
| Conversation summarization | Auto-summarize for long chats             | Medium   |
| Auto-embedding on deploy   | Trigger via Cloud Build                   | Medium   |
| Streaming responses        | Real-time token streaming                 | Low      |
| Voice input                | Speech-to-text for chat                   | Low      |

---

## Appendix: Token Estimates

| Component                     | Tokens            |
| ----------------------------- | ----------------- |
| System prompt                 | ~500              |
| RAG context (5 chunks)        | ~2,000            |
| Conversation history (20 msg) | ~4,000-8,000      |
| User message                  | ~100              |
| **Total input**               | **~6,600-10,600** |
| Response                      | ~500-1,000        |

Well within limits of all modern models (128k+ context).

---

## Appendix: Cost Estimates

### Embedding (One-Time)

| Item                     | Cost       |
| ------------------------ | ---------- |
| Docs (~500k tokens)      | $0.01      |
| API specs (~200k tokens) | $0.004     |
| **Total**                | **~$0.02** |

### Per-Query

| Item                    | Cost      |
| ----------------------- | --------- |
| Query embedding         | $0.00001  |
| Generation (user's key) | User pays |

**Platform cost per query:** Essentially $0 (Firestore reads only).
