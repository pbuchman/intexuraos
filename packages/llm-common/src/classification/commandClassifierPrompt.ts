/**
 * Command classification prompt for categorizing user messages.
 * Used by commands-agent to classify incoming commands into categories.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export type CommandCategory =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'unclassified';

export interface CommandClassifierPromptInput {
  /** The user message to classify */
  message: string;
}

export interface CommandClassifierPromptDeps extends PromptDeps {
  /** Custom categories (defaults to standard set) */
  categories?: CommandCategory[];
}

export const commandClassifierPrompt: PromptBuilder<
  CommandClassifierPromptInput,
  CommandClassifierPromptDeps
> = {
  name: 'command-classification',
  description: 'Classifies user messages into command categories (todo, research, note, etc.)',

  build(input: CommandClassifierPromptInput, _deps?: CommandClassifierPromptDeps): string {
    return `You are a command classifier. Analyze the user's message and classify it into one of these categories:

CATEGORIES (in priority order - when multiple could apply, use the FIRST matching category):
1. todo: A task that needs to be done (e.g., "buy groceries", "call mom", "finish report")
2. research: A question or topic to research (e.g., "how does X work?", "find out about Y")
3. calendar: A time-based event or appointment (e.g., "meeting tomorrow at 3pm", "dentist on Friday")
4. reminder: Something to be reminded about at a specific time (e.g., "remind me to X in 2 hours")
5. note: Information to remember or store (e.g., "meeting notes from today", "idea for project")
6. link: A URL or reference to save (e.g., contains a URL or asks to save a link)
7. unclassified: Cannot be classified into any of the above categories

IMPORTANT: If a message could fit multiple categories, always choose the HIGHER priority category.
For example: "research and write a report about AI" → todo (because there's a task to complete)
             "schedule meeting to discuss project" → calendar (has calendar aspect, takes priority over todo)

Respond with ONLY a JSON object in this exact format:
{
  "type": "<category>",
  "confidence": <number between 0 and 1>,
  "title": "<short descriptive title, max 50 chars>",
  "reasoning": "<1-2 sentences explaining why this classification was chosen>"
}

The confidence should reflect how certain you are about the classification:
- 0.9-1.0: Very confident
- 0.7-0.9: Fairly confident
- 0.5-0.7: Somewhat uncertain
- Below 0.5: Use "unclassified" instead

CRITICAL: The title MUST be in the SAME LANGUAGE as the user's message (Polish message → Polish title, Spanish message → Spanish title, etc.)

The title should be a concise summary of the action (e.g., "Buy groceries", "Research AI trends", "Team meeting notes").
The reasoning should briefly explain what keywords or patterns led to this classification.

User message to classify:
${input.message}`;
  },
};
