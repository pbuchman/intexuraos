# INT-1366 Evidence: OpenRouter Model Grouping Plan

**Date:** 2026-04-13
**Task:** Enable grouping LLM usage by OpenRouter models
**Outcome:** Planned — frontend-only change, no backend modifications needed

## Summary

- Added "OpenRouter Model" as a new group-by option for the LLM Usage page
- Plan: `docs/superpowers/plans/2026-04-13-openrouter-model-grouping.md`
- Scope: 3 files — 1 new utility, 1 new test file, 1 modified page component
- The backend aggregate query API already supports `groupBy: ['request.provider', 'request.model']` and `filters.providers: ['openrouter']` — no backend changes needed
- Friendly model names from a static mapping mirroring `packages/infra-openrouter/src/allowlist.ts`
