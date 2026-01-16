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
  | 'linear';

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
    return `Classify the message into exactly one category. Follow this decision tree IN ORDER:

## STEP 1: Explicit Prefix Override
If message STARTS with a category keyword (with or without colon), use that category.
Prefixes: linear, todo, note, research, reminder, link, calendar
Polish: do lineara, zadanie, notatka, zbadaj, przypomnij

Examples:
- "linear: buy groceries" → linear (user override)
- "todo: meeting tomorrow" → todo (user override)
- "do lineara: fix bug" → linear

## STEP 2: Linear Detection (if no prefix override)
Classify as "linear" when message contains:
- Linear PM context: "add to linear", "create linear issue", "in linear", "do lineara"
- Engineering terms: bug, issue, ticket, feature request, PR, pull request

EXCEPTION: "linear" in math/science context (e.g., "linear regression", "linear algebra") → NOT linear

Examples:
- "bug: mobile menu broken" → linear
- "create linear issue for auth" → linear
- "research linear regression" → research (math context)

## STEP 3: Category Detection (if no linear match)
Apply in this priority order:

**calendar** — Time-specific event or appointment
Signals: tomorrow, today, weekday names, time (3pm, 15:00), meeting, appointment, schedule, book
- "meeting tomorrow at 3" → calendar
- "dentist next Tuesday 10am" → calendar
- "call mom tomorrow" → calendar

**reminder** — Request to be reminded about something
Signals: remind me, przypomnij, don't forget
- "remind me about the meeting" → reminder
- "przypomnij o spotkaniu" → reminder

**research** — Question or topic to investigate
Signals: how does, what is, why, find out, learn about, ?
- "how does OAuth work?" → research
- "find out about competitor pricing" → research

**link** — URL to save
Signals: contains http://, https://, or "save this link"
- "https://example.com interesting article" → link

**note** — Information to store
Signals: notes, idea, remember that, jot down
- "meeting notes: discussed Q4 goals" → note
- "idea for new feature" → note

**todo** — Action to complete (default for actionable requests)
- "buy groceries" → todo
- "finish the report" → todo
- "call mom" → todo (no time specified)

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "type": "<category>",
  "confidence": <0.0-1.0>,
  "title": "<concise title, max 50 chars, SAME LANGUAGE as input>",
  "reasoning": "<brief explanation>"
}

## CONFIDENCE SEMANTICS
- 0.90+: Clear match (explicit prefix, multiple strong signals)
- 0.70-0.90: Strong match (single clear signal like "bug", time expression)
- 0.50-0.70: Choosing between 2-3 plausible categories, picked the best fit
- <0.50: Genuinely uncertain → default to "note" (everything can be a note)

Message to classify:
${input.message}`;
  },
};
