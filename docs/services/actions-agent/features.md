# Actions Agent

Turn natural language commands into structured actions that get executed across your IntexuraOS workspace.

## The Problem

You send commands to your AI assistant through WhatsApp, web, or other interfaces. The system needs to:

1. **Understand what you want** - Classify your command into a specific action type (todo, research, note, link, calendar, linear, reminder, code)
2. **Track the action lifecycle** - Move actions from pending to processing to completed
3. **Route to the right service** - Send research actions to research-agent, todos to todos-agent, linear to linear-agent, etc.
4. **Handle failures gracefully** - Retry stuck actions, allow manual correction
5. **Get your approval via WhatsApp** - Approve or reject actions by tapping interactive buttons

## How It Helps

Actions-agent is the **central coordinator** for all user-initiated actions in IntexuraOS. When you send a command like "research quantum computing" or "remind me to call Mom tomorrow":

1. **commands-agent** classifies your command and publishes an event
2. **actions-agent** receives the event, creates an Action record, and publishes `action.created`
3. The appropriate handler (research, todo, note, link) picks up the event
4. The handler sends you a WhatsApp notification with interactive **Approve** and **Reject** buttons
5. You tap the button in WhatsApp
6. Upon approval, the target service (research-agent, todos-agent, etc.) executes the action directly
7. Actions-agent updates the action status and sends you a completion notification

## Key Features

### WhatsApp Interactive Button Approval (v2.0.0, unified in v4.0.0)

Approve or reject actions by tapping interactive buttons in WhatsApp — no typing required:

- Tap **Approve** to approve any action
- Tap **Reject** (or **Cancel**) to reject
- Code actions get an extra **Convert to Issue** button
- Text replies re-send fresh buttons (no LLM, no guessing)
- Deterministic, instant intent resolution — no API calls needed

### Atomic Status Transitions

Firestore transactions prevent race conditions when multiple systems try to update the same action simultaneously. This ensures:

- No duplicate WhatsApp notifications
- No double-execution of actions
- Consistent state even with concurrent Pub/Sub messages

### Event-Driven Architecture

After WhatsApp approval, actions-agent executes actions directly or publishes `action.created` events to trigger downstream processing:

- Research requests go to research-agent
- Todo items go to todos-agent
- Notes go to notes-agent
- Links go to bookmarks-agent
- Calendar events go to calendar-agent
- Linear issues go to linear-agent
- Code tasks go to code-agent

## Use Cases

### Research Actions

- "Research the latest developments in AI safety"
- "Find information about climate change solutions"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed (with research URL)

### Todo Actions

- "Remind me to review the quarterly report"
- "Add a todo to call the dentist"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed (todo created)

### Note Actions

- "Take a note: meeting recap with design team"
- "Remember: the client prefers blue over green"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed (note created)

### Link Actions

- "Save this article: https://example.com/interesting-read"
- "Bookmark this for later"
- Action flows: pending -> processing -> completed (bookmark created, with OG metadata)
- **Auto-executed** when confidence >= 90% (no manual approval needed)

### Calendar Actions

- "Schedule a meeting with John tomorrow at 3pm"
- "Add event: Team standup every Monday 9am"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed

### Linear Actions

- "Create a Linear issue for the login bug"
- "Add task to Linear: implement dark mode"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed (Linear issue created)

### Code Actions

- "Fix the authentication bug in the login module"
- "Implement dark mode for the settings page"
- Action flows: pending -> awaiting_approval -> (WhatsApp button tap) -> processing -> completed (code task dispatched)
- Approval message shows estimated cost ($1-2) and time (30-60 min)
- Supports three WhatsApp buttons: **Approve**, **Reject**, **Convert to Issue**
- Running code tasks can be cancelled via a **Cancel Task** button on status messages

### User Correction Workflow

When classification is wrong:

1. User sees action in web UI with wrong type
2. User changes type (e.g., "link" -> "todo")
3. Action is re-routed to correct handler
4. System learns from correction for future classifications

## Key Benefits

**WhatsApp-first approval** - Approve actions with one tap, no typing required

**Deterministic intent** - Button taps resolve instantly, no AI API calls on the approval path

**Race condition safety** - Atomic Firestore transactions prevent duplicate processing

**Centralized visibility** - All your actions in one place, filterable by status

**Reliable execution** - Automatic retry of stuck actions via Cloud Scheduler

**User control** - Approve, reject, or correct actions before execution

**Duplicate handling** - Smart conflict resolution for existing bookmarks

**Progressive enhancement** - New action types can be added without modifying core routing logic

**Interactive approval buttons** - All action types use unified WhatsApp interactive buttons (v4.0.0)

**Graceful deletion handling** - Deleted/expired actions return a clear WhatsApp notification instead of retrying forever

## Limitations

**No reminder handler** - The reminder action type is defined but has no handler (action stays in pending)

**Link actions auto-execute** - Link actions with >= 90% confidence auto-execute immediately; all other action types require manual approval

**WhatsApp-only notifications** - Success/failure notifications currently only sent via WhatsApp

**No bulk actions** - Actions are executed individually; batch execution is not supported

**WhatsApp interactive buttons required** - Approval relies on interactive button support; if a client doesn't support buttons, text replies re-send fresh buttons
