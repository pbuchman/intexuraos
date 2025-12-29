# 1-0: infra-whatsapp Package

**Tier:** 1 - Shared Packages (Independent)
**Status:** Pending

## Context

Extract WhatsApp sender functionality from whatsapp-service into a reusable package for notification sending.

## Problem Statement

The llm-orchestrator-service needs to send WhatsApp notifications, but the sender is currently embedded in whatsapp-service. Extract to shared package.

## Scope

**In Scope:**
- Create `packages/infra-whatsapp/` package
- Move `WhatsAppCloudApiSender` class
- Define `WhatsAppSender` port interface
- Update whatsapp-service to use the package

**Out of Scope:**
- Webhook handling (stays in whatsapp-service)
- Media download (stays in whatsapp-service)

## Required Approach

1. Create package structure with package.json, tsconfig.json
2. Define sender port interface
3. Copy sender implementation
4. Export from index.ts
5. Update whatsapp-service imports

## Step Checklist

- [ ] Create `packages/infra-whatsapp/` directory
- [ ] Create `package.json` with name `@intexuraos/infra-whatsapp`
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/ports/WhatsAppSender.ts` interface
- [ ] Create `src/WhatsAppCloudApiSender.ts` implementation
- [ ] Create `src/index.ts` exports
- [ ] Update `apps/whatsapp-service` to import from package
- [ ] Run `npm install` and verify

## Definition of Done

- [ ] Package compiles without errors
- [ ] whatsapp-service uses package import
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm install
npm run typecheck
npm run test --workspace=@intexuraos/whatsapp-service
```

## Rollback Plan

Delete package directory, restore original sender in whatsapp-service.
