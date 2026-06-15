# Fishing Assistant Service - Technical Debt

## Summary

| Category | Count | Severity |
| -------- | ----- | -------- |
| TODO/FIXME Comments | 0 | - |
| Test Coverage Gaps | 0 active gaps found in current docs review | - |
| TypeScript Issues | 0 active issues found in current docs review | - |
| SRP Violations | 0 active issues found in current docs review | - |
| Code Duplicates | 0 active issues found in current docs review | - |
| Deprecations | 0 active issues found in current docs review | - |

Last updated: 2026-06-12

## Current Status

The 3.7.0 service surface includes tests for chat repositories and routes, knowledge indexing and repositories, citation validation, retrieval, prompt/ranking behavior, digest routes, LLM clients, and config. No TODO or FIXME comments were present in `apps/fishing-assistant-service/src` during this docs pass.

## Release 3.7.0 Reliability Work

- Date serialization was normalized in service responses so Firestore timestamps leave the API as ISO strings.
- Citation alias validation prevents the LLM from inventing or mutating source IDs before citations are stored.
- Knowledge-base evidence is prioritized in retrieval and citation validation when knowledge chunks are present.
- Conversation history retrieval is part of the chat message generation path.
- Knowledge page reindexing can recover page content after edits or failed indexing.

## Known Operational Constraints

### User API Key Dependency

Chat generation depends on each user's OpenRouter key from user-service. The service handles missing keys with `NO_API_KEY`; it does not fall back to an app-level chat key.

### Embedding Dependency

Knowledge indexing depends on OpenAI embeddings. Failed embedding calls keep the page record with `indexingStatus: failed`, `indexingError`, and no chunks.

### Firestore Index Dependency

Knowledge and chat list queries require the indexes from migrations 101 and 104, including the vector index for chunk retrieval.

## Resolved Issues

### 3.7.0 Fishing Assistant Foundation

PRs #2038 and #2054 introduced the service, knowledge routes, chat routes, RAG retrieval, persisted chat messages, digest integration, and the web UI integration surface.

### 3.7.0 Date and Source Reliability

PRs #2057 and #2068 normalized client-facing date handling. PR #2074 hardened citation source validation. PR #2104 prioritized knowledge-base evidence and required knowledge-page citations when knowledge evidence is available.

### 3.7.0 History and Mobile Support

PR #2091 added conversation history retrieval for chat answers. PRs #2073 and #2105 fixed Fishing Assistant responsive UI behavior in the web app; no service API change is required for those layout fixes.
