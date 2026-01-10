# 1-5: Add Calculator to infra-claude

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Anthropic ma cache read + cache write multipliers.

## Scope

- packages/infra-claude/src/costCalculator.ts (NEW)
- packages/infra-claude/src/clientV2.ts (NEW)
- packages/infra-claude/src/types.ts (extend with ClaudeConfigV2)

## Provider-Specific

- cacheReadMultiplier
- cacheWriteMultiplier
- webSearchCostPerCall

## Steps

- [x] Create costCalculator.ts (Anthropic-specific: cache read/write)
- [x] Create ClaudeConfigV2 in types.ts
- [x] Create clientV2.ts
- [x] Export from index.ts
- [ ] Add tests (not added - relies on integration tests)

## Definition of Done

- [x] createClaudeClientV2 works with passed pricing
- [x] Cache costs calculated correctly
- [x] Original createClaudeClient unchanged
- [x] npm run ci passes

## Created Files

- packages/infra-claude/src/costCalculator.ts
- packages/infra-claude/src/clientV2.ts
- packages/infra-claude/src/types.ts (updated with ClaudeConfigV2)

## Verification

```bash
npm run test -w @intexuraos/infra-claude
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-6-infra-perplexity-calculator.md.
