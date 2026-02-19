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
  version: '1.0.0',

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
- **linear** = ONLY when user EXPLICITLY wants to create/track a Linear issue (must mention "linear", "issue", "track", "log", "report")
- **code** = ANY engineering task describing work to do (fix, implement, design, add, refactor, change, update, build, etc.)

When ambiguous between linear and code, prefer "code". Engineering tasks default to code execution.
Code actions automatically create a Linear issue, so tracking is never lost.
Only classify as "linear" when user EXPLICITLY asks to create/document an issue without wanting execution.

**Explicit command phrases (confidence 0.90+):**
- **link/bookmark**: "save bookmark", "save link", "bookmark this", "save this link", "zapisz link", "dodaj zakładkę", "zapisz zakładkę"
- **todo**: "create todo", "add todo", "add task", "make todo", "stwórz zadanie", "dodaj zadanie"
- **research**: "perform research", "do research", "research this", "investigate", "zbadaj", "sprawdź", "przeprowadź research"
- **note**: "create note", "save note", "make note", "write note", "stwórz notatkę", "zapisz notatkę"
- **reminder**: "set reminder", "remind me", "przypomnij mi"
- **calendar**: "schedule", "add to calendar", "book appointment", "zaplanuj", "dodaj do kalendarza"
- **linear** (EXPLICIT tracking intent - user must mention "linear", "issue", "track", or "report"): "linear issue", "linear task", "create linear", "create linear issue", "create issue", "add issue", "report issue", "report bug", "track this", "document this", "log this bug", "zgłoś błąd", "stwórz issue", "dodaj do lineara", "do lineara", "zapisz jako issue"
- **code** (DEFAULT for engineering tasks): "fix X", "implement X", "design X", "add X", "refactor X", "change X", "update X", "build X", "remove X", "improve X", "execute this", "start working on", "code this", "write the code", "make this change"

**Linear vs Code disambiguation examples:**
- "linear issue: fix the login bug" → linear (explicit "linear issue" prefix)
- "create issue for auth bug" → linear (explicit "create issue")
- "track this: mobile menu broken" → linear (explicit "track this")
- "fix the login bug" → code (engineering task, no explicit "linear"/"issue"/"track")
- "implement dark mode" → code (engineering task)
- "design new dashboard layout" → code (engineering task)
- "refactor the auth module" → code (engineering task)
- "add validation to the form" → code (engineering task)
- "change how labels are displayed" → code (engineering task)
- "execute linear issue INT-123" → code (executing a tracked issue)

Examples:
- "save bookmark https://research-world.com" → link (explicit "save bookmark" overrides "research" in URL)
- "create todo to research competitors" → todo (explicit "create todo" overrides "research" keyword)
- "perform research on todo apps" → research (explicit "perform research" overrides "todo" keyword)
- "save note about the research meeting" → note (explicit "save note" is the command)
- "research this https://example.com" → research (explicit "research this" overrides URL presence - STEP 2 > STEP 4)
- "investigate https://competitor.io/pricing" → research (explicit "investigate" overrides URL)
- "create an issue for the bug" → linear (explicit "create an issue")
- "linear task: refactor the auth module" → linear (explicit "linear task" prefix)
- "look into the performance issue" → research (investigation, NOT execution)
- "refactor the auth module" → code (engineering task, no "linear"/"issue" keyword)
- "implement the new feature" → code (engineering task)

## STEP 3: Code Detection — Default for Engineering Tasks (if no explicit intent match)
Classify as "code" when message describes engineering work to be done:
- Action verbs: fix, implement, design, add, remove, refactor, change, update, build, improve, migrate, optimize, create (when describing a feature/component, NOT an issue)
- Engineering context: bug fix, feature, component, module, service, endpoint, UI, layout, flow, logic
- Implicit task descriptions: "fix X", "implement Y", "add Z", "refactor W", "design X", "change X"

**DEFAULT TO CODE for engineering tasks.** Code actions automatically create a Linear issue for tracking.
The assumption is: describing work = wanting it done, not just documented.

Only classify as "linear" when user EXPLICITLY mentions "linear", "issue", "track", "report", or "document":
- Linear PM context: "linear issue", "linear task", "add to linear", "create linear issue", "in linear", "do lineara"
- Explicit tracking phrases: "create issue", "report bug", "track this", "log this", "document this"

EXCEPTION: "linear" in math/science context (e.g., "linear regression", "linear algebra") → NOT linear

Examples:
- "fix the authentication flow" → code (engineering task)
- "implement new dashboard" → code (engineering task)
- "design the settings page" → code (engineering task)
- "bug: mobile menu broken" → code (engineering task describing a fix)
- "create linear issue for auth" → linear (explicit "linear issue")
- "track this: API latency spike" → linear (explicit "track this")
- "report bug: login fails on Safari" → linear (explicit "report bug")
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

**code** — DEFAULT for any engineering task (fix, implement, design, add, refactor, change, build, etc.)
Signals: any engineering action verb, bug descriptions, feature descriptions, design requests
Code actions automatically create a Linear issue, so tracking is never lost.
- "fix the login bug" → code (engineering task)
- "implement dark mode" → code (engineering task)
- "design new settings page" → code (engineering task)
- "refactor the auth module" → code (engineering task)
- "change how labels display" → code (engineering task)
- "execute linear issue INT-123" → code (executing a tracked issue)

**NOT code (these are LINEAR - explicit tracking/documenting):**
- "create issue for the login bug" → linear (explicit "create issue")
- "linear task: dark mode" → linear (explicit "linear" prefix)
- "track this: auth module needs refactor" → linear (explicit "track this")

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
