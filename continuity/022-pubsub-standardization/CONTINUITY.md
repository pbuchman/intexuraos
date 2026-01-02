# Pub/Sub Standardization - Continuity Ledger

## Status: COMPLETED

## Goal

Reduce ~200 lines of duplicated publisher code and consolidate 4 separate `PublishError` definitions into a shared infrastructure.

## Code Smells Identified

| Issue                                      | Severity | Files Affected | Resolution                    |
| ------------------------------------------ | -------- | -------------- | ----------------------------- |
| Duplicated publisher try/catch/log pattern | CRITICAL | 5 files        | FIXED - BasePubSubPublisher   |
| `PublishError` defined 4 times             | HIGH     | 4 files        | FIXED - shared type           |
| Hardcoded topic name with `-dev` suffix    | HIGH     | 1 file         | FIXED - env vars              |
| `SendMessageEvent` duplicated              | MEDIUM   | 2 files        | KEPT - architectural boundary |
| Logger creation duplicated                 | MEDIUM   | 5 files        | FIXED - BasePubSubPublisher   |
| Inconsistent event type naming             | LOW      | 8 event types  | DEFERRED                      |

## Done

- [x] Analysis completed
- [x] Code smells documented
- [x] Migration priority established
- [x] Created `BasePubSubPublisher` in `packages/infra-pubsub`
- [x] Consolidated `PublishError` type
- [x] Migrated `whatsapp-service` publisher (5 methods, ~130 lines → ~60 lines)
- [x] Migrated `llm-orchestrator` publishers (2 files, ~80 lines → ~45 lines)
- [x] Migrated `commands-router` publisher (1 file, ~40 lines → ~20 lines)
- [x] Fixed hardcoded topic names in commands-router
- [x] Updated CLAUDE.md with Pub/Sub standards
- [x] Created Pub/Sub documentation

## Decisions

| Decision                                | Rationale                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `SendMessageEvent` duplication     | Domain layer should not import from infra packages. Both definitions serve different architectural purposes (input vs output boundary). |
| Use environment variables for topics    | Follows existing pattern in whatsapp-service. Enables environment-specific configuration.                                               |
| Create `BasePubSubPublisher` class      | Provides inheritance-based code reuse while allowing domain-specific error mapping.                                                     |
| Defer event type naming standardization | Low priority, requires coordination with consumers.                                                                                     |

## Key Files Changed

| File                                                                | Change                                |
| ------------------------------------------------------------------- | ------------------------------------- |
| `packages/infra-pubsub/src/basePublisher.ts`                        | NEW - shared base class               |
| `packages/infra-pubsub/src/index.ts`                                | UPDATED - exports base class          |
| `apps/whatsapp-service/src/infra/pubsub/publisher.ts`               | REFACTORED - extends base             |
| `apps/llm-orchestrator/src/infra/pubsub/analyticsEventPublisher.ts` | REFACTORED - extends base             |
| `apps/llm-orchestrator/src/infra/pubsub/researchEventPublisher.ts`  | REFACTORED - extends base             |
| `apps/commands-router/src/infra/pubsub/actionEventPublisher.ts`     | REFACTORED - extends base             |
| `apps/commands-router/src/infra/pubsub/config.ts`                   | REFACTORED - env vars                 |
| `apps/commands-router/src/domain/ports/eventPublisher.ts`           | REFACTORED - uses shared PublishError |

## Lines of Code Reduction

| Component                   | Before  | After   | Reduction     |
| --------------------------- | ------- | ------- | ------------- |
| whatsapp-service publisher  | 232     | 103     | 129 (56%)     |
| llm-orchestrator publishers | 168     | 92      | 76 (45%)      |
| commands-router publisher   | 72      | 30      | 42 (58%)      |
| **Total**                   | **472** | **225** | **247 (52%)** |

## Open Questions (Resolved)

1. ~~Should event type names be changed for consistency?~~ → Deferred, low priority
2. ~~Should we add message attributes for better observability?~~ → Out of scope for this task
