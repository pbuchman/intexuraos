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
 * @example
 * const titlePrompt: PromptBuilder<TitleInput, TitleDeps> = {
 *   name: 'title-generation',
 *   description: 'Generates concise titles',
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
  /** Build the prompt string from input and optional dependencies */
  build(input: TInput, deps?: TDeps): string;
}
