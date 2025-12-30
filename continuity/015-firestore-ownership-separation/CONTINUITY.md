# CONTINUITY LEDGER: Firestore Collection Ownership Separation

## Goal

Rozdzielić własność kolekcji Firestore między serwisami zgodnie z zasadą "jedna kolekcja = jeden właściciel" oraz ustanowić wzorzec service-to-service communication.

**Success Criteria:**
- ✅ `notion_connections` zarządzana wyłącznie przez notion-service
- ✅ `promptvault_settings` zarządzana wyłącznie przez promptvault-service
- ✅ promptvault-service pobiera token przez `/internal/notion/users/:userId/context`
- ✅ Internal endpoints używają konwencji `/internal/{service-prefix}/{resource-path}`
- ✅ `npm run ci` przechodzi
- ✅ `terraform validate` przechodzi
- ✅ Operacje na promptach działają poprawnie

## Constraints & Assumptions

- Bez cache w promptvault-service (świeże dane z notion-service)
- Jednorazowy deployment obu serwisów
- Breaking change: `connectNotion()` nie przyjmuje już `promptVaultPageId`
- Pattern `X-Internal-Auth` dla service-to-service auth

## Key Decisions

### 1. Rozdział promptVaultPageId od notionToken
**Decision**: promptVaultPageId to ustawienie specyficzne dla promptvault, nie dla Notion integration.
**Rationale**: Notion zarządza połączeniem (token), promptvault zarządza swoimi ustawieniami (pageId).
**Alternatives Rejected**:
- Trzymanie wszystkiego w notion_connections - łamie separation of concerns
- Cache w promptvault - dodaje złożoność, aktualne dane ważniejsze

### 2. Konwencja internal endpoints: /internal/{service-prefix}/...
**Decision**: Ujednolicona konwencja nazewnictwa dla wszystkich internal endpoints.
**Rationale**: Czytelność, spójność, łatwa identyfikacja service-to-service calls.
**Impact**: Wymaga dokumentacji w CLAUDE.md i docs/architecture/

## State

### Done
- ✅ Plan approved (stored in /Users/p.buchman/.claude/plans/serialized-tumbling-otter.md)
- ✅ Continuity structure created (015-firestore-ownership-separation/)
- ✅ INSTRUCTIONS.md created
- ✅ CONTINUITY.md created (this file)

### Now
- Creating task files (0-0 through 2-X)

### Next
- Execute tier 0: verify current state
- Execute tier 1: implement changes in notion-service
- Execute tier 1: implement changes in promptvault-service
- Execute tier 1: clean up infra-notion package
- Execute tier 2: documentation
- Execute tier 2: test coverage verification
- Execute tier 2: deployment preparation
- Archive task

## Open Questions
- None currently

## Working Set

**Files to create:**
- Task files in continuity/015-firestore-ownership-separation/
- 7+ new source files
- 13+ modified files
- 2 files to delete

**Commands:**
- `npm run ci` - verification
- `terraform fmt -check -recursive && terraform validate` - terraform verification

---

## Reasoning Log

**2025-12-31 00:00** - Project initialization
Created continuity structure for task 015-firestore-ownership-separation. Plan was already approved in plan mode with all key architectural decisions documented. Breaking down into tiered tasks following continuity pattern.
