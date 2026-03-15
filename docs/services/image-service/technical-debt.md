# Image Service — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [documentation-runs.md](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| Code Smells         | 1     | Medium   |
| TODO/FIXME Comments | 0     | —        |
| Test Coverage Gaps  | 0     | —        |
| TypeScript Issues   | 0     | —        |
| SRP Violations      | 0     | —        |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | —        |
| **Total**           | **2** | —        |

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

### Medium Priority

| File                       | Issue                  | Impact                                                                                                                                                                                                     |
| -------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` + `services.ts` | Pricing model mismatch | `REQUIRED_MODELS` fetches pricing for `gemini-2.5-flash` and `gpt-4o-mini`, but prompt adapters use `gemini-2.5-pro` and `gpt-4.1`. Cost tracking may use incorrect per-token rates for prompt generation. |

### Low Priority

None detected.

---

## Test Coverage Gaps

### Current Status

Comprehensive test coverage achieved. All adapters, routes, and infrastructure layers are tested:

- Image generators: OpenAI and Google adapters fully tested including error paths
- Prompt generation: GPT and Gemini adapters tested including `mapError` function
- GCS storage: Upload, delete, and path building tested
- Routes: Internal endpoints with auth validation, error handling, and success paths tested
- Models: Validation functions and configuration objects tested
- Parser: INT-605 contract alignment verified with explicit tests confirming stale fields are excluded

No v8 ignore comments present in the codebase.

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

All files are within reasonable size limits. The largest file is `routes/internalRoutes.ts` which handles three related endpoints in a single route plugin — an appropriate grouping for internal image operations.

---

## Code Duplicates

### Low Priority

| Pattern                | Locations                                                            | Suggestion                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapError` function    | `GptPromptAdapter.ts` (exported), `GeminiPromptAdapter.ts` (private) | Extract to shared `mapError.ts` utility. Both implement identical switch logic over `INVALID_KEY`, `RATE_LIMITED`, `TIMEOUT`, `PARSE_ERROR` codes. |
| `mapLlmError` function | `OpenAIImageGenerator.ts`, `GoogleImageGenerator.ts`                 | Extract to shared utility. Both implement identical switch over `INVALID_KEY`, `RATE_LIMITED`, `TIMEOUT` codes.                                    |

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### 2026-03-12: v3.3.0 ZAI Provider Removal

**Issue:** ZAI provider and GLM-4.7 models were present in the LLM contract and referenced in services across the codebase.

**Resolution:**
- ZAI pricing fetch removed from `services.ts` (`REQUIRED_MODELS` reduced from 5 to 4 entries)
- Platform fallback is now exclusively Gemini via `INTEXURAOS_GEMINI_APP_API_KEY`
- No functional change to image generation flows — ZAI was never an image generation provider

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

### 2026-02-16: Dash0 OpenTelemetry Integration

**Issue:** No distributed tracing or OpenTelemetry metrics across services.

**Resolution:**
- New `packages/infra-otel` package with preload module loaded via `--import` in Dockerfile
- All 19 services instrumented transparently; no-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` unset

### 2026-02-15: Gemini Platform Fallback Added

**Issue:** Platform fallback only supported ZAI (GLM-4.7-flash), which took 29s for title generation and exceeded the 10s HTTP timeout.

**Resolution:**
- `platformGeminiApiKey` added to `createUserServiceClient()` in `internal-clients`
- `INTEXURAOS_GEMINI_APP_API_KEY` is the platform fallback (ZAI removed in v3.3.0)
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
