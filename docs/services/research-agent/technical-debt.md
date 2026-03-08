# Research Agent - Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** v3.2.0 documentation refresh

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Low      |
| Code Duplicates     | 0     | -        |
| Deprecations        | 2     | Low      |
| **Total**           | **4** | Low      |

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

### Model Selection Improvements

1. **Learning from user preferences** - Track which models users typically select
2. **Cost-aware selection** - Suggest cheaper models for simple queries
3. **Provider fallback** - Automatically substitute unavailable models with equivalents

---

## Code Smells

### Low Priority

| File                           | Issue      | Impact                                           |
| ------------------------------ | ---------- | ------------------------------------------------ |
| `src/routes/researchRoutes.ts` | 1662 lines | Large file but logically cohesive                |
| `src/routes/internalRoutes.ts` | 1035 lines | Large file but contains related Pub/Sub handlers |

**Note:** Both route files grew with the addition of the `POST /research/:id/export-notion` endpoint and v8 ignore coverage annotations. The new `researchExportRoutes.ts` (160 lines) was correctly extracted as a separate route file for Notion export settings. No immediate refactoring needed.

---

## Test Coverage

### Current Status

Comprehensive test coverage across all layers with 100% branch coverage enforced (INT-427). Uncovered branches require inline v8 ignore exemptions with validated categories.

- Domain layer: Research models, use cases fully tested
- Infrastructure: LLM adapters, repositories, Notion exporter, markdown converter tested
- Routes: Internal, public, and export settings endpoints tested

### Coverage Areas

- **Models**: Research entity creation, enhancement, factories, NotionExportInfo
- **Use Cases**: Process research, synthesis, retry, enhance, unshare, extractModelPreferences, toggleResearchFavourite
- **Infrastructure**: All LLM adapters with nock mocks, ContextInferenceAdapter with repair scenarios, InputValidationAdapter with Zod schemas and structural checks, NotionResearchExporter, markdownToNotionBlocks, researchExportSettingsRepository, notionServiceClient
- **Routes**: PubSub endpoints, research CRUD, export-notion, export settings with auth validation

### Recent Test Additions

| File                             | Coverage | Notes                                                              |
| -------------------------------- | -------- | ------------------------------------------------------------------ |
| `InputValidationAdapter.test.ts` | 100%     | Structural validation with repair pattern (INT-609)                |

### Test Additions (Notion Export)

| File                                       | Coverage | Notes                                        |
| ------------------------------------------ | -------- | -------------------------------------------- |
| `notionResearchExporter.test.ts`           | 100%     | Full Notion page creation with batch append  |
| `markdownToNotionBlocks.test.ts`           | 100%     | All markdown elements and inline formatting  |
| `researchExportSettingsRepository.test.ts` | 100%     | Firestore CRUD for export settings           |
| `notionServiceClient.test.ts`              | 100%     | Token fetch and error handling               |
| `notionServiceClient.pagePreview.test.ts`  | 100%     | Page preview with error scenarios            |
| `exportResearchToNotionUseCase.test.ts`    | 100%     | Fire-and-forget use case with all skip paths |
| `researchExportRoutes.test.ts`             | 100%     | Settings GET/POST and validate endpoints     |
| `toggleResearchFavourite.test.ts`          | 100%     | Favourite toggle with error branches         |

### Test Additions (Model Preferences)

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

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in production code.

The `@ts-expect-error` usages in `researchExportSettingsRepository.test.ts` (4 instances) are test-only, used for injecting fake Firestore implementations.

The Zod schema migration (INT-86, INT-218) improved type safety by deriving types from schemas using `z.infer<>`.

---

## SRP Violations

### Low Priority

| File                           | Lines | Issue                                           | Suggestion                       |
| ------------------------------ | ----- | ----------------------------------------------- | -------------------------------- |
| `src/routes/researchRoutes.ts` | 1662  | Handles many endpoints but all research-related | Acceptable given domain cohesion |

**Analysis:** The file grew with the addition of `POST /research/:id/export-notion` and v8 ignore annotations. It follows single responsibility at the domain level (all research-related endpoints). The Notion export settings endpoints were correctly split into `researchExportRoutes.ts`.

---

## Code Duplicates

### None Detected

The Zod schema definitions in `@intexuraos/llm-prompts` are shared across research and synthesis contexts, avoiding duplication. Common schema elements (Domain, Mode, Safety) are reused via imports.

---

## Deprecations

### Low Priority

| File                                                      | Function               | Replacement              | Impact                               |
| --------------------------------------------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| `src/infra/firestore/researchExportSettingsRepository.ts` | `getResearchPageId()`  | `getResearchSettings()`  | Returns full settings with title/URL |
| `src/infra/firestore/researchExportSettingsRepository.ts` | `saveResearchPageId()` | `saveResearchSettings()` | Accepts title and URL parameters     |

**Note:** The deprecated functions are still used by the fire-and-forget export use case (`getResearchPageId`). Migration to `getResearchSettings` can be done in a follow-up.

---

## TODO/FIXME Comments

### Low Priority

| File                                           | Comment                                                  | Impact                                    |
| ---------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `src/domain/research/usecases/runSynthesis.ts` | `// TODO: define port interface for NotionServiceClient` | NotionServiceClient typed as `never` cast |

**Note:** The `notionServiceClient` dependency in `runSynthesis` uses a `never` cast because importing the infra-layer `NotionServiceClient` type into the domain layer violates import rules. A port interface should be defined in `domain/research/ports/`.

---

## Resolved Issues

### 2026-03-07 - Input Improvement Structural Checks (INT-609)

| Date       | Issue                                                         | Resolution                                                                                     |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2026-02-27 | Structurally invalid LLM repairs could pass validation        | Added structural checks (prefix, JSON, length, explanatory text) to `validateImprovedPrompt`   |
| 2026-03-07 | Multi-option detection and language drift heuristics removed  | Checks were too aggressive with false positives; removed in v3.2.0                             |

### 2026-02-27 - Thumbnail Output Contract (INT-605)

| Date       | Issue                                    | Resolution                                                    |
| ---------- | ---------------------------------------- | ------------------------------------------------------------- |
| 2026-02-27 | Thumbnail parser fields misaligned       | Aligned thumbnail output contract with consumed parser fields |

### 2026-02-22 - v3.1.0 Prompt Audit & Version Alignment

| Date       | Issue                                         | Resolution                                                                           |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-02-22 | Unsafe casts in ContextInferenceAdapter       | Simplified with safer fallback defaults during adversarial dual-agent prompt audit   |
| 2026-02-22 | Package version behind monorepo-wide releases | Aligned to v3.1.0 (v3.0.0 and v3.1.0 were version bumps only for research-agent)     |

### 2026-02-19 — Observability & Developer Experience

| Date       | Issue                                  | Resolution                                                       |
| ---------- | -------------------------------------- | ---------------------------------------------------------------- |
| 2026-02-19 | No distributed tracing across services | Added Dash0 OTLP via `packages/infra-otel` preload in Dockerfile |
| 2026-02-19 | PM2 log output unreadable (raw JSON)   | Added `createLogStream()` for colorized dev-mode formatting      |

### 2026-02-19 — Platform Fallbacks & Prompt Improvements

| Date       | Issue                                               | Resolution                                                                    |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| 2026-02-19 | Title generation timeout (glm-4.7-flash at 29s)     | Switched fast model to `gemini-2.0-flash`; platform Gemini key added          |
| 2026-02-19 | Users without API keys had no LLM fallback          | Added Gemini (primary) + Zai (secondary) platform-owned key fallbacks         |
| 2026-02-19 | `buildSynthesisContextRepairPrompt` overly complex  | Simplified to pass `originalPrompt` directly; matches updated llm-prompts API |
| 2026-02-19 | `INTEXURAOS_GUEST_ZAI_API_KEY` naming inconsistency | Consolidated to `INTEXURAOS_ZAI_APP_API_KEY`                                  |

### 2026-02-08 - Notion Export Integration

| Date       | Issue                         | Resolution                                          |
| ---------- | ----------------------------- | --------------------------------------------------- |
| 2026-02-08 | No Notion export capability   | Added automatic + manual export with page hierarchy |
| 2026-02-08 | No export settings management | Added Firestore-backed settings with validation     |
| 2026-02-08 | Cover image missing in Notion | Fixed export ordering (after DB save)               |

### 2026-02-08 - Auth0 Claims Namespace

| Date       | Issue                            | Resolution                                       |
| ---------- | -------------------------------- | ------------------------------------------------ |
| 2026-02-08 | Missing name/email in API tokens | Added namespace prefix lookup with bare fallback |

### 2026-02-08 - Response Contract Standardization

| Date       | Issue                               | Resolution                          |
| ---------- | ----------------------------------- | ----------------------------------- |
| 2026-02-08 | Raw reply.send() in internal routes | Migrated to reply.ok()/reply.fail() |

### 2026-02-08 - Coverage Enforcement (INT-427)

| Date       | Issue                     | Resolution                              |
| ---------- | ------------------------- | --------------------------------------- |
| 2026-02-08 | 95% threshold too lenient | Enforced 100% with v8 ignore exemptions |

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

No previously resolved issues tracked prior to initial release.

---

## v3.1.0 Architecture Quality

### Strengths

1. **Type-safe validation** - All LLM response validation uses Zod schemas (ResearchContext, SynthesisContext, InputQuality)
2. **Self-healing** - Parser + repair pattern handles malformed LLM responses gracefully
3. **Structural guardrails** — Input improvement validation catches malformed responses (unwanted prefixes, JSON markers, explanatory text) before they reach users
4. **Standardized clients** - `@intexuraos/internal-clients` provides consistent service-to-service communication
5. **One model per provider** - Clear constraint prevents duplicate costs
6. **Notion integration** - Clean separation between export use case, exporter, markdown converter, and service client
7. **100% branch coverage** - Strict enforcement with categorized v8 ignore exemptions
8. **Sentry integration** - All loggers use `createAppLogger()` for error forwarding
9. **Distributed tracing** - Dash0 OpenTelemetry preload provides transparent trace propagation across all services
10. **Prompt versioning** - All prompts follow semver; adversarial audit ensured quality (v3.1.0)

### Areas for Future Improvement

1. **Schema versioning** - No mechanism to handle schema changes over time
2. **Repair telemetry** - Repair attempts are logged but not aggregated for analysis
3. **Model keyword maintenance** - Keywords in `extractModelPreferences` need manual updates when models change
4. **NotionServiceClient port** - Domain layer uses `never` cast for infra type; needs proper port interface
5. **Notion re-export** - No way to re-export after initial export (requires manual deletion of `notionExportInfo`)

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting started guide
- [Documentation Run Log](../../documentation-runs.md)
