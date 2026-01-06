# 1-2: Clean Up infra-claude Package

## Status: ✅ DONE

## Tier: 1 (Package-level)

## Context

Remove V1 client, rename V2 to be the only client. Simplify exports and types.

## Scope

**Files to DELETE:**
- packages/infra-claude/src/client.ts

**Files to RENAME:**
- packages/infra-claude/src/clientV2.ts → packages/infra-claude/src/client.ts

**Files to MODIFY:**
- packages/infra-claude/src/client.ts (renamed): change `createClaudeClientV2` → `createClaudeClient`, `ClaudeClientV2` → `ClaudeClient`
- packages/infra-claude/src/types.ts: remove `ClaudeConfig`, rename `ClaudeConfigV2` → `ClaudeConfig`
- packages/infra-claude/src/index.ts: remove V2 exports, update to new names

## Non-Scope

- Consumer updates (handled in Tier 2)

## Current State

```typescript
// index.ts (BEFORE)
export { createClaudeClient, type ClaudeClient } from './client.js';
export { createClaudeClientV2, type ClaudeClientV2 } from './clientV2.js';
export type { ClaudeConfig, ClaudeConfigV2, ... } from './types.js';
```

## Target State

```typescript
// index.ts (AFTER)
export { createClaudeClient, type ClaudeClient } from './client.js';
export type { ClaudeConfig, ... } from './types.js';
```

## Steps

- [ ] Delete `packages/infra-claude/src/client.ts` (V1)
- [ ] Rename `packages/infra-claude/src/clientV2.ts` → `client.ts`
- [ ] In new `client.ts`: rename `createClaudeClientV2` → `createClaudeClient`
- [ ] In new `client.ts`: rename `ClaudeClientV2` → `ClaudeClient`
- [ ] In `types.ts`: delete `ClaudeConfig` (V1), rename `ClaudeConfigV2` → `ClaudeConfig`
- [ ] Update `index.ts`: remove V2 exports, keep only `createClaudeClient`, `ClaudeClient`, `ClaudeConfig`
- [ ] Run `npx tsc --noEmit -p packages/infra-claude/tsconfig.json`

## Definition of Done

- [ ] No V1 `client.ts` with hardcoded pricing exists
- [ ] No `clientV2.ts` file exists
- [ ] No `ClaudeConfigV2` type exists
- [ ] Package compiles standalone
- [ ] Clean exports: `createClaudeClient`, `ClaudeClient`, `ClaudeConfig`

## Verification

```bash
npx tsc --noEmit -p packages/infra-claude/tsconfig.json
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-3-infra-perplexity-cleanup.md.

