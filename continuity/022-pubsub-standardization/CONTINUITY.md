# Pub/Sub Standardization - Continuity Ledger

## Status: NOT STARTED

## Goal

Reduce ~200 lines of duplicated publisher code and consolidate 4 separate `PublishError` definitions into a shared infrastructure.

## Code Smells Identified

| Issue                                      | Severity | Files Affected |
| ------------------------------------------ | -------- | -------------- |
| Duplicated publisher try/catch/log pattern | CRITICAL | 5 files        |
| `PublishError` defined 4 times             | HIGH     | 4 files        |
| Hardcoded topic name with `-dev` suffix    | HIGH     | 1 file         |
| `SendMessageEvent` duplicated              | MEDIUM   | 2 files        |
| Logger creation duplicated                 | MEDIUM   | 5 files        |
| Inconsistent event type naming             | LOW      | 8 event types  |

## Done

- [x] Analysis completed
- [x] Code smells documented
- [x] Migration priority established

## Now

- [ ] Not started

## Next

1. Create `BasePubSubPublisher` in `packages/infra-pubsub`
2. Add consolidated `PublishError` type
3. Migrate `whatsapp-service` publisher
4. Migrate `llm-orchestrator` publishers
5. Migrate `commands-router` publisher
6. Remove `SendMessageEvent` duplication
7. Fix hardcoded topic names

## Key Files

| File                                                      | Change                          |
| --------------------------------------------------------- | ------------------------------- |
| `packages/infra-pubsub/src/basePublisher.ts`              | NEW - shared base class         |
| `packages/infra-pubsub/src/types.ts`                      | ADD - consolidated PublishError |
| `apps/whatsapp-service/src/infra/pubsub/publisher.ts`     | REFACTOR - extend base          |
| `apps/llm-orchestrator/src/infra/pubsub/*.ts`             | REFACTOR - extend base          |
| `apps/commands-router/src/infra/pubsub/*.ts`              | REFACTOR - extend base          |
| `apps/whatsapp-service/src/domain/inbox/events/events.ts` | REMOVE - SendMessageEvent       |

## Decisions

None yet - task not started.

## Open Questions

1. Should event type names be changed for consistency? (may require consumer updates)
2. Should we add message attributes for better observability?
