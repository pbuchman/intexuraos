# IntexuraOS

An AI-native personal operating system that turns WhatsApp text messages, dashboard tasks, and ideas into research, code, calendar events, bookmarks, notes, and organized work.

## The Vision

Most productivity tools ask you to do two things at once: have the idea and organize it. You remember the dentist appointment while walking to lunch, but scheduling it means unlocking your phone, opening a calendar app, navigating to the right date, filling in a title, picking a time. Most people let the moment pass. The thought vanishes. The appointment never gets made.

IntexuraOS eliminates the gap between thinking and doing. You send a WhatsApp text message or a quick entry in the web dashboard, and a system of specialized agents handles the rest. Intex can create notes, calendar events, research drafts, bookmarks, and code tasks directly. Your dentist appointment lands on your Google Calendar when the details are clear. Your research question goes to multiple AI models. Your bug report becomes a code task picked up by an autonomous coding agent that produces finished, tested code while you sleep. You stay in the loop through design reviews, dashboard state, and notifications — but the work happens without you doing the work.

This is not one AI that tries to do everything. It is a system of services, each built for a single domain, communicating through a shared platform. Intex handles WhatsApp text conversations and direct tool calls. The research agent queries multiple AI providers and cross-references their answers. The code agent designs a solution, waits for your design approval when appropriate, and writes the code on your own machine — code that never leaves your infrastructure, running inside isolated containers powered by your own AI subscription. The calendar agent puts events on your schedule. Linear (a project tracking tool) structures your board. Because each agent has a single domain, the system can improve any agent independently, add new capabilities without touching existing ones, and route with precision that a general-purpose assistant cannot match by design.

## What You Can Do

### Build Software Autonomously

Describe what you want built. Walk away. Come back to finished, tested code — with a design review checkpoint in between so the agent never builds the wrong thing. Everything runs on your own hardware, inside isolated containers, using your own AI subscription. Your source code never touches a third-party cloud.

**[Code Agent](services/code-agent/features.md)** is the interface you interact with. Submit a task by WhatsApp text message, the web dashboard, or a comment on a GitHub pull request — and the agent creates a Linear issue, produces a design document explaining its approach, and stops. You review the design on your own schedule. Press the Implement button, and the agent writes tests, writes code, runs the test suite, and opens a code change for review. Leave a comment on GitHub, and the agent evaluates it using tool calling and a unified webhook evaluator, then picks up your feedback with full context. All PR actions are visible in one place through a unified PR automation log. PR triage is also triggered via Pub/Sub push subscription, reducing latency from GitHub webhook delivery. When all workers are busy, new tasks queue automatically and dispatch in order as capacity opens — no requests are dropped. Behind the scenes, agent-based routing dispatches each task to the right specialist — a planning agent for designs, an execution agent for code — based on Linear issue labels. Code reviews now check whether the implementation matches the original plan, catching drift before it reaches your repository. Triage decisions use structured output with auto-repair to produce reliable results. You can choose from worker types across Anthropic, MiniMax, Xiaomi MiMo Pro 2.5, Alibaba Cloud Model Studio (GLM-5, Qwen), Kimi Code, OpenAI Codex, and OpenRouter — or let the agent pick automatically. When submitting a task you can select the mode — planning or execution — to control whether the agent produces a design first or proceeds directly to writing code. Pull requests can be queued for automatic ordered merging, so multiple code changes land without conflicts. Issue groups can be flagged as important, surfacing them prominently in the dashboard. Task finalization uses a dedicated status endpoint so completion is reliably recorded even if the primary completion flow encounters an error. Per-user limits on concurrency, hourly rate, and daily spend keep costs predictable.

**[Hellscript Agent](services/hellscript-agent/features.md)** is an AI-powered writing assistant that follows your personal style and preferences. Provide writing samples organized by category — Threads, LinkedIn, or general — and the agent uses them to generate drafts that match your voice. Style instructions and sample content are stored per category and used to guide every generation.

**[Orchestrator](services/orchestrator/features.md)** runs on your own hardware. Your source code never leaves your network. Any Unix machine becomes a worker station, connected to the platform through a single secure outbound connection — no firewall changes, no open ports. Each task gets its own branch, its own container, its own credentials — two concurrent tasks never see each other's files. An independent verifier confirms completion by checklist and AI review, not worker self-reporting. A sensitive file guard scans every commit for passwords and secrets, reverting anything suspicious before it reaches your repository. Automatic Docker container cleanup prevents resource leaks from orphaned or stale containers. Every code task includes a mandatory simplify step before completion to reduce unnecessary complexity. A remediation agent handles auto-improvement autonomously — running cross-LLM checks on plans and implementations, then applying corrections through an event-sourcing pattern without human intervention.

The system survives reboots, cleans up orphaned work, and notifies the platform without manual intervention. Inside each container, a fully equipped isolated coding environment arrives with every tool a developer would need — all configured automatically before the agent writes its first line of code. Your team's own Anthropic subscription powers the AI compute. When a task finishes, the environment is destroyed. No stale credentials, no leftover files, no cleanup checklists.

### Talk to the System

You have two interfaces into IntexuraOS: WhatsApp and a web dashboard. Between them, you can reach every agent in the system without learning a single new tool.

**[WhatsApp Service](services/whatsapp-service/features.md)** is your mobile command center. Send a text message or share a link, and the system routes supported requests through Intex. The private WhatsApp workspace mirrors private chats into read-only conversations, sender/day views, Matrix sync, and preserved group context so private messages can be inspected without mixing them into the assistant flow. Voice messages are explicitly unsupported for now and receive a text reply asking you to send text instead. Code task progress notifications keep you updated as tasks move through planning, implementation, and completion. A notification importance filter lets you suppress low-priority messages — set your preference to receive only messages explicitly flagged as important.

**[Web App](services/web/features.md)** is where you observe and control what the agents are doing on your behalf. Watch code being written in real time with color-coded log streams. Review code task designs, research reports, calendar data, your Linear board, and connected service settings — all in one interface you can install on your phone's home screen like a native app. Share content from any app on your phone directly into IntexuraOS through the system share menu. Workers status is accessible from the user menu.

**[Ask Agent](services/code-agent/features.md)** starts an interactive Claude Code session directly from the web dashboard. Send a message, watch the agent respond in real time, and continue the conversation — back and forth — without leaving the UI. Useful for exploratory coding tasks, quick questions about your codebase, or any work where you want to stay in the loop step by step rather than approve a finished result.

**[Fishing Assistant](services/fishing-assistant-service/features.md)** is a grounded chat for fishing knowledge. Ask questions against your saved fishing pages, WhatsApp digest summaries, and recent group-message context; the service retrieves supporting evidence, validates citations before storing answers, and keeps chat history so follow-up questions retain context. Knowledge-base evidence is prioritized when available, while digest and raw-message evidence fill in recent mobile context.

### Capture and Organize Your Thoughts

Every message you send enters through one front door and reaches the right specialist without you choosing a category, opening a menu, or filling out a form.

**[Intex Agent](services/intex-agent/features.md)** is that front door for WhatsApp text. It uses direct tools rather than a separate command queue: create a note, create a calendar event, create a research draft, save a bookmark, or create a code task. The duplicated legacy action-agent paths have been folded into this single workflow, so supported actions share one routing and session model. If a message does not fit those tools, Intex says it is unsupported instead of inventing a workflow. Voice support and general approval workflows are intentionally not part of this path right now.

**[Calendar Agent](services/calendar-agent/features.md)** puts events on your Google Calendar from dashboard flows and Intex tool calls. Send "Dentist next Tuesday at 3pm" and the event is created when the title, date, start, and end are clear. Relative dates, all-day events, locations, and multilingual input — including Polish — all work without a settings page. Vague messages that lack enough detail ask for clarification instead of being guessed.

**[Notes Agent](services/notes-agent/features.md)** gives your quick thoughts a home inside the platform. Create a note with tags from the dashboard, or let Intex store one on your behalf from a WhatsApp text message. Tag-based organization, most-recent-first sorting, and zero friction.

**[Bookmarks Agent](services/bookmarks-agent/features.md)** saves links with context. Share a URL, and the agent visits the page, extracts the title, cover image, and site information, then generates an AI summary delivered straight to your WhatsApp. When you come back next week, you remember exactly why you saved it. Duplicate URLs are caught automatically.

**[Linear Agent](services/linear-agent/features.md)** keeps Linear (a project tracking tool) synchronized with the platform. Your board loads instantly in the web dashboard from a local copy updated in real time, with live data hydration that keeps issue details current without manual refresh. The code agent updates your board as it works, closing the loop from thought to finished code to tracked progress. An AI-powered cleanup tool identifies issues that are candidates for pruning — cancelled, duplicate, sub-issues, or already-resolved — and surfaces them in a review UI for batch deletion on a schedule.

### Research With Multi-Model Consensus

**[Research Agent](services/research-agent/features.md)** does not ask one AI and trust the answer. It sends your question to up to four providers simultaneously — Claude, Gemini, GPT, and Perplexity — each receiving the same structured research plan and any documents you attach (up to five, roughly 40 pages each). Research tasks can also be routed through OpenRouter, giving access to additional models beyond the four native providers. The synthesis that comes back is not a blended summary. It is a structured conflict analysis: topic by topic, naming which models reached which conclusions, rating each disagreement by severity. Every claim is attributed to its source model. Every model's original report is available in full, with citations you can trace.

You review a draft before anything runs — the refined prompt, selected models, and attached materials — so misclassifications are caught before you spend. Partial failures do not discard completed results. Completed research can be shared as a public page with an auto-generated cover image, exported to Notion, or enhanced later with new models and new context material without re-querying what already completed.

**[Web Agent](services/web-agent/features.md)** reads the internet on behalf of other agents. When the research agent needs to digest source articles, or the bookmarks agent needs a rich preview card, the web agent visits the page automatically and returns a summary written in the same language as the source material. Polish stays Polish. German stays German. It works behind the scenes — you never interact with it directly, but it powers the reading comprehension of every agent that touches a URL.

### See What Is Happening

**[Your Dashboard](services/web/features.md)** is the observation deck. Code tasks stream their output in real time — color-coded lines showing every file read, every test run, every tool invocation — with a redesigned issue-centric grouped task view that surfaces design documents, worker model selection, and task lifecycle at a glance. All PR automation actions are visible in a unified log. Research reviews, your Linear board, calendar, notes, bookmarks, and notification history are each one tap away.

**[LLM Usage Service](services/llm-usage-service/features.md)** shows you what every AI interaction costs. Usage can be grouped by model, call type, prompt type, source service, and provider, with research-run cost summaries that include per-event rows, totals, image counts, and missing-attribution diagnostics. Image generation metadata and OpenRouter model identifiers are preserved, so usage dashboards can explain both text and image spend without collapsing everything into one total.

### Connect Your Tools and Data

**[Image Service](services/image-service/features.md)** generates professional cover images from your content without prompt engineering. When you share a research report as a public page, the service reads the text, writes its own optimized prompt, and produces a cover image with an automatic thumbnail for cards and previews. Unsharing cleans up both the image and the database record.

**[Notion Service](services/notion-service/features.md)** bridges IntexuraOS and your Notion workspace. Connect once through Notion's sharing settings, and research results export directly — the synthesis as a main page, each model's full report as a child page beneath it. The connection validates your token before storing it and verifies page access before every export attempt.

**[Mobile Notifications Service](services/mobile-notifications-service/features.md)** captures your phone's notification stream — banking alerts, delivery updates, app reminders — and structures them inside the platform. Connect your Android phone once, and every notification flows in automatically, filterable by app, searchable by title. The real value is pairing this data with the data insights agent to surface patterns you would never spot from individual alerts. WhatsApp group messages can also be processed into AI-generated daily digest summaries, surfacing the day's highlights from group conversations without reading every message.

**[User Service](services/user-service/features.md)** is the trust layer beneath the platform. Store API keys for AI providers in a single encrypted vault — protected with bank-grade encryption, decrypted only in memory, never readable while stored. Every key is tested against its provider's actual API before it is accepted. Error messages are translated from cryptic provider codes into plain language. Sign in with Google connects your calendar. Authentication works across the web dashboard, command line, and mobile apps — including a short-code sign-in for devices without a browser.

### Keep the System Running

**[VM Lifecycle](services/vm-lifecycle/features.md)** manages the dedicated machine that runs your coding agents. It starts every weekday morning, verifies the orchestrator and workers are ready to accept work — not just that the operating system booted — and shuts down every night. Before powering off, it checks for active coding tasks and waits up to ten minutes for them to finish. Your work is never interrupted mid-flight, and the machine stops billing the moment it is no longer needed.

**Log Cleanup** sweeps out old execution logs every night in controlled batches. Database queries stay fast, storage costs stay flat, and no one ever has to think about log retention. If a nightly run fails, the next one catches what was missed.

**[API Docs Hub](services/api-docs-hub/features.md)** collects the technical documentation for all backend services into a single interactive reference. One URL, one dropdown, always current. If you are building on top of IntexuraOS or want to understand how services communicate, this is the starting point.

## How It Works

A thought enters the system and becomes a result through a direct tool call. You send a WhatsApp text message — "Research the latest developments in solid-state batteries" — and Intex creates a research draft. Multiple AI models can receive the same structured research plan simultaneously. Minutes later, a synthesis arrives with attributed claims, rated disagreements, and full source reports. A WhatsApp notification tells you the results are ready.

The same boundary works for each supported domain. A text message about a bug becomes a code task, dispatched to the code agent, which creates a Linear issue, produces a design, and waits for your review. A message about lunch Friday becomes a calendar event when the details are clear. A shared link becomes an enriched bookmark with an AI summary delivered to your phone. Unsupported requests get a clear "not supported yet" response.

When the work involves code, execution happens on your own infrastructure. The orchestrator receives the task, routes it to the right specialist — a planning agent for designs, an execution agent for implementation — based on issue labels, creates an isolated container with a fresh copy of your repository, and the worker writes the code, runs the tests, and produces a finished change ready for your review. You can choose from worker types across Anthropic, MiniMax, Xiaomi MiMo Pro 2.5, Alibaba Cloud Model Studio (GLM-5, Qwen), Kimi Code, OpenAI Codex, and OpenRouter — or let the system pick automatically. An independent verifier confirms the result. Logs stream back to your web dashboard in real time. The machine that runs all of this starts and stops on a schedule, so you pay for compute only when you are using it.

## Getting Started

You need three things: a WhatsApp account, a Google account, and a web browser. Sign up through the web app, connect your WhatsApp number with a one-time verification code, and link your Google account for calendar access. Your first text message enters the system immediately. The platform provides fallback AI model access so you can run research and generate bookmarks before configuring your own API keys.

For coding tasks, connect a worker machine — any Mac or Linux computer will do — and the platform handles the secure connection. For project tracking, connect your Linear account. For research exports, connect Notion. Each integration is optional and independent — use the parts you need, skip the rest.

## Limitations

IntexuraOS is designed for individual power users who want depth in one workflow over breadth across many. These are deliberate scope decisions, not gaps on a roadmap.

- **WhatsApp as the mobile channel** — All mobile interactions flow through WhatsApp. There is no SMS, email, or native push notification alternative. WhatsApp's 24-hour messaging policy means the system cannot initiate conversations after a day of silence — you send the next message to reopen the window.
- **Google Calendar only** — Deep calendar integration covers primary, secondary, and shared Google calendars. Outlook, Apple Calendar, and other providers are not connected.
- **Linear for project tracking** — Issue creation and board sync work with Linear. Jira, Asana, and other trackers are not connected.
- **Android for notification capture** — Mobile notification forwarding requires a compatible Android automation app. iOS is not supported.
- **English and Polish natively** — Intent recognition is built for English and Polish. Other languages may work through general pattern matching but are not explicitly tested.
- **Two worker machines** — You can configure a primary and a fallback coding worker, but not a larger pool.
- **Designed for individual use** — Notes, bookmarks, and notifications are personal and private. There are no shared workspaces or team collaboration features.
- **API keys configured manually** — Connecting AI providers requires generating and pasting API keys yourself. The system validates every key before accepting it, but there is no one-click sign-in for most providers.
- **Design review before code execution** — Code tasks pause between design and implementation for your approval. This is a deliberate quality gate, not an optimization to be removed.

---

_IntexuraOS — your brain does the thinking, the system does the rest._
