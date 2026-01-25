# Research Agent - Technical Debt

**Last Updated:** 2026-01-25
**Analysis Run:** v2.1.0 documentation update

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Low      |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |
| **Total**           | **1** | Low      |

---

## Future Plans

### Streaming Responses

Currently, research results are returned in bulk when all LLMs complete. Future enhancement:

1. Implement WebSocket or Server-Sent Events for real-time streaming
2. Stream individual LLM results as they complete
3. Stream synthesis progress

### Additional Synthesis Options

1. **Custom synthesis prompts** - Allow users to customize synthesis behavior
2. **Multiple synthesis strategies** - Bullet points, detailed, comparison, etc.
3. **Synthesis only mode** - Re-synthesize existing results with different parameters

### Research Organization

1. **Collections/Folders** - Group related research
2. **Tags** - Add custom tags for organization
3. **Search** - Full-text search across researches

### Model Selection Improvements (v2.0.0 follow-up)

1. **Learning from user preferences** - Track which models users typically select
2. **Cost-aware selection** - Suggest cheaper models for simple queries
3. **Provider fallback** - Automatically substitute unavailable models with equivalents

---

## Code Smells

### Low Priority

| File                           | Issue      | Impact                                           |
| ------------------------------ | ---------- | ------------------------------------------------ |
| `src/routes/researchRoutes.ts` | 1344 lines | Large file but logically cohesive                |
| `src/routes/internalRoutes.ts` | 934 lines  | Large file but contains related Pub/Sub handlers |

**Note:** Both route files are large but contain logically related endpoints. The size is justified by the complexity of the research orchestration flow. No immediate refactoring needed.

---

## Test Coverage

### Current Status

Comprehensive test coverage across all layers with 95% threshold enforced:

- Domain layer: Research models, use cases fully tested
- Infrastructure: LLM adapters, repositories, publishers tested
- Routes: Internal and public endpoints tested

### Coverage Areas

- **Models**: Research entity creation, enhancement, factories
- **Use Cases**: Process research, synthesis, retry, enhance, unshare, extractModelPreferences (v2.0.0)
- **Infrastructure**: All LLM adapters with nock mocks, ContextInferenceAdapter with repair scenarios, InputValidationAdapter with Zod schemas (v2.1.0)
- **Routes**: PubSub endpoints with proper auth validation

### v2.0.0 Test Additions

| File                              | Coverage | Notes                                     |
| --------------------------------- | -------- | ----------------------------------------- |
| `extractModelPreferences.test.ts` | 100%     | All branches covered including edge cases |
| `ContextInferenceAdapter.test.ts` | 100%     | Repair pattern scenarios tested           |

### v2.1.0 Test Additions

| File                             | Coverage | Notes                                     |
| -------------------------------- | -------- | ----------------------------------------- |
| `InputValidationAdapter.test.ts` | 100%     | Zod schema validation with repair pattern |

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

The Zod schema migration (INT-86, INT-218) improved type safety by deriving types from schemas using `z.infer<>`.

---

## SRP Violations

### Low Priority

| File                           | Lines | Issue                                           | Suggestion                       |
| ------------------------------ | ----- | ----------------------------------------------- | -------------------------------- |
| `src/routes/researchRoutes.ts` | 1344  | Handles many endpoints but all research-related | Acceptable given domain cohesion |

**Analysis:** The file is large but follows single responsibility at the domain level (all research-related endpoints). Splitting would fragment related logic.

---

## Code Duplicates

### None Detected

The Zod schema definitions in `@intexuraos/llm-prompts` are shared across research and synthesis contexts, avoiding duplication. Common schema elements (Domain, Mode, Safety) are reused via imports.

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### 2026-01-25 - INT-218 Input Validation Zod Migration

| Date       | Issue                       | Resolution                           |
| ---------- | --------------------------- | ------------------------------------ |
| 2026-01-25 | Manual input quality guards | Migrated to InputQualitySchema (Zod) |
| 2026-01-25 | Fragile input validation    | Implemented parser + repair pattern  |

### 2026-01-25 - INT-269 Internal Clients Migration

| Date       | Issue                       | Resolution                               |
| ---------- | --------------------------- | ---------------------------------------- |
| 2026-01-25 | Duplicate user client code  | Migrated to @intexuraos/internal-clients |
| 2026-01-25 | Inconsistent error handling | Standardized UserServiceError codes      |
| 2026-01-25 | Docker build failures       | Flat exports enable esbuild bundling     |

### 2026-01-24 - INT-86 Zod Migration

| Date       | Issue                          | Resolution                             |
| ---------- | ------------------------------ | -------------------------------------- |
| 2026-01-24 | Manual type guards for context | Migrated to Zod schemas with z.infer<> |
| 2026-01-24 | Fragile LLM response parsing   | Implemented parser + repair pattern    |

### Historical Issues

No previously resolved issues tracked prior to v2.0.0.

---

## v2.1.0 Architecture Quality

### Strengths

1. **Type-safe validation** - All LLM response validation uses Zod schemas (ResearchContext, SynthesisContext, InputQuality)
2. **Self-healing** - Parser + repair pattern handles malformed LLM responses gracefully
3. **Standardized clients** - `@intexuraos/internal-clients` provides consistent service-to-service communication
4. **One model per provider** - Clear constraint prevents duplicate costs

### Areas for Future Improvement

1. **Schema versioning** - No mechanism to handle schema changes over time
2. **Repair telemetry** - Repair attempts are logged but not aggregated for analysis
3. **Model keyword maintenance** - Keywords in `extractModelPreferences` need manual updates when models change

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting started guide
- [Documentation Run Log](../../documentation-runs.md)
