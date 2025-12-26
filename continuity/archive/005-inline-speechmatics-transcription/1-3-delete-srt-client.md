# 1-3: Delete SRT Client from whatsapp-service

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

`apps/whatsapp-service/src/infra/srt/` contains HTTP client for calling srt-service. No longer needed.

## Problem Statement

Delete the SRT client infrastructure code from whatsapp-service.

## Scope

**In scope:**

- Delete `apps/whatsapp-service/src/infra/srt/` directory

**Out of scope:**

- services.ts updates (2-2)
- webhookRoutes.ts updates (2-0)

## Required Approach

1. Delete the entire infra/srt directory
2. Note: This will cause TypeScript errors until services.ts is updated

## Step Checklist

- [ ] Delete `apps/whatsapp-service/src/infra/srt/` directory
- [ ] Document expected TypeScript errors

## Definition of Done

- `apps/whatsapp-service/src/infra/srt/` does not exist

## Verification Commands

```bash
ls apps/whatsapp-service/src/infra/srt 2>&1 | grep "No such file"
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/infra/srt/
```
