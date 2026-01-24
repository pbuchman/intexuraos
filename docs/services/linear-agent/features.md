# Linear Agent

Speak your ideas, ship your issues. Linear Agent transforms natural language into structured Linear issues with AI-powered extraction of title, priority, and detailed descriptions.

## The Problem

Creating Linear issues from mobile requires context-switching: open the app, navigate to the right team, fill out multiple fields. When you have a quick idea during a meeting or commute, that friction means the task either gets lost or gets created with minimal detail. By the time you reach your computer, half the context is gone.

## How It Helps

### Voice-to-Issue Pipeline

Speak naturally about what needs to be done. Linear Agent uses Gemini 2.5 Flash or GLM-4.7 to extract structured issue data from your voice notes.

**Example:** Driving to work, you remember a bug. Send a voice note: "The login button on iOS isn't responding to taps." The system creates a properly formatted issue with title, priority, and technical context.

### Intelligent Priority Detection

Linear Agent understands urgency from context. Words like "urgent," "blocker," "when you have time," and "nice to have" map to Linear's 5-level priority scale automatically.

**Example:** "URGENT - Production is down, API gateway returning 502 errors" becomes Priority 1 (Urgent). "When you have time, add dark mode" becomes Priority 4 (Low).

### Structured Descriptions

AI generates proper issue structure with Functional Requirements and Technical Details sections. Your stream-of-consciousness voice note becomes a well-organized specification.

**Example:** A rambling 2-minute voice note about authentication becomes:

- Clear title: "Implement OAuth login with Google and GitHub"
- FR section: User flow requirements
- TD section: Implementation hints (passport.js, token handling)

### Dashboard with Smart Grouping

View your Linear issues in a 3-column layout designed for workflow visibility:

| Column   | Sections                        | Purpose                    |
| -------- | ------------------------------- | -------------------------- |
| Planning | Todo (top), Backlog (bottom)    | Work waiting to be started |
| Work     | In Progress, In Review, To Test | Active development stages  |
| Closed   | Done (last 7 days)              | Recently completed work    |

**Example:** Issues automatically sort into sections based on Linear state names. "In Review" and "Code Review" go to the review section. "QA" and "Testing" go to the test section.

### Idempotent Processing

Send the same message twice? No duplicate issues. Linear Agent tracks processed actions and returns the existing issue URL instead of creating duplicates.

**Example:** Network hiccup causes a retry. Instead of two identical issues, you get the same issue link both times.

## Use Cases

### Quick Bug Report

Voice note: "I found a bug where the submit button doesn't work on Firefox when the form has validation errors"

Result:

- **Title:** Fix submit button failure on Firefox with validation errors
- **Priority:** Normal (3)
- **Functional Requirements:** Submit button must function correctly on Firefox browsers when form validation errors are present
- **Technical Details:** Investigate Firefox-specific event handling, check form validation state management

### Urgent Production Issue

Voice note: "URGENT - Database connection pool is exhausted, users seeing 500 errors on all API calls"

Result:

- **Title:** Production: Database connection pool exhaustion causing 500 errors
- **Priority:** Urgent (1)
- **Description:** Detailed incident context with auto-generated timestamps

### Feature Idea

Voice note: "It would be nice to have keyboard shortcuts for common actions, maybe ctrl+enter to submit forms"

Result:

- **Title:** Add keyboard shortcuts for common form actions
- **Priority:** Low (4)
- **Functional Requirements:** Support Ctrl+Enter to submit forms, document all shortcuts

## Key Benefits

| Benefit              | Description                                         |
| -------------------- | --------------------------------------------------- |
| Zero Context Switch  | Create issues without leaving WhatsApp              |
| Consistent Structure | AI ensures every issue has proper FR/TD sections    |
| Priority Accuracy    | Natural language maps to Linear's 5-level scale     |
| Workflow Visibility  | 3-column dashboard shows work at every stage        |
| Failure Recovery     | Invalid extractions saved for manual review         |
| Duplicate Prevention | Idempotency check prevents duplicate issue creation |

## Limitations

- Requires Linear API key and team selection during initial setup
- Complex multi-issue descriptions may extract only the primary task
- Priority inference depends on explicit cues in the message
- Maximum input text length: 4000 characters
- Voice transcription quality affects extraction accuracy

---

_Part of [IntexuraOS](../overview.md) - Capture your ideas, ship your issues._
