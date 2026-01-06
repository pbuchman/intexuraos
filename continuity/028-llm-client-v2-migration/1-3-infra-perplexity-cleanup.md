# 1-3: Clean Up infra-perplexity Package

## Status: ✅ DONE

## Tier: 1 (Package-level)

## Context

Remove V1 client, rename V2 to be the only client. Simplify exports and types.

## Scope

**Files to DELETE:**
- packages/infra-perplexity/src/client.ts

**Files to RENAME:**
- packages/infra-perplexity/src/clientV2.ts → packages/infra-perplexity/src/client.ts

**Files to MODIFY:**
- packages/infra-perplexity/src/client.ts (renamed): change `createPerplexityClientV2` → `createPerplexityClient`, `PerplexityClientV2` → `PerplexityClient`
- packages/infra-perplexity/src/types.ts: remove `PerplexityConfig`, rename `PerplexityConfigV2` → `PerplexityConfig`
- packages/infra-perplexity/src/index.ts: remove V2 exports, update to new names

## Non-Scope

- Consumer updates (handled in Tier 2)

## Current State

```typescript
// index.ts (BEFORE)
export { createPerplexityClient, type PerplexityClient } from './client.js';
export { createPerplexityClientV2, type PerplexityClientV2 } from './clientV2.js';
export type { PerplexityConfig, PerplexityConfigV2, ... } from './types.js';
```

## Target State

```typescript
// index.ts (AFTER)
export { createPerplexityClient, type PerplexityClient } from './client.js';
export type { PerplexityConfig, ... } from './types.js';
```

## Steps

- [ ] Delete `packages/infra-perplexity/src/client.ts` (V1)
- [ ] Rename `packages/infra-perplexity/src/clientV2.ts` → `client.ts`
- [ ] In new `client.ts`: rename `createPerplexityClientV2` → `createPerplexityClient`
- [ ] In new `client.ts`: rename `PerplexityClientV2` → `PerplexityClient`
- [ ] In `types.ts`: delete `PerplexityConfig` (V1), rename `PerplexityConfigV2` → `PerplexityConfig`
- [ ] Update `index.ts`: remove V2 exports, keep only `createPerplexityClient`, `PerplexityClient`, `PerplexityConfig`
- [ ] Run `npx tsc --noEmit -p packages/infra-perplexity/tsconfig.json`

## Definition of Done

- [ ] No V1 `client.ts` with hardcoded pricing exists
- [ ] No `clientV2.ts` file exists
- [ ] No `PerplexityConfigV2` type exists
- [ ] Package compiles standalone
- [ ] Clean exports: `createPerplexityClient`, `PerplexityClient`, `PerplexityConfig`

## Verification

```bash
npx tsc --noEmit -p packages/infra-perplexity/tsconfig.json
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 2-0-llm-orchestrator-migration.md.

