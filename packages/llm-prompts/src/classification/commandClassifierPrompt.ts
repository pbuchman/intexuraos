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
  | 'code';

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

## CRITICAL: URL Keyword Isolation
**Keywords inside URLs must be IGNORED for classification purposes.**
- "https://research-world.com" → The word "research" is part of the URL, NOT a command
- "https://todo-app.io/notes" → The words "todo" and "notes" are URL components, NOT commands
- Only consider keywords that appear OUTSIDE of URLs (http:// or https:// sequences)

## STEP 1: Explicit Prefix Override
If message STARTS with a category keyword (with or without colon), use that category.
Prefixes: linear, todo, note, research, reminder, link, calendar
Polish: do lineara, zadanie, notatka, zbadaj, przypomnij

Examples:
- "linear: buy groceries" → linear (user override)
- "todo: meeting tomorrow" → todo (user override)
- "do lineara: fix bug" → linear

## STEP 2: Explicit Intent Command Detection (HIGH PRIORITY)
Look for explicit command phrases that clearly indicate what the user wants to do.
These phrases OVERRIDE category signals from URL content or incidental keywords.

**CRITICAL: Linear vs Code Distinction**
- **linear** = DOCUMENT/TRACK/CREATE an issue (save for later, track work)
- **code** = EXECUTE/IMPLEMENT/DO the work NOW (make code changes)

When ambiguous, prefer "linear" (documenting) unless there's an EXPLICIT execution verb.

**Explicit command phrases (confidence 0.90+):**
- **link/bookmark**: "save bookmark", "save link", "bookmark this", "save this link", "zapisz link", "dodaj zakładkę", "zapisz zakładkę"
- **todo**: "create todo", "add todo", "add task", "make todo", "stwórz zadanie", "dodaj zadanie"
- **research**: "perform research", "do research", "research this", "investigate", "zbadaj", "sprawdź", "przeprowadź research"
- **note**: "create note", "save note", "make note", "write note", "stwórz notatkę", "zapisz notatkę"
- **reminder**: "set reminder", "remind me", "przypomnij mi"
- **calendar**: "schedule", "add to calendar", "book appointment", "zaplanuj", "dodaj do kalendarza"
- **linear** (DOCUMENT intent): "linear issue", "linear task", "create linear", "create linear issue", "create issue", "add issue", "add bug", "report issue", "report bug", "track this", "document this", "log this bug", "zgłoś błąd", "stwórz issue", "dodaj do lineara", "do lineara", "zapisz jako issue"
- **code** (EXECUTE intent - requires EXPLICIT action verb): "execute this", "implement this now", "fix this bug now", "do this task", "execute linear issue", "implement linear issue", "start working on", "code this", "write the code", "make this change now"

**Linear vs Code disambiguation examples:**
- "linear issue: fix the login bug" → linear (documenting the bug)
- "create linear issue for auth bug" → linear (creating a ticket)
- "fix the login bug" → linear (no explicit "now"/"execute" - assume documenting)
- "implement dark mode" → linear (no explicit execution command - assume documenting)
- "execute: fix the login bug" → code (explicit "execute")
- "implement this now: dark mode" → code (explicit "now")
- "start working on the auth bug" → code (explicit "start working")
- "execute linear issue INT-123" → code (explicit "execute linear issue")

Examples:
- "save bookmark https://research-world.com" → link (explicit "save bookmark" overrides "research" in URL)
- "create todo to research competitors" → todo (explicit "create todo" overrides "research" keyword)
- "perform research on todo apps" → research (explicit "perform research" overrides "todo" keyword)
- "save note about the research meeting" → note (explicit "save note" is the command)
- "research this https://example.com" → research (explicit "research this" overrides URL presence - STEP 2 > STEP 4)
- "investigate https://competitor.io/pricing" → research (explicit "investigate" overrides URL)
- "create an issue for the bug" → linear (tracking intent, documenting)
- "linear task: refactor the auth module" → linear (documenting the task)
- "look into the performance issue" → research (investigation, NOT execution)
- "execute: refactor the auth module" → code (explicit execution command)
- "start implementing the new feature" → code (explicit "start implementing")

## STEP 3: Linear Detection (if no explicit intent match)
Classify as "linear" when message describes work to be TRACKED/DOCUMENTED:
- Linear PM context: "linear issue", "linear task", "add to linear", "create linear issue", "in linear", "do lineara"
- Engineering terms describing work: bug, issue, ticket, feature request, PR, pull request
- Implicit task descriptions: "fix X", "implement Y", "add Z", "refactor W" (WITHOUT explicit "execute"/"now"/"start working")

**DEFAULT TO LINEAR for engineering tasks** unless there's an explicit execution command.
The assumption is: describing work = documenting it for tracking, not executing it immediately.

EXCEPTION: "linear" in math/science context (e.g., "linear regression", "linear algebra") → NOT linear

Examples:
- "bug: mobile menu broken" → linear (documenting a bug)
- "create linear issue for auth" → linear (explicit Linear context)
- "fix the authentication flow" → linear (task description = documenting)
- "implement new dashboard" → linear (task description = documenting)
- "research linear regression" → research (math context)

## STEP 4: URL Presence Check (BEFORE other category signals)
**If message contains a URL (http:// or https://), strongly prefer "link" classification.**
URLs indicate the user is sharing/saving a link, not asking for research or creating a task.

- "https://example.com interesting article" → link (URL present)
- "check out https://research-tools.com" → link (URL present, "research" is in URL)
- "https://todo-tracker.io nice tool" → link (URL present, "todo" is in URL)

**Higher confidence (0.90+) for links when:**
- Sharing context phrases present: "check this out", "look at this", "you should see this", "found this", "sharing", "see this"
- Explicit recommendation: "this is great", "interesting", "nice item", "cool link"
- App-generated share format (clean URL with optional brief text)

## STEP 5: Category Detection (if no URL and no explicit intent)
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

**code** — User wants to EXECUTE code changes NOW (requires EXPLICIT execution command)
Signals (must be EXPLICIT): "execute", "do this now", "start working on", "implement this now", "execute linear issue", "code this", "write the code now"
WITHOUT explicit execution command → classify as "linear" (documenting work)
- "execute: fix the login bug" → code (explicit "execute")
- "start working on dark mode" → code (explicit "start working")
- "implement this now: new dashboard" → code (explicit "now")
- "execute linear issue INT-123" → code (explicit execution of tracked issue)

**NOT code (these are LINEAR - documenting work):**
- "fix the login bug" → linear (no explicit execution = documenting)
- "implement dark mode" → linear (no explicit execution = documenting)
- "refactor the auth module" → linear (no explicit execution = documenting)

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
