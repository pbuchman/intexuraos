# Continuity Ledger: User Approval Workflow

## Goal
Introduce user approval workflow for all actions - no automatic execution, explicit user approval required.

## Success Criteria
- WhatsApp notifications on approval needed + completion
- Web UI approval flow with confirmation dialogs
- Synchronous execute endpoint
- Firestore ownership transferred to actions-agent
- `npm run ci` passes

---

## Status

### Done
- ✅ Tier 0-0: Added `awaiting_approval` status to ActionStatus enum (commands-router, web, actions-agent)
- ✅ Tier 0-0: Created Action model in actions-agent
- ✅ Tier 0-0: Created ActionRepository port and Firestore implementation in actions-agent
- ✅ Tier 1-0: Added @intexuraos/infra-pubsub dependency to actions-agent
- ✅ Tier 1-0: Created action event publisher infrastructure (actionEventPublisher)
- ✅ Tier 1-0: Updated services.ts with actionRepository and actionEventPublisher
- ✅ Tier 1-0: Implemented POST /internal/actions endpoint with validation, save, publish
- ✅ Tier 1-0: Wrote comprehensive tests (auth, validation, happy path, error handling)
- ✅ Tier 1-0: Updated firestore-collections.json ownership (actions → actions-agent)
- ✅ Tier 1-1: Created publicRoutes.ts with GET, PATCH, DELETE endpoints
- ✅ Tier 1-1: Added action schema with awaiting_approval status
- ✅ Tier 1-1: Registered public routes in server (routes/index.ts)
- ✅ Tier 1-1: Wrote 11 comprehensive tests (auth, ownership, CRUD operations)
- ✅ Tier 1-2: Created UserPhoneLookup port and adapter (user-service client)
- ✅ Tier 1-2: Added WhatsAppSendPublisher from @intexuraos/infra-pubsub
- ✅ Tier 1-2: Updated services.ts with userPhoneLookup and whatsappPublisher
- ✅ Tier 1-2: Added INTEXURAOS_WHATSAPP_SEND_TOPIC and INTEXURAOS_WEB_APP_URL env vars
- ✅ Tier 1-2: Created FakeUserPhoneLookup and FakeWhatsAppSendPublisher for testing
- ✅ Tier 1-2: Wrote 4 comprehensive tests for UserPhoneLookup adapter

### Now
- ⏳ Ready to start Tier 2-0: Create execute endpoint POST /actions/:id/execute
- ⚠️ Note: Firestore ownership check failing - commands-router still has old actionRepository.ts
  - Will be resolved after Tier 2-1 (create actions-agent client) and Tier 2-3 (delete old repository)

### Next (Prioritized)
1. Tier 1-1: Move public action endpoints to actions-agent (GET, PATCH, DELETE)
2. Tier 1-2: Add WhatsApp Pub/Sub integration to actions-agent
3. Tier 2-0: Create execute endpoint POST /actions/:id/execute
4. Tier 2-1: Create actions-agent client in commands-router
5. Tier 2-1: Update classification flow to call actions-agent
6. Tier 2-2: Update handleResearchAction with WhatsApp notifications
7. Tier 2-3: Delete action repository from commands-router
8. Tier 3: Update frontend (confirmation dialogs + inbox deep linking)
9. Tier 3: Update action-config.yaml
10. Tier 3: Full CI verification

---

## Key Decisions

### Decision 1: commands-router has NO Firestore access
**Reasoning**: Clear responsibility boundary - actions-agent owns entire action lifecycle
**Impact**: Requires POST /internal/actions endpoint for action creation
**Alternative considered**: Allow commands-router to create via Firestore (rejected - violates ownership)

### Decision 2: Execute endpoint in actions-agent (not commands-router)
**Reasoning**: Respects responsibility boundary, commands-router ends after classification
**Impact**: Simpler architecture, direct UI → actions-agent communication
**Alternative considered**: Route through commands-router (rejected - unnecessary hop)

### Decision 3: WhatsApp notifications via Pub/Sub (not HTTP)
**Reasoning**: Async, reliable, existing pattern in llm-orchestrator
**Impact**: Requires `@intexuraos/infra-pubsub` dependency
**Alternative considered**: Direct HTTP to whatsapp-service (rejected - tight coupling)

### Decision 4: Synchronous execute endpoint
**Reasoning**: UI needs immediate feedback with resource_url for navigation
**Impact**: 5-minute timeout required, llm-orchestrator can be slow
**Alternative considered**: Async with polling (rejected - poor UX)

### Decision 5: Duplicate Action type in each app
**Reasoning**: Apps cannot import from other apps (architectural boundary)
**Impact**: Type definitions duplicated in commands-router and actions-agent
**Alternative considered**: Shared package (rejected - adds complexity)

---

## Open Questions

### Q1: Should we add approval workflow for other action types (todo, note, etc.)?
**Status**: Deferred - research only for MVP
**Notes**: Pattern established, easy to extend later

### Q2: What happens to actions created during deployment window?
**Status**: Unresolved
**Risk**: Medium - small window, low traffic
**Mitigation**: Deploy during low-traffic period, manual cleanup if needed

### Q3: Should execute endpoint validate action type matches handler?
**Status**: Resolved - Yes
**Decision**: Return 400 if no handler registered for action type

---

## Progress Log

### 2026-01-02 (Session 3)
- ✅ Completed Tier 1-2: WhatsApp Pub/Sub Integration
  - Created UserPhoneLookup port interface (domain/ports/userPhoneLookup.ts)
  - Implemented UserPhoneLookup adapter calling user-service internal API
  - Added WhatsAppSendPublisher from @intexuraos/infra-pubsub package
  - Updated services.ts with userPhoneLookup and whatsappPublisher
  - Added environment variables: INTEXURAOS_WHATSAPP_SEND_TOPIC, INTEXURAOS_WEB_APP_URL
  - Created FakeUserPhoneLookup and FakeWhatsAppSendPublisher for testing
  - Wrote 4 comprehensive tests for UserPhoneLookup adapter (success, 404, 500, network error)
- ⚠️ Firestore ownership check failing - expected, will resolve after Tier 2 work

### 2026-01-02 (Session 2)
- ✅ Completed Tier 1-0: Action Creation Endpoint
  - Added @intexuraos/infra-pubsub dependency
  - Created action event publisher infrastructure
  - Implemented POST /internal/actions with full validation
  - Wrote 6 comprehensive unit tests (auth, validation, happy/error paths)
  - Updated firestore-collections.json ownership transfer
  - Added INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC env var validation
- ✅ Completed Tier 1-1: Public Action Endpoints Migration
  - Created publicRoutes.ts with GET, PATCH, DELETE for /router/actions
  - Added action schema including awaiting_approval status
  - Registered public routes in routes/index.ts
  - Wrote 11 comprehensive tests covering all endpoints and edge cases

### 2026-01-02 02:30 UTC
- Created continuity structure (023-user-approval-workflow)
- Completed Tier 0-0: Status enum updates (commands-router + web + actions-agent)
- Completed Tier 0-0: Moved action repository to actions-agent
- Created action model and Firestore implementation

### Session Start
- Exited plan mode with approved comprehensive plan
- Identified need for continuity ledger structure
- 16 subtasks identified from approved plan

---

## Blocked Items

None currently.

---

## Risks & Mitigation

### Risk 1: Firestore ownership verification fails
**Likelihood**: Medium
**Impact**: High - blocks deployment
**Mitigation**: Run `npm run verify:firestore` after each change, test incrementally

### Risk 2: Pub/Sub message delivery delays
**Likelihood**: Low
**Impact**: Medium - delayed notifications
**Mitigation**: Monitor Cloud Logging, Pub/Sub provides automatic retries

### Risk 3: Execute endpoint timeout
**Likelihood**: Medium
**Impact**: High - user sees error, action may succeed anyway
**Mitigation**: 5-minute timeout, idempotent execution, clear error messages

### Risk 4: Breaking existing actions
**Likelihood**: High
**Impact**: Low - manual cleanup required
**Mitigation**: Delete pending actions before deployment, document migration

---

## Dependencies Status

- ✅ `@intexuraos/infra-firestore` - Available
- ✅ `@intexuraos/common-http` - Available
- ✅ `@intexuraos/common-core` - Available
- ✅ `@intexuraos/infra-pubsub` - Added to actions-agent package.json
- ✅ user-service - Phone lookup endpoint exists
- ✅ whatsapp-service - Pub/Sub consumer exists
- ✅ llm-orchestrator - Research creation endpoint exists

---

## Notes

- **Major architectural change** - affects commands-router, actions-agent, web frontend
- Plan file reference: `/Users/p.buchman/.claude/plans/snazzy-riding-fairy.md`
- Original work tracked in deleted todo list, migrated to continuity structure
- All HTTP endpoints must follow internal/public patterns
- Remember to add JWT authentication to public routes in actions-agent

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
