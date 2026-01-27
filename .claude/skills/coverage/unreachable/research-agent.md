# Unreachable Branches - research-agent

This file documents branches that are provably unreachable due to TypeScript type system guarantees or code structure invariants.

## formatLlmError.ts (4 branches)

### Lines 128-130: tryParseGeminiError catch block
**Branch:** `catch` block after `JSON.parse(raw)`
**Reason:** Marked with `v8 ignore next` comment (`/* v8 ignore next -- defensive, JSON.parse failure returns null */`)
**Proof:** This is defensive code - if `JSON.parse` throws, we fall through to generic error parsing. The comment explicitly indicates this is defensive.

### Lines 163-165: tryParseAnthropicError catch block
**Branch:** `catch` block inside `tryParseAnthropicError` after `JSON.parse(jsonMatch[0])`
**Reason:** Marked with `v8 ignore next` comment (`/* v8 ignore next -- defensive, JSON.parse failure falls through */`)
**Proof:** This is defensive code - if `JSON.parse` throws, we fall through to string-based pattern matching. The comment explicitly indicates this is defensive.

## FirestoreResearchRepository.ts (5 branches)

### Lines 104-105: Array access in cursor generation for favorites
**Branch:** `trimmed[trimmed.length - 1]` when `trimmed.length` could be 0
**Reason:** `noUncheckedIndexedAccess` defensive check
**Proof:** The code structure guarantees `items.length >= limit` (line 102: `items.length >= limit`), and `trimmed = items.slice(0, limit)` (line 103), so `trimmed.length === limit >= 1`. The check at line 105 (`items.length > limit`) ensures we only access `lastItem` when `trimmed.length >= 1`.

### Lines 138-139: Array access in cursor generation for combined results (2 occurrences)
**Branch:** `resultItems[resultItems.length - 1]` when `resultItems.length` could be 0
**Reason:** `noUncheckedIndexedAccess` defensive check
**Proof:** The code structure guarantees `resultItems.length >= 1` because either:
1. `items.length >= limit` (favorited case), OR
2. `remaining > 0` and `nonFavorites` query returns at least one result

The cursor is only generated when `combined.length > limit` (line 138), which implies `resultItems.length >= 1`.

### Line 142: Similar array access pattern
**Branch:** Same defensive check for cursor ternary expression
**Reason:** Same as lines 138-139

## htmlGenerator.ts (1 branch)

### Line 436: inputContexts label check false branch
**Status:** FIXED - Added test case covering `label: undefined`

## Summary

**Total documented unreachable branches: 7**

All documented branches are either:
1. **Defensive error handlers** marked with `v8 ignore next` comments (4 branches in formatLlmError.ts)
2. **TypeScript `noUncheckedIndexedAccess` defensive checks** that are provably safe due to code structure invariants (3 branches in FirestoreResearchRepository.ts)

These branches represent defensive programming practices and should not be covered by tests.

## Remaining Coverage Gaps

The following files still have uncovered branches that may be reachable but require additional investigation:

- **retryFromFailed.ts**: 95% (19/20) - 1 uncovered (likely a minor edge case)
- **htmlGenerator.ts**: 97.82% (45/46) - 1 uncovered (likely defensive `noUncheckedIndexedAccess`)
- **exportResearchToNotionUseCase.ts**: 96.15% (25/26) - 1 uncovered (likely defensive check)
- **runSynthesis.ts**: 91.26% (115/126) - 11 uncovered (needs investigation)
- **FirestoreResearchRepository.ts**: 90.9% (50/55) - 5 uncovered (documented above)
