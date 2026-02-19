# Linear Agent

Speak your ideas, ship your issues. Linear Agent transforms natural language into structured Linear issues with AI-powered extraction of title, priority, and detailed descriptions. It provides bidirectional sync between Linear and IntexuraOS through webhooks, full issue synchronization, issue commenting, and programmatic issue management for AI code agents.

## The Problem

Creating Linear issues from mobile requires context-switching: open the app, navigate to the right team, fill out multiple fields. When you have a quick idea during a meeting or commute, that friction means the task either gets lost or gets created with minimal detail. By the time you reach your computer, half the context is gone. Additionally, keeping local issue state in sync with Linear requires manual effort, and AI code agents need programmatic access to create and manage issues during automated workflows.

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

### AI-Powered Title Generation

When code agents create issues programmatically, the `generateIssueTitle` use case produces concise, well-formatted titles from task descriptions. The LLM classifies issue type (bug, feature, refactor, research) and generates a title under 80 characters. Retries once before returning an error to the caller — quality over silent degradation.

### Dashboard with Smart Grouping and Parent-Child Support

View your Linear issues in a 3-column layout designed for workflow visibility:

| Column   | Sections                        | Purpose                    |
| -------- | ------------------------------- | -------------------------- |
| Planning | Todo (top), Backlog (bottom)    | Work waiting to be started |
| Work     | In Progress, In Review, To Test | Active development stages  |
| Closed   | Done (last 7 days)              | Recently completed work    |

Issues automatically sort into sections based on Linear state names. Parent issues display their sub-issues nested beneath them. Labels (with colors) appear on each issue card for quick context.

**Example:** A parent issue "Implement authentication" appears in "In Progress" with its child issues ("Add OAuth provider", "Write tests") nested below.

### Fast Local-First Issue Listing

The dashboard reads from a local Firestore cache populated by webhooks and full sync — not from the Linear API at request time. This means the board loads instantly, even under poor connectivity, and handles large workspaces without rate limiting concerns.

### Issue Detail and Comments

View full issue details and comments without leaving IntexuraOS. The `GET /linear/issues/:identifier` endpoint returns issue metadata plus `commentCount` and `lastCommentAt`. The `GET /linear/issues/:identifier/comments` endpoint returns paginated comments with author names and markdown bodies.

### Webhook-Based Real-Time Sync

Linear webhooks push issue and comment changes (create, update, remove) to the agent in real time. Each webhook is validated with per-connection HMAC-SHA256 signatures and routed to the correct user based on team ID. The `syncSingleIssue` use case keeps Firestore in sync without polling.

### Full Issue Synchronization

The `fullSync` use case fetches all issues from the Linear API and reconciles them with local storage. It creates new records, updates existing ones, and deletes stale issues that no longer exist in Linear. The `fullSyncAllUsers` variant runs for all connected users (designed for Cloud Scheduler). Sync stats include created/updated/deleted counts and duration.

### Issue Validation

The `validateIssue` use case verifies that a Linear issue identifier (e.g., "INT-123") exists in the user's connected workspace and belongs to their configured team. It returns issue metadata including labels and child count, enabling AI agents to validate parent issues before creating subtasks.

### Programmatic Issue Management (Internal API)

Code agents create Linear issues and update workflow states through internal service-to-service endpoints. The `POST /internal/issues` endpoint creates issues with title and description. The `PATCH /internal/issues/:issueId/state` endpoint transitions issues between workflow states (backlog, in_progress, in_review, qa).

### Failed Issue Retry

Failed AI extractions are saved for manual review. Users can retry creation from the original text via `POST /linear/failed-issues/:id/retry`, which re-attempts the Linear API call using the user's real team ID and cleans up on success. Failed issues can also be dismissed via `DELETE /linear/failed-issues/:id`.

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

### Code Agent Workflow

An AI code agent working on a task needs to break it into subtasks:

1. Agent validates parent issue `INT-445` via `validateIssue`
2. Agent generates a title from the task description via `generateIssueTitle`
3. Agent creates a child issue via `POST /internal/issues`
4. As work progresses, agent updates state via `PATCH /internal/issues/:issueId/state`

## Key Benefits

| Benefit              | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| Zero Context Switch  | Create issues without leaving WhatsApp                        |
| Consistent Structure | AI ensures every issue has proper FR/TD sections              |
| Priority Accuracy    | Natural language maps to Linear's 5-level scale               |
| Workflow Visibility  | 3-column dashboard shows work at every stage                  |
| Parent-Child View    | Sub-issues nest under parent issues on the board              |
| Instant Dashboard    | Local-first Firestore cache — no API latency on load          |
| Issue Comments       | Read comments and last activity without leaving IntexuraOS    |
| Failure Recovery     | Invalid extractions saved for manual review and retry         |
| Duplicate Prevention | Idempotency check prevents duplicate issue creation           |
| Real-Time Sync       | Webhook integration keeps local data current                  |
| Full Sync            | Bulk reconciliation for initial setup and recovery            |
| Programmatic Access  | Internal API for code agents to manage issues                 |
| Issue Validation     | Verify issue existence and team ownership before use          |
| AI Title Generation  | LLM-powered title generation with retry-on-failure            |

## Limitations

- Requires Linear API key and team selection during initial setup
- Complex multi-issue descriptions may extract only the primary task
- Priority inference depends on explicit cues in the message
- Maximum input text length: 4000 characters
- Voice transcription quality affects extraction accuracy
- Webhook sync requires configuring webhook secret in Linear settings
- Dashboard shows Firestore-synced data; run a full sync after connecting for the first time
- `generateIssueTitle` returns an error (not a degraded title) if LLM fails after 2 attempts
- Label support in `POST /internal/issues` is accepted but not yet forwarded to Linear

---

_Part of [IntexuraOS](../overview.md) - Capture your ideas, ship your issues._
