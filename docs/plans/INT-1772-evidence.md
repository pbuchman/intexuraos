# INT-1772 Planning Evidence

Generated: 2026-06-29T01:07:33Z

Linear issue: https://linear.app/pbuchman/issue/INT-1772/ensure-agent-replies-in-the-users-detected-language
Code task: https://intexuraos.cloud/#/code-tasks/task_8a741339-4ca8-4c28-b15a-bdb6a9e57259

## Summary

INT-1772 was classified as SIMPLE. The implementation should strengthen the Intex agent prompt so the agent replies in the language of the last reasonable user message, ignoring links, images, attachment-only input, and trivial greetings when choosing the language.

This is a prompt-focused change, but the follow-up implementation must account for deterministic Intex agent replies that bypass the LLM. `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` currently returns hard-coded Polish text for the greeting short-circuit, confirmation previews, completed tool replies, and unsupported-intent replies. `apps/intex-agent/src/domain/agent/capabilities.ts` also returns hard-coded English unsupported-capability and completion-failure replies that are reachable from runner failure paths. `apps/intex-agent/src/domain/agent/intentGate.ts` owns the greeting classification that can trigger the no-action greeting path before the prompt is used. To satisfy the universal acceptance criterion, the implementation must localize those deterministic reply paths instead of narrowing INT-1772 to LLM-generated replies only.

## Planned Scope

- Introduce a new Intex agent prompt language-selection instruction in `apps/intex-agent/src/domain/agent/systemPrompt.ts`. The current prompt has no language-selection clause.
- State that the agent must reply in the language of the last reasonable user message. Exclude plain links, image-only input, attachment-only input, and trivial greetings when choosing the language.
- For ambiguous short messages, instruct the LLM to infer language from earlier eligible user-message entries in the chat history built from `events` by `buildMessages`, while applying the same exclusions to prior messages. If no specific language can be classified from the current or prior eligible user messages, fall back to English.
- Follow TDD sequencing: first add failing prompt/version assertions, run the targeted test to confirm the red state, implement the minimal prompt and deterministic-reply changes, then refactor only after the tests are green.
- Implement deterministic reply behavior in `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` and `apps/intex-agent/src/domain/agent/capabilities.ts` by localizing hard-coded confirmation/completed/unsupported/greeting and capability failure replies according to the same last-reasonable-user-message rule. Address `apps/intex-agent/src/domain/agent/intentGate.ts` as the greeting classifier and `intexAgentRunner.ts` as the file that returns the no-action greeting so trivial greetings do not force Polish.
- Add or update prompt tests in a dedicated `apps/intex-agent/src/__tests__/domain/systemPrompt.test.ts` so language-selection clause assertions stay localized to the prompt definition. If the implementation instead extends `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`, justify that choice by reusing its existing prompt wiring assertions and `FakeToolCallingClient` / `ToolExecutingFakeToolCallingClient` fakes.
- Assert prompt clauses with `toContain`, not full-prompt equality, and cover non-English last reasonable messages, ignored link/image/greeting-only messages, ambiguous short-message fallback using a populated `events` array, and English fallback. The populated-`events` fallback test must assert the specific clause requiring the LLM to consult earlier eligible user-message entries from `events` while applying the same exclusions, not merely assert that the prompt contains a generic language keyword. Use a concrete ambiguous example such as last user message `"ok"` with a prior eligible user message `"Stwórz notatkę o jutrzejszym spotkaniu"` to lock the conversation-history fallback behavior.
- Because the prompt change is behavioral, bump `INTEX_AGENT_SYSTEM_PROMPT.version` from `8.0.0` to `9.0.0` and `buildIntexAgentSystemPrompt.version` from `2.0.0` to `3.0.0`; update the existing `INTEX_AGENT_SYSTEM_PROMPT.version` assertion and add a direct assertion for `buildIntexAgentSystemPrompt.version === '3.0.0'`.
- Before editing `promptType: 'intex-agent-whatsapp-session'`, cross-check `apps/intex-agent` for any prompt registry, cache key, or hashing usage that depends on `promptType`; document any cache-key implication in the implementation PR if the prompt type changes.
- Maintain 100% branch coverage for new or changed prompt and deterministic-reply logic in `systemPrompt.ts`, `intexAgentRunner.ts`, and `capabilities.ts`; cover any new branch with tests rather than coverage ignores.
- Include `pnpm run ci:tracked` as the final implementation acceptance gate so prompt tests, v8 coverage, lint, typecheck, and tracked validation all run before commit.

## Artifacts

- Original Linear description archived in a Linear comment before updating the issue description.
- Linear issue description updated in place with the simple plan and acceptance criteria.
