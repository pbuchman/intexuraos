# Research Agent — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [v3.6.0 documentation refresh](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 1     | Medium   |
| TODOs       | 1     | Low      |
| **Total**   | **4** | —        |

---

## Future Plans

- Define a proper port interface for `NotionServiceClient` in the domain layer to remove the `as never` cast in `runSynthesis` (currently tracked as a TODO in `runSynthesis.ts`)
- Extract `LlmCallPublisher` interface duplication — the same interface is redeclared in both `processResearch.ts` and `retryFromFailed.ts` instead of sharing a single definition
- Consider moving the Notion export use case (`exportResearchToNotionUseCase.ts`) from `infra/` to `domain/` or a dedicated `usecases/` location to align with the existing use-case organization pattern

---

## Code Smells

### Medium Priority

| File                                              | Issue                                                                                          | Impact                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/domain/research/usecases/processResearch.ts` | `LlmCallPublisher` interface duplicated in `retryFromFailed.ts` — same shape, two definitions  | Changing one requires updating both; drift risk             |
| `src/infra/notion/notionResearchExporter.ts`      | `LocalNotionError` / `LocalNotionErrorCode` types shadow the imported package types            | Fragile error mapping; package upgrade may diverge silently |

---

## Test Coverage Gaps

No significant gaps identified. The service maintains high test coverage across domain use cases, infra adapters (including the OpenRouterAdapter), and route handlers. The `v8-ignore` blocks in `processResearch.ts`, `runSynthesis.ts`, and `openRouterRoutes.ts` are properly justified with testing-blocker explanations and use valid exemption categories.

---

## TypeScript Issues

### Medium Priority

| File                                           | Issue                                                                                                   | Count |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| `src/domain/research/usecases/runSynthesis.ts` | `notionServiceClient` typed as `unknown` with `as never` cast to bypass domain layer import restriction | 1     |

**Context:** The `RunSynthesisDeps` interface declares `notionServiceClient?: unknown` and casts it with `notionServiceClient as never` when passing to `exportResearchToNotionUseCase`. This is an acknowledged architectural boundary workaround — the domain layer cannot import from `infra/`. The fix is to define a `NotionExporterPort` interface in `domain/research/ports/` and implement it in the infra layer.

---

## TODOs / FIXMEs

| File                                               | Comment                                               | Priority |
| -------------------------------------------------- | ----------------------------------------------------- | -------- |
| `src/domain/research/usecases/runSynthesis.ts:414` | `TODO: define port interface for NotionServiceClient` | Low      |

---

## SRP Violations

No violations. The largest files (`researchRoutes.ts`, `internalRoutes.ts`) are appropriately large because they contain multiple related route definitions with full schema declarations — this is an intentional Fastify pattern, not a SRP issue.

---

## Code Duplicates

| Pattern                      | Locations                                                                                            | Suggestion                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `LlmCallPublisher` interface | `src/domain/research/usecases/processResearch.ts`, `src/domain/research/usecases/retryFromFailed.ts` | Extract to `src/domain/research/ports/index.ts` |

---

## Deprecations

No deprecated items identified.

---

## Resolved Issues

| Date       | Issue                                                                                        | Resolution                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-04-22 | LLM pricing fetched from app-settings-service at startup; PricingClient in service container | Removed PricingClient; usage reported via HttpInternalAuthUsageSink (INT-1387)     |
| 2026-04-22 | Stale model references (gpt-5.2, claude-sonnet-4-5, claude-opus-4-5) in call sites           | Migrated all call sites to gpt-5.4, claude-sonnet-4-6, claude-opus-4-6             |
| 2026-04-07 | Cover image generation used only one provider; failure meant no cover image                  | Added provider failover with ordered pipeline selection (INT-1310)                 |
| 2026-03-29 | `GET /research` list endpoint returned full `Research` documents with large text fields      | Added `ResearchSummary` projection via `findSummariesByUserId`                     |
| 2026-03-26 | OpenRouter pricing display and audit correlation issues (INT-1106)                           | Fixed pricing display and audit log correlation                                    |
| 2026-03-24 | OpenRouter model validation only at selection, not at execution (INT-1011)                   | Added allowlist enforcement at research execution time                             |
| 2026-03-10 | Silent dispatch failures in LLM call publishing (INT-810, INT-811)                           | Fixed nested transaction handling and error propagation                            |
| 2026-03-15 | Notion export race condition: export read stale `shareInfo` without `coverImageUrl`          | Moved export to after Firestore save; documented in gotchas                        |
| 2026-03-12 | ZAI provider and GLM-4.7 models removed after provider change                                | Models cleaned up from LLM adapter registry                                        |
| 2026-02-26 | Thumbnail output contract mismatch with consumed parser fields (INT-605)                     | Aligned `llm-prompts` thumbnail prompt with imageServiceClient parser              |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
