# Web App

Your window into the machine — one interface for everything IntexuraOS is doing on your behalf.

## The Problem

Running software that works through tasks on its own is only useful if you can see what it is doing. Without a central interface, you are left checking multiple tools, refreshing dashboards, and hoping nothing went wrong while you were not looking. The system might be classifying your inbox, writing code, or running research — but if you cannot observe and intervene, autonomy becomes anxiety.

The deeper problem is control. Autonomous systems make decisions, and some of those decisions need human approval. If approvals are buried in notifications across different apps, things slip through. A code task finishes its planning phase and needs a green light before the system starts writing code. A research query returns results that need review. A message arrives that requires your judgment. Without a single place to act on these, you either slow the system down by missing prompts or speed it up by rubber-stamping things you did not read.

This is not a passive dashboard. The web app closes a loop: you observe what the system did, and that observation directly unblocks what it does next. Your attention is not optional — it is the mechanism that keeps autonomous work moving safely.

## Use Case: A Morning of Agent Oversight

You wake up and open the web app on your phone — it is installed as a standalone app, no browser chrome, just your system. Overnight, the agents processed twelve commands from your inbox. Three turned into action items waiting for your approval. One kicked off a code task that finished its design phase — the plan is sitting there, ready for you to read and greenlight. A research report on competitor pricing came back with four sources. Your calendar shows two meetings today, and a Linear issue you filed yesterday already has sub-issues broken out by the planning agent.

You approve two actions, reject one that misread your intent, read the code task plan and tap to start execution. While you eat breakfast, the log stream shows the code agent working — cyan lines for your original request, blue lines as it writes files, yellow flashes when it runs tools. You scroll up to check something, and the stream pauses so you do not lose your place. When you scroll back to the bottom, it catches up automatically.

By the time you sit down at your desk, half your morning work is already done. You did not write a single line of code or open a single email. You just watched, approved, and moved on.

## How It Helps

### Watch Code Being Written in Real Time

You send a coding request and switch to the code tasks view. The log stream starts immediately — every action the code agent takes appears as a color-coded line. Your original input shows in cyan. When the agent queues work, amber lines appear. Tool invocations flash yellow. Errors — if they happen — show in red, so you spot problems the moment they occur rather than discovering them after the task finishes.

The stream follows the agent's output in real time. If you scroll up to re-read an earlier section, auto-scroll pauses and stays where you put it. Scroll back to the bottom, and follow mode re-engages. A live indicator pulses while the task runs, and a line count tells you how much output has accumulated. When you need to share the full log with someone, one button copies every line to your clipboard.

**Example:** Your code agent is halfway through implementing a new API endpoint. You notice in the log stream that it is creating a file in the wrong directory — a yellow tool line shows the path. You type a follow-up message directly into the task. The message queues without interrupting the agent's current work, and within seconds you see it pick up your correction and adjust course. No restart, no lost progress.

### Approve a Plan Before the System Writes Code

Code tasks run in two phases, and you control the gate between them. The design phase produces a plan — what the agent intends to build, which files it will touch, what approach it will take. That plan lands in your web app as a reviewable document. Nothing happens until you approve it.

Once you approve, the execution phase begins. The web app links the two phases together with color-coded banners — on the execution task, a violet banner links back to the design; on the design task, an emerald banner links forward to the implementation. You can navigate between them to compare what was planned against what was built. When the execution finishes, GitHub pull request events appear inline, with expandable details and clickable links straight to the code.

**Example:** You ask the system to refactor your authentication module. The design phase comes back with a plan that proposes changing three files and adding a new utility. You read it, notice it missed an edge case in token refresh, and type that feedback as a follow-up. The agent revises the plan. You approve the updated version, and execution begins. Twenty minutes later, the PR events show up — you expand them, read the review comments and activity, and click through to GitHub to merge.

### Track GitHub Activity with an Event Decision Log

Every GitHub event that passes through the system — pull request reviews, webhook decisions, CI results — appears in the PR Events page. The GitHub event decision log shows which events triggered agent decisions, what the decision was, and whether it is still pending. You filter by decision status, search by repository or PR number, and see a live connection indicator so you know whether the event stream is healthy.

**Example:** A pull request you opened yesterday had three review events. You open the PR Events page, filter to pending decisions, and see one event that the system has not acted on yet. You expand it to read the event details and decide whether to nudge the agent or wait.

### Act on Everything From One Inbox

Commands and actions flow into a single inbox. Commands are things the system received — messages, requests, inputs from various channels. Actions are things the system wants to do about them. Some actions just need your awareness. Others need your explicit approval before the system proceeds.

Each action item shows configurable buttons — approve, reject, or whatever responses the originating service defined. You do not need to context-switch to another app or remember which service generated the request. The inbox is the one place where human judgment enters the loop.

**Example:** You sent a WhatsApp message last night saying "cancel my dentist appointment and reschedule for next week." The system classified it, created an action item, and is waiting. You open the inbox this morning, see the proposed calendar changes, tap approve, and the system handles the rest — cancellation message, new appointment request, calendar update. One tap, three operations.

### Track Your Projects as They Move

The Linear integration presents your issues in grouped columns — Planning, In Progress, and Recently Closed — with sub-statuses nested within each. Sub-issues nest under their parents, so you see the full breakdown of a project without opening Linear separately. Labels show in their assigned colors. The board refreshes periodically, so changes appear shortly after they happen.

**Example:** You filed an issue for a new feature last week. The planning agent broke it into four sub-issues overnight. You open the Linear board in the web app and see all four nested under the parent, each with status labels. One is already In Progress — the code agent picked it up. You tap into it, see the linked code task, and jump to the log stream to watch the work happening.

### Review Research and Visualize Data

Research tasks return structured reports with sources, summaries, and findings. The web app shows them in a list view, and you can drill into any report to read the full analysis. Data insights sit alongside — combined views that pull together information from multiple sources into a single feed, saved visualizations you have configured, and static data sources you have uploaded for reference.

**Example:** You asked the system to research pricing models for a competitor. The report comes back with four sources, a summary table, and a recommendation section. You read it, decide you want deeper analysis on one point, and send a follow-up research request. The new report lands in the same list, and you compare the two side by side.

### Configure Your AI Workers

The Worker Configuration page lets you register, test, and manage the code execution workers that run agent tasks. Each worker requires Cloudflare Access credentials and an orchestrator secret. You can reorder workers to set priority, test connectivity with a live check, and set a default review worker type per your preferences — choosing which AI model handles review tasks by default. Up to two workers can be registered at a time.

**Example:** You have two workers registered — one running Opus for complex tasks and one running Sonnet for speed. You set Sonnet as your default review worker type so that quick review passes happen faster without consuming Opus capacity for your main implementation tasks.

### Everything Else in One Place

Calendar events show your schedule. Todos and notes capture your running lists and scratch thoughts. Bookmarks save things you want to return to, with real-time sync so additions from other parts of the system appear immediately. Mobile notification history shows what the system pushed to your phone, so you can trace back anything you dismissed. Settings pages let you configure every connected service — WhatsApp, Notion, Google Calendar, Linear webhooks, mobile notifications, worker processes, API keys, LLM pricing, usage costs, and share history.

A floating chat assistant is available on every page. It connects to an AI assistant that can answer questions and create commands on your behalf — the same commands that flow through the inbox for processing. If someone visits without an account, the chat still works in guest mode — useful for sharing a link with a colleague who wants to ask a quick question.

**Example:** You are on the calendar page reviewing tomorrow's meetings. You remember you need to add a note about preparation for one of them. You tap into notes, write it, and switch to bookmarks to check a link you saved last week. No app-switching, no separate logins — it is all one surface.

### Install Once, Check From Anywhere

The web app is a Progressive Web App. On Android and iOS, you install it to your home screen and it runs in standalone mode — no browser bar, no tabs, just the app. It auto-updates silently, and the shell loads even when your connection drops momentarily. The share target integration means you can share a link or text from any app on your phone directly into IntexuraOS, the same way you would share to Messages or Email.

**Example:** You are reading an article on your phone and spot a competitor announcement worth tracking. You hit the share button, select IntexuraOS from the share sheet, and the link flows into the system as a command in your inbox — ready for the system to process. No manual copy-paste required.

## Getting Started

Install the web app from your browser — on mobile, use "Add to Home Screen." Sign in with your account, or start a guest chat session without one. The inbox shows what has accumulated since your last visit. Code tasks, research reports, calendar events, and Linear issues are each one tap away.

## Key Benefits

- **One screen for autonomous operations** — every agent's work surfaces in a single interface, so you stop checking five different tools
- **Approval without context-switching** — action items, code task gates, and research reviews all happen in the same app you are already looking at
- **Real-time visibility into code generation** — color-coded log streams show exactly what the agent is doing, not a summary after the fact
- **Phone-native experience** — install it to your home screen, share content from any app, and the shell loads even offline — the system is always one tap away
- **Control without friction** — follow-up messages, approval buttons, and phase gates give you authority over the system's next move without slowing it down
- **GitHub event transparency** — the decision log shows every webhook event and its outcome, so nothing disappears silently into the system

## Limitations

- **Offline loads the shell, not live data** — the app opens without a connection, but everything meaningful requires network access
- **Real-time updates need an active connection** — if your connection drops, updates pause until it reconnects
- **Guest access is limited to the chat assistant** — inbox, code tasks, and other views require a full account
- **Share target requires installation** — sending content from other apps only works when the PWA is installed to your home screen
- **Some settings assume familiarity** — pages like webhook configuration and worker setup have no guided wizard yet
- **Maximum two workers** — the worker configuration page supports up to two registered workers at a time

---

_Part of [IntexuraOS](../overview.md) — Your window into the machine._
