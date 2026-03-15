# Refactoring Tasks — image-service

I now have a complete picture of the codebase. Let me produce the detailed task instructions.

---

## TASK: IS-COV-1

### Context
The `slugify` function (lines 18-28 of `internalRoutes.ts`) has only one test case (`'My Cool Image Title!!!'` -> `'my-cool-image-title'`). Several edge cases are uncovered: unicode/diacritics, empty string, maxLength boundary, consecutive dashes at the end after slicing. In `services.ts`, the env var fallback defaults on lines 62-63 (`INTEXURAOS_IMAGE_BUCKET` defaults to `''`, `INTEXURAOS_IMAGE_PUBLIC_BASE_URL` defaults to `undefined`) and the provider fallthrough in `createPromptGenerator` (lines 87-97: non-Google falls through to GPT) and `createImageGenerator` (lines 104-125: non-OpenAI falls through to Google) are not explicitly tested.

### Pre-conditions
- [ ] Read `apps/image-service/src/routes/internalRoutes.ts` lines 18-28 (slugify function)
- [ ] Read `apps/image-service/src/services.ts` lines 62-63 (env var defaults) and lines 87-97, 104-125 (provider fallthrough)
- [ ] Read `apps/image-service/src/__tests__/internalRoutes.test.ts` (existing route tests)
- [ ] Read `apps/image-service/src/__tests__/services.test.ts` (existing services tests)

### Steps

**Part A: Slugify edge-case tests**

1. Open `apps/image-service/src/__tests__/internalRoutes.test.ts`. The `slugify` function is private (not exported), so it must be tested through the route handler. All slugify tests go in the existing `describe('POST /internal/images/generate', ...)` block (starts at line 240), because that is the endpoint that calls `slugify(title)`.

2. Add the following test cases AFTER the existing test `'generates image with slug when title is provided'` (line 457), still inside the `describe('POST /internal/images/generate', ...)` block. Each test sends a valid generate-image request with a specific `title` value and asserts the slug saved in `fakeRepo`:

   **Test 1: Unicode/diacritics are stripped**
   ```typescript
   it('slugifies title with unicode diacritics correctly', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: 'Cafe Resume Noel',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage?.slug).toBe('cafe-resume-noel');
   });
   ```
   Note: The accented chars `Cafe Resume Noel` should actually include accents: `Café Résumé Noël`. Use the literal accented characters in the test string.

   **Test 2: Empty title produces undefined slug (not passed to saved image)**
   ```typescript
   it('does not set slug when title is empty string', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: '',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage?.slug).toBeUndefined();
   });
   ```
   IMPORTANT: Look at `internalRoutes.ts` line 142: `const slug = title !== undefined ? slugify(title) : undefined;`. An empty string `''` is NOT `undefined`, so `slugify('')` will be called, returning `''`. Then line 199: `...(slug !== undefined && { slug })` -- an empty string is not undefined, so `slug: ''` WILL be set. If this is the actual behavior, adjust the assertion to `expect(savedImage?.slug).toBe('')`. Verify by tracing the logic before finalizing.

   **Test 3: maxLength boundary -- title longer than 50 chars is truncated**
   ```typescript
   it('truncates slug to 50 characters for long titles', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: 'This Is A Very Long Title That Should Be Truncated After Fifty Characters Exactly',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage).toBeDefined();
     expect(savedImage!.slug!.length).toBeLessThanOrEqual(50);
   });
   ```
   To determine the exact expected slug: run `slugify('This Is A Very Long Title That Should Be Truncated After Fifty Characters Exactly')` manually:
   - lowercase: `'this is a very long title that should be truncated after fifty characters exactly'`
   - normalize NFD + strip diacritics: no change
   - strip non-alnum: no change
   - spaces to dashes: `'this-is-a-very-long-title-that-should-be-truncated-after-fifty-characters-exactly'`
   - consecutive dashes: no change
   - slice(0,50): `'this-is-a-very-long-title-that-should-be-truncated'` (exactly 50 chars)
   - strip trailing dash: no trailing dash
   - Result: `'this-is-a-very-long-title-that-should-be-truncated'`
   Add assertion: `expect(savedImage!.slug).toBe('this-is-a-very-long-title-that-should-be-truncated');`

   **Test 4: Title exactly at maxLength boundary (50 chars) is not truncated**
   ```typescript
   it('does not truncate slug at exactly 50 characters', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     // This title slugifies to exactly 50 characters
     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: 'short title here for testing exact boundary check',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage).toBeDefined();
   });
   ```
   NOTE: Compute the actual slugified value of the title you choose. Make sure the slugified result is exactly 50 chars. Adjust the title input string accordingly.

   **Test 5: Multiple consecutive dashes are collapsed**
   ```typescript
   it('collapses multiple dashes in slug', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: 'Hello---World   &&&   Test',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage?.slug).toBe('hello-world-test');
   });
   ```
   Trace: `'Hello---World   &&&   Test'` -> lowercase `'hello---world   &&&   test'` -> NFD: no change -> strip non-alnum/space/dash: `'hello---world      test'` -> spaces to dash: `'hello----world------test'` -> collapse dashes: `'hello-world-test'` -> slice(0,50): same -> strip trailing dash: same. Result: `'hello-world-test'`.

   **Test 6: Trailing dash after slice is stripped**
   ```typescript
   it('strips trailing dash from slug after truncation', async () => {
     fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

     // Construct a title where slicing at 50 chars would leave a trailing dash
     // e.g. 'aaaa...a bbbbb' where the dash from space falls at position 50
     const response = await app.inject({
       method: 'POST',
       url: '/internal/images/generate',
       headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
       payload: {
         prompt: 'A beautiful sunset over mountains',
         model: LlmModels.GPTImage1,
         userId: TEST_USER_ID,
         title: 'a'.repeat(49) + ' bbbbb',
       },
     });

     expect(response.statusCode).toBe(200);
     const savedImage = fakeRepo.getImage('test-generated-id');
     expect(savedImage).toBeDefined();
     // 49 'a's + space becomes dash at position 49 (0-indexed), slice(0,50) = 49 a's + '-', then trailing dash stripped
     expect(savedImage!.slug).toBe('a'.repeat(49));
   });
   ```
   Trace: `'aaa...a bbbbb'` (49 a's + space + bbbbb) -> lowercase: same -> NFD: same -> strip non-alnum: same (space and letters preserved) -> spaces to dash: `'aaa...a-bbbbb'` -> collapse: same -> slice(0,50): `'aaa...a-'` (49 a's + dash = 50 chars) -> strip trailing dash: `'aaa...a'` (49 a's). Result: 49 `a`s.

**Part B: Env var defaults and provider fallthrough tests in services.test.ts**

3. Open `apps/image-service/src/__tests__/services.test.ts`. Add the following test cases.

   **Test 7: Inside `describe('initializeServices', ...)` block, add test for missing `INTEXURAOS_IMAGE_BUCKET`:**
   ```typescript
   it('uses empty string as default when INTEXURAOS_IMAGE_BUCKET is not set', () => {
     delete process.env['INTEXURAOS_IMAGE_BUCKET'];
     
     initializeServices(fakePricingContext);
     
     const services = getServices();
     expect(services.imageStorage).toBeDefined();
   });
   ```

   **Test 8: Inside `describe('initializeServices', ...)` block, add test for missing `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`:**
   ```typescript
   it('uses undefined as default when INTEXURAOS_IMAGE_PUBLIC_BASE_URL is not set', () => {
     delete process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
     
     initializeServices(fakePricingContext);
     
     const services = getServices();
     expect(services.imageStorage).toBeDefined();
   });
   ```

   **Test 9: Inside `describe('initializeServices', ...)` block, add test for missing `INTEXURAOS_USER_SERVICE_URL`:**
   ```typescript
   it('uses default localhost URL when INTEXURAOS_USER_SERVICE_URL is not set', () => {
     delete process.env['INTEXURAOS_USER_SERVICE_URL'];
     
     initializeServices(fakePricingContext);
     
     const services = getServices();
     expect(services.userServiceClient).toBeDefined();
   });
   ```

   **Test 10: Provider fallthrough -- `createPromptGenerator` with a non-Google provider defaults to GPT adapter:**
   The existing test at line 92-100 already covers `'openai'` provider. The fallthrough is that ANY non-`'google'` value returns the GPT adapter. However, the TypeScript type is `Google | OpenAI` (i.e., `'google' | 'openai'`), so there are only two valid values, and both are already tested. This is a type-level exhaustive match, not truly a fallthrough with unknown values. **Skip this test** -- the type system guarantees only `'google'` or `'openai'` can be passed, and both are already tested.

   **Test 11: Provider fallthrough -- `createImageGenerator` with a non-OpenAI model defaults to Google generator:**
   Same situation. The type `ImageGenerationModel` is `GPTImage1 | Gemini25FlashImage`, and both are already tested at lines 102-130. **Skip this test** -- both branches are already covered.

### Files to Create
- None

### Files to Modify
- `apps/image-service/src/__tests__/internalRoutes.test.ts` -- Add 6 new test cases inside the existing `describe('POST /internal/images/generate', ...)` block after line 477
- `apps/image-service/src/__tests__/services.test.ts` -- Add 3 new test cases inside the existing `describe('initializeServices', ...)` block after line 139

### Test Requirements
- [ ] Test: `slugifies title with unicode diacritics correctly` -- verifies NFD normalization strips diacritics (`Cafe Resume Noel` with accents -> `cafe-resume-noel`)
- [ ] Test: `does not set slug when title is empty string` -- verifies empty title behavior (trace actual slugify('') output: empty string, which IS set because `'' !== undefined`)
- [ ] Test: `truncates slug to 50 characters for long titles` -- verifies maxLength=50 truncation
- [ ] Test: `does not truncate slug at exactly 50 characters` -- verifies boundary at exactly 50
- [ ] Test: `collapses multiple dashes in slug` -- verifies `/-+/g` replacement works with special chars
- [ ] Test: `strips trailing dash from slug after truncation` -- verifies `.replace(/-$/, '')` after slice
- [ ] Test: `uses empty string as default when INTEXURAOS_IMAGE_BUCKET is not set` -- verifies env var default
- [ ] Test: `uses undefined as default when INTEXURAOS_IMAGE_PUBLIC_BASE_URL is not set` -- verifies env var default
- [ ] Test: `uses default localhost URL when INTEXURAOS_USER_SERVICE_URL is not set` -- verifies env var default

### Acceptance Criteria
- [ ] All 9 new tests pass
- [ ] All existing tests pass unchanged
- [ ] `pnpm run verify:workspace:tracked -- image-service` passes
- [ ] No v8 ignore comments added -- all new code is testable

---

## TASK: IS-1

### Context
The three route handlers in `internalRoutes.ts` contain business logic (API key resolution, image generation orchestration, cleanup-on-failure, slugification) that should be extracted into application-layer use-cases. This task creates the use-case interfaces, types, and implementations. The existing domain ports (`PromptGenerator`, `ImageGenerator`, `GeneratedImageRepository`, `ImageStorage`) are the dependencies these use-cases will consume.

### Pre-conditions
- [ ] IS-COV-1 is complete and all tests pass
- [ ] Read `apps/image-service/src/routes/internalRoutes.ts` -- all three handlers
- [ ] Read all domain port interfaces in `apps/image-service/src/domain/ports/`
- [ ] Read `apps/image-service/src/domain/models/` -- all model types
- [ ] Read `apps/image-service/src/services.ts` -- `ServiceContainer` interface and factory functions
- [ ] Read `apps/image-service/src/__tests__/fakes.ts` -- existing fakes for ports

### Steps

1. **Create `apps/image-service/src/application/generatePrompt.ts`**

   Define the following types and factory function:

   ```typescript
   import type { Result, Logger } from '@intexuraos/common-core';
   import type { Google, OpenAI } from '@intexuraos/llm-contract';
   import type { ThumbnailPrompt } from '../domain/index.js';
   import type { PromptGenerator, PromptGenerationError } from '../domain/index.js';
   import type { ImagePromptModelConfig } from '../domain/index.js';
   import type { UserServiceClient } from '@intexuraos/internal-clients';

   export interface GeneratePromptInput {
     text: string;
     model: string;           // raw model string from request
     userId: string;
   }

   export type GeneratePromptError =
     | { code: 'API_KEYS_UNAVAILABLE'; message: string }
     | { code: 'MISSING_API_KEY'; message: string; provider: string }
     | { code: 'RATE_LIMITED'; message: string }
     | { code: 'GENERATION_FAILED'; message: string };

   export type GeneratePromptUseCase = (
     input: GeneratePromptInput
   ) => Promise<Result<ThumbnailPrompt, GeneratePromptError>>;

   export interface GeneratePromptDeps {
     userServiceClient: UserServiceClient;
     createPromptGenerator: (
       provider: Google | OpenAI,
       apiKey: string,
       userId: string,
       logger: Logger
     ) => PromptGenerator;
     logger: Logger;
   }

   export function createGeneratePromptUseCase(
     deps: GeneratePromptDeps,
     modelConfig: ImagePromptModelConfig
   ): GeneratePromptUseCase {
     // ... implementation extracted from internalRoutes.ts lines 57-112
   }
   ```

   The implementation must:
   - Call `deps.userServiceClient.getApiKeys(input.userId)`
   - On failure, return `err({ code: 'API_KEYS_UNAVAILABLE', message: '...' })`
   - Check `keysResult.value[modelConfig.provider]` for undefined
   - On missing key, return `err({ code: 'MISSING_API_KEY', message: '...', provider: modelConfig.provider })`
   - Create generator via `deps.createPromptGenerator(modelConfig.provider, apiKey, input.userId, deps.logger)`
   - Call `generator.generateThumbnailPrompt(input.text)`
   - Map `RATE_LIMITED` error to `{ code: 'RATE_LIMITED' }`, all others to `{ code: 'GENERATION_FAILED' }`
   - On success, return `ok(result.value)`
   - Include `deps.logger.info(...)` calls matching the current log lines in the route handler

2. **Create `apps/image-service/src/application/generateImage.ts`**

   ```typescript
   import type { Result, Logger } from '@intexuraos/common-core';
   import type { ImageGenerationModel, GeneratedImageRepository, ImageGenerator, ImageStorage, GeneratedImageData } from '../domain/index.js';
   import type { UserServiceClient } from '@intexuraos/internal-clients';

   export interface GenerateImageInput {
     prompt: string;
     model: ImageGenerationModel;
     userId: string;
     title?: string | undefined;
   }

   export interface GenerateImageOutput {
     id: string;
     thumbnailUrl: string;
     fullSizeUrl: string;
   }

   export type GenerateImageError =
     | { code: 'API_KEYS_UNAVAILABLE'; message: string }
     | { code: 'MISSING_API_KEY'; message: string; provider: string }
     | { code: 'GENERATION_FAILED'; message: string }
     | { code: 'SAVE_FAILED'; message: string };

   export type GenerateImageUseCase = (
     input: GenerateImageInput
   ) => Promise<Result<GenerateImageOutput, GenerateImageError>>;

   export interface GenerateImageDeps {
     userServiceClient: UserServiceClient;
     createImageGenerator: (
       model: ImageGenerationModel,
       apiKey: string,
       userId: string,
       logger: Logger
     ) => ImageGenerator;
     generatedImageRepository: GeneratedImageRepository;
     imageStorage: ImageStorage;
     logger: Logger;
   }
   ```

   The `createGenerateImageUseCase(deps, modelConfig)` factory must:
   - Accept `ImageGenerationModelConfig` as second arg (from `IMAGE_GENERATION_MODELS[model]`)
   - Call `slugify(title)` internally -- move the `slugify` function into this file (or a shared `apps/image-service/src/application/slugify.ts` utility). **Export `slugify` so it can be unit-tested directly** in IS-COV-1-style tests.
   - Follow the exact logic from `internalRoutes.ts` lines 141-228:
     1. Resolve API keys
     2. Check provider key exists
     3. Generate image
     4. Save to repository (with userId and optional slug)
     5. On save failure: attempt storage cleanup, return `err({ code: 'SAVE_FAILED' })`
     6. On success: return `ok({ id, thumbnailUrl, fullSizeUrl })`

3. **Create `apps/image-service/src/application/deleteImage.ts`**

   ```typescript
   import type { Result, Logger } from '@intexuraos/common-core';
   import type { GeneratedImageRepository, ImageStorage } from '../domain/index.js';

   export interface DeleteImageInput {
     id: string;
   }

   export interface DeleteImageOutput {
     deleted: boolean;
   }

   export type DeleteImageUseCase = (
     input: DeleteImageInput
   ) => Promise<Result<DeleteImageOutput, never>>;

   export interface DeleteImageDeps {
     generatedImageRepository: GeneratedImageRepository;
     imageStorage: ImageStorage;
     logger: Logger;
   }
   ```

   The `createDeleteImageUseCase(deps)` factory must:
   - Look up image by id to get slug (for storage deletion)
   - Delete from storage (log error but continue)
   - Delete from repository (log error but continue)
   - Always return `ok({ deleted: true })`
   - Match logic from `internalRoutes.ts` lines 260-283

4. **Create `apps/image-service/src/application/slugify.ts`**

   Move the `slugify` function from `internalRoutes.ts` line 18-28 to this file. Export it.

   ```typescript
   export function slugify(title: string, maxLength = 50): string {
     return title
       .toLowerCase()
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .replace(/[^a-z0-9\s-]/g, '')
       .replace(/\s+/g, '-')
       .replace(/-+/g, '-')
       .slice(0, maxLength)
       .replace(/-$/, '');
   }
   ```

5. **Create `apps/image-service/src/application/index.ts`** barrel export:

   ```typescript
   export { createGeneratePromptUseCase, type GeneratePromptUseCase, type GeneratePromptDeps, type GeneratePromptInput, type GeneratePromptError } from './generatePrompt.js';
   export { createGenerateImageUseCase, type GenerateImageUseCase, type GenerateImageDeps, type GenerateImageInput, type GenerateImageOutput, type GenerateImageError } from './generateImage.js';
   export { createDeleteImageUseCase, type DeleteImageUseCase, type DeleteImageDeps, type DeleteImageInput, type DeleteImageOutput } from './deleteImage.js';
   export { slugify } from './slugify.js';
   ```

6. **Create tests for each use-case.** Write tests BEFORE implementation (test-first per CLAUDE.md).

   **Create `apps/image-service/src/__tests__/application/generatePrompt.test.ts`:**
   - Test: success path returns `ThumbnailPrompt`
   - Test: returns `API_KEYS_UNAVAILABLE` when user-service fails
   - Test: returns `MISSING_API_KEY` when provider key is absent
   - Test: returns `RATE_LIMITED` when generator returns RATE_LIMITED
   - Test: returns `GENERATION_FAILED` for other generator errors

   **Create `apps/image-service/src/__tests__/application/generateImage.test.ts`:**
   - Test: success path returns id, thumbnailUrl, fullSizeUrl and saves to repo with userId
   - Test: saves slug when title provided
   - Test: returns `API_KEYS_UNAVAILABLE` when user-service fails
   - Test: returns `MISSING_API_KEY` when provider key is absent
   - Test: returns `GENERATION_FAILED` when image generator fails
   - Test: returns `SAVE_FAILED` and cleans up storage when DB save fails
   - Test: returns `SAVE_FAILED` and logs when both save and cleanup fail

   **Create `apps/image-service/src/__tests__/application/deleteImage.test.ts`:**
   - Test: deletes image from storage and repository
   - Test: returns success even when image not found in repository
   - Test: returns success even when storage delete fails
   - Test: returns success even when repository delete fails
   - Test: passes slug to storage.delete when image has slug

   **Create `apps/image-service/src/__tests__/application/slugify.test.ts`:**
   - Test: basic slugification (spaces to dashes, lowercase)
   - Test: strips unicode diacritics
   - Test: handles empty string
   - Test: truncates at maxLength (50 default)
   - Test: custom maxLength
   - Test: collapses multiple dashes
   - Test: strips trailing dash after truncation
   - Test: removes special characters

   All test files use the existing fakes from `apps/image-service/src/__tests__/fakes.ts` and the same `beforeEach`/`afterEach` pattern (no `setServices` needed -- use-cases receive deps directly).

### Files to Create
- `apps/image-service/src/application/slugify.ts` -- pure function, extracted from internalRoutes.ts
- `apps/image-service/src/application/generatePrompt.ts` -- GeneratePromptUseCase factory + types
- `apps/image-service/src/application/generateImage.ts` -- GenerateImageUseCase factory + types
- `apps/image-service/src/application/deleteImage.ts` -- DeleteImageUseCase factory + types
- `apps/image-service/src/application/index.ts` -- barrel exports
- `apps/image-service/src/__tests__/application/slugify.test.ts` -- unit tests for slugify
- `apps/image-service/src/__tests__/application/generatePrompt.test.ts` -- unit tests
- `apps/image-service/src/__tests__/application/generateImage.test.ts` -- unit tests
- `apps/image-service/src/__tests__/application/deleteImage.test.ts` -- unit tests

### Files to Modify
- None in this task (route handlers are NOT modified yet -- that is IS-2)

### Test Requirements
- [ ] Test: `slugify basic` -- verifies `'Hello World' -> 'hello-world'`
- [ ] Test: `slugify diacritics` -- verifies `'Cafe Resume Noel' (with accents) -> 'cafe-resume-noel'`
- [ ] Test: `slugify empty` -- verifies `'' -> ''`
- [ ] Test: `slugify truncation` -- verifies output <= 50 chars
- [ ] Test: `slugify custom maxLength` -- verifies `slugify('abcdef', 3) -> 'abc'`
- [ ] Test: `slugify collapse dashes` -- verifies `'a---b' -> 'a-b'`
- [ ] Test: `slugify trailing dash strip` -- verifies trailing dash after slice is removed
- [ ] Test: `slugify special chars` -- verifies `'hello@world#test' -> 'helloworld-test'` or similar
- [ ] Test: `generatePrompt success` -- end-to-end use-case returns ThumbnailPrompt
- [ ] Test: `generatePrompt api keys unavailable` -- user-service failure
- [ ] Test: `generatePrompt missing api key` -- no key for provider
- [ ] Test: `generatePrompt rate limited` -- RATE_LIMITED propagation
- [ ] Test: `generatePrompt generation failed` -- other error propagation
- [ ] Test: `generateImage success` -- returns image data and saves to repo
- [ ] Test: `generateImage with slug` -- title -> slug in saved image
- [ ] Test: `generateImage api keys unavailable` -- user-service failure
- [ ] Test: `generateImage missing api key` -- no key for provider
- [ ] Test: `generateImage generation failed` -- image generator failure
- [ ] Test: `generateImage save failed with cleanup` -- DB save fails, storage cleaned up
- [ ] Test: `generateImage save failed cleanup also fails` -- both fail, still returns error
- [ ] Test: `deleteImage success` -- deletes from storage and repo
- [ ] Test: `deleteImage not found` -- success even when image doesn't exist
- [ ] Test: `deleteImage storage fails` -- success despite storage error
- [ ] Test: `deleteImage repo fails` -- success despite repo error
- [ ] Test: `deleteImage with slug` -- passes slug to storage.delete

### Acceptance Criteria
- [ ] All use-case files compile with `pnpm run typecheck` (run from `apps/image-service`)
- [ ] All new tests pass
- [ ] All existing tests pass unchanged (routes still have their own logic -- unchanged at this point)
- [ ] `pnpm run verify:workspace:tracked -- image-service` passes
- [ ] Each use-case has a `Deps` interface following the codebase pattern (function factory with dependency injection, not class-based)
- [ ] `slugify` is now directly importable and testable

---

## TASK: IS-2

### Context
After IS-1 created the use-cases, this task wires the route handlers to delegate to use-cases instead of containing business logic inline. The route layer keeps: request parsing, auth validation, use-case invocation, error-code-to-HTTP-status mapping, and response formatting.

### Pre-conditions
- [ ] IS-1 is complete and all tests pass
- [ ] Read the use-case files created in IS-1 (`apps/image-service/src/application/*.ts`)
- [ ] Read `apps/image-service/src/routes/internalRoutes.ts` -- the current handlers
- [ ] Read `apps/image-service/src/services.ts` -- ServiceContainer interface

### Steps

1. **Update `apps/image-service/src/services.ts`** -- Add use-case factory functions or use-case instances to `ServiceContainer`. Two approaches are valid:

   **Option A (Recommended):** Add use-case instances to the container:
   ```typescript
   import type { GeneratePromptUseCase, GenerateImageUseCase, DeleteImageUseCase } from './application/index.js';
   ```
   Add to `ServiceContainer` interface:
   ```typescript
   // After existing fields:
   createGeneratePromptUseCase: (model: string, logger: Logger) => GeneratePromptUseCase;
   createGenerateImageUseCase: (model: ImageGenerationModel, logger: Logger) => GenerateImageUseCase;
   createDeleteImageUseCase: (logger: Logger) => DeleteImageUseCase;
   ```
   IMPORTANT: The use-cases need a `logger` at construction time (the request logger), so the container exposes factory functions that take `logger` as a parameter.

   Alternatively, the use-cases can be created inline in the route handler using services from the container directly. This is simpler and avoids changing ServiceContainer. Evaluate which approach is cleaner. The simpler approach:

   **Option B (Simpler):** Import use-case factories directly in the route file and construct them in the handler using services from `getServices()`. No ServiceContainer changes needed.

   **Use Option B** -- it's simpler and avoids changing the ServiceContainer (which would require updating all test files that create ServiceContainer fakes). The route handler will do:
   ```typescript
   const services = getServices();
   const useCase = createGeneratePromptUseCase(
     { userServiceClient: services.userServiceClient, createPromptGenerator: services.createPromptGenerator, logger: request.log },
     modelConfig
   );
   const result = await useCase({ text, model, userId });
   ```

2. **Rewrite `apps/image-service/src/routes/internalRoutes.ts`:**

   - Remove the `slugify` function (lines 18-28) -- it's now in `application/slugify.ts`
   - Add import: `import { createGeneratePromptUseCase, createGenerateImageUseCase, createDeleteImageUseCase } from '../application/index.js';`
   - Keep import of `IMAGE_PROMPT_MODELS, IMAGE_GENERATION_MODELS` and their types

   **POST /internal/images/prompts/generate handler (lines 46-113):**
   Replace lines 57-112 with:
   ```typescript
   const { text, model, userId } = request.body;
   request.log.info({ model, userId, textLength: text.length }, 'Processing prompt generation request');

   const modelConfig = IMAGE_PROMPT_MODELS[model as ImagePromptModel];
   const { userServiceClient, createPromptGenerator } = getServices();

   const useCase = createGeneratePromptUseCase(
     { userServiceClient, createPromptGenerator, logger: request.log },
     modelConfig
   );
   const result = await useCase({ text, model, userId });

   if (!result.ok) {
     if (result.error.code === 'API_KEYS_UNAVAILABLE') {
       reply.status(502);
       return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
     }
     if (result.error.code === 'MISSING_API_KEY') {
       reply.status(400);
       return await reply.fail('INVALID_REQUEST', result.error.message);
     }
     if (result.error.code === 'RATE_LIMITED') {
       return await reply.fail('RATE_LIMITED', result.error.message);
     }
     return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
   }

   return await reply.ok(result.value);
   ```

   **POST /internal/images/generate handler (lines 130-229):**
   Replace lines 141-228 with:
   ```typescript
   const { prompt, model, userId, title } = request.body;
   request.log.info({ model, userId, promptLength: prompt.length }, 'Processing image generation request');

   const { userServiceClient, createImageGenerator, generatedImageRepository, imageStorage } = getServices();
   const modelConfig = IMAGE_GENERATION_MODELS[model as ImageGenerationModel];

   const useCase = createGenerateImageUseCase(
     { userServiceClient, createImageGenerator, generatedImageRepository, imageStorage, logger: request.log },
     modelConfig
   );
   const result = await useCase({ prompt, model: model as ImageGenerationModel, userId, title });

   if (!result.ok) {
     if (result.error.code === 'API_KEYS_UNAVAILABLE') {
       reply.status(502);
       return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
     }
     if (result.error.code === 'MISSING_API_KEY') {
       reply.status(400);
       return await reply.fail('INVALID_REQUEST', result.error.message);
     }
     if (result.error.code === 'SAVE_FAILED') {
       reply.status(500);
       return await reply.fail('INTERNAL_ERROR', result.error.message);
     }
     reply.status(502);
     return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
   }

   return await reply.ok(result.value);
   ```

   **DELETE /internal/images/:id handler (lines 247-284):**
   Replace lines 260-283 with:
   ```typescript
   const { generatedImageRepository, imageStorage } = getServices();

   const useCase = createDeleteImageUseCase({ generatedImageRepository, imageStorage, logger: request.log });
   const result = await useCase({ id });

   return await reply.ok(result.value);
   ```

3. **Verify all existing route-level tests still pass unchanged.** The route tests in `internalRoutes.test.ts` test through `app.inject()` and should produce identical HTTP responses since the use-cases implement the same logic.

### Files to Create
- None

### Files to Modify
- `apps/image-service/src/routes/internalRoutes.ts` -- Replace inline business logic with use-case delegation. Remove `slugify` function. Add application imports. Keep auth validation, logging, error-to-HTTP mapping in route layer.

### Test Requirements
- [ ] All existing route tests in `internalRoutes.test.ts` pass unchanged (same HTTP status codes, same response bodies)
- [ ] All existing service tests pass unchanged
- [ ] All use-case tests from IS-1 pass unchanged

### Acceptance Criteria
- [ ] `internalRoutes.ts` no longer contains business logic (no direct calls to `userServiceClient.getApiKeys`, `generator.generateThumbnailPrompt`, `generatedImageRepository.save`, etc.)
- [ ] `internalRoutes.ts` no longer contains the `slugify` function
- [ ] Route handlers are purely: parse request -> validate auth -> call use-case -> map result to HTTP response
- [ ] All existing tests pass unchanged -- zero test modifications
- [ ] `pnpm run verify:workspace:tracked -- image-service` passes
- [ ] The `internalRoutes.ts` file is significantly shorter (target: ~120-150 lines, down from 288)

---

## TASK: IS-3

### Context
`services.ts` (130 lines) combines two concerns: (1) the container type + get/set/reset functions (DI container), and (2) the `initializeServices()` factory function that constructs real implementations. Splitting these improves testability and separates configuration from runtime access.

### Pre-conditions
- [ ] IS-2 is complete and all tests pass
- [ ] Read `apps/image-service/src/services.ts` -- current combined file
- [ ] Read `apps/image-service/src/index.ts` -- where `initializeServices` is called
- [ ] Read `apps/image-service/src/__tests__/services.test.ts` -- existing tests
- [ ] Read `apps/image-service/src/__tests__/internalRoutes.test.ts` -- how tests use `setServices`/`resetServices`
- [ ] Search for ALL imports of `services.ts` across the codebase: `grep -r "from.*services" apps/image-service/src/`

### Steps

1. **Create `apps/image-service/src/serviceContainer.ts`** -- Contains the container type and accessor functions:

   ```typescript
   import type { IPricingContext } from '@intexuraos/llm-pricing';
   import type { Google, OpenAI } from '@intexuraos/llm-contract';
   import type { Logger } from '@intexuraos/common-core';
   import type {
     GeneratedImageRepository,
     PromptGenerator,
     ImageGenerator,
     ImageGenerationModel,
     ImageStorage,
   } from './domain/index.js';
   import type { UserServiceClient } from '@intexuraos/internal-clients';

   export interface ServiceContainer {
     generatedImageRepository: GeneratedImageRepository;
     imageStorage: ImageStorage;
     userServiceClient: UserServiceClient;
     pricingContext: IPricingContext;
     createPromptGenerator: (
       provider: Google | OpenAI,
       apiKey: string,
       userId: string,
       logger: Logger
     ) => PromptGenerator;
     createImageGenerator: (
       model: ImageGenerationModel,
       apiKey: string,
       userId: string,
       logger: Logger
     ) => ImageGenerator;
     generateId: () => string;
   }

   let container: ServiceContainer | null = null;

   export function getServices(): ServiceContainer {
     if (container === null) {
       throw new Error('Service container not initialized. Call initializeServices() first.');
     }
     return container;
   }

   export function setServices(services: ServiceContainer): void {
     container = services;
   }

   export function resetServices(): void {
     container = null;
   }
   ```

2. **Create `apps/image-service/src/serviceFactory.ts`** -- Contains the `initializeServices` function:

   ```typescript
   import { randomUUID } from 'node:crypto';
   import { createAppLogger } from '@intexuraos/infra-sentry';
   import type { IPricingContext } from '@intexuraos/llm-pricing';
   import { LlmModels, LlmProviders, type Google, type OpenAI } from '@intexuraos/llm-contract';
   import type { Logger } from '@intexuraos/common-core';
   import type { ImageGenerationModel } from './domain/index.js';
   import { IMAGE_GENERATION_MODELS } from './domain/index.js';
   import { createGeneratedImageRepository } from './infra/firestore/index.js';
   import { createOpenAIImageGenerator, createGoogleImageGenerator } from './infra/image/index.js';
   import { createGeminiPromptAdapter, createGptPromptAdapter } from './infra/llm/index.js';
   import { createGcsImageStorage } from './infra/storage/index.js';
   import { createUserServiceClient } from '@intexuraos/internal-clients';
   import { setServices } from './serviceContainer.js';

   export function initializeServices(pricingContext: IPricingContext): void {
     // ... exact same body as current initializeServices in services.ts
     // but calls setServices(container) from serviceContainer.ts instead of setting local variable
   }
   ```

   IMPORTANT: The current `initializeServices` sets the module-level `container` variable directly. The new version must call `setServices(container)` from `serviceContainer.ts` since `container` is now in that module.

3. **Update `apps/image-service/src/services.ts`** -- Make it a re-export barrel that preserves backward compatibility:

   ```typescript
   // Re-export everything from the split files for backward compatibility
   export { type ServiceContainer, getServices, setServices, resetServices } from './serviceContainer.js';
   export { initializeServices } from './serviceFactory.js';
   export type { DecryptedApiKeys } from '@intexuraos/internal-clients';
   ```

   This ensures ALL existing imports (`from '../services.js'`) continue to work without any changes.

4. **Verify no import changes are needed.** Since `services.ts` re-exports everything, all existing test files and source files that import from `'../services.js'` will continue to work. Run a search to confirm:
   - `apps/image-service/src/routes/internalRoutes.ts` imports `getServices` from `'../services.js'` -- still works
   - `apps/image-service/src/__tests__/internalRoutes.test.ts` imports `resetServices, setServices, type ServiceContainer` from `'../services.js'` -- still works
   - `apps/image-service/src/__tests__/services.test.ts` imports `getServices, setServices, resetServices, initializeServices, type ServiceContainer` from `'../services.js'` -- still works
   - `apps/image-service/src/index.ts` imports `initializeServices` from `'./services.js'` -- still works

5. **Update `apps/image-service/src/__tests__/services.test.ts`** -- Add tests for the split:

   Add a new `describe('serviceFactory', ...)` block:
   ```typescript
   describe('serviceFactory', () => {
     it('initializeServices sets container via setServices', () => {
       initializeServices(fakePricingContext);
       // If getServices doesn't throw, initializeServices correctly called setServices
       expect(() => getServices()).not.toThrow();
     });
   });
   ```
   Note: This is already covered by existing tests. Only add if coverage requires it.

### Files to Create
- `apps/image-service/src/serviceContainer.ts` -- ServiceContainer type + get/set/reset functions
- `apps/image-service/src/serviceFactory.ts` -- initializeServices factory function

### Files to Modify
- `apps/image-service/src/services.ts` -- Replace implementation with re-exports from serviceContainer.ts and serviceFactory.ts

### Test Requirements
- [ ] All existing tests in `services.test.ts` pass unchanged (since they import from `services.ts` which re-exports)
- [ ] All existing tests in `internalRoutes.test.ts` pass unchanged
- [ ] All use-case tests pass unchanged

### Acceptance Criteria
- [ ] `serviceContainer.ts` contains ONLY the type definition and get/set/reset functions (~30 lines)
- [ ] `serviceFactory.ts` contains ONLY the `initializeServices` function (~70 lines)
- [ ] `services.ts` is a pure re-export barrel (~5 lines)
- [ ] Zero import changes in any file outside of `services.ts`, `serviceContainer.ts`, and `serviceFactory.ts`
- [ ] All existing tests pass unchanged -- zero test modifications
- [ ] `pnpm run verify:workspace:tracked -- image-service` passes
