# INT-1369 Default User Client And Orchestrator Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the approved user-facing Gemini hardcodings with the existing user default-model client plus fallback flow, and add a shared prioritized model fallback strategy for orchestrator completion verification and agent compliance validation.

**Architecture:** This work splits cleanly into two tracks. The remaining codebase reuses `packages/internal-clients/src/user-service/client.ts#getLlmClient()` as the single source of truth for default-model plus fallback resolution, then removes service-local Gemini assumptions in hellscript-agent, image-service, linear-agent, and chat-agent. The orchestrator remains platform-owned, but stops hardcoding one verifier model per component by parsing a single ordered environment variable and constructing primary/secondary validation clients that both completion verification and `agent-compliance-validator` can share.

**Tech Stack:** TypeScript, Fastify, Firestore, `@intexuraos/internal-clients`, `@intexuraos/llm-factory`, `@intexuraos/llm-contract`, `@intexuraos/infra-gemini`, `@intexuraos/infra-openrouter`

---

## Locked Requirements

1. **Orchestrator validation clients become prioritized, not hardcoded.**
   - Use one env var carrying an ordered list of models.
   - Initial order: primary `or:google/gemma-4-31b-it:free`, secondary `gemini-2.5-flash`.
   - Apply the same ordered list to:
     - completion verification
     - agent compliance validation

2. **Remaining-codebase migrations must use the user default client with fallback.**
   - The eight approved migration points from the audit remain the implementation scope.
   - Reuse `createUserServiceClient(...).getLlmClient(userId)` instead of introducing new service-local fallback logic.
   - Guest or platform-only flows with no user context stay hardcoded.

3. **Do not expand this task into capability-specific or platform-owned hardcodings.**
   - Image generation models, research model-selection infrastructure, API-key validation probes, cron/code-agent system loops, and tool-calling-only pricing constants remain hardcoded unless explicitly called out below.

---

## File Structure

| Area | Files | Responsibility |
| --- | --- | --- |
| Orchestrator env + boot | `workers/orchestrator/src/start.ts`, `terraform/environments/dev/main.tf`, `ecosystem.config.cjs`, `workers/orchestrator/README.md` | Parse one ordered validation-model env var, wire required secrets, document the new configuration |
| Orchestrator client selection | `workers/orchestrator/src/services/completion-verifier.ts`, `workers/orchestrator/src/services/agent-compliance-validator.ts`, new helper in `workers/orchestrator/src/services/` | Build provider-agnostic validation clients from prioritized models and retry/fallback on failure |
| Orchestrator tests | `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`, `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts`, possibly `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` | Cover ordered-model parsing, missing-key handling, primary failure -> secondary fallback, and logging |
| Hellscript migration | `apps/hellscript-agent/src/index.ts`, `apps/hellscript-agent/src/services.ts`, `apps/hellscript-agent/src/infra/llm/geminiIntentInterpreter.ts`, `apps/hellscript-agent/src/infra/llm/geminiDraftGenerator.ts`, related tests | Remove direct Gemini bootstrapping and use a generic user-backed generate client |
| Image-service migration | `apps/image-service/src/serviceFactory.ts`, `apps/image-service/src/infra/llm/GeminiPromptAdapter.ts`, `apps/image-service/src/application/generatePrompt.ts`, related tests | Resolve prompt-generation model and pricing dynamically from user defaults instead of Gemini constants |
| Linear-agent migration | `apps/linear-agent/src/index.ts`, `apps/linear-agent/src/services.ts`, prune route tests | Stop creating a fixed `Gemini25Flash` pruning client at startup; resolve a user-backed client at classification time |
| Chat-agent migration | `apps/chat-agent/src/services.ts`, `apps/chat-agent/src/routes/chatRoutes.ts`, related tests | Keep guest Gemini fixed, but route authenticated user generation through the default user client with fallback |
| Audit appendix | `docs/plans/INT-1369-evidence.md` | Preserve the migration list plus classify omitted hardcoded Gemini/OpenRouter sites so the document is complete |

## Endpoint Changes

### Modified
None.

### Created
None.

### Removed
None.

### Unchanged
- Existing user-service internal settings and LLM-key endpoints remain the source of truth for default and fallback model resolution.
- No new public or internal HTTP surface is required for this plan.

---

## Workstream 1: Shared Orchestrator Validation Model Priority

**Objective:** Replace one-off hardcoded models in `start.ts`, `completion-verifier.ts`, and `agent-compliance-validator.ts` with one ordered model list shared by both validation systems.

**Files:**
- Modify: `workers/orchestrator/src/start.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Modify: `workers/orchestrator/src/services/agent-compliance-validator.ts`
- Create or modify: `workers/orchestrator/src/services/<validation-model-helper>.ts`
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
- Modify: `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `workers/orchestrator/README.md`

**Plan:**
- [ ] Introduce a single ordered env var for orchestrator-owned validation calls.
  - Proposed name: `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS`
  - Proposed default/dev value: `or:google/gemma-4-31b-it:free,gemini-2.5-flash`
- [ ] Parse that env var once in `start.ts` and fail fast on empty or invalid model ids.
- [ ] Add a small helper that:
  - accepts an ordered model list
  - resolves provider-specific credentials for each model (`INTEXURAOS_OPENROUTER_APP_API_KEY` for `or:` models, `INTEXURAOS_GEMINI_APP_API_KEY` for Gemini)
  - resolves pricing from existing sources (`getDefaultAllowlistPricing()` for OpenRouter allowlist models, pricing context/static pricing for Gemini)
  - returns `LlmGenerateClient` instances in priority order
- [ ] Refactor `OrchestratorCompletionVerifier` to accept a primary client plus optional fallback clients instead of `{ model, geminiApiKey }`.
- [ ] Refactor `OrchestratorAgentComplianceValidator` to stop constructing `createOpenRouterClient(...)` directly and instead use the same provider-agnostic ordered client list.
- [ ] Standardize runtime behavior:
  - primary model runs first
  - retry on provider failure, timeout, invalid-key, or parse/shape failure only when fallback exists
  - log which model produced the final answer and which model was skipped/fell back
- [ ] Keep prompt contents and schemas unchanged in this task. This is a client-selection change, not a prompt rewrite.
- [ ] Wire the new env var in all required configuration locations and document the expected comma-separated format.

**Verification:**
- [ ] Unit tests prove ordered parsing and invalid-model rejection.
- [ ] Completion verifier tests cover primary success and primary failure -> Gemini fallback.
- [ ] Compliance validator tests cover the same fallback path and confirm the reported model is the one that actually succeeded.
- [ ] `pnpm run verify:workspace:tracked -- orchestrator`

---

## Workstream 2: Hellscript-Agent Uses User Default Client

**Objective:** Remove service-local Gemini bootstrapping for writing-buffer interpretation and draft generation.

**Files:**
- Modify: `apps/hellscript-agent/src/index.ts`
- Modify: `apps/hellscript-agent/src/services.ts`
- Modify: `apps/hellscript-agent/src/infra/llm/geminiIntentInterpreter.ts`
- Modify: `apps/hellscript-agent/src/infra/llm/geminiDraftGenerator.ts`
- Modify tests in `apps/hellscript-agent/src/__tests__/`

**Plan:**
- [ ] Replace the startup-created `GeminiClient` with a generic `LlmGenerateClient` or a request-time client factory backed by `userServiceClient.getLlmClient(userId)`.
- [ ] Rename the Gemini-specific adapters or generalize them so their constructor type is `LlmGenerateClient`, not `GeminiClient`.
- [ ] Remove hardcoded `Gemini25Flash` pricing from startup; if startup still needs pricing validation, fetch it via the standard pricing client instead of `TOOL_CALLING_PRICING`.
- [ ] Preserve current fallback behavior inside `GeminiIntentInterpreter`/`GeminiDraftGenerator` logic; only the upstream client source changes.
- [ ] Ensure service initialization still works in tests through `setServices()` without requiring live user-service calls.

**Verification:**
- [ ] Route/use-case tests still pass with fake interpreters and draft generators.
- [ ] Add at least one service-level test proving the adapter accepts a non-Gemini `LlmGenerateClient`.
- [ ] `pnpm run verify:workspace:tracked -- hellscript-agent`

---

## Workstream 3: Image-Service Prompt Generation Tracks User Defaults

**Objective:** Make text prompt generation use the user's selected default/fallback model while leaving image-generation model selection unchanged.

**Files:**
- Modify: `apps/image-service/src/serviceFactory.ts`
- Modify: `apps/image-service/src/infra/llm/GeminiPromptAdapter.ts`
- Modify: `apps/image-service/src/application/generatePrompt.ts`
- Modify tests in `apps/image-service/src/__tests__/`

**Plan:**
- [ ] Keep `createImageGenerator(...)` unchanged for `GPTImage1` and `Gemini25FlashImage`.
- [ ] Refactor prompt-generation creation so Google prompt generation no longer hardcodes:
  - `Gemini25Flash` pricing in `serviceFactory.ts`
  - `Gemini25Pro` as the implicit default in `GeminiPromptAdapter`
- [ ] Resolve the prompt-generation model from the user’s default client/fallback settings, then derive pricing from that resolved model instead of from a Gemini constant.
- [ ] If the prompt generator remains provider-specific, pass the resolved model explicitly into the adapter and rename the adapter/config surface to make that obvious.
- [ ] Keep the internal API contract unchanged: callers still supply text/model/userId, but prompt-generation internals become user-model-aware.

**Verification:**
- [ ] Add tests proving prompt generation uses the resolved model’s pricing, not `Gemini25Flash` by default.
- [ ] Preserve existing tests for image generation using capability-specific hardcoded image models.
- [ ] `pnpm run verify:workspace:tracked -- image-service`

---

## Workstream 4: Linear-Agent Issue Pruning Stops Using A Fixed Gemini Client

**Objective:** Move the pruning classifier off a platform Gemini singleton and onto the user-backed default/fallback client path.

**Files:**
- Modify: `apps/linear-agent/src/index.ts`
- Modify: `apps/linear-agent/src/services.ts`
- Modify routes/tests around prune candidate classification

**Plan:**
- [ ] Remove the startup-time `createGeminiClient({ model: Gemini25Flash, userId: 'system:pruning' })` construction.
- [ ] Push client resolution to the point where the classifier knows which user/workspace owns the pruning request.
- [ ] Use `userServiceClient.getLlmClient(userId)` so the classifier automatically gets:
  - user default model
  - user fallback model
  - provider-specific API key lookup
- [ ] Keep the existing “classifier unavailable” fallback behavior when no usable client can be resolved.
- [ ] Trim `REQUIRED_MODELS`/pricing bootstrap in `index.ts` so it no longer assumes `Gemini25Flash` is always required for pruning.

**Verification:**
- [ ] Update route tests to prove user-backed client resolution is attempted before classification.
- [ ] Add one failure-path test showing the route still degrades safely when no user client is available.
- [ ] `pnpm run verify:workspace:tracked -- linear-agent`

---

## Workstream 5: Chat-Agent Keeps Guest Gemini But Migrates Authenticated Users

**Objective:** Preserve the guest path exactly as-is while routing authenticated chat generation through user default/fallback resolution.

**Files:**
- Modify: `apps/chat-agent/src/services.ts`
- Modify: `apps/chat-agent/src/routes/chatRoutes.ts`
- Modify tests in `apps/chat-agent/src/__tests__/`

**Plan:**
- [ ] Leave `guestLlmClient` hardcoded to platform Gemini 2.5 Flash.
- [ ] Audit authenticated chat routes/use-cases and replace any direct Gemini assumptions with `userServiceClient.getLlmClient(userId)`.
- [ ] Ensure pricing bootstrap only validates models still needed at startup; guest-only Gemini should remain in `CHAT_MODELS`, authenticated-user models should not be fixed there.
- [ ] Add explicit test coverage that guest requests still use the guest client while authenticated requests use the user-service-backed client.

**Verification:**
- [ ] `pnpm run verify:workspace:tracked -- chat-agent`

---

## Approved Migration Scope For The Remaining Codebase

These are the eight user-facing points the owner explicitly approved for migration:

| # | Service | File | Migration intent |
| --- | --- | --- | --- |
| 1 | hellscript-agent | `src/index.ts` | remove startup Gemini singleton |
| 2 | hellscript-agent | `src/services.ts` | remove Gemini-specific container typing |
| 3 | hellscript-agent | `src/infra/llm/geminiDraftGenerator.ts` | accept generic generate client |
| 4 | hellscript-agent | `src/infra/llm/geminiIntentInterpreter.ts` | accept generic generate client |
| 5 | image-service | `src/infra/llm/GeminiPromptAdapter.ts` | resolve model dynamically from user defaults |
| 6 | image-service | `src/serviceFactory.ts` | remove Gemini-only pricing assumption |
| 7 | linear-agent | `src/services.ts` | replace fixed pruning client with user-backed client |
| 8 | chat-agent | `src/services.ts` | keep guest Gemini, migrate authenticated path |

---

## Omitted Hardcoded Usage Now Explicitly Classified

These sites were missing from the original audit. They are not part of the approved migration scope, but they are now classified so this document is complete.

| File | Current hardcoding | Classification | Reason |
| --- | --- | --- | --- |
| `workers/orchestrator/src/start.ts`, `workers/orchestrator/src/services/completion-verifier.ts`, `workers/orchestrator/src/services/agent-compliance-validator.ts` | validation models | **Change in this task** | owner explicitly asked for prioritized primary/secondary validation clients |
| `apps/cron-agent/src/index.ts` | `Gemini25Flash` tool-calling + generate clients | **No change in this task** | platform-owned scheduler, no user context |
| `apps/code-agent/src/services.ts` | Gemini tool-calling + execution-memory models | **No change in this task** | system-owned orchestration/classification path, not one of the approved eight migration points |
| `apps/research-agent/src/routes/researchRoutes.ts`, `apps/research-agent/src/routes/internalRoutes.ts`, `apps/research-agent/src/routes/helpers/synthesisHelper.ts` | `Gemini25Flash` for title/context helpers | **No change in this task** | research helper flows are product-defined Google helpers, not user default-model replacement scope here |
| `packages/llm-prompts/src/research/modelExtractionPrompt.ts`, `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts`, `apps/research-agent/src/infra/llm/GeminiAdapter.ts` | research Gemini selection infrastructure | **No change in this task** | explicit research-model selection must stay provider/model aware |
| `apps/user-service/src/infra/llm/LlmValidatorImpl.ts` | `Gemini20Flash` validation probe | **No change in this task** | cheapest-provider validation probe |
| `apps/image-service/src/infra/image/GoogleImageGenerator.ts`, `packages/infra-gemini/src/client.ts` | `Gemini25FlashImage` | **No change in this task** | capability-specific image generation |
| `packages/infra-gemini/src/toolCallingClient.ts` | `TOOL_CALLING_PRICING[Gemini25Flash]` | **No change in this task** | tool-calling support is currently Gemini-specific |

---

## Delivery Sequence

1. Implement Workstream 1 first so the orchestrator’s system-owned fallback story is locked.
2. Implement hellscript-agent next because it has the smallest user-backed migration surface and validates the adapter pattern.
3. Implement image-service and linear-agent after that, since both depend on dynamic model/pricing resolution but in different ways.
4. Finish with chat-agent, keeping the guest split explicit and covered by tests.
5. Run targeted workspace verification for each touched workspace, then `pnpm run ci:tracked`.

## Final Verification Gate

- [ ] `pnpm run verify:workspace:tracked -- orchestrator`
- [ ] `pnpm run verify:workspace:tracked -- hellscript-agent`
- [ ] `pnpm run verify:workspace:tracked -- image-service`
- [ ] `pnpm run verify:workspace:tracked -- linear-agent`
- [ ] `pnpm run verify:workspace:tracked -- chat-agent`
- [ ] `pnpm run ci:tracked`

