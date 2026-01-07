# 1-1: Clean Up infra-gpt Package

## Status: ✅ DONE

## Tier: 1 (Package-level)

## Context

Remove V1 client, rename V2 to be the only client. Simplify exports and types.

## Scope

**Files to DELETE:**

- packages/infra-gpt/src/client.ts

**Files to RENAME:**

- packages/infra-gpt/src/clientV2.ts → packages/infra-gpt/src/client.ts

**Files to MODIFY:**

- packages/infra-gpt/src/client.ts (renamed): change `createGptClientV2` → `createGptClient`, `GptClientV2` → `GptClient`
- packages/infra-gpt/src/types.ts: remove `GptConfig`, rename `GptConfigV2` → `GptConfig`
- packages/infra-gpt/src/index.ts: remove V2 exports, update to new names

## Non-Scope

- Consumer updates (handled in Tier 2)

## Current State

```typescript
// index.ts (BEFORE)
export { createGptClient, type GptClient } from './client.js';
export { createGptClientV2, type GptClientV2 } from './clientV2.js';
export type { GptConfig, GptConfigV2, ... } from './types.js';
```

## Target State

```typescript
// index.ts (AFTER)
export { createGptClient, type GptClient } from './client.js';
export type { GptConfig, ... } from './types.js';
```

## Steps

- [ ] Delete `packages/infra-gpt/src/client.ts` (V1)
- [ ] Rename `packages/infra-gpt/src/clientV2.ts` → `client.ts`
- [ ] In new `client.ts`: rename `createGptClientV2` → `createGptClient`
- [ ] In new `client.ts`: rename `GptClientV2` → `GptClient`
- [ ] In `types.ts`: delete `GptConfig` (V1), rename `GptConfigV2` → `GptConfig`
- [ ] Update `index.ts`: remove V2 exports, keep only `createGptClient`, `GptClient`, `GptConfig`
- [ ] Run `npx tsc --noEmit -p packages/infra-gpt/tsconfig.json`

## Definition of Done

- [ ] No V1 `client.ts` with hardcoded pricing exists
- [ ] No `clientV2.ts` file exists
- [ ] No `GptConfigV2` type exists
- [ ] Package compiles standalone
- [ ] Clean exports: `createGptClient`, `GptClient`, `GptConfig`

## Verification

```bash
npx tsc --noEmit -p packages/infra-gpt/tsconfig.json
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-2-infra-claude-cleanup.md.
