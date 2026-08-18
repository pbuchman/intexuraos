# Image Service — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [documentation-runs.md](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| Code Smells         | 0     | --       |
| TODO/FIXME Comments | 0     | --       |
| Test Coverage Gaps  | 0     | --       |
| TypeScript Issues   | 0     | --       |
| SRP Violations      | 0     | --       |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | --       |
| **Total**           | **1** | --       |

---

## Future Plans

### Additional Image Providers

The port-based architecture (`ImageGenerator` interface) makes adding new providers straightforward. Potential additions:

1. **Stable Diffusion** — Self-hosted option for cost control
2. **Ideogram** — For text-in-image generation use cases

### Enhanced Features

1. **Image editing** — Inpainting, outpainting, and variation generation
2. **Style presets** — Pre-defined artistic styles for consistent branding
3. **Batch generation** — Generate multiple variations from a single prompt

### Cost Management

1. **Per-user budgets** — Enforce spending limits on image generation
2. **Cost estimation** — Preview cost before generating an image

---

## Code Smells

None detected.

---

## Test Coverage Gaps

### Current Status

Comprehensive test coverage achieved. All adapters, routes, use cases, and infrastructure layers are tested:

- Application use cases: `generateImage`, `generatePrompt`, `deleteImage` — all with dedicated test files
- Image generation: OpenRouter adapter fully tested, including error paths and stable alias mapping
- Prompt generation: OpenRouter adapter tested, including `mapError`
- GCS storage: Upload, delete, and path building tested
- Routes: Internal endpoints with auth validation, error handling, and success paths tested
- Models: Validation functions and configuration objects tested
- Parser: INT-605 contract alignment verified with explicit tests confirming stale fields are excluded
- Slugify: Edge cases including unicode, special characters, and max length tested
- Service factory: Env var fallback branches now covered by real tests (v8 ignore blocks removed in v3.5.0 via INT-1072)

v8 ignore comments present only in `internalRoutes.ts` (DeleteImageUseCase error type is `never` — `test-infra` category).

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in source files. Test files use `'any-token'` as a string literal value (not an `any` type).

---

## TODO/FIXME Comments

### None Detected

No TODO, FIXME, HACK, or XXX comments found in the source code.

---

## SRP Violations

### None Detected

All files are within reasonable size limits. The v3.4.0 refactoring improved the situation further — `internalRoutes.ts` is now a thin handler layer, with business logic moved to dedicated use-case files in the `application/` directory.

---

## Code Duplicates

### Low Priority

| Pattern                | Locations                                                            | Suggestion                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapError` function | `GptPromptAdapter.ts` | Compatibility filename for the OpenRouter prompt adapter; extract only if another active adapter needs the same mapping. |

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### 2026-04-22: v3.6.0 LLM Pricing Removal (INT-1387)

**Issue:** `REQUIRED_MODELS` in `index.ts` fetched pricing for `gemini-2.5-flash` and `gpt-4o-mini`, but prompt adapters actually used `gemini-2.5-pro` and `gpt-4.1`. Cost tracking used incorrect per-token rates for prompt generation.

**Resolution:**
- All LLM pricing removed from image-service — `REQUIRED_MODELS`, `pricingContext`, `ModelPricing` fields in adapter configs all deleted
- `initializeServices()` is now synchronous (no async pricing fetch)
- Pricing is handled centrally in `llm-usage-service` via `HttpInternalAuthUsageSink`
- The mismatch gotcha no longer applies

### 2026-04-14: v3.6.0 Explicit Model in Prompt Generation (INT-1369)

**Issue:** `GeminiPromptAdapter` defaulted to `Gemini25Pro` model when none was passed. `createPromptGenerator` did not accept a model parameter, making it impossible for the caller to control which model was used for pricing resolution.

**Resolution:**
- `createPromptGenerator` signature expanded with explicit `model: string` parameter
- `GeminiPromptAdapter` `model` field is now required (no default)
- Pricing resolved dynamically via `pricingContext.getPricing(model)` (later removed entirely in INT-1387)

### 2026-04-11: v3.6.0 HTTP-Based Usage Sinks (INT-1342)

**Issue:** LLM usage was tracked via direct Firestore writes using `UsageLogger`, which coupled services to Firestore schema and made it impossible to centralize usage data.

**Resolution:**
- All usage sinks migrated to `HttpInternalAuthUsageSink` — reports usage to `llm-usage-service` via HTTP
- Each adapter branded with a `component` identifier (e.g., `gemini-prompt-adapter`, `openai-image-generator`)
- `INTEXURAOS_LLM_USAGE_SERVICE_URL` added to `REQUIRED_ENV`

### 2026-03-25: v3.5.0 v8 Ignore Block Removal (INT-1072)

**Issue:** `serviceFactory.ts` had v8 ignore blocks for `process.env` fallback branches that could not be reached in tests.

**Resolution:**
- Real test added that deletes env vars before calling `initializeServices` to exercise fallback branches
- v8 ignore blocks removed from `serviceFactory.ts`
- Coverage now achieved through actual test execution rather than exemptions

### 2026-03-16: v3.4.0 Application Layer Extraction (INT-898, INT-899, INT-900)

**Issue:** Business logic was embedded in route handlers (`internalRoutes.ts`), making it harder to test in isolation and violating the layered architecture pattern used by other services. The `services.ts` file mixed container interface, state management, and factory initialization.

**Resolution:**
- New `application/` layer with `generatePrompt.ts`, `generateImage.ts`, `deleteImage.ts` use cases
- Route handlers now delegate to use cases — thin HTTP layer with no business logic
- `services.ts` split into `serviceContainer.ts` (DI interface) and `serviceFactory.ts` (initialization)
- `slugify.ts` extracted as standalone utility
- Dedicated test files for each use case added

### 2026-03-12: v3.3.0 ZAI Provider Removal

**Issue:** ZAI provider and GLM-4.7 models were present in the LLM contract and referenced in services across the codebase.

**Resolution:**
- ZAI pricing fetch removed from `services.ts` (`REQUIRED_MODELS` reduced from 5 to 4 entries)
- At that time, platform fallback moved from ZAI to Gemini; it was later retired in favor of OpenRouter
- No functional change to image generation flows — ZAI was never an image generation provider

### 2026-08-12: Direct Gemini Removal

**Issue:** A shared direct Gemini API key bypassed centralized OpenRouter visibility.

**Resolution:**
- Prompt and image generation were restricted to OpenAI
- Direct Gemini image models were removed from image-service
- The shared Gemini environment variable and Secret Manager container were retired

### 2026-02-27: INT-605 Thumbnail Output Contract Alignment

**Issue:** `ThumbnailPromptParameters` included `aspectRatio`, `textOnImage`, and `logosTrademarks` fields that were produced by the LLM but never consumed by the parser or downstream code.

**Resolution:**
- `ThumbnailPrompt.ts` trimmed to 3 fields: `framing`, `realism`, `people`
- `parseResponse.ts` only validates consumed fields
- `promptSchemas.ts` response schema updated to match
- Test fixtures cleaned of stale fields in `7fbf7668`

### 2026-02-16: Dev-Mode Log Formatting

**Issue:** Raw pino JSON output in PM2 logs was unreadable during local development.

**Resolution:**
- `server.ts` updated to use `createLogStream()` from `@intexuraos/infra-sentry`
- Colorized format: `service-name | HH:mm:ss | LEVEL | message | {extras}`
- Applied across all 18 service `server.ts` files via `6063175b`

### 2026-02-15: Gemini Platform Fallback Added

**Issue:** Platform fallback only supported ZAI (GLM-4.7-flash), which took 29s for title generation and exceeded the 10s HTTP timeout.

**Resolution:**
- `platformGeminiApiKey` added to `createUserServiceClient()` in `internal-clients`
- At that time, the platform fallback moved to Gemini; it was later retired in favor of OpenRouter
- Gemini 2.5 Flash is now the default platform model for faster responses

### 2026-02-15: API Key Naming Standardization

**Issue:** Platform API key env vars used inconsistent naming (`GUEST_ZAI`, `ZAI`, `OPENAI_API_KEY`).

**Resolution:**
- All platform keys now follow `INTEXURAOS_<PROVIDER>_APP_API_KEY` pattern (ZAI key removed in v3.3.0)

### 2026-02-09: Platform Key Fallback for User Service Client

**Issue:** Users without personal API keys could not generate images.

**Resolution:**
- `createUserServiceClient()` now accepts `platformGeminiApiKey` (ZAI key removed in v3.3.0)
- `getApiKeys()` returns platform-owned keys as fallback when user has none configured

### 2026-02-08: Standardized Response Contract Migration

**Issue:** Internal endpoints used ad-hoc response formats with manual `reply.status()` calls and `apiFail()` helper.

**Resolution:**
- All auth failures migrated to `reply.fail('UNAUTHORIZED', message)`
- Rate limit errors use `reply.fail('RATE_LIMITED', message)`
- Downstream errors use `reply.fail('DOWNSTREAM_ERROR', message)`
- Removed `apiFail` import from `@intexuraos/common-http`

### 2026-02-08: Sentry-Enabled Logger Migration

**Issue:** Direct `pino()` logger usage in `services.ts` bypassed Sentry error tracking.

**Resolution:**
- Replaced `pino({ name: 'user-service-client' })` with `createAppLogger({ name: 'user-service-client' })`

### 2026-02-08: Direct Import from internal-clients

**Issue:** Local re-export barrel file `infra/user/index.ts` added unnecessary indirection.

**Resolution:**
- Deleted `apps/image-service/src/infra/user/index.ts`
- All imports changed to `@intexuraos/internal-clients` directly

### 2026-02-08: Env Var Registration and Coverage

**Issue:** `INTEXURAOS_IMAGE_PUBLIC_BASE_URL` was used but not in `REQUIRED_ENV`. `mapError` lacked test coverage.

**Resolution:**
- Added `INTEXURAOS_IMAGE_PUBLIC_BASE_URL` to `REQUIRED_ENV` in `index.ts`
- Exported `mapError` from `GptPromptAdapter.ts` and added dedicated tests

### 2025-01-25: INT-269 Internal-Clients Migration

**Issue:** Direct HTTP calls to user-service duplicated across services.

**Resolution:**
- Migrated to `@intexuraos/internal-clients/user-service` package
- Removed local HTTP implementation

### 2025-01-24: INT-266 UsageLogger Migration

**Issue:** LLM pricing tracking needed centralized implementation.

**Resolution:**
- Migrated LLM clients to use `UsageLogger` class for consistent cost tracking

### 2025-01-19: Test Coverage Improvements

**Issue:** Some branches in image generation flow had no coverage.

**Resolution:**
- Added tests for error paths in both OpenAI and Google generators
- Covered thumbnail generation edge cases and GCS upload failure scenarios

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Tutorial](tutorial.md) — Getting-started guide
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
