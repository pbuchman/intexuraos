# Todos Agent

Your tasks, structured automatically. Say what needs doing, and todos-agent breaks it into items with priorities and deadlines -- native task management that lives inside the platform, and a future bridge to whatever task system you already use.

## The Problem

Most task management starts the same way: you think of something that needs doing, open an app, create a task, set a priority, add a due date, break it into subtasks. By the time you have finished organizing the work, you have spent more energy on the system than on the actual thinking. Worse, half the tasks that occur to you never make it into the system at all -- because the friction of capture is higher than the urgency of the thought.

The irony of productivity tools is that they demand productivity to maintain. You end up managing your task manager instead of managing your work. And if you use IntexuraOS for research, coding, and scheduling, your tasks live somewhere else entirely -- disconnected from the platform that already understands your projects, your conversations, and your priorities.

## Use Case: Quick Capture, Instant Structure

You are between meetings when a project suddenly crystallizes into next steps. You send a single message: "Launch prep: finalize pricing page copy by Thursday, send beta invites to the waitlist, schedule the demo walkthrough for next Monday, and order branded swag -- that one's low priority."

Within seconds, todos-agent creates a single todo with four structured items. Each one has a title pulled from your natural language. The pricing page copy gets a Thursday deadline. The demo walkthrough lands on Monday. The swag order is tagged low priority. You did not fill out a single form. You described your work the way you would tell a colleague, and the system handled the rest.

When you open your dashboard later, everything is already organized: items listed, priorities assigned, due dates set. You start checking things off.

## How It Helps

### AI-Powered Extraction

This is what separates todos-agent from a basic checklist app. Describe your work in plain language -- a paragraph, a bullet list, a stream of consciousness -- and the service's language model parses it into discrete, actionable items. Each extracted item gets its own title, priority level, and due date when one is mentioned or implied.

The extraction uses your own configured API key, which means the model responds in the context of your account and preferences. If extraction fails for any reason -- a missing key, an ambiguous description -- the system still creates your todo and flags what it could not parse, so nothing is lost.

**Example:** You send "Prepare board deck: pull Q3 revenue numbers, draft the narrative section, get design to polish the slides by Friday, and schedule a dry run with the team." Four items appear, each with a clear title. The design task gets a Friday deadline. The rest await your prioritization.

### Priority and Filtering

Four priority levels -- low, medium, high, and urgent -- apply to both the todo itself and each individual item within it. When your list grows, filter by priority, status, tags, or archived state to surface exactly what matters right now. Tags let you group related todos across projects without rigid folder structures.

### Tasks That Arrive Without You Creating Them

Other agents in the system can create todos on your behalf. A research session surfaces a follow-up action -- the research agent files it as a todo. A voice command mentions a next step -- the actions agent routes it here. You do not need to be "using the task manager" for tasks to appear in it. The more you use IntexuraOS, the more your task list reflects what actually needs doing -- even the things you would have forgotten to write down.

This is the difference between a standalone task app and one embedded in a platform. A standalone app only knows what you tell it. Todos-agent knows what every other agent tells it, too.

### Lifecycle Without the Overhead

Todos move through a natural progression: created, processed by AI, ready to work, in progress, completed. You can also cancel a todo that is no longer relevant and archive anything you have finished -- clearing your active view without losing the record. Unarchive if you need it back.

The mechanics stay out of your way. You focus on doing the work. The system tracks where things stand.

### Automatic Status Tracking

Complete all the items in a todo and the todo itself marks as completed -- no extra step required. Complete some items and the todo transitions to in-progress. Add a new item to a completed todo and it reopens automatically. The status always reflects reality without you having to manage it.

## Key Benefits

- **Capture in seconds** -- Describe tasks in natural language from WhatsApp or the web dashboard; AI handles the structuring
- **Automatic decomposition** -- A single description becomes a prioritized checklist with deadlines, no manual entry required
- **Flexible filtering** -- Narrow your view by priority, status, tags, or archive state to focus on what matters now
- **Tasks from every channel** -- Other agents create todos on your behalf -- a research finding, a follow-up from a voice command, a next step from a coding session -- so your task list fills even when you are not actively capturing
- **Native to the platform** -- Your tasks live alongside your research, code, and calendar inside IntexuraOS, not in a disconnected third-party app
- **Smart status** -- Todo status automatically reflects item completion state, removing a layer of manual bookkeeping

## Limitations

- **No recurring tasks** -- Repeating tasks must be created each time
- **No task dependencies** -- Items within a todo are independent; completing one does not trigger the next
- **No reminders or notifications** -- The service does not proactively alert you about approaching deadlines
- **No collaboration** -- Todos are single-user; no sharing or assignment to others
- **One level of depth** -- Todos contain items, but items cannot contain sub-items

---

_Part of [IntexuraOS](../overview.md) -- Native task management that thinks with you._
