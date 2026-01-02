# Tier 2-0: Execute Action Endpoint

## Status: ⏳ PENDING

## Objective
Create public POST /actions/:actionId/execute endpoint for user-initiated action execution with WhatsApp notifications.

## Dependencies
- 0-0-setup (completed)
- 1-1-public-action-endpoints (provides JWT auth setup)
- 1-2-whatsapp-integration (provides notification capability)

## Tasks
- [ ] Create executeResearchAction use case
- [ ] Add POST /actions/:actionId/execute to publicRoutes.ts
- [ ] Implement JWT authentication
- [ ] Verify user owns action (403 if not)
- [ ] Verify action status (400 if not awaiting_approval or failed)
- [ ] Call executeResearchAction use case
- [ ] Send WhatsApp notification on success
- [ ] Return synchronously with resource_url
- [ ] Handle idempotency (return existing result if already completed)
- [ ] Write unit tests
- [ ] Write integration tests

## Files to Create
1. `apps/actions-agent/src/domain/usecases/executeResearchAction.ts` - Execute logic

## Files to Modify
1. `apps/actions-agent/src/routes/publicRoutes.ts` - Add endpoint
2. `apps/actions-agent/src/services.ts` - Add use case

## Execute Research Use Case Flow
1. Fetch action from repository
2. If status is `completed`: return existing resource_url (idempotency)
3. Update status to `processing`
4. Call llm-orchestrator to create draft
5. On success:
   - Update to `completed` with `payload: { researchId, resource_url }`
   - Send WhatsApp notification with draft link
6. On failure:
   - Update to `failed` with error details
7. Return final status + resource_url

## Resource URL Format
- Draft research: `/#/research/{researchId}/edit`
- Published research: `/#/research/{researchId}`
- Determined by llm-orchestrator response status

## WhatsApp Notification
```typescript
const phoneNumber = await userPhoneLookup.getPhoneNumber(action.userId);
if (phoneNumber !== null) {
  const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] as string;
  const resourceUrl = `${webAppUrl}${resource_url}`;
  const message = `Your research draft is ready. Edit it here: ${resourceUrl}`;

  await whatsappPublisher.publishSendMessage({
    userId: action.userId,
    phoneNumber,
    message,
    correlationId: `research-complete-${researchId}`,
  });
}
```

## Response Schema
```typescript
{
  success: true,
  data: {
    actionId: string,
    status: 'completed' | 'failed',
    resource_url?: string  // Present if completed
  }
}
```

## Verification
- [ ] JWT authentication works
- [ ] Returns 403 when user doesn't own action
- [ ] Returns 400 for invalid status
- [ ] Creates research draft successfully
- [ ] WhatsApp notification sent
- [ ] Returns correct resource_url
- [ ] Idempotency works (retry returns same result)
- [ ] Timeout set to 5 minutes
- [ ] Integration test passes

## Blocked By
- 1-1-public-action-endpoints (JWT auth setup)
- 1-2-whatsapp-integration (notification capability)

## Blocks
- User approval flow (frontend needs this endpoint)

## Notes
- **Synchronous execution** - wait for llm-orchestrator to complete
- **5-minute timeout** - llm-orchestrator can be slow
- **Idempotent** - safe to retry failed executions
- Phone lookup is best-effort - don't fail if user not found

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
