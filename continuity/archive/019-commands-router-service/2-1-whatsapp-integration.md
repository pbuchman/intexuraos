# 2-1 WhatsApp Integration

## Tier

2 (Dependent)

## Context

Modify whatsapp-service to publish command events to PubSub.

## Problem

Need to trigger commands-router when messages are saved or transcribed.

## Scope

- Add command event publisher
- Publish on text message save
- Publish on voice transcription complete

## Non-Scope

- Image messages (for now)
- Other message types

## Approach

1. Add command event type to publisher
2. Publish after text message save in webhookRoutes.ts
3. Publish after transcription complete in TranscribeAudioUseCase

## Event Payload

```typescript
interface CommandEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: 'whatsapp_text' | 'whatsapp_voice';
  externalId: string; // WhatsApp message ID
  text: string; // Message text or transcript
  timestamp: string; // ISO8601
}
```

## Files to Modify

- `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- `apps/whatsapp-service/src/routes/webhookRoutes.ts`
- `apps/whatsapp-service/src/domain/usecases/transcribeAudio.ts`
- `apps/whatsapp-service/src/config.ts` (add topic name)

## Checklist

- [ ] Command event type added
- [ ] Publisher method for commands
- [ ] Text message → publish
- [ ] Voice transcription → publish
- [ ] Config for topic name

## Definition of Done

WhatsApp service publishes command events on message save/transcription.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/whatsapp-service
npm run test --workspace=@intexuraos/whatsapp-service
```

## Rollback

Revert whatsapp-service changes.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
