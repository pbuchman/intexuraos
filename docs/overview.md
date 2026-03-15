# IntexuraOS

An AI-native personal operating system — 25 specialized agents that turn your voice notes, messages, and ideas into research, code, calendar events, and organized work, all from WhatsApp and a single web dashboard.

## The Vision

Most productivity tools ask you to do two things at once: have the idea and organize it. You remember the dentist appointment while walking to lunch, but scheduling it means unlocking your phone, opening a calendar app, navigating to the right date, filling in a title, picking a time. Most people let the moment pass. The thought vanishes. The appointment never gets made.

IntexuraOS eliminates the gap between thinking and doing. You say what you need — through a WhatsApp voice note, a text message, or a quick entry in the web dashboard — and a system of specialized agents handles the rest. One agent classifies your intent. Another dispatches it to the right specialist. A third executes it. Your dentist appointment lands on your Google Calendar. Your research question goes to five AI models simultaneously. Your bug report becomes a tracked project issue, picked up by an autonomous coding agent that produces finished, tested code while you sleep. You stay in the loop through previews, approval buttons, and notifications — but the work happens without you doing the work.

This is not one AI that tries to do everything. It is 25 services, each built for a single domain, communicating through a shared platform. The commands agent understands what you said. The actions agent decides what to do about it. The research agent queries multiple AI providers and cross-references their answers. The code agent designs a solution, waits for your approval, and writes the code on your own machine — code that never leaves your infrastructure, running inside isolated containers powered by your own AI subscription. The calendar agent puts events on your schedule. Linear (a project tracking tool) structures your board. Because each agent has a single domain, the system can improve any agent independently, add new capabilities without touching existing ones, and route with precision that a general-purpose assistant cannot match by design.

## What You Can Do

### Talk to the System

You have two interfaces into IntexuraOS: WhatsApp and a web dashboard. Between them, you can reach every agent in the system without learning a single new tool.

**[WhatsApp Service](services/whatsapp-service/features.md)** is your mobile command center. Send a text message, record a voice note, or share a link — and the system routes it to the right agent automatically. Voice transcription is event-driven — audio files trigger processing automatically with support for user-level language preferences — and understands your specialized vocabulary with 100+ domain-specific terms, project names, and technical words. When an agent needs your decision, an interactive approval button arrives in the same conversation thread, with call-to-action buttons that deep-link directly to the relevant page in your dashboard. Code task progress notifications keep you updated as tasks move through planning, implementation, and completion. Four interactions with four different agents, none requiring you to leave WhatsApp.

**[Web App](services/web/features.md)** is where you observe, approve, and control everything the agents are doing on your behalf. Watch code being written in real time with color-coded log streams. Approve action items and code task designs from a single inbox. Review research reports, manage your calendar, track your Linear board, and configure every connected service — all in one interface you can install on your phone's home screen like a native app. Share content from any app on your phone directly into IntexuraOS through the system share menu. Workers status is accessible from the user menu.

**[Chat Agent](services/chat-agent/features.md)** is your guide to the platform itself. Ask it how anything works, and it answers from up-to-date documentation with linked source citations. Then act on what you learned — describe a new command in natural language, confirm it, and the system creates it. No forms, no field navigation. Guest access works without an account, so anyone can explore before signing up.

### Capture and Organize Your Thoughts

Every message you send enters through one front door and reaches the right specialist without you choosing a category, opening a menu, or filling out a form.

**[Commands Agent](services/commands-agent/features.md)** is that front door. It reads your messages through a five-step decision process that understands intent, not keywords. "Create a todo to research competitors" becomes a to-do item, not a research task — because the agent recognizes the explicit instruction over the misleading word. It handles English and Polish natively, classifies voice notes the same way it classifies text, and sorts every input into one of eight categories: to-do, research, note, link, calendar, project tracking, reminder, or code.

**[Actions Agent](services/actions-agent/features.md)** is the dispatcher that turns every classified command into the right action. High-confidence classifications execute immediately — no approval step, no delay. Lower confidence pauses and asks. Project tracking actions always require approval, because an accidental issue in your tracker affects your team. Every correction you make in the dashboard — changing an action's type from note to to-do, for instance — is stored as training data that improves future accuracy.

**[Calendar Agent](services/calendar-agent/features.md)** puts events on your Google Calendar from voice notes and text messages. Say "Dentist next Tuesday at 3pm" and a richly formatted preview appears with the title, date, time, duration, and the AI's reasoning. Approve it, and the event is created. Relative dates, all-day events, locations, and multilingual input — including Polish — all work without a settings page. Vague messages that lack enough detail are saved for review instead of discarded.

**[Todos Agent](services/todos-agent/features.md)** structures your tasks automatically. Send a paragraph describing four next steps, and the agent breaks it into individual items with priorities and deadlines extracted from your natural language. Other agents create todos on your behalf — a research finding, a follow-up from a voice command — so your task list fills even when you are not actively capturing.

**[Notes Agent](services/notes-agent/features.md)** gives your quick thoughts a home inside the platform. Create a note with tags from the dashboard, or let other agents store one on your behalf from a WhatsApp voice command. Tag-based organization, most-recent-first sorting, and zero friction.

**[Bookmarks Agent](services/bookmarks-agent/features.md)** saves links with context. Share a URL, and the agent visits the page, extracts the title, cover image, and site information, then generates an AI summary delivered straight to your WhatsApp. When you come back next week, you remember exactly why you saved it. Duplicate URLs are caught automatically.

**[Linear Agent](services/linear-agent/features.md)** turns voice notes and quick messages into structured, prioritized issues in Linear (a project tracking tool). The AI extracts a title, separates functional requirements from technical details, and reads urgency cues from your words — "ASAP" maps to Urgent, "when you have time" maps to Low. Your board loads instantly in the web dashboard from a local copy updated in real time, with live data hydration that keeps issue details current without manual refresh. The code agent updates your board as it works, closing the loop from thought to finished code to tracked progress.

### Build Software Autonomously

Describe what you want built. Walk away. Come back to finished, tested code — with a design review checkpoint in between so the agent never builds the wrong thing. Everything runs on your own hardware, inside isolated containers, using your own AI subscription. Your source code never touches a third-party cloud.

**[Code Agent](services/code-agent/features.md)** is the interface you interact with. Submit a task by WhatsApp voice note, text message, the web dashboard, or a comment on a GitHub pull request — and the agent creates a Linear issue, produces a design document explaining its approach, and stops. You review the design on your own schedule. Press the Implement button, and the agent writes tests, writes code, runs the test suite, and opens a code change for review. Leave a comment on GitHub, and the agent evaluates it using tool calling and a unified webhook evaluator, then picks up your feedback with full context. All PR actions are visible in one place through a unified PR automation log. When all workers are busy, new tasks queue automatically and dispatch in order as capacity opens — no requests are dropped. Behind the scenes, agent-based routing dispatches each task to the right specialist — a planning agent for designs, an execution agent for code — based on Linear issue labels. Triage decisions use structured output with auto-repair to produce reliable results. You can choose from seven worker types across three AI providers: Anthropic (Opus, Sonnet, Auto), MiniMax, and Alibaba Cloud Model Studio (GLM-5, Qwen, Kimi) — or let the agent pick automatically. Per-user limits on concurrency, hourly rate, and daily spend keep costs predictable.

**[Orchestrator](services/orchestrator/features.md)** runs on your own hardware. Your source code never leaves your network. Any Unix machine becomes a worker station, connected to the platform through a single secure outbound connection — no firewall changes, no open ports. Each task gets its own branch, its own container, its own credentials — two concurrent tasks never see each other's files. An independent verifier confirms completion by checklist and AI review, not worker self-reporting. A sensitive file guard scans every commit for passwords and secrets, reverting anything suspicious before it reaches your repository. Automatic Docker container cleanup prevents resource leaks from orphaned or stale containers. Every code task includes a mandatory simplify step before completion to reduce unnecessary complexity.

The system survives reboots, cleans up orphaned work, and notifies the platform without manual intervention.

**[Claude Worker](services/claude-worker/features.md)** is the isolated coding environment inside each container. It arrives fully equipped with every tool a developer would need — all configured automatically before the agent writes its first line of code. Your team's own Anthropic subscription powers the AI compute. When a task finishes, the environment is destroyed. No stale credentials, no leftover files, no cleanup checklists.

### Research With Multi-Model Consensus

**[Research Agent](services/research-agent/features.md)** does not ask one AI and trust the answer. It sends your question to up to four providers simultaneously — Claude, Gemini, GPT, and Perplexity — each receiving the same structured research plan and any documents you attach (up to five, roughly 40 pages each). The synthesis that comes back is not a blended summary. It is a structured conflict analysis: topic by topic, naming which models reached which conclusions, rating each disagreement by severity. Every claim is attributed to its source model. Every model's original report is available in full, with citations you can trace.

You review a draft before anything runs — the refined prompt, selected models, and attached materials — so misclassifications are caught before you spend. Partial failures do not discard completed results. Completed research can be shared as a public page with an auto-generated cover image, exported to Notion, or enhanced later with new models and new context material without re-querying what already completed.

**[Web Agent](services/web-agent/features.md)** reads the internet on behalf of other agents. When the research agent needs to digest source articles, or the bookmarks agent needs a rich preview card, the web agent visits the page automatically and returns a summary written in the same language as the source material. Polish stays Polish. German stays German. It works behind the scenes — you never interact with it directly, but it powers the reading comprehension of every agent that touches a URL.

### See What Is Happening

**[Your Dashboard](services/web/features.md)** is the observation deck. Code tasks stream their output in real time — color-coded lines showing every file read, every test run, every tool invocation — with a redesigned issue-centric grouped task view that surfaces design documents, worker model selection, and task lifecycle at a glance. All PR automation actions are visible in a unified log. Action items, approval gates, and research reviews surface in a single inbox. Your Linear board, calendar, todos, notes, bookmarks, and notification history are each one tap away. The floating chat assistant is available on every page.

**[Data Insights Agent](services/data-insights-agent/features.md)** turns scattered data into visualizations. Upload spreadsheet exports, data files, or plain text, or combine them with filtered mobile notifications into a single view. The AI discovers patterns and recommends chart types — line, bar, scatter, area, pie, or heatmap — each with a trackable metric. Preview before you save. Refresh when you want the latest view. No formulas, no spreadsheet gymnastics.

**[App Settings Service](services/app-settings-service/features.md)** shows you what every AI interaction costs. Current pricing for all four providers, broken down by model. Your personal usage split by month, model, and call type — with dollar costs displayed so you know exactly where your AI spend goes. The service verifies that every registered model has pricing data before it starts, so the numbers are never stale or incomplete.

### Connect Your Tools and Data

**[Image Service](services/image-service/features.md)** generates professional cover images from your content without prompt engineering. When you share a research report as a public page, the service reads the text, writes its own optimized prompt, and produces a cover image with an automatic thumbnail for cards and previews. Unsharing cleans up both the image and the database record.

**[Notion Service](services/notion-service/features.md)** bridges IntexuraOS and your Notion workspace. Connect once through Notion's sharing settings, and research results export directly — the synthesis as a main page, each model's full report as a child page beneath it. The connection validates your token before storing it and verifies page access before every export attempt.

**[Mobile Notifications Service](services/mobile-notifications-service/features.md)** captures your phone's notification stream — banking alerts, delivery updates, app reminders — and structures them inside the platform. Connect your Android phone once, and every notification flows in automatically, filterable by app, searchable by title. The real value is pairing this data with the data insights agent to surface patterns you would never spot from individual alerts.

**[User Service](services/user-service/features.md)** is the trust layer beneath the platform. Store API keys for AI providers in a single encrypted vault — protected with bank-grade encryption, decrypted only in memory, never readable while stored. Every key is tested against its provider's actual API before it is accepted. Error messages are translated from cryptic provider codes into plain language. Sign in with Google connects your calendar. Authentication works across the web dashboard, command line, and mobile apps — including a short-code sign-in for devices without a browser.

### Keep the System Running

**[VM Lifecycle](services/vm-lifecycle/features.md)** manages the dedicated machine that runs your coding agents. It starts every weekday morning, verifies the orchestrator and workers are ready to accept work — not just that the operating system booted — and shuts down every night. Before powering off, it checks for active coding tasks and waits up to ten minutes for them to finish. Your work is never interrupted mid-flight, and the machine stops billing the moment it is no longer needed.

**[Log Cleanup](services/log-cleanup/features.md)** sweeps out old execution logs every night in controlled batches. Database queries stay fast, storage costs stay flat, and no one ever has to think about log retention. If a nightly run fails, the next one catches what was missed.

**[API Docs Hub](services/api-docs-hub/features.md)** collects the technical documentation for all 15 backend services into a single interactive reference. One URL, one dropdown, always current. If you are building on top of IntexuraOS or want to understand how services communicate, this is the starting point.

## How It Works

A thought enters the system and becomes a result in four stages. You send a WhatsApp voice note — "Research the latest developments in solid-state batteries" — and the WhatsApp service transcribes it with domain-aware vocabulary. The commands agent reads the transcript, recognizes a research intent, and classifies it. The actions agent checks the confidence score — well above the auto-execution threshold — and dispatches it to the research agent without asking for approval. Multiple AI models receive the same structured research plan simultaneously. Minutes later, a synthesis arrives with attributed claims, rated disagreements, and full source reports. A WhatsApp notification tells you the results are ready.

The same path works for every domain. A voice note about a bug becomes a classified code task, dispatched to the code agent, which creates a Linear issue, produces a design, and waits for your approval. A message about lunch Friday becomes a calendar preview you approve with one tap. A shared link becomes an enriched bookmark with an AI summary delivered to your phone. The entry point is always the same — say what you need — and the system decides which specialists handle it, whether to ask permission or act immediately, and how to deliver the result.

When the work involves code, execution happens on your own infrastructure. The orchestrator receives the task, routes it to the right specialist — a planning agent for designs, an execution agent for implementation — based on issue labels, creates an isolated container with a fresh copy of your repository, and the worker writes the code, runs the tests, and produces a finished change ready for your review. You can choose from seven worker types across three AI providers — Anthropic, MiniMax, and Alibaba Cloud Model Studio (GLM-5, Qwen, Kimi) — or let the system pick automatically. An independent verifier confirms the result. Logs stream back to your web dashboard in real time. The machine that runs all of this starts and stops on a schedule, so you pay for compute only when you are using it.

## Getting Started

You need three things: a WhatsApp account, a Google account, and a web browser. Sign up through the web app, connect your WhatsApp number with a one-time verification code, and link your Google account for calendar access. Your first message — typed or spoken — enters the system immediately. The platform provides fallback AI model access so you can run research, generate bookmarks, and use the chat assistant before configuring your own API keys.

For coding tasks, connect a worker machine — any Mac or Linux computer will do — and the platform handles the secure connection. For project tracking, connect your Linear account. For research exports, connect Notion. Each integration is optional and independent — use the parts you need, skip the rest.

## Limitations

IntexuraOS is designed for individual power users who want depth in one workflow over breadth across many. These are deliberate scope decisions, not gaps on a roadmap.

- **WhatsApp as the mobile channel** — All mobile interactions flow through WhatsApp. There is no SMS, email, or native push notification alternative. WhatsApp's 24-hour messaging policy means the system cannot initiate conversations after a day of silence — you send the next message to reopen the window.
- **Google Calendar only** — Deep calendar integration covers primary, secondary, and shared Google calendars. Outlook, Apple Calendar, and other providers are not connected.
- **Linear for project tracking** — Issue creation and board sync work with Linear. Jira, Asana, and other trackers are not connected.
- **Android for notification capture** — Mobile notification forwarding requires a compatible Android automation app. iOS is not supported.
- **English and Polish natively** — Intent recognition is built for English and Polish. Other languages may work through general pattern matching but are not explicitly tested.
- **Two worker machines** — You can configure a primary and a fallback coding worker, but not a larger pool.
- **Designed for individual use** — Todos, notes, bookmarks, and notifications are personal and private. There are no shared workspaces or team collaboration features.
- **No recurring events or tasks** — Calendar events and todos are single instances. Recurring patterns are calendar-specific complexity not yet built.
- **API keys configured manually** — Connecting AI providers requires generating and pasting API keys yourself. The system validates every key before accepting it, but there is no one-click sign-in for most providers.
- **Design review before code execution** — Code tasks pause between design and implementation for your approval. This is a deliberate quality gate, not an optimization to be removed.

---

_IntexuraOS — your brain does the thinking, the system does the rest._
