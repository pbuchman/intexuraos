# Firestore Collection Ownership Separation

## Goal

Przenieść własność kolekcji Firestore z pakietów współdzielonych do pojedynczych serwisów i ustanowić wzorzec service-to-service communication.

### Success Criteria

1. Tylko `notion-service` ma bezpośredni dostęp do `notion_connections`
2. Tylko `promptvault-service` ma bezpośredni dostęp do `promptvault_settings`
3. promptvault-service pobiera token przez HTTP od notion-service
4. Internal endpoints używają konwencji `/internal/{service-prefix}/{resource-path}`
5. `npm run ci` i `terraform validate` przechodzą
6. Wszystkie operacje na promptach działają poprawnie

## Task Numbering

Pliki zadań używają formatu: `[tier]-[sequence]-[title].md`

- **Tier 0**: Setup i diagnostyka
- **Tier 1**: Niezależne deliverables (changes w poszczególnych serwisach)
- **Tier 2**: Zależne/integratywne deliverables (dokumentacja, deployment)

## Process

1. Execute tasks sequentially by tier
2. Update CONTINUITY.md after each task
3. Second-to-last task verifies test coverage
4. Archive to `continuity/archive/015-firestore-ownership-separation/` when complete

## Idempotency

All tasks are designed to be idempotent - running them multiple times produces the same result.

## Resume Procedure

If interrupted:

1. Read CONTINUITY.md for current state
2. Check "Now" section for current task
3. Continue from that task
