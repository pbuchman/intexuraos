# INT-1369: Gemini Client Usage Audit for User Model Standardization

> **Audit date:** 2026-04-13
>
> **Goal:** Map all hardcoded Gemini client usage. Identify which can be replaced with the user's `defaultModel` preference and which must stay hardcoded.

## Context

Users configure a `defaultModel` in `LlmPreferences` (stored via user-service). Many services currently hardcode `Gemini25Flash` or `Gemini25Pro` even in contexts where the user's preferred model should be used instead. This audit identifies every such location.

---

## Orchestrator (`workers/orchestrator/`)

| File                                  | Line(s)         | Hardcoded Model     | Purpose                                                                                              | Can Use User Model?   | Rationale                                                                                                                               |
| ------------------------------------- | --------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/start.ts`                        | 727-735         | `Gemini25Flash`     | Completion verification — extracts structured data from agent logs to determine task success/failure | **NO**                | System-level infrastructure. Runs after agent completes, no user context. Must be cheap/fast and deterministic. Platform-owned API key. |
| `src/services/completion-verifier.ts` | 221-227         | `Gemini25Flash`     | `VERIFIER_PRICING` constant for completion verification cost tracking                                | **NO**                | Paired with the hardcoded model above.                                                                                                  |
| `src/services/task-dispatcher.ts`     | 1383, 2078-2082 | N/A (uses verifier) | Calls `completionVerifier.verify()` and `extractResumeSummary()`                                     | **NO**                | Consumes the verifier; model choice is in `start.ts`.                                                                                   |

**Orchestrator summary:** All Gemini usage is for completion verification — a platform-internal system function. **No changes needed.**

---

## Remaining Codebase

### Can Replace with User's Default Model

| #   | Service              | File                                       | Line(s)        | Hardcoded Model           | Purpose                                                         | Notes                                                                                                                                            |
| --- | -------------------- | ------------------------------------------ | -------------- | ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **hellscript-agent** | `src/index.ts`                             | 40-53          | `Gemini25Flash`           | Intent interpretation + draft generation for writing buffer     | Uses platform Gemini API key with system userId. Should use user's preferred model and key when available.                                       |
| 2   | **hellscript-agent** | `src/services.ts`                          | 21, 31-32      | `GeminiClient` type       | Service container typed to `GeminiClient` specifically          | Port interfaces (`IntentInterpreter`, `DraftGenerator`) are model-agnostic — only the infra layer is Gemini-specific. Needs factory/abstraction. |
| 3   | **hellscript-agent** | `src/infra/llm/geminiDraftGenerator.ts`    | 1-13           | `GeminiClient` type       | Draft generation adapter hardwired to Gemini client             | Implement via `llm-factory` like other services.                                                                                                 |
| 4   | **hellscript-agent** | `src/infra/llm/geminiIntentInterpreter.ts` | 1-21           | `GeminiClient` type       | Intent interpretation adapter hardwired to Gemini client        | Same — use generic `LlmGenerateClient` interface.                                                                                                |
| 5   | **image-service**    | `src/infra/llm/GeminiPromptAdapter.ts`     | 18             | `Gemini25Pro`             | Default model for thumbnail prompt generation                   | `model` is already optional in config — just needs to pass user's default model through.                                                         |
| 6   | **image-service**    | `src/serviceFactory.ts`                    | 46, 64-71      | `Gemini25Flash` (pricing) | Pricing lookup hardcoded to Gemini25Flash for prompt generation | Should resolve pricing dynamically based on the model being used.                                                                                |
| 7   | **linear-agent**     | `src/services.ts`                          | 88-108         | `Gemini25Flash`           | Issue pruning classifier — classifies issues for auto-pruning   | Uses platform API key with `system:pruning` userId. Could use user's model preference for their workspace.                                       |
| 8   | **chat-agent**       | `src/services.ts`                          | 32-34, 143-151 | `Gemini25Flash`           | Guest LLM client for unauthenticated chat                       | **Partial**: Guest mode must stay hardcoded (no user context). Authenticated users should use their default model.                               |

### MUST NOT Change (Hardcoded by Design)

| #   | Service            | File                                        | Line(s)           | Hardcoded Model                | Purpose                                                                                           | Why It Must Stay                                                                                                                        |
| --- | ------------------ | ------------------------------------------- | ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **research-agent** | `llm-prompts/.../modelExtractionPrompt.ts`  | 219-229           | Various Gemini models          | `MODEL_KEYWORDS` — maps user phrases ("gemini", "google") to specific research models             | This IS the user model selection system. Users explicitly choose research models. Changing defaults here changes the product semantics. |
| 2   | **research-agent** | `llm-prompts/.../modelExtractionPrompt.ts`  | 235-240           | `Gemini25Pro`                  | `PROVIDER_DEFAULT_MODELS` — when user says "use google" without specifying a model                | Provider-level default for research. Intentional product decision.                                                                      |
| 3   | **research-agent** | `llm-prompts/.../modelExtractionPrompt.ts`  | 245, 250          | `Gemini25Pro`                  | `SYNTHESIS_MODELS` and `DEFAULT_SYNTHESIS_MODEL` — synthesis requires specific model capabilities | Not all models support synthesis. This is a capability gate, not a preference.                                                          |
| 4   | **research-agent** | `src/domain/.../extractModelPreferences.ts` | 42-43             | `Gemini25Pro`, `Gemini25Flash` | `RESEARCH_MODELS` list of available research models                                               | Enumerates what's available — not a default selection.                                                                                  |
| 5   | **research-agent** | `src/infra/llm/GeminiAdapter.ts`            | All               | `GeminiClient`                 | Adapter for research/synthesis using Gemini                                                       | Part of multi-provider research system — user explicitly selects Gemini for research.                                                   |
| 6   | **user-service**   | `src/infra/llm/LlmValidatorImpl.ts`         | 22-28             | `Gemini20Flash`                | API key validation — sends cheap test prompt to verify key works                                  | Must use cheapest/fastest model per provider. Not a user-facing generation.                                                             |
| 7   | **image-service**  | `src/infra/image/GoogleImageGenerator.ts`   | 57-65             | `Gemini25FlashImage`           | Image generation — uses Gemini's image generation model                                           | This is a capability-specific model (image gen), not a text generation preference.                                                      |
| 8   | **infra-gemini**   | `src/client.ts`                             | 54                | `Gemini25FlashImage`           | Image generation default in client factory                                                        | Capability-specific — image generation only works with specific models.                                                                 |
| 9   | **infra-gemini**   | `src/toolCallingClient.ts`                  | 37-43             | `Gemini25Flash`                | `TOOL_CALLING_PRICING` for tool-calling agent loops                                               | Pricing constant paired with tool-calling capability. Only Gemini25Flash supports tool calling in the Gemini family.                    |
| 10  | **llm-contract**   | `src/supportedModels.ts`                    | 149-154, 355, 358 | All Gemini models              | Model registry — defines supported models and capabilities                                        | Infrastructure definition, not a usage site.                                                                                            |

---

## Summary

- **Orchestrator:** 0 changeable sites. All Gemini usage is system-level completion verification.
- **Remaining codebase:** 8 sites across 4 services (hellscript-agent, image-service, linear-agent, chat-agent) where hardcoded Gemini could be replaced with user's default model.
- **Do not change:** 10 sites where Gemini is hardcoded by design (research model selection, API key validation, image generation, capability gates, infrastructure definitions).
