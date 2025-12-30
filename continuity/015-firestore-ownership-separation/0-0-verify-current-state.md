# 0-0: Verify Current State

**Tier**: 0 (Setup/Diagnostics)
**Dependencies**: None

## Context

Before making changes, verify current usage of `notion_connections` collection and `promptVaultPageId` field across the codebase.

## Problem

Need baseline understanding of:
1. Where `notionConnection.ts` functions are currently used
2. Which files reference `promptVaultPageId`
3. Current test coverage that will need updating

## Scope

**In Scope:**
- Search for all usages of `promptVaultPageId` string literal
- Identify all imports from `@intexuraos/infra-notion` related to connections
- List all test files that reference Notion connections

**Out of Scope:**
- Making any changes
- Modifying code

## Approach

1. Search for `promptVaultPageId` across codebase
2. Search for imports of `saveNotionConnection`, `getNotionConnection`, etc.
3. Identify test files that will need updates
4. Document findings in this file

## Steps

- [ ] Search for `promptVaultPageId` string
- [ ] Search for `NotionConnectionPublic` interface usage
- [ ] Search for function imports from infra-notion
- [ ] List affected test files
- [ ] Document findings below

## Definition of Done

- All current usages documented
- Baseline established for verification after changes
- No code changes made

## Verification

```bash
# Should find references (before changes)
grep -r "promptVaultPageId" apps/ packages/
```

## Rollback

N/A - read-only task

---

## Findings

(To be filled during execution)

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
