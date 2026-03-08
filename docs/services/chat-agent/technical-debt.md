# Chat Agent — Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** [2026-03-07 entry](../../documentation-runs.md)

---

## Summary

| Category               | Count  | Severity |
| ---------------------- | ------ | -------- |
| v8 ignore exemptions   | 5      | Low      |
| Architectural concerns | 3      | Medium   |
| Missing features       | 4      | Medium   |
| Test coverage gaps     | 1      | Low      |
| **Total**              | **13** | —        |

---

## Future Plans

### Conversation Persistence

Currently, conversation history is passed by the client on every request. No server-side storage exists. A future implementation would store conversations in Firestore, enabling cross-device continuity and analytics.

### Multi-action Support

The `SuggestedAction` type only supports `create_command`. Future expansion to `edit_command`, `delete_command`, and other action types would increase the assistant's usefulness.

### Documentation Indexing Pipeline

The `doc_embeddings` collection requires manual population. A pipeline to automatically index documentation on commit (via Cloud Build trigger or Pub/Sub) would keep the RAG knowledge base current.

### Streaming Responses

The current implementation waits for the full LLM response before returning. Server-Sent Events (SSE) or WebSocket streaming would improve perceived latency for long responses.

---

## Architectural Concerns

### In-Memory Guest Rate Limiter

**File:** `apps/chat-agent/src/infra/rateLimit/guestRateLimiter.ts`

The rate limiter stores usage data in a `Map` local to the process. When Cloud Run scales to multiple instances or restarts, rate limiting state is lost. For production-grade enforcement, this should move to Redis or Firestore with TTL documents.

**Severity:** Medium — guest abuse possible during scale events.

### Hardcoded Embedding Model

**File:** `apps/chat-agent/src/infra/llm/embeddingClient.ts` (line 56)

The OpenAI embedding model (`text-embedding-3-small`) is hardcoded as a default. Changing the model requires reindexing all documents in `doc_embeddings` because different models produce incompatible vector spaces.

**Severity:** Medium — model upgrades require manual migration.

### Action Extraction via Regex

**File:** `apps/chat-agent/src/infra/llm/chatClient.ts` (lines 100-122)

The `extractSuggestedAction` function uses a regex (`/\[ACTION:\s*(create_command)\s+({.*?})\]/s`) to detect structured actions from raw LLM output. This is fragile: if the LLM slightly varies the format, the regex misses it. A structured output format (JSON mode or function calling) would be more reliable.

**Severity:** Medium — action detection silently fails on format variations.

---

## Code Smells

### Duplicate Firestore Data Extraction

**Files:**

- `apps/chat-agent/src/infra/firestore/embeddingRepository.ts` (lines 80-100 in `findNearest`, lines 142-162 in `findById`)

The field extraction logic (reading `content`, `filePath`, `section`, `docType`, `createdAt` from Firestore data with type guards and defaults) is duplicated between `findNearest` and `findById`. A shared `toDocChunk(data, id)` helper would reduce duplication.

### Large v8 ignore Blocks in chatClient.ts

**File:** `apps/chat-agent/src/infra/llm/chatClient.ts`

The entire `generate` method (lines 44-91) is wrapped in a v8 ignore block. This covers a significant amount of logic: prompt building, LLM calling, error handling, and action extraction. While the exemption reason is valid (LLM output-dependent paths tested through fakes), the block size is large.

---

## Test Coverage Gaps

### chatClient.ts Real Integration

The `chatClient.ts` adapter is largely covered by v8 ignore exemptions because its behavior depends on real LLM output format. Integration tests with recorded LLM responses (snapshot testing) would increase confidence without requiring live LLM calls.

---

## TypeScript Issues

No open TypeScript issues. The codebase uses strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

---

## TODOs and FIXMEs

| File | Line | Type | Description |
| ---- | ---- | ---- | ----------- |

No TODO or FIXME comments found in the codebase.

---

## v8 Ignore Exemptions

| File                                  | Lines   | Category   | Reason                                                      |
| ------------------------------------- | ------- | ---------- | ----------------------------------------------------------- |
| `routes/chatRoutes.ts`                | 179-189 | upstream   | Fallback for unknown error codes from domain layer          |
| `infra/llm/chatClient.ts`             | 44-91   | upstream   | LLM client error paths tested in fakes, not real LLM        |
| `infra/llm/chatClient.ts`             | 101-121 | upstream   | Branches depend on LLM output format                        |
| `infra/llm/chatClient.ts`             | 128-133 | upstream   | String.replace branch depends on action being present       |
| `domain/usecases/generateResponse.ts` | 226-228 | test-infra | Fallback impossible to trigger (split always returns array) |

---

## SRP Violations (Files > 300 Lines)

| File                                  | Lines | Concern                                                                            |
| ------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| `__tests__/fakes.fixture.ts`          | 322   | Contains 7 fake classes. Could split into per-class files if it grows.             |
| `domain/usecases/generateResponse.ts` | 300   | At the threshold. Contains main use case + 4 helper functions. Acceptable for now. |

---

## Resolved Issues

| Issue      | Description                                           | Resolution                                                          |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `99febe66` | FakeUserServiceClient missing resolveGitHubUsername   | Added stub method to conform to updated UserServiceClient interface |
| `e6782f64` | INTEXURAOS_LLM_MODEL env var no longer needed         | Removed; model selection via user-service                           |
| `332fd990` | EmbeddingClient had tight OpenAI coupling             | Refactored to function injection pattern                            |
| `0f37ed41` | Shared LLM client across all users                    | Refactored to per-request client from user-service                  |
| `63170e4a` | Inconsistent GLM "free" terminology in LLM factory    | Removed; all clients now created via `createLlmClient` uniformly    |
| `c72b7c53` | Default LLM (GLM) had no Gemini fallback for platform | Switched default to Gemini 2.5 Flash; added Gemini platform key     |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
