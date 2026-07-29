# Fishing Assistant Service

User-scoped fishing chat and knowledge-base service for grounded answers over saved fishing notes, digest summaries, and raw group messages.

## The Problem

Fishing knowledge in IntexuraOS is split across manually saved notes, WhatsApp digest history, and recent group messages. Users need a chat surface that can answer fishing questions while preserving source traceability.

## How It Helps

The service stores per-user knowledge folders and pages, indexes page chunks with embeddings, persists chat sessions and messages, and retrieves supporting evidence before generating a cited answer. Its compatibility digest views read canonical history from `message-digest-service`, while supporting source-message evidence comes from the scoped private WhatsApp API.

## Release 3.7.0 Highlights

- Added the Fishing Assistant RAG foundation: knowledge folders, knowledge pages, page chunking, OpenAI embeddings, Firestore vector search, and chat endpoints. (PRs #2038, #2054)
- Added persisted chat history retrieval through `/chats`, `/chats/:chatId`, and `/chats/:chatId/messages`; new answers receive recent chat messages in the prompt. (PR #2091)
- Strengthened citation validation by aliasing prompt source IDs and remapping citations back to canonical source IDs before storing assistant messages. (PR #2074)
- Prioritized knowledge-base evidence over digest/raw-message context and requires a knowledge-page citation when knowledge evidence is available. (PR #2104)
- Normalized response timestamps to ISO strings for chats, messages, folders, and pages so the web client receives stable dates. (PR #2068)
- Supported the Fishing Assistant web UI and mobile fixes through the chat, knowledge, and digest endpoint surface; the responsive layout fixes live in `apps/web`. (PRs #2054, #2073, #2105)

## Use Cases

### Ask a Grounded Fishing Question

**User Goal:** Get a practical fishing answer backed by stored sources.

**Steps:**
1. Create or select a chat.
2. Send a message to `/chats/:chatId/messages`.
3. Read the assistant reply, confidence, and citations returned in the stored assistant message.

### Maintain a Personal Knowledge Base

**User Goal:** Save fishing recipes, guides, species notes, or theory pages for later retrieval.

**Steps:**
1. Create a folder.
2. Add a page with raw text.
3. Let the service normalize, classify, chunk, embed, and store the page.
4. Reindex the page after edits when needed.

### Browse Digest Context

**User Goal:** Inspect the migrated Fishing group history from the canonical Message Digest store.

**Steps:**
1. List digest groups with `/digest-groups`.
2. Query digests for a group and date range with `/digests`.
3. Load a digest detail with `/digests/:groupKey/:date`.

## Key Benefits

**Grounded answers** - Chat responses are based on retrieved knowledge, digest, and raw-message evidence rather than free-form model output alone.

**Source validation** - Assistant citations must reference known evidence source IDs, and knowledge-base evidence is treated as the authoritative answer base when present.

**Conversation continuity** - Chat sessions and messages are stored per user and reused as recent prompt context for follow-up questions.

**Stable UI contracts** - Response serializers convert Firestore timestamps to ISO strings for the web client.

## Limitations

**OpenRouter key required for chat** - Chat generation uses the user's OpenRouter API key from user-service. Missing keys return a `NO_API_KEY` error.

**Knowledge indexing depends on embeddings** - Knowledge pages can be stored with `indexingStatus: failed` when embedding generation fails.

**Folder deletion is blocked when pages exist** - A folder containing pages returns `FOLDER_NOT_EMPTY` on delete.

**No Pub/Sub contract** - The service exposes HTTP endpoints only.
