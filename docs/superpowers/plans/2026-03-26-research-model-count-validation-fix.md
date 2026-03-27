# Plan: Fix Model Count Discrepancy in Research Request Validation

**Date:** 2026-03-26
**Linear Issue:** [INT-1107](https://linear.app/pbuchman/issue/INT-1107)
**Status:** Implemented
**Complexity:** SIMPLE

## Problem

The frontend allows selecting more than 6 models total when combining regular providers + OpenRouter, but the backend correctly rejects requests with `maxItems: 6` validation. The frontend displays only a generic "Validation failed" message without showing the detailed error from `error.details`.

Three independent limits don't coordinate:
1. Regular providers: No limit (can select all 4)
2. OpenRouter selector: Hardcoded max of 5
3. Backend: Enforces max of 6

## Solution

Frontend-only changes across two files. No backend changes required.

### Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** POST `/api/research` (backend validation already correct)

## Tasks

### Task 1: Add total model counter and dynamic limits to ModelSelector

**File:** `apps/web/src/components/ModelSelector.tsx`

1. Export a `MAX_TOTAL_MODELS = 6` constant for use across components
2. Calculate `regularProviderCount` from `selectedModels` map entries that are non-null
3. Calculate `openRouterCount` from `selectedOpenRouterModels` length
4. Derive `totalSelectedModels` and `openRouterMaxModels = MAX_TOTAL_MODELS - regularProviderCount`
5. Add a total model counter bar showing `X/6` with color change at max
6. Disable provider rows when at max capacity and not already selected, with "(max reached)" label
7. Pass dynamic `maxModels` prop to `OpenRouterModelSelector`
8. Update OpenRouter badge to show `X/N selected` where N is the dynamic max

**Verification:** Visual confirmation that counter updates in real-time, providers disable at max, OpenRouter respects dynamic limit.

### Task 2: Add pre-submit validation and error parsing to ResearchAgentPage

**File:** `apps/web/src/pages/ResearchAgentPage.tsx`

1. Import `MAX_TOTAL_MODELS` from components and `ApiError` from services
2. Add `useEffect` to auto-trim `selectedOpenRouterModels` when dynamic max decreases below current count (prevents stale "5/4 selected" state)
3. Add pre-submit validation: if `selectedModels.length > MAX_TOTAL_MODELS`, show clear error with excess count
4. Replace duck-typed error check with `err instanceof ApiError` for type-safe validation error extraction
5. Parse `err.details.errors[]` array to extract and display specific validation messages

**Verification:** Submit with >6 models shows specific count error. Backend validation errors display detail messages instead of generic "Validation failed".

### Task 3: Export constant from barrel

**File:** `apps/web/src/components/index.ts`

1. Add `MAX_TOTAL_MODELS` to the `ModelSelector` re-export line

**Verification:** `MAX_TOTAL_MODELS` importable from `@/components`.
