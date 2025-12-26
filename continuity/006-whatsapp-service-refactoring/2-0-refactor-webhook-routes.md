# 2-0: Refactor webhookRoutes.ts to Use Usecases

## Tier
2 (Dependent on Tier 1)

## Context
With usecases extracted, webhookRoutes.ts must be refactored to use them.

## Problem Statement
webhookRoutes.ts is currently 1317 lines containing business logic.
Target: <200 lines, handling only:
- Route registration
- Schema validation
- Signature validation
- Calling usecases
- Sending HTTP responses

## Scope
- Remove all business logic functions
- Import and use usecases from domain
- Keep route handlers thin
- Update services.ts with usecase factories

## Non-Scope
- Changing API contracts
- Modifying other route files

## Required Approach
1. Import usecases from domain layer
2. Create usecase instances with injected dependencies
3. Replace inline logic with usecase calls
4. Remove helper functions moved to usecases
5. Keep confirmation message sending in routes (HTTP concern)

## Target Structure
```typescript
// webhookRoutes.ts (~150-200 lines)
export function createWebhookRoutes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    // GET /v1/webhooks/whatsapp - Verification (keep as-is, ~30 lines)
    
    // POST /v1/webhooks/whatsapp - Event receiver (~50 lines)
    // - Validate signature
    // - Persist event
    // - Call ProcessIncomingMessageUseCase
    // - Send confirmation based on result
    // - Return 200
    
    done();
  };
}
```

## Step Checklist
- [ ] Import usecases
- [ ] Update services.ts with usecase creation
- [ ] Replace processWebhookAsync with usecase call
- [ ] Remove processImageMessage function
- [ ] Remove processAudioMessage function
- [ ] Remove transcribeAudioAsync function
- [ ] Remove helper functions moved to usecases
- [ ] Keep only route-level helpers (confirmation sending)
- [ ] Run CI

## Definition of Done
- webhookRoutes.ts < 200 lines
- All tests pass
- `npm run ci` passes

## Verification Commands
```bash
wc -l apps/whatsapp-service/src/routes/v1/webhookRoutes.ts
npm run ci
```

## Rollback Plan
Git revert to pre-refactor state

