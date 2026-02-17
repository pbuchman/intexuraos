# Image Service - Technical Debt

**Last Updated:** 2026-02-08
**Analysis Run:** [documentation-runs.md](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |
| **Total**           | **0** | —        |

---

## Future Plans

### Additional Image Providers

Planned support for:

1. **Midjourney** - Via API when available
2. **Stable Diffusion** - Self-hosted option
3. **Ideogram** - For text-in-image generation

### Enhanced Features

1. **Image editing** - Inpainting, outpainting, variations
2. **Style presets** - Pre-defined artistic styles
3. **Batch generation** - Generate multiple variations at once
4. **Image search** - Find similar images in user's collection

### Cost Management

1. **Per-user budgets** - Enforce spending limits
2. **Cost estimation** - Preview cost before generation
3. **Usage analytics** - Track generation patterns

---

## Code Smells

### None Detected

No active code smells found in current codebase.

---

## Test Coverage

### Current Status

Comprehensive test coverage achieved in v2.0.0:

- Image generators: OpenAI and Google adapters fully tested
- Prompt generation: GPT and Gemini adapters tested
- GCS storage: Upload, delete, signed URL generation tested
- Routes: Internal endpoints with auth validation tested

**Resolution:** INT-167 addressed uncovered branches.

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

---

## SRP Violations

### None Detected

All files are within reasonable size limits:

| File                      | Lines | Status |
| ------------------------- | ----- | ------ |
| `internalRoutes.ts`       | 297   | OK     |
| `GcsImageStorage.ts`      | 113   | OK     |
| `OpenAIImageGenerator.ts` | 112   | OK     |
| `GoogleImageGenerator.ts` | 113   | OK     |
| `GeminiPromptAdapter.ts`  | 75    | OK     |
| `GptPromptAdapter.ts`     | 75    | OK     |

---

## Code Duplicates

### None Detected

No significant code duplication patterns identified. The OpenAI and Google image generators share a common pattern via the `ImageGenerator` interface.

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### 2026-02-08: Standardized Response Contract Migration

**Issue:** Internal endpoints used ad-hoc response formats (`{ error: 'Unauthorized' }`) with manual `reply.status()` calls and `apiFail()` helper.

**Resolution:**

- Migrated all auth failures to `reply.fail('UNAUTHORIZED', message)`
- Rate limit errors now use `reply.fail('RATE_LIMITED', message)` instead of manual `apiFail()` + `reply.status(429)`
- Downstream errors use `reply.fail('DOWNSTREAM_ERROR', message)` instead of manual `reply.status(502)`
- Removed `apiFail` import from `@intexuraos/common-http`

### 2026-02-08: Sentry-Enabled Logger Migration

**Issue:** Direct `pino()` logger usage in `services.ts` bypassed Sentry error tracking.

**Resolution:**

- Replaced `pino({ name: 'user-service-client' })` with `createAppLogger({ name: 'user-service-client' })`
- Errors now automatically sent to Sentry

### 2026-02-08: Direct Import from internal-clients

**Issue:** Local re-export barrel file `infra/user/index.ts` added unnecessary indirection.

**Resolution:**

- Deleted `apps/image-service/src/infra/user/index.ts`
- All imports changed from `./infra/user/index.js` to `@intexuraos/internal-clients` directly
- `FakeUserServiceClient` updated with `getOAuthToken` method for new interface

### 2026-02-08: Env Var Registration and Coverage

**Issue:** `INTEXURAOS_IMAGE_PUBLIC_BASE_URL` was used but not in `REQUIRED_ENV`. `mapError` function lacked test coverage.

**Resolution:**

- Added `INTEXURAOS_IMAGE_PUBLIC_BASE_URL` to `REQUIRED_ENV` in `index.ts`
- Exported `mapError` from `GptPromptAdapter.ts` and added dedicated tests

### 2025-01-25: INT-269 Internal-Clients Migration

**Issue:** Direct HTTP calls to user-service for API key retrieval were duplicated across services.

**Resolution:**

- Migrated to `@intexuraos/internal-clients/user-service` package
- `UserServiceClient` now imported from shared package
- Removed local HTTP implementation
- Backwards compatible - `getApiKeys()` signature unchanged

### 2025-01-24: INT-266 UsageLogger Migration

**Issue:** LLM pricing tracking needed centralized implementation.

**Resolution:**

- Migrated LLM clients to use `UsageLogger` class
- Centralized cost tracking logic
- Consistent pricing across all services

### 2025-01-19: Test Coverage Improvements

**Issue:** Some branches in image generation flow had no coverage.

**Resolution:**

- Added tests for error paths in both OpenAI and Google generators
- Covered thumbnail generation edge cases
- Tested GCS upload failure scenarios

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Getting-started guide
- [Agent](agent.md) - Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
