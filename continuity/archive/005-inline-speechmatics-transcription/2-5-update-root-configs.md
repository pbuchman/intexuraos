# 2-5: Update Root Configs

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-2

## Context Snapshot

Root-level config files may reference srt-service:

- `tsconfig.json` — project references
- `package.json` — workspace references (if any)

## Problem Statement

Remove srt-service references from root configuration files.

## Scope

**In scope:**

- `tsconfig.json`
- `package.json` (if needed)

**Out of scope:**

- Application-level configs

## Required Approach

1. Remove apps/srt-service from tsconfig.json references
2. Check package.json for workspace references

## Step Checklist

- [ ] Remove apps/srt-service from tsconfig.json references array
- [ ] Check package.json for srt-service references
- [ ] Run `npm run typecheck`

## Definition of Done

- No srt-service in tsconfig.json
- TypeScript compiles

## Verification Commands

```bash
grep -r "srt-service" tsconfig.json && echo "FAIL" || echo "OK: No srt-service"
grep -r "srt-service" package.json && echo "FAIL" || echo "OK: No srt-service"
npm run typecheck
```

## Rollback Plan

```bash
git checkout -- tsconfig.json
git checkout -- package.json
```
