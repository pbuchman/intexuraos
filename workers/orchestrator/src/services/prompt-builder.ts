/**
 * Local PromptBuilder interface for orchestrator system prompts.
 * Mirrors the pattern from packages/llm-prompts/src/types.ts but kept
 * local to avoid coupling orchestrator to the llm-prompts package.
 *
 * CI enforcement: scripts/verify-prompt-versions.mjs detects PromptBuilder<
 * typed exports and validates version fields + bump-on-change.
 */
export interface PromptBuilder<TInput> {
  readonly name: string;
  readonly description: string;
  /**
   * Semantic version (MAJOR.MINOR.PATCH).
   * - MAJOR: Behavior change (agent routing, output format, new mandatory sections)
   * - MINOR: Refined instructions, new examples, added edge cases
   * - PATCH: Typo fixes, formatting, comment clarifications
   */
  readonly version: string;
  build(input: TInput): string;
}
