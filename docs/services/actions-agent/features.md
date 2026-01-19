# Actions Agent

Turn natural language commands into structured actions that get executed across your IntexuraOS workspace.

## The Problem

You send commands to your AI assistant through WhatsApp, web, or other interfaces. The system needs to:

1. **Understand what you want** - Classify your command into a specific action type (todo, research, note, link, calendar, linear, reminder)
2. **Track the action lifecycle** - Move actions from pending to processing to completed
3. **Route to the right service** - Send research actions to research-agent, todos to todos-agent, linear to linear-agent, etc.
4. **Handle failures gracefully** - Retry stuck actions, allow manual correction

## How It Helps

Actions-agent is the **central coordinator** for all user-initiated actions in IntexuraOS. When you send a command like "research quantum computing" or "remind me to call Mom tomorrow":

1. **commands-agent** classifies your command and publishes an event
2. **actions-agent** receives the event, creates an Action record, and publishes `action.created`
3. The appropriate handler (research, todo, note, link) picks up the event
4. The handler calls the target service (research-agent, todos-agent, etc.)
5. Actions-agent updates the action status and sends you a WhatsApp notification

## Use Cases

### Research Actions

- "Research the latest developments in AI safety"
- "Find information about climate change solutions"
- Action flows: pending -> processing -> completed (with research URL)

### Todo Actions

- "Remind me to review the quarterly report"
- "Add a todo to call the dentist"
- Action flows: pending -> processing -> completed (todo created)

### Note Actions

- "Take a note: meeting recap with design team"
- "Remember: the client prefers blue over green"
- Action flows: pending -> processing -> completed (note created)

### Link Actions

- "Save this article: https://example.com/interesting-read"
- "Bookmark this for later"
- Action flows: pending -> processing -> completed (bookmark created, with OG metadata)
- **Auto-executed** when confidence >= 90% (no manual approval needed)

### Calendar Actions

- "Schedule a meeting with John tomorrow at 3pm"
- "Add event: Team standup every Monday 9am"
- Action flows: pending -> awaiting_approval -> processing -> completed

### Linear Actions

- "Create a Linear issue for the login bug"
- "Add task to Linear: implement dark mode"
- Action flows: pending -> awaiting_approval -> processing -> completed (Linear issue created)

### User Correction Workflow

When classification is wrong:

1. User sees action in web UI with wrong type
2. User changes type (e.g., "link" -> "todo")
3. Action is re-routed to correct handler
4. System learns from correction for future classifications

## Key Benefits

**Centralized visibility** - All your actions in one place, filterable by status

**Reliable execution** - Automatic retry of stuck actions via Cloud Scheduler

**User control** - Approve, reject, or correct actions before execution

**Duplicate handling** - Smart conflict resolution for existing bookmarks

**Progressive enhancement** - New action types can be added without modifying core routing logic

## Limitations

**No reminder handler** - The reminder action type is defined but has no handler (action stays in pending)

**Link actions auto-execute** - Link actions with >= 90% confidence auto-execute immediately; all other action types require manual approval

**WhatsApp-only notifications** - Success/failure notifications currently only sent via WhatsApp

**No bulk actions** - Actions are executed individually; batch execution is not supported
