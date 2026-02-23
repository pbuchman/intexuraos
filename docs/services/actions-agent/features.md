# Actions Agent

The dispatch center that turns every command into the right action -- and knows when to ask before acting.

## The Problem

A smart assistant that understands what you said is only half the equation. The other half is doing something about it.

Once your message has been understood -- "research question," "to-do item" -- someone still has to send it to the right place, confirm it gets done, and tell you when it is finished. In most systems, that middle layer does not exist.

The harder problem is confidence. When the system is ninety percent sure you want a research task, making you tap "approve" is busywork. When it is sixty percent sure, acting without asking is reckless. The actions agent sits between understanding and execution: routing each command to the right specialist, deciding whether to act or ask, and making sure nothing gets lost.

## Use Case: The Confident Shortcut

You send a WhatsApp message: "Research the latest developments in solid-state batteries." The system identifies this with high confidence as a research request. The actions agent skips approval. Within seconds, the research agent is working. You never tapped a button.

Now imagine: "Schedule a deep dive with engineering next Thursday." The confidence is lower -- did you mean this Thursday or next? -- so the actions agent asks first. A WhatsApp message arrives with two buttons: Approve or Reject. One tap, and it is done.

## How It Helps

### Confidence-Calibrated Autonomy

Every action arrives with a confidence score. At ninety percent or higher, the system acts immediately. Below that, it asks first via WhatsApp.

One category never auto-executes: project tracking issues. Creating an issue in your project tracker carries consequences that are difficult to reverse, so the system always asks first. The result is a system that feels fast when it should and cautious when it matters.

### One-Tap Approval

When the system asks, a WhatsApp message arrives with interactive buttons -- Approve and Reject. One tap resolves it. No typing, no app-switching.

Code tasks include a third button -- Convert to Issue -- for when the work belongs in your project tracker. The approval message shows estimated cost and time so you know what you are agreeing to. If you reply with text instead of tapping, the system resends the buttons. No language model involved, no ambiguity.

### Seven Specialists, One Dispatcher

The actions agent routes work to seven specialized services: research, to-dos, notes, bookmarks, calendar, project tracking, and engineering tasks. Each specialist knows its domain. The actions agent makes sure the right one gets the right work and tracks the result. An eighth category, reminders, is recognized but not yet connected to a service.

### Corrections That Teach

Sometimes the system gets it wrong. In the web dashboard, you change the action type with one click -- a misidentified link becomes a to-do -- and it is immediately sent to the correct specialist.

The correction does more than fix one mistake. The system records what it originally thought, what you corrected it to, the original message, and how confident it was -- building a record that future versions of the system can learn from. Every fix makes the next version smarter.

### Quiet Reliability

Actions stuck for over an hour retry automatically. Deleted or expired actions do not loop endlessly -- the system notifies you and moves on. Duplicate bookmarks are caught before creating redundant entries, letting you skip or update what already exists.

## Key Benefits

- High-confidence actions execute immediately -- no approval step, no delay
- Project tracking actions always require explicit approval
- Approve or reject with one tap; code tasks show estimated cost and time upfront
- Button taps resolve instantly -- no language model involved, no guessing
- Every correction you make is recorded, helping the system improve over time
- Actions stuck for over an hour retry automatically; deleted actions fail gracefully with a notification
- All actions visible in the web dashboard, filterable by status, and deletable

## Limitations

- **No reminder execution** -- Reminder actions are recognized but no service is connected yet; they remain pending
- **Auto-execution is absolute** -- Any action type (except project tracking) at ninety percent confidence or above executes without asking; no per-user toggle
- **WhatsApp-only notifications** -- Approval requests and status updates are delivered exclusively through WhatsApp
- **No bulk execution** -- Actions are processed individually; no way to approve or reject multiple at once
- **Button-dependent approval** -- Text replies resend the buttons rather than interpreting the message

---

_Part of [IntexuraOS](../overview.md) -- the dispatch center that knows when to act and when to ask._
