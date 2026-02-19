# Data Insights Agent — Technical Debt

**Last Updated:** 2026-02-19
**Analysis Run:** Development branch documentation update

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| TODO/FIXME  | 0     | -        |
| Code Smells | 0     | -        |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| **Total**   | **0** | —        |

---

## Future Plans

Based on recent migrations and improvements:

1. **Visualization generation service** — `visualizationGenerationService` noted in earlier planning is not wired into services.ts; currently the visualization computation uses the existing `dataTransformService`. A dedicated generation service may be warranted when AI-assisted chart config generation (separate from the insight-level chart-definition endpoint) becomes a feature.

2. **Zod schema validation** — LLM response validation migrated to Zod schemas for improved type safety (INT-218)
   - `chartDefinitionService` now uses Zod for chart definition parsing
   - `dataAnalysisService` now uses Zod for insight parsing
   - `dataTransformService` now uses Zod for transformed data parsing

3. **GLM-4.7-Flash support** — Added Zai AI model option (2c3a98c); Gemini 2.5 Flash is now the default

---

## Code Smells

### High Priority

None detected.

### Medium Priority

None detected.

### Low Priority

None detected.

---

## Test Coverage Gaps

None detected — all code paths covered at 100% threshold with v8 ignore exemptions for false positives.

---

## TypeScript Issues

None detected — no `any` types, `@ts-ignore`, or unsafe casts.

---

## TODOs / FIXMEs

None detected in codebase scan.

---

## SRP Violations

None detected — all files under 300 lines, clear separation of concerns.

---

## Code Duplicates

None detected — unique implementations per service.

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                     | Resolution                                           |
| ---------- | ----------------------------------------- | ---------------------------------------------------- |
| 2026-02-17 | Visualization service as placeholder      | Full CRUD + async compute + auto-refresh implemented |
| 2026-02-15 | Default LLM model not specified           | Switched to Gemini 2.5 Flash with Gemini fallback    |
| 2026-02-08 | Response contract violations              | Migrated all routes to reply.ok() / reply.fail()     |
| 2026-02-08 | Raw pino() logger usage                   | Migrated to createAppLogger() for Sentry integration |
| 2026-02-08 | INT-408 Missing env var registration      | Added 4 required env vars to REQUIRED_ENV            |
| 2026-02-08 | INT-427 Coverage enforcement              | Strict 100% branch coverage with v8 ignore           |
| 2026-02-08 | INT-301 User service client consolidation | Removed local infra/user/ re-export wrapper          |
| 2025-01-25 | INT-218 LLM response validation           | Migrated 3 services to Zod schemas                   |
| 2025-01-25 | INT-269 Internal client consolidation     | Migrated to @intexuraos/internal-clients             |
| 2025-01-19 | INT-160 Empty chart definitions           | Fixed empty chart bug                                |
| 2025-01-17 | INT-137 Strict sentence count validation  | Relaxed validation                                   |
| 2025-01-15 | INT-79 Parse failures                     | Added LLM repair pattern                             |
| 2025-01-15 | INT-77 Empty insights as errors           | Return success with reason                           |
| 2025-01-15 | Clean Architecture violations             | Enforced domain->infra boundary                      |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
