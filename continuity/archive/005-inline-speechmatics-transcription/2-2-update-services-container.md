# 2-2: Update Services Container

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-1, 1-3

## Context Snapshot

`apps/whatsapp-service/src/services.ts` needs to:

- Remove SrtServiceClient
- Add SpeechmaticsTranscriptionAdapter
- Update ServiceConfig and ServiceContainer

`apps/whatsapp-service/src/config.ts` needs:

- Add INTEXURAOS_SPEECHMATICS_API_KEY
- Remove srtServiceUrl
- Remove transcription subscription name (if present)

## Problem Statement

Wire the new Speechmatics adapter and remove old SRT client from service container.

## Scope

**In scope:**

- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/config.ts`

**Out of scope:**

- Adapter implementation (1-1)
- Terraform secrets (2-4)

## Required Approach

1. Remove SrtServiceClientPort from ServiceContainer
2. Add SpeechTranscriptionPort to ServiceContainer
3. Update ServiceConfig to include speechmaticsApiKey
4. Remove srtServiceUrl from ServiceConfig
5. Instantiate SpeechmaticsTranscriptionAdapter in getServices()
6. Update config.ts to load INTEXURAOS_SPEECHMATICS_API_KEY

## Step Checklist

- [ ] Update config.ts: add speechmaticsApiKey, remove srtServiceUrl
- [ ] Update ServiceConfig interface
- [ ] Update ServiceContainer interface
- [ ] Remove SrtServiceClient import
- [ ] Add SpeechmaticsTranscriptionAdapter import
- [ ] Update getServices() instantiation
- [ ] Remove transcription subscription config if present
- [ ] Run `npm run typecheck`

## Definition of Done

- No reference to SrtServiceClient
- SpeechTranscriptionPort in ServiceContainer
- INTEXURAOS_SPEECHMATICS_API_KEY loaded from env
- TypeScript compiles

## Verification Commands

```bash
npm run typecheck
grep -r "SrtServiceClient" apps/whatsapp-service/src/ && echo "FAIL" || echo "OK: No SrtServiceClient"
grep "speechmaticsApiKey" apps/whatsapp-service/src/config.ts
grep "SpeechTranscriptionPort" apps/whatsapp-service/src/services.ts
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/services.ts
git checkout -- apps/whatsapp-service/src/config.ts
```
