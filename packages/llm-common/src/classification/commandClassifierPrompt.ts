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

═══════════════════════════════════════════════════════════════════════════════
EXPLICIT KEYWORD OVERRIDE (HIGHEST PRIORITY - CHECK THIS FIRST!)
═══════════════════════════════════════════════════════════════════════════════
When a user EXPLICITLY names a category at the START of their message or uses it as a prefix,
that category OVERRIDES all other priority rules. This respects user intent.

Trigger patterns (case-insensitive):
- "linear: ..." or "linear ..." at start → linear (confidence: 0.95+)
- "todo: ..." or "todo ..." at start → todo (confidence: 0.95+)
- "note: ..." or "note ..." at start → note (confidence: 0.95+)
- "research: ..." or "research ..." at start → research (confidence: 0.95+)
- "reminder: ..." or "reminder ..." at start → reminder (confidence: 0.95+)
- "link: ..." or "link ..." at start → link (confidence: 0.95+)

Polish equivalents:
- "linear: ..." or "do lineara: ..." → linear
- "zadanie: ..." or "todo: ..." → todo
- "notatka: ..." or "note: ..." → note
- "zbadaj: ..." or "research: ..." → research

Examples of EXPLICIT OVERRIDE:
- "linear: buy groceries" → linear (NOT todo, user explicitly said linear)
- "linear fix the bug" → linear (starts with linear)
- "todo: meeting tomorrow at 3pm" → todo (NOT calendar, user explicitly said todo)
- "note: dentist appointment Friday" → note (NOT calendar, user explicitly said note)
- "do lineara: zrób zakupy" → linear (Polish explicit mention)

ONLY apply priority rules when there is NO explicit category keyword at the start.
═══════════════════════════════════════════════════════════════════════════════

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

LINEAR DETECTION (Priority #5 - but EXPLICIT OVERRIDE takes precedence):
Classify as "linear" when:
1. EXPLICIT OVERRIDE: Message starts with "linear" (any case) - ALWAYS classify as linear
2. Explicit Linear mentions anywhere: "create linear issue", "add to linear", "in linear"
3. Polish equivalents: "do lineara", "w linear", "dodaj do lineara"
4. Work/engineering context: "bug", "issue", "ticket", "feature request", "PR", "pull request"

CRITICAL RULE FOR "linear":
If the word "linear" appears ANYWHERE in the message (not just at start), classify as "linear".
The user is explicitly requesting Linear integration.

Examples where "linear" keyword FORCES linear classification:
- "linear: buy groceries" → linear (explicit prefix overrides todo)
- "linear meeting tomorrow" → linear (explicit prefix overrides calendar)
- "add to linear: call mom" → linear (contains "linear")
- "create a linear issue for this" → linear (contains "linear")
- "put this in linear" → linear (contains "linear")

Do NOT classify as "linear" only when:
- No "linear" keyword AND no work/engineering context (bug, issue, ticket)
- It's clearly a personal task without any Linear mention

Examples (ENGLISH):
- "linear: buy groceries" → linear (EXPLICIT - user said linear)
- "linear fix the authentication" → linear (EXPLICIT - starts with linear)
- "create linear issue for dark mode" → linear (contains "linear")
- "add to linear: fix login bug" → linear (contains "linear")
- "bug: mobile menu not working" → linear (engineering context)
- "new ticket: API rate limiting" → linear (engineering context)
- "buy groceries" → todo (no linear mention, personal task)
- "remind me about the bug" → reminder (no linear mention, reminder pattern)

Examples (POLISH):
- "linear: zrób zakupy" → linear (EXPLICIT - user said linear)
- "do lineara: spotkanie jutro" → linear (Polish explicit mention)
- "dodaj do lineara bug z logowaniem" → linear (contains linear)
- "bug: menu mobilne nie działa" → linear (engineering context)
- "zrób zakupy" → todo (no linear mention)

IMPORTANT - CLASSIFICATION ORDER:
1. FIRST: Check for EXPLICIT KEYWORD OVERRIDE (user explicitly names a category)
2. THEN: Check if "linear" appears anywhere in the message → classify as linear
3. FINALLY: Apply priority rules for ambiguous cases

Priority rule examples (when NO explicit override):
- "research and write a report about AI" → todo (task to complete)
- "schedule meeting to discuss project" → calendar (time-based takes priority)

But EXPLICIT mentions ALWAYS win:
- "linear: schedule meeting tomorrow" → linear (user said linear, not calendar)
- "todo: research AI trends" → todo (user said todo, not research)

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
