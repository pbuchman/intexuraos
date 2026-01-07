# 3-0: Final Verification and Dead Code Check

## Status: TODO

## Tier: 3 (Final)

## Context

After all migrations complete, verify:

1. No V1 client code remains anywhere
2. No references to V2 naming (should be just the standard names now)
3. Full CI passes
4. No dead imports or unused code

## Scope

**Verification targets:**

- All infra-\* packages
- All consumer services
- Full codebase grep for dead code

## Dead Code Search Patterns

```bash
# Should return 0 results after migration:
grep -r "createGptClientV2" packages/ apps/
grep -r "createGeminiClientV2" packages/ apps/
grep -r "createClaudeClientV2" packages/ apps/
grep -r "createPerplexityClientV2" packages/ apps/

# Should return 0 results (V1 config types removed):
grep -r "GptConfigV2" packages/ apps/
grep -r "GeminiConfigV2" packages/ apps/
grep -r "ClaudeConfigV2" packages/ apps/
grep -r "PerplexityConfigV2" packages/ apps/

# Should return 0 results (old client.ts files deleted):
ls packages/infra-gpt/src/client.ts 2>/dev/null && echo "V1 GPT client still exists!"
ls packages/infra-gemini/src/client.ts 2>/dev/null && echo "V1 Gemini client still exists!"
ls packages/infra-claude/src/client.ts 2>/dev/null && echo "V1 Claude client still exists!"
ls packages/infra-perplexity/src/client.ts 2>/dev/null && echo "V1 Perplexity client still exists!"

# V2 files should NOT exist (renamed to client.ts):
ls packages/infra-*/src/clientV2.ts 2>/dev/null && echo "clientV2.ts files should be renamed!"
```

## Steps

- [ ] Run all grep patterns above — all should return empty
- [ ] Run `npm run lint` — no unused imports/variables
- [ ] Run `npm run test` — all tests pass
- [ ] Run `npm run ci` — full CI green
- [ ] Manual review: spot check each infra-\* package exports

## Package Export Verification

Each infra-\* package should export:

- `createXxxClient` (not V2)
- `XxxClient` type (not V2)
- `XxxConfig` (not V2)
- `calculateTextCost`, `normalizeUsageV2` (calculator utils)

**No V2 suffix in any export.**

## Definition of Done

- [ ] All dead code searches return empty
- [ ] `npm run ci` passes
- [ ] No TypeScript errors
- [ ] No ESLint warnings about unused code
- [ ] All infra-\* packages have clean exports

## Verification

```bash
# Full CI
npm run ci

# Dead code check
grep -r "V2" packages/infra-*/src/index.ts && echo "Found V2 in exports!" || echo "Clean"

# Verify no clientV2.ts files
find packages/infra-* -name "clientV2.ts" | wc -l  # Should be 0
```

---

## NO Continuation

This is the final task. Upon completion:

1. Update CONTINUITY.md with final state
2. Move folder to `continuity/archive/028-llm-client-v2-migration/`
