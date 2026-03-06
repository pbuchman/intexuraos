/**
 * Common types for LLM prompts with injectable dependencies.
 */

/**
 * Base dependencies that can be injected into prompt builders.
 */
export interface PromptDeps {
  /** Override current date for time-sensitive prompts */
  currentDate?: () => string;
  /** Maximum length constraint */
  maxLength?: number;
  /** Language hint for multilingual prompts */
  language?: string;
}

/**
 * Generic prompt builder interface with injectable dependencies.
 * Prompts are objects with metadata and a build() method that returns the prompt string.
 *
 * A simplified single-generic variant of this interface exists at
 * workers/orchestrator/src/services/prompt-builder.ts for orchestrator
 * system prompts (kept local to avoid coupling orchestrator to this package).
 *
 * @example
 * const titlePrompt: PromptBuilder<TitleInput, TitleDeps> = {
 *   name: 'title-generation',
 *   description: 'Generates concise titles',
 *   version: '1.0.0',
 *   build(input, deps) { return `...${input.content}...`; }
 * };
 *
 * // Usage
 * const prompt = titlePrompt.build({ content: 'Article text...' }, { maxLength: 50 });
 */
export interface PromptBuilder<TInput, TDeps extends PromptDeps = PromptDeps> {
  /** Unique identifier for the prompt (for logging/tracking) */
  readonly name: string;
  /** Human-readable description of what the prompt does */
  readonly description: string;
  /**
   * Semantic version (MAJOR.MINOR.PATCH) of this prompt.
   *
   * - MAJOR: Behavior change (default inversion, category added/removed, output format change)
   * - MINOR: New examples, refined instructions, added edge cases
   * - PATCH: Typo fixes, formatting, comment clarifications
   *
   * MUST be bumped when prompt content changes. Enforced by CI.
   * See docs/patterns/prompt-versioning.md
   */
  readonly version: string;
  /** Build the prompt string from input and optional dependencies */
  build(input: TInput, deps?: TDeps): string;
}
