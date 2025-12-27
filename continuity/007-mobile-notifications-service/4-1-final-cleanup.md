# 4-1: Final Cleanup and Archival

## Tier

4 (Final)

## Context

Last task before archiving.

## Problem Statement

Ensure clean state before archiving:

- No unused code
- No unused imports
- Documentation updated
- CI passes

## Scope

- Remove any dead code
- Final CI verification
- Archive task folder

## Non-Scope

- New features

## Required Approach

1. Run lint to catch unused code
2. Review changed files
3. Run full CI
4. Move to archive

## Step Checklist

- [ ] Run `npm run lint` - fix any issues
- [ ] Review all changed files for dead code
- [ ] Run `npm run ci`
- [ ] Terraform verification (if changed)
- [ ] Move folder to `continuity/archive/007-mobile-notifications-service/`

## Definition of Done

- `npm run ci` passes
- Terraform validated (if changed)
- Folder archived
- No unused code
- Documentation current

## Verification Commands

```bash
npm run ci
terraform fmt -check -recursive && terraform validate  # if terraform changed
mv continuity/007-mobile-notifications-service continuity/archive/
```

## Rollback Plan

N/A - final task
