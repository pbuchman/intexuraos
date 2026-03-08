# WhatsApp Service

The mobile command center for IntexuraOS — an operating system of specialized AI agents that handle research, coding, scheduling, and more. Send a voice note, tap an approval button, get notified when something needs your attention, all without leaving WhatsApp.

## The Problem

The best ideas arrive at the worst times. You are walking to lunch when a research question surfaces. You are in a cab when a decision needs sign-off. You are between meetings when three different agents need answers. Every one of these moments demands the same thing: pull out a laptop, open a dashboard, navigate, act. Most people just let the moment pass.

Meanwhile, the system keeps working. Agents research, code ships, calendars shift — and each event generates a notification that sits unread in some tab you closed an hour ago. The gap between what your system knows and what you know widens with every minute you are away from a screen.

## Use Case: A Morning in Motion

Built for founders, operators, and knowledge workers juggling multiple projects from their phone.

You are in transit when your phone buzzes:

1. A notification arrives: "Monthly report draft is ready for review." You tap the link button to open it directly in your browser.
2. Seconds later, an approval request: "Create automation: 'Weekly team sync reminder' every Monday 9am?" You tap Approve.
3. You remember something — record a quick voice note about a topic you want researched. The srt-service transcribes it asynchronously, and the transcript arrives as a reply to your voice note. The system routes it to the right agent for processing.
4. A code task update: "PR ready for review." You tap the "View PR" CTA button and the pull request opens in your browser.

Four interactions with four different agents. None required opening an app, logging in, or switching contexts. WhatsApp handled all of it.

## How It Helps

### One Channel for Every Agent

Unlike Slack bots or Telegram integrations — where each workflow lives in a separate bot — this one handles an entire operating system through a single conversation. No new app and no behavior change. WhatsApp is already in your pocket.

Every message you send — text, voice, or image — flows into IntexuraOS and reaches the right agent. The system reads your intent and routes it automatically: a research question reaches the research-agent, a task update reaches the code-agent, a scheduling request reaches the calendar-agent. You send the message. The system decides where it belongs. If it gets one wrong, sending a follow-up to clarify usually does the trick.

The flow works in both directions. When an agent has something to report — a research result, a status update, a scheduling confirmation — it sends a notification to your phone. Every notification arrives in the same conversation thread, formatted for quick scanning on a small screen.

### Voice That Understands Context

Record a voice note and the srt-service transcribes it asynchronously with event-driven processing. Audio files are stored in GCS and a Pub/Sub event triggers transcription. When complete, the transcript and an AI-generated summary arrive as a reply threaded beneath your original voice note. From there, the system routes it to the right agent — if it contains a research question, the research-agent picks it up; if it describes a task, the code-agent gets it.

**Example:** You record a voice note about a project update while walking. Within seconds, the transcript arrives as a reply threaded beneath your original voice note, along with an AI-generated summary of the key points. You just talked. The system figured out the rest.

### Approvals at the Speed of a Tap

When an agent needs your sign-off, an interactive message arrives with clearly labeled buttons. Tap Approve. Tap Reject. Done. The decision happens immediately — no login, no dashboard, no context switch. If buttons are not convenient, reply with plain text. "Yes" works just as well.

**Example:** The bookmarks-agent wants to add a URL to your reading list. You receive "Add 'AI Trends Report' to Reading List?" with Approve and Cancel buttons. One tap, and you are back to your conversation. The entire interaction takes two seconds.

### Deep Links with CTA Buttons

When an agent completes work that produces a URL — a pull request, a research report, a task dashboard — the notification arrives with a clickable CTA (Call-to-Action) button that opens the link directly in your browser. No copying URLs from chat, no switching between apps.

**Example:** The code-agent finishes a PR. You receive "PR #42 ready for review" with a "View PR" button. One tap opens the GitHub pull request in your browser.

### Instant Message Capture

Send any thought the moment it strikes — and the system acts on it immediately. A text message becomes a command routed to the right agent. An image gets stored for later reference. A link becomes a bookmark with the page title, description, and image automatically pulled in. Unlike a notes app, sending a message does not just store it. It triggers the right agent to start working.

**Example:** Walking to lunch, you remember a research question. Send "research quantum computing market trends 2026" via WhatsApp. By the time you sit down, the research-agent has already started gathering sources.

## Getting Connected

Verify your WhatsApp number with a one-time six-digit code sent to your phone. Enter the code in the web dashboard, and your number is linked to your IntexuraOS account. Linking your number to your account lets agents know who sent each message. From that point on, WhatsApp and the web dashboard serve as your two interfaces into the system — one for mobile, one for desktop.

## Key Benefits

- **Event-driven transcription** — Audio messages are transcribed asynchronously via srt-service with AI-generated summaries
- **Tap-to-decide** — Interactive buttons or plain text replies for instant approvals on the move
- **Deep link CTA buttons** — Open pull requests, dashboards, and reports directly from WhatsApp notifications
- **Unified interface** — Every agent in the system reports to one conversation thread on your phone
- **Capture and route** — Text, voice, and images flow into the system and trigger the right agent immediately
- **Nothing to install** — Works inside WhatsApp, the app already on your phone

## Limitations

- **WhatsApp Business API required** — The service connects through Meta's Business API, which requires business verification and API access from Meta
- **24-hour messaging window** — WhatsApp only allows proactive messages within 24 hours of your last message; the system is designed to keep you engaged with useful notifications, but if 24 hours pass without a message from you, it cannot reach out until you do
- **No video support** — Video messages are not currently processed
- **One user per phone number** — Each phone number can only be connected to one IntexuraOS account
- **Platform rate limits** — Subject to WhatsApp API rate limits, which vary by tier

---

_Part of [IntexuraOS](../overview.md) — Your mobile command center for capturing thoughts and making decisions from anywhere._
