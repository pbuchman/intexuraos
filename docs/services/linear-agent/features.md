# Linear Agent

Speak your ideas, ship your issues. Turn voice notes and quick thoughts into structured, prioritized Linear issues — with AI that understands urgency and keeps your board loaded before you blink.

## The Problem

You are in a meeting when a bug crosses your mind. You could open Linear, navigate to the right board, type a title, pick a priority, write a description. By the time you finish, you have missed three minutes of conversation and the issue says "fix login thing" with no detail.

The real cost is not the typing. It is the tradeoff: capture the thought carefully, or stay present. Most people choose presence, and the thought disappears. The ones who do capture it end up with a graveyard of one-line issues that need a follow-up conversation before anyone can act on them.

Then there is the board itself. Every time you check in on your team's work, you wait for Linear's servers to respond. Open the dashboard, stare at a loading spinner, scan for updates, close the tab. Do that ten times a day and you have donated minutes to waiting — minutes that feel like nothing individually but compound into a tax on your attention. Eventually you stop checking, and a board nobody checks is a board nobody trusts.

## Use Case: The Voice Note That Becomes a Specification

A product lead driving home from a client demo. She noticed the onboarding flow broke for users who skipped the company name field.

1. She holds the record button on WhatsApp and says: "The onboarding wizard crashes when a user skips the company name on step two. This is high priority — we have a demo next Tuesday. The form should just let people skip that field and keep going."

2. She sends the voice note. IntexuraOS transcribes it and routes it — through its message routing layer — to the Linear Agent, which parses her stream of consciousness into structured parts: a title under 100 characters ("Onboarding wizard crashes when company name is skipped"), a priority (High — she said "high priority"), functional requirements describing what should happen ("Form should treat company name as optional and allow users to proceed past step two"), and technical details describing how an engineer might fix it ("Update validation to make company name optional; add fallback when the field is empty").

3. A Linear issue appears on her board, properly prioritized, with a description split into sections her engineering team can act on without asking clarifying questions. She never left the road.

4. Later that evening she opens the IntexuraOS dashboard — the web app where she manages everything. Her board loads instantly — no waiting for Linear's servers — and she sees the new issue sitting in the backlog alongside everything else her team is working on, sorted by most recently updated. She taps into the issue, reads the full description, scrolls through two comments her tech lead already left, and closes the tab. Total time from thought to follow-up: under a minute.

## How It Helps

### Turn Spoken Thoughts into Structured Issues

Say what is on your mind and let AI do the formatting. The Linear Agent takes natural language — a rambling voice note, a quick typed message, a half-formed idea — and extracts a structured Linear issue from it. The title stays under 100 characters. The description splits into two sections: Functional Requirements (what should happen) and Technical Details (how it might be built). You get an issue your team can pick up and work on, not a sticky note they need to decode.

The AI supports multilingual input — English and Polish are natively understood, and other languages may work through general pattern matching. The model used for extraction is determined by your account configuration.

**Example:** You send a WhatsApp message: "Users on the free plan can see the billing page but the upgrade button does nothing. Low priority, fix when you have time." The agent creates an issue titled "Upgrade button non-functional on free plan billing page," sets priority to Low (it caught "when you have time"), and writes a description separating the user-facing bug from the likely implementation fix.

### Read Urgency Between the Lines

Priority is not a dropdown you remember to set — it is a signal the agent picks up from your words. Say "urgent" or "ASAP" and the issue arrives marked Urgent. Say "high priority" or "important" and it lands as High. Mention "low priority" or "when you have time" and it files as Low. Everything else defaults to Normal. The same cues work in Polish — "pilne" triggers Urgent, "wazne" triggers High.

This matters most when you are capturing issues in the heat of a moment. The words you naturally reach for when something is on fire — "blocker," "ASAP," "critical" — are exactly the cues the agent listens for. Your urgency translates directly into your board's priority column.

**Example:** A developer messages: "The deploy pipeline is stuck, this is a blocker for the release — ASAP." The agent marks the issue Urgent. An hour later the same developer sends: "Also, we should rename that config variable when you have time." That one lands as Low. Neither required opening a dropdown.

### Load Your Board Before You Blink

The Linear Agent keeps a local copy of your entire board, updated in real time. When something changes in Linear — an issue moves to In Review, a new sub-task appears, a label gets added — the change is pushed to IntexuraOS automatically within seconds via webhook fan-out to all connected users on the team. When you open the IntexuraOS dashboard, it reads from that local copy. No call to Linear's servers. No loading spinner. Just your board, already there.

The dashboard groups your issues into columns that mirror how work actually flows: Backlog, Todo, In Progress, In Review, To Test, and Done — with recently completed items visible for seven days before they archive. Within each column, issues sort by most recently updated, so the work getting attention right now floats to the top. Parent issues carry their children in a nested list, keeping related work grouped together.

**Example:** Your team moves five issues into "In Review" during a morning code review session. You open the dashboard ten minutes later and every one of those issues already sits in the In Review column. You did not refresh. You did not wait. The board was current before you arrived.

### See Issue Details Without Leaving

Tap into any issue on the dashboard and you get the full picture: description, labels with their colors, and comments from your team — paginated, with author names, timestamps, and markdown formatting preserved. The comment count shows on the card before you tap, so you know whether there is a conversation worth reading before you dive in.

This keeps context where you need it. You do not bounce between IntexuraOS and Linear to read a thread or check what labels are attached. The local copy holds all of it.

**Example:** An issue card shows "3 comments." You tap in and find a discussion between your designer and your backend engineer about an edge case. You read it, form your opinion, and move on — without ever opening Linear.

### Serve Issue Context to Other Services

Other IntexuraOS services can now fetch an issue's description and comments directly from the Linear Agent's local store — without needing user credentials or calling the Linear API. The orchestrator uses this to read issue context during deep validation, enriching its understanding of what the code task should accomplish before deciding whether to proceed.

**Example:** The code agent's orchestrator needs to validate a task against the full issue description and recent discussion. It calls the Linear Agent's context endpoint, receives the description and the latest comments (newest-first, capped at 100), and feeds that context into its validation prompt — all without requiring the user's Linear API key.

### Let Your Code Agent Update the Board

The Code Agent — another IntexuraOS service that picks up Linear issues and autonomously writes the code to resolve them — updates your board as it works. It creates related issues when implementation breaks into pieces, moves workflow states forward as each piece progresses, adds comments to track work, and updates labels and assignees. Your board reflects what the Code Agent has done without any manual status updates from you.

When you assign an issue that carries a "planning-task" or "code-task" label, the Linear Agent detects this and automatically triggers a code task. If the issue has a "code-task" label, the agent sends it straight for execution. If it has a "planning-task" label, the agent asks the code agent to first analyze the issue, enrich its description with requirements, acceptance criteria, and a test plan, then mark it ready. In both cases, the dispatched prompt instructs the code agent to read the full Linear issue and all its comments (newest-first) before starting work, so clarifications or follow-up context you added in the comments are never missed.

When the code agent discovers that the work described in an issue has already been completed or merged, it reports `already_completed` and the enforcement pipeline moves the issue to Done with a "Work already completed" comment — no manual cleanup needed.

**Example:** You created an issue from a voice note about a broken CSV export. The code agent picks it up, creates related issues for the parsing fix and the test, adds comments along the way, and moves workflow states forward as it works. An hour later you glance at the dashboard and see the progress reflected on your board. You never touched Linear.

### Generate Titles from Descriptions

Sometimes you write the description first and the title is an afterthought. The Linear Agent can generate a title from a description — concise, under 80 characters, capturing the essence of what the issue is about. If the first attempt fails, it retries once. If it fails again, it tells you instead of silently producing garbage.

**Example:** You paste a three-paragraph description of a caching bug into a new issue but leave the title blank. The agent generates: "Stale cache served after user profile update." Eighty characters or fewer, specific enough to scan on a board.

### Catch Duplicates and Handle Failures

Send the same message twice — from a spotty connection, an accidental re-send, a double tap — and the agent creates one issue, not two. Each action is processed with idempotency checks, so duplicate submissions return the existing result rather than creating a second issue.

When something does go wrong — the AI cannot parse your message, the input is too ambiguous, the extraction fails — the system does not swallow the error. Failed extractions land in a review queue where you can inspect them, retry them, or dismiss them. Nothing disappears into a void.

**Example:** Your WhatsApp connection drops mid-send and the message goes out twice. You check the board and find one issue, not a duplicate. Later, a garbled voice transcription fails to parse. You find it in the review queue, read the original text, clean it up, and retry. The issue appears on your board.

### Recover When Things Drift

Networks hiccup. Updates miss a beat. Over weeks, the local copy can drift from what Linear actually holds. When that happens, you trigger a full refresh — or let the automatic scheduled sync handle it — and the agent pulls every issue from Linear, updates the local store, and removes anything that no longer exists. Your board snaps back to reality.

**Example:** After a server restart, you suspect the board might be stale. You trigger a full refresh. The agent reconciles every issue — creates three that were missing, updates twelve that had changed, and removes one that was deleted from Linear. Your dashboard matches your Linear board exactly.

## Getting Connected

Connect your Linear account through the settings page — you will need your API key and team selection (your IT admin can help if needed). Once connected, the agent receives board updates automatically. Each user connects independently — your board, your credentials, your sync.

## Key Benefits

- **Capture without context-switching** — send a voice note or quick message and get a properly structured issue, without opening Linear or leaving your current task.
- **Priority from your words** — the agent reads urgency cues from natural language, so issues arrive pre-triaged into four priority levels.
- **Instant board access** — the dashboard reads from a local copy updated in real time, so you never wait for Linear's servers to respond.
- **Living board** — automatic sync, scheduled reconciliation, webhook fan-out to all team users, and manual refresh keep the local copy current across six workflow columns.
- **Code agent continuity** — issues move through your workflow as the code agent creates sub-tasks, adds comments, updates labels, and transitions states, visible on your board without manual status changes.
- **Smart auto-trigger** — assign an issue with a "planning-task" or "code-task" label and the code agent starts working automatically, choosing between enrichment and execution based on the label.
- **Cross-service context sharing** — other services fetch issue descriptions and comments from the local store without user credentials, enabling richer validation and decision-making.
- **No lost input** — duplicate detection prevents double-creation, and failed extractions queue for review instead of vanishing.

## Limitations

- **Linear only** — this agent works with Linear. If your team uses Jira, Asana, or another tracker, the integration does not apply.
- **Voice input through WhatsApp** — voice notes and messages reach the agent through WhatsApp via IntexuraOS's message routing layer. Other input channels are not currently supported.
- **AI extraction is imperfect** — ambiguous or garbled input may fail to parse. The agent saves these failures for review rather than guessing, but you still need to handle them manually.
- **Title generation may miss nuance** — auto-generated titles capture the gist but may not reflect the exact framing you would choose. The agent retries once on failure and reports errors rather than degrading silently.
- **Seven-day closed window** — completed and cancelled issues appear in the Closed column for seven days, then drop off the dashboard. They still exist in Linear.
- **One team per connection** — each connected account syncs with a single Linear team. Multi-team setups require separate connections.
- **Label passthrough gap** — the `POST /internal/issues` endpoint accepts a `labels` field but does not forward label IDs to Linear on creation. Labels must be set via the separate metadata endpoint.

---

_Part of [IntexuraOS](../overview.md) — your operating system for the work between the tools._
