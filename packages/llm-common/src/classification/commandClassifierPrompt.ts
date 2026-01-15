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
  | 'linear'
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
1. calendar: A time-based event or appointment (highest priority for time-sensitive requests)
2. todo: A task that needs to be done (e.g., "buy groceries", "call mom", "finish report")
3. research: A question or topic to research (e.g., "how does X work?", "find out about Y")
4. reminder: Something to be reminded about at a specific time (e.g., "remind me to X in 2 hours")
5. linear: A task or issue to create in Linear (project management)
6. note: Information to remember or store (e.g., "meeting notes from today", "idea for project")
7. link: A URL or reference to save (e.g., contains a URL or asks to save a link)
8. unclassified: Cannot be classified into any of the above categories

CALENDAR DETECTION (Priority #1):
Classify as "calendar" when the message contains:
- Time expressions: "tomorrow", "today", "Monday", "next week", "3pm", "15:00", "at 5"
- Event keywords: "meeting", "appointment", "call", "dentist", "doctor", "lunch", "dinner"
- Scheduling verbs: "schedule", "arrange", "book", "set up", "organize"
- Date formats: "2024-01-15", "15.01.2024", "15/01"
- Relative dates: "in 2 days", "next Friday", "this afternoon"

Examples (ENGLISH):
- "meeting tomorrow at 3pm" → calendar
- "schedule lunch with John on Friday" → calendar
- "dentist appointment next Tuesday at 10" → calendar
- "call mom tomorrow" → calendar (time-based)
- "remind me about the meeting" → reminder (not a new event)

Examples (POLISH):
- "spotkanie jutro o 15" → calendar
- "umów wizytę u dentysty we wtorek" → calendar
- "obiad z Janem w piątek o 13" → calendar
- "zadzwoń do mamy jutro" → calendar
- "przypomnij o spotkaniu" → reminder

LINEAR DETECTION (Priority #5):
Classify as "linear" when the message contains:
- Explicit Linear mentions: "linear", "create linear issue", "add to linear"
- Polish equivalents: "do lineara", "nowe zadanie w linear", "dodaj do lineara"
- Task/issue phrasing combined with work context: "new issue", "new ticket", "bug report"
- Issue tracker keywords: "issue", "ticket", "bug", "feature request", "task"

IMPORTANT: Only classify as "linear" when:
- The user explicitly mentions Linear by name, OR
- The context clearly indicates a work/project management task (bug, feature, issue)

Do NOT classify as "linear" when:
- It's a personal todo without work context (use "todo" instead)
- It's a reminder without issue context (use "reminder" instead)

Examples (ENGLISH):
- "create linear issue for dark mode feature" → linear
- "add to linear: fix login bug" → linear
- "new ticket: API rate limiting" → linear
- "bug: mobile menu not working" → linear (work context)
- "buy groceries" → todo (personal task, not linear)
- "remind me about the bug" → reminder (not a new issue)

Examples (POLISH):
- "nowe zadanie w linear: napraw walidację" → linear
- "dodaj do lineara bug z logowaniem" → linear
- "nowy ticket: API rate limiting" → linear
- "bug: menu mobilne nie działa" → linear
- "zrób zakupy" → todo (not linear)

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
