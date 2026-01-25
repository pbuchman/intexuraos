# Commands Agent

Intelligent command classification that understands user intent across languages and contexts.

## The Problem

When users send messages through WhatsApp, voice notes, or web sharing, the system must determine what they want to do. This classification challenge has several dimensions:

1. **Ambiguous phrasing** - "Remember this" could be a note, todo, or bookmark
2. **URL-embedded keywords** - "https://research-tools.com" contains "research" but the user is sharing a link
3. **Conflicting signals** - "Create todo to research competitors" contains both "todo" and "research"
4. **Multiple languages** - Polish users say "zapisz link" (save link) not "save link"
5. **Multiple channels** - WhatsApp text, voice transcriptions, and PWA share each need handling

## How It Helps

### Structured Classification Pipeline (v2.0.0)

Processes commands through a 5-step decision tree that eliminates ambiguity.

**Step 1:** Explicit prefix override - User says "linear: buy groceries" - respect the prefix

**Step 2:** Explicit intent detection - "save bookmark https://research-world.com" - the phrase "save bookmark" overrides the "research" keyword in the URL

**Step 3:** Linear detection - Engineering terms like "bug", "issue", "PR" trigger Linear classification

**Step 4:** URL presence check - Any URL strongly suggests link classification

**Step 5:** Category signals - Traditional keyword matching (calendar, reminder, research, note, todo)

**Example:** "save bookmark https://research-world.com" correctly classifies as `link` because Step 2 (explicit "save bookmark") executes before Step 4 (URL presence), and both override the misleading "research" keyword.

### URL Keyword Isolation

Keywords embedded in URLs no longer trigger incorrect classifications.

**Example:** "https://todo-app.io/notes" classifies as `link`, not `todo` or `note`. The URL is treated as an opaque token - only keywords outside URLs affect classification.

### Multi-Language Support

Native Polish command phrases receive equal treatment to English.

| English            | Polish                | Category |
| ------------------ | --------------------- | -------- |
| "save bookmark"    | "zapisz zakladke"     | link     |
| "create todo"      | "stwórz zadanie"      | todo     |
| "perform research" | "zbadaj"              | research |
| "create note"      | "stwórz notatke"      | note     |
| "set reminder"     | "przypomnij mi"       | reminder |
| "add to calendar"  | "dodaj do kalendarza" | calendar |

### Idempotent Processing

Commands identified by `{sourceType}:{externalId}` prevent duplicate processing. The same WhatsApp message processed twice returns the existing command.

### Graceful Degradation

When a user's LLM API key is unavailable, commands enter `pending_classification` status. Cloud Scheduler retries every 5 minutes.

### Robust Validation (v2.1.0)

LLM responses validated using Zod schemas to ensure type safety and catch malformed responses early.

## Use Case

You share a link via the PWA share sheet: "Check out this great tool https://research-tracker.io"

**Without v2.0.0:** Might classify as `research` (keyword in URL)

**With v2.0.0:**

1. Step 1: No explicit prefix
2. Step 2: No explicit command phrase like "save bookmark"
3. Step 3: Not engineering/Linear context
4. Step 4: URL present - classify as `link` (0.90+ confidence)

Result: Link saved to bookmarks, not queued for research.

## Key Benefits

- Accurate classification even when URLs contain misleading keywords
- Polish speakers use native phrases without translation
- Explicit commands ("save bookmark", "create todo") always respected
- Duplicate prevention across WhatsApp message retries
- No manual action type selection required
- Type-safe LLM response validation

## Limitations

**Classification models** - Requires Gemini 2.5 Flash, GLM-4.7, or GLM-4.7-Flash API access

**Reminder handler** - Classification recognizes `reminder` but actions-agent handler not yet implemented

**Language coverage** - Currently English and Polish; other languages use English keyword matching

**Confidence threshold** - Very ambiguous commands default to `note` with low confidence

**No reclassification** - Failed commands must be deleted and re-sent, not reclassified

---

_Part of [IntexuraOS](../overview.md) - Intelligent command routing for natural language input._
