# Actions Agent

The dispatch center that turns every command into the right action — and knows when to ask before acting.

## The Problem

Understanding what someone said is the easy part. The hard part is doing something about it — reliably, quickly, and with the right amount of caution.

Most assistant systems stop at comprehension. They parse your message, classify your intent, and then hand you a menu of options. The gap between understanding and execution remains your problem. You still have to confirm, route, and track every task yourself. The assistant understood you perfectly and then did nothing.

The deeper issue is judgment. When a system is ninety percent sure you want a research task, making you tap "approve" is busywork that trains you to ignore it. When the system is sixty percent sure, acting without asking is reckless. Most tools pick one posture — always ask or always act — and neither is right. What you need is a dispatcher that reads the confidence of every classification, routes each command to the right specialist, decides whether to act or ask, and makes sure nothing falls through the cracks. And when it gets the call wrong, it should learn from the correction — so every mistake makes the next decision better.

## Use Case: From Message to Result in Seconds

You are a founder who lives in WhatsApp and sends half a dozen requests a day.

1. You send a message: "Research the latest developments in solid-state batteries." The system classifies this as a research request with high confidence. The actions agent skips approval entirely and dispatches the work to the research agent. Within seconds, research is underway. You never tapped a button.

2. Minutes later, you send: "Add a task to fix the onboarding flow." Confidence is high again. The actions agent routes it straight to the to-dos agent. Done.

3. Then: "Create an issue to redesign the onboarding metrics dashboard." This one is different. Project tracking actions always require your approval — an accidental issue in your tracker affects your team. A WhatsApp message arrives with two buttons: Approve and Reject. One tap, and the project tracking agent takes over.

4. You send: "Schedule a team standup tomorrow at 9am for 30 minutes." The system classifies this as a calendar action with high confidence. It auto-executes, creates the event in Google Calendar, and sends you a rich WhatsApp notification showing the event title, date, time, and duration — with a direct "View in Calendar" link that opens right in Google Calendar.

5. Later, you send: "Fix the authentication bug in the login module." The system recognizes this as a code task. A WhatsApp message arrives showing estimated cost and time, with three buttons: Approve, Reject, and Convert to Issue. You tap Approve. The code agent starts working. When the task reaches the design phase, you receive a new message with a "Proceed to Implementation" button to greenlight the next stage.

6. You open the web dashboard and notice an action that was classified as a note but should have been a to-do. You change the type with one click. The system immediately routes it to the correct specialist — and quietly records the correction so future classifications improve.

7. That evening, you check the dashboard. Every action from the day is visible, filterable by status, and accounted for. Nothing was lost.

## How It Helps

### Route Every Command to the Right Specialist

The actions agent dispatches work to seven specialized services: research, to-dos, notes, bookmarks, calendar, project tracking, and engineering tasks. Each specialist is purpose-built for its domain. You do not choose which service handles your request — the dispatcher reads the classification, picks the right one, and tracks the result.

An eighth category — reminders — is recognized by the system but not yet connected to a specialist. Reminder actions stay in a pending state until the service is built.

**Example:** You send "Save this article on battery recycling" and the actions agent routes it to the bookmarks agent. If that URL is already saved, the system catches the duplicate and asks whether you want to skip or update the existing bookmark — no redundant entries, no silent overwrites.

### Decide When to Act and When to Ask

Every action arrives with a confidence score from the classification step. At ninety percent or above, the actions agent executes immediately — no approval step, no delay. Below that threshold, it pauses and asks you first.

One category overrides this rule entirely. Project tracking issues always require explicit approval, regardless of confidence. An accidental issue in your project tracker creates real consequences for other people, so the system never assumes.

**Example:** "Draft a research brief on EU carbon tariffs" arrives at ninety-three percent confidence. The research agent starts working before you finish reading your next message. But "Create a ticket to refactor the auth module" — a project tracking action — waits for your approval even at ninety-nine percent confidence, because creating issues in your project tracker affects your team.

### Approve with One Tap, Not a Conversation

When the system asks for approval, a WhatsApp message arrives with interactive buttons: Approve and Reject. One tap resolves it. No typing, no app-switching, no back-and-forth.

Engineering tasks include a third button — Convert to Issue — for when the work belongs in your project tracker instead. The approval message for code actions also shows estimated cost and time, so you know what you are agreeing to before you tap.

Calendar actions include a rich preview in the approval message — the event title, date, time, duration, and location — so you can verify the details before approving.

If you reply with text instead of tapping a button, the system resends the buttons. There is no language model interpreting your reply, no ambiguity, no misread "yes" or "sure." Approval is a binary decision delivered through a binary interface.

**Example:** A code action arrives for approval. The message reads: estimated cost, estimated time, and three buttons — Approve, Reject, Convert to Issue. You glance at the estimate, tap Approve, and move on. The entire interaction takes two seconds.

### Get Rich Notifications When Work Completes

When an action finishes, you receive a detailed WhatsApp notification — not just "task completed" but a message tailored to the action type.

Calendar events show the event title, date, time, duration, and location in a formatted message, with a "View in Calendar" button that opens the event directly in Google Calendar. Code tasks show the task ID and a link to the code task detail page. Research, to-dos, notes, and bookmarks each include a link to the created resource.

**Example:** You approved a calendar event for "Team Standup" tomorrow at 9 AM. When it completes, you receive a WhatsApp message showing the event title in bold, the date and time, the 30-minute duration, and a tappable "View in Calendar" button that opens Google Calendar.

### Control Multi-Phase Work from WhatsApp

Engineering tasks operate in phases. After the initial approval dispatches the task, the code agent works through design and implementation stages. At each transition point, you receive a WhatsApp notification with buttons to proceed, cancel, or view the task.

When a code task completes its design phase, a "Proceed to Implementation" button arrives. One tap starts the next stage. If something goes wrong or you change your mind, a "Cancel Task" button uses a one-time security token to safely terminate the running task.

**Example:** You approved a code task to fix a bug. The code agent finishes designing the solution and sends you a "Proceed to Implementation" button. You tap it, and the implementation begins. Twenty minutes later, you receive a completion notification with a link to the created PR.

### Turn Every Correction into Training Data

Sometimes the system misclassifies a command. In the web dashboard, you change the action type — a misidentified link becomes a to-do — and the system immediately dispatches it to the correct specialist.

But the correction does more than fix one mistake. The system records the correction — what it originally classified the action as, what you changed it to, and when — as training data. Every correction builds a record that future versions of the classification system can learn from. Real corrections from real usage are the most valuable signal for improving accuracy over time.

**Example:** You notice "Summarize the Q3 board deck" was classified as a note instead of a research task. You change the type in the dashboard. The research agent picks it up immediately. Meanwhile, the system stores the correction — original type: note, corrected type: research — as a data point for improving future classifications.

### Recover Quietly from Edge Cases

Actions stuck in a pending state retry automatically on a schedule. You do not need to notice, escalate, or re-send anything. If you tap an approval button on an action that has already been deleted, the system handles it gracefully — it notifies you via WhatsApp that the action no longer exists. No zombie tasks, no silent failures, no error messages that require your intervention.

**Example:** You approve an action, but the specialist service is momentarily unavailable. The action stays in a pending state. The system retries it automatically on a schedule. You never knew there was a problem.

## Getting Started

Every message you send through IntexuraOS is already routed through the actions agent. Open the web dashboard to see your actions, filter by status, change types when the classification is wrong, and watch the system get smarter with every correction.

## Key Benefits

- **Instant execution for high-confidence actions** — At ninety percent confidence or above, actions execute immediately with no approval step and no delay
- **Mandatory approval where mistakes are costly** — Project tracking issues always ask first, regardless of confidence
- **One-tap approval via WhatsApp** — Approve or Reject with a single button tap; code actions show estimated cost and time upfront
- **Rich WhatsApp notifications** — Calendar completions show event details with a "View in Calendar" button; each action type delivers context-specific completion messages
- **Multi-phase engineering task control** — Approve, proceed to implementation, cancel, or view code tasks at each stage from WhatsApp
- **Seven specialized agents, one dispatcher** — Research, to-dos, notes, bookmarks, calendar, project tracking, and engineering tasks each have a dedicated service
- **Corrections that compound** — Every type change you make in the dashboard is stored as training data, improving future classification accuracy
- **Automatic retry and graceful cleanup** — Stuck actions retry on a schedule; deleted actions notify you and clean up without intervention

## Limitations

- **No reminder execution** — Reminder actions are recognized but no specialist service is connected yet; they remain pending indefinitely
- **No per-user confidence threshold** — Auto-execution triggers at ninety percent for all users; you cannot raise or lower the threshold for your account
- **WhatsApp-only approval** — Approval requests and status updates are delivered exclusively through WhatsApp; no email, SMS, or in-app notification alternative
- **No bulk approval via WhatsApp** — Actions are approved or rejected individually through WhatsApp buttons; there is no way to approve multiple actions at once
- **Button-only approval** — Text replies to approval messages resend the buttons rather than interpreting the reply; approval requires tapping, not typing

---

_Part of [IntexuraOS](../overview.md) — the dispatch center that knows when to act and when to ask._
