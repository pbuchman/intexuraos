# 1-0: Clean Up infra-gemini Package

## Status: ✅ DONE

## Tier: 1 (Package-level)

## Context

Remove V1 client, rename V2 to be the only client. Simplify exports and types.

## Scope

**Files to DELETE:**
- packages/infra-gemini/src/client.ts

**Files to RENAME:**
- packages/infra-gemini/src/clientV2.ts → packages/infra-gemini/src/client.ts

**Files to MODIFY:**
- packages/infra-gemini/src/client.ts (renamed): change `createGeminiClientV2` → `createGeminiClient`, `GeminiClientV2` → `GeminiClient`
- packages/infra-gemini/src/types.ts: remove `GeminiConfig`, rename `GeminiConfigV2` → `GeminiConfig`
- packages/infra-gemini/src/index.ts: remove V2 exports, update to new names

## Non-Scope

- Consumer updates (handled in Tier 2)

## Current State

```typescript
// index.ts (BEFORE)
export { createGeminiClient, type GeminiClient } from './client.js';
export { createGeminiClientV2, type GeminiClientV2 } from './clientV2.js';
export type { GeminiConfig, GeminiConfigV2, ... } from './types.js';
```

## Target State

```typescript
// index.ts (AFTER)
export { createGeminiClient, type GeminiClient } from './client.js';
export type { GeminiConfig, ... } from './types.js';
// No V2 exports, no GeminiConfigV2 — V2 IS the new V1
```

## Steps

- [ ] Delete `packages/infra-gemini/src/client.ts` (V1)
- [ ] Rename `packages/infra-gemini/src/clientV2.ts` → `client.ts`
- [ ] In new `client.ts`: rename `createGeminiClientV2` → `createGeminiClient`
- [ ] In new `client.ts`: rename `GeminiClientV2` → `GeminiClient`
- [ ] In `types.ts`: delete `GeminiConfig` (V1), rename `GeminiConfigV2` → `GeminiConfig`
- [ ] Update `index.ts`: remove V2 exports, keep only `createGeminiClient`, `GeminiClient`, `GeminiConfig`
- [ ] Run `npm run ci -w @intexuraos/infra-gemini` (expect failures from consumers — that's OK)

## Definition of Done

- [ ] No `client.ts` with hardcoded pricing exists
- [ ] No `clientV2.ts` file exists (it became `client.ts`)
- [ ] No `GeminiConfigV2` type exists (it became `GeminiConfig`)
- [ ] Package compiles standalone
- [ ] Exports are clean: `createGeminiClient`, `GeminiClient`, `GeminiConfig`

## Verification

```bash
npx tsc --noEmit -p packages/infra-gemini/tsconfig.json
```

Note: Full CI will fail until consumers are updated in Tier 2.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-1-infra-gpt-cleanup.md.

