# INT-1772 Planning Evidence

Generated: 2026-06-29T01:07:33Z

Linear issue: https://linear.app/pbuchman/issue/INT-1772/ensure-agent-replies-in-the-users-detected-language
Code task: https://intexuraos.cloud/#/code-tasks/task_8a741339-4ca8-4c28-b15a-bdb6a9e57259

## Summary

INT-1772 was classified as SIMPLE. The implementation should strengthen the Intex agent prompt so the agent replies in the language of the last reasonable user message, ignoring links, images, attachment-only input, and trivial greetings when choosing the language.

## Planned Scope

- Update the existing Intex agent prompt language-selection instruction.
- Add or update prompt snapshot/tests for non-English messages, ignored link/image/greeting-only messages, ambiguous short-message context fallback, and English fallback.
- Follow prompt versioning rules if the prompt is implemented with `PromptBuilder`.

## Artifacts

- Original Linear description archived in a Linear comment before updating the issue description.
- Linear issue description updated in place with the simple plan and acceptance criteria.
