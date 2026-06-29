# INT-1772 Planning Evidence

Generated: 2026-06-29T01:07:33Z

Linear issue: https://linear.app/pbuchman/issue/INT-1772/ensure-agent-replies-in-the-users-detected-language
Code task: https://intexuraos.cloud/#/code-tasks/task_8a741339-4ca8-4c28-b15a-bdb6a9e57259

## Summary

INT-1772 was classified as SIMPLE. The implementation should strengthen the Intex agent prompt so the agent replies in the language of the last reasonable user message, ignoring links, images, attachment-only input, and trivial greetings when choosing the language.

This is a prompt-focused change, but the follow-up implementation must account for deterministic Intex agent replies that bypass the LLM. `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` currently returns hard-coded Polish text for the greeting short-circuit, confirmation previews, completed tool replies, and unsupported-intent replies. Those paths cannot be localized by prompt text alone, so the implementation scope must either localize those deterministic replies or explicitly narrow the acceptance target to LLM-generated replies and document the remaining Polish-only behavior.

## Planned Scope

- Introduce a new Intex agent prompt language-selection instruction in `apps/intex-agent/src/domain/agent/systemPrompt.ts`. The current prompt has no language-selection clause.
- State that the agent must reply in the language of the last reasonable user message. Exclude plain links, image-only input, attachment-only input, and trivial greetings when choosing the language.
- For ambiguous short messages, instruct the LLM to infer language from earlier eligible user-message entries in the chat history built from `events` by `buildMessages`, while applying the same exclusions to prior messages. If no specific language can be classified from the current or prior eligible user messages, fall back to English.
- Decide and implement deterministic reply behavior in `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`: localize hard-coded confirmation/completed/unsupported/greeting replies, or document that INT-1772 only applies to LLM-generated replies. If trivial greetings should not force Polish, address the `intentGate` greeting short-circuit before it returns the hard-coded greeting.
- Add or update prompt tests in `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts` using the existing `FakeToolCallingClient` / `ToolExecutingFakeToolCallingClient` fakes. Assert prompt clauses with `toContain`, not full-prompt equality, and cover non-English last reasonable messages, ignored link/image/greeting-only messages, ambiguous short-message fallback using a populated `events` array, and English fallback.
- Because the prompt change is behavioral, bump `INTEX_AGENT_SYSTEM_PROMPT.version` from `8.0.0` to `9.0.0` and `buildIntexAgentSystemPrompt.version` from `2.0.0` to `3.0.0`; update existing version assertions such as `intexAgentRunner.test.ts`.

## Artifacts

- Original Linear description archived in a Linear comment before updating the issue description.
- Linear issue description updated in place with the simple plan and acceptance criteria.
