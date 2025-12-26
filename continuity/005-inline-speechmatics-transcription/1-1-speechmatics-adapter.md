# 1-1: Speechmatics Adapter

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Need to implement `SpeechTranscriptionPort` using `@speechmatics/batch-client` npm package.

## Problem Statement

Create infrastructure adapter that wraps Speechmatics batch client and implements the domain port interface.

## Scope

**In scope:**
- Create `apps/whatsapp-service/src/infra/speechmatics/` directory
- Create `adapter.ts` implementing SpeechTranscriptionPort
- Create `index.ts` exporting adapter
- Handle all logging requirements
- Track API calls in response

**Out of scope:**
- Wiring into services.ts (2-2)
- Config changes (2-2)

## Required Approach

1. Use `@speechmatics/batch-client` BatchClient
2. Implement submitJob: create job with GCS URL fetch
3. Implement pollJob: get job status
4. Implement getTranscript: fetch result as text
5. Log all API calls with request/response
6. Return TranscriptionApiCall in all results

## Step Checklist

- [ ] Create `apps/whatsapp-service/src/infra/speechmatics/` directory
- [ ] Create `adapter.ts` with SpeechmaticsTranscriptionAdapter class
- [ ] Implement submitJob method
- [ ] Implement pollJob method
- [ ] Implement getTranscript method
- [ ] Add comprehensive logging (pino)
- [ ] Create `index.ts` with exports
- [ ] Run `npm run typecheck`

## Definition of Done

- Adapter implements SpeechTranscriptionPort
- All methods log API calls
- All methods return TranscriptionApiCall in result
- TypeScript compiles

## Verification Commands

```bash
npm run typecheck
cat apps/whatsapp-service/src/infra/speechmatics/index.ts
```

## Rollback Plan

```bash
rm -rf apps/whatsapp-service/src/infra/speechmatics/
```

