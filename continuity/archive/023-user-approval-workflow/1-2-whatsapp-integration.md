# Tier 1-2: WhatsApp Pub/Sub Integration

## Status: ⏳ PENDING

## Objective

Add WhatsApp message publishing capability and user phone number lookup to actions-agent.

## Dependencies

- 0-0-setup (completed)

## Tasks

- [ ] Add `@intexuraos/infra-pubsub` to package.json
- [ ] Create UserPhoneLookup port interface
- [ ] Implement UserPhoneLookup adapter (calls user-service)
- [ ] Add WhatsAppSendPublisher to services.ts
- [ ] Add UserPhoneLookup to services.ts
- [ ] Add environment variables for Pub/Sub
- [ ] Write unit tests for UserPhoneLookup
- [ ] Write integration tests

## Files to Create

1. `apps/actions-agent/src/domain/ports/userPhoneLookup.ts` - Port interface
2. `apps/actions-agent/src/infra/userService/userPhoneLookup.ts` - Implementation

## Files to Modify

1. `apps/actions-agent/package.json` - Add dependency
2. `apps/actions-agent/src/services.ts` - Add publisher and phone lookup
3. `.envrc` - Add environment variables (local dev)

## UserPhoneLookup Port

```typescript
export interface UserPhoneLookup {
  getPhoneNumber(userId: string): Promise<string | null>;
}
```

## Implementation Details

- Calls: `GET /internal/users/:userId/whatsapp-phone` on user-service
- Returns: E.164 format phone number or null
- Error handling: Return null on 404 or errors

## WhatsAppSendPublisher Setup

```typescript
import { createWhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

const whatsappPublisher = createWhatsAppSendPublisher({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] as string,
  topicName: process.env['INTEXURAOS_WHATSAPP_SEND_TOPIC'] as string,
});
```

## Environment Variables

- `INTEXURAOS_GCP_PROJECT_ID` - Google Cloud project
- `INTEXURAOS_WHATSAPP_SEND_TOPIC` - Pub/Sub topic name
- `INTEXURAOS_USER_SERVICE_URL` - User service base URL
- `INTEXURAOS_WEB_APP_URL` - Web app base URL for deep links

## Verification

- [ ] Package installs successfully
- [ ] UserPhoneLookup returns phone numbers
- [ ] UserPhoneLookup returns null for users without WhatsApp
- [ ] Publisher can publish messages (check logs)
- [ ] Environment variables validated at startup

## Blocked By

None (independent)

## Blocks

- 2-2-execute-endpoint (needs WhatsApp integration)
- 2-3-research-handler-update (needs WhatsApp integration)

## Notes

- Use existing pattern from llm-orchestrator
- Phone lookup is best-effort - don't fail if user not found
- Messages published asynchronously - don't wait for delivery

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
