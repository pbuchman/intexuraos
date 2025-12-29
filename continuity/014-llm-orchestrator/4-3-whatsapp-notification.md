# 4-3: WhatsApp Notification

**Tier:** 4 - LLM Orchestrator Infrastructure
**Status:** Pending

## Context

Implement WhatsApp notification sender using shared package.

## Problem Statement

Need to notify users when research completes via WhatsApp.

## Scope

**In Scope:**
- Implement `NotificationSender` port
- Use infra-whatsapp package
- Check if user has WhatsApp connected
- Skip silently if not connected

**Out of Scope:**
- Other notification channels

## Required Approach

1. Import sender from infra-whatsapp package
2. Look up user's WhatsApp phone number (from whatsapp_mappings collection)
3. Send message with deep link to research
4. Skip silently if no phone number

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/infra/whatsapp/notificationSender.ts`
- [ ] Import WhatsAppCloudApiSender from package
- [ ] Look up user's phone number from Firestore
- [ ] Compose message with research title and link
- [ ] Send message or skip if no phone
- [ ] Implement port interface

## Definition of Done

- [ ] Sends notification when WhatsApp connected
- [ ] Skips silently when not connected
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete notification sender file.
