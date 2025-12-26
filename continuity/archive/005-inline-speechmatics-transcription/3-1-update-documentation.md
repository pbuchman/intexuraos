# 3-1: Update Documentation

**Tier:** 3 (Documentation/Verification)

**Depends on:** 3-0

## Context Snapshot

Documentation needs updates to reflect:

1. Removal of srt-service
2. New inline transcription architecture
3. Cloud Run in-process async risks

## Problem Statement

Update all documentation to reflect the new architecture.

## Scope

**In scope:**

- `README.md` — remove srt-service from services list, update environment variables
- `docs/architecture/` — update service architecture diagrams/descriptions
- Add Cloud Run risk documentation

**Out of scope:**

- Code changes

## Required Approach

1. Update README.md service list
2. Update environment variable documentation
3. Create/update architecture doc explaining inline transcription
4. Document Cloud Run in-process async risks

## Step Checklist

- [ ] Update README.md — remove srt-service from service list
- [ ] Update README.md — update environment variables section
- [ ] Update/create architecture documentation
- [ ] Document Cloud Run risks:
  - Container may be killed before transcription completes
  - Long audio files at risk
  - Consider min_scale=1 for reliability
  - Future: Cloud Tasks for guaranteed delivery
- [ ] Remove any srt-service references from docs/
- [ ] Verify no remaining srt-service references

## Definition of Done

- README.md updated
- Architecture docs updated
- Cloud Run risks documented
- No srt-service references in documentation

## Verification Commands

```bash
grep -r "srt-service" README.md docs/ && echo "FAIL" || echo "OK: No srt-service in docs"
grep -r "srt_service" README.md docs/ && echo "FAIL" || echo "OK: No srt_service in docs"
```

## Rollback Plan

```bash
git checkout -- README.md docs/
```
