# 5-0: Documentation Updates

**Tier:** 5 (Documentation)

**Depends on:** All implementation tasks

---

## Context

All new functionality must be documented according to project standards.

---

## Problem Statement

Update documentation for:

- API contracts (new endpoints)
- Architecture (event flow)
- Setup guides (new secrets, Pub/Sub)
- CHANGELOG

---

## Scope

**In scope:**

- docs/architecture/api-contracts.md
- New setup guide for srt-service secrets
- Update README if needed
- CHANGELOG.md entry

**Out of scope:**

- External user docs
- Video tutorials

---

## Required Approach

1. Document new whatsapp-service endpoints
2. Document srt-service endpoints
3. Document event flow diagram
4. Document new secrets needed
5. Add CHANGELOG entry

---

## Step Checklist

- [ ] Update api-contracts.md with media endpoints
- [ ] Update api-contracts.md with srt-service endpoints
- [ ] Document Pub/Sub event schemas
- [ ] Document INTEXURAOS_SPEECHMATICS_API_KEY secret
- [ ] Document new env vars for services
- [ ] Add architecture diagram for event flow (ASCII or description)
- [ ] Add CHANGELOG entry for media + srt-service
- [ ] Verify .env.default files are up to date with all required env vars
  - [ ] apps/whatsapp-service/.env.default (add PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION)
  - [ ] apps/srt-service/.env.default (verify all required vars)
- [ ] Verify docs render correctly

---

## Definition of Done

- All new endpoints documented
- Event flow explained
- Setup guide updated
- CHANGELOG updated

---

## Verification Commands

```bash
# Review docs manually
cat docs/architecture/api-contracts.md
cat CHANGELOG.md
```

---

## Rollback Plan

Revert documentation files.
