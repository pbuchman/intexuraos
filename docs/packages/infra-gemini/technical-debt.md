# Technical Debt: @intexuraos/infra-gemini

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Hardcoded Image Model

The image model is hardcoded to `LlmModels.Gemini25FlashImage`:

```ts
const IMAGE_MODEL = LlmModels.Gemini25FlashImage;
```

**Impact:** Low. Only one Gemini image model exists currently. If Google releases additional image models, this will need to be configurable.

**Recommendation:** Make image model configurable via `GeminiConfig` when additional models become available.

### No Inline Data Validation

`generateImage` accesses `response.candidates?.[0]?.content?.parts` with optional chaining but does not validate the MIME type of returned image data:

```ts
const imagePart = parts?.find((part) => part.inlineData !== undefined);
```

**Impact:** Low. The API currently returns PNG data consistently, but the MIME type is not verified.

### Hardcoded MAX_TOKENS Absent

Unlike other LLM clients in the monorepo, the Gemini client does not set a `max_tokens` limit on text generation requests. The `@google/genai` SDK uses the model's default.

**Impact:** Low. Gemini models handle token limits well by default. However, it creates inconsistency with other clients that enforce 8192.

**Recommendation:** Add an optional `maxTokens` configuration or align with the 8192 default used by other clients.

## Shared Pattern Duplication

The `createRequestContext`, `trackUsage`, and error handling boilerplate is nearly identical across all five LLM client packages (Claude, Gemini, GPT, GLM, Perplexity).

**Recommendation:** Extract into a shared `@intexuraos/llm-client-base` utility.

## Future Improvements

- Add support for multi-modal inputs (image + text prompts)
- Add support for Gemini's code execution tool
- Extract `createRequestContext` helper into a shared LLM client base package
