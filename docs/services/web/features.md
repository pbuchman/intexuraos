# Web App

The single-page Progressive Web App that brings all of IntexuraOS into one unified dashboard.

## The Problem

Managing your digital life across multiple services creates constant friction. Switching between WhatsApp for messages, calendar for events, notes for thoughts, and bookmarks for links breaks your flow. Each interface has different patterns, requires context switching, and lacks unified visibility into what needs your attention.

## How It Helps

### Unified Command Center

Access all IntexuraOS capabilities from a single, fast interface. Inbox, research, calendar, notes, todos, bookmarks, Linear issues, and data insights are one tap away.

**Example:** Open the app to see 3 actions awaiting approval, 2 research reports ready, and calendar events for today — no tab switching required.

### Real-Time Action Inbox

Watch actions arrive and update in real-time via Firestore listeners. Approve, reject, or execute with a single tap. Filter by status, archive completed items, and deep-link to specific actions.

**Example:** You send a WhatsApp message "schedule team standup for Tuesday 2pm". Within seconds, a calendar preview appears in your inbox. You review the event details and tap approve — it is created immediately.

### Configurable Action Buttons

Every action displays dynamically generated buttons based on YAML configuration. Approve, reject, retry, delete, or custom actions execute directly from the UI.

**Example:** A research action shows "Approve", "Retry with different models", and "Delete" buttons. A calendar action shows "Approve" with the event preview card, or "Reject" if the time doesn't work.

### Progressive Web App

Install IntexuraOS on your home screen for an app-like experience on mobile. Offline support, push notifications, and background sync keep you productive without a constant connection.

**Example:** Commuting without signal? Open the app to review previously loaded actions. Your actions queue locally and execute when connectivity returns.

### Intex Chat Assistant

Talk to IntexuraOS using natural language through the floating chat bubble. Ask questions, create commands, and get context-aware responses. Works for both authenticated users and guests.

**Example:** You type "remind me to call the dentist tomorrow" in the chat. The assistant suggests creating a todo command. You confirm, and it appears in your inbox within seconds.

### Code Task Management

Submit code generation tasks with markdown instructions, choose a worker type (Auto, Opus, or GLM), and link to Linear issues. Monitor task execution in real-time through an xterm.js terminal viewer that streams logs with full ANSI color support.

**Example:** You describe a refactoring task in markdown, link it to an existing Linear issue, select a worker, and submit. The terminal viewer shows live progress as the code agent works. When done, a PR link appears in the task detail.

### GitHub PR Events

View aggregated GitHub pull request activity: reviews, comments, pushes, and status checks grouped by PR. Stay on top of your repository activity without leaving IntexuraOS.

**Example:** You open the PR Events page and see that PR #762 received 2 reviews and 3 inline comments since yesterday, all collapsed into a single expandable group.

### Dark Mode

Switch between light, dark, and system-following themes. The preference persists across sessions and applies throughout the entire UI.

**Example:** You toggle to dark mode in the header. Every page, modal, and component instantly adapts to the dark palette.

### Developer Toolbar (DevBar)

Available in local and predev environments, the DevBar provides tabs for running commands against backend services, viewing real-time PM2 logs via SSE, and monitoring Pub/Sub events. State and logs persist across page reloads.

**Example:** While developing locally, you expand the DevBar to see real-time logs from all backend services, filter to just calendar-agent, and spot a payload parsing error.

### External Integration Management

Connect and manage all your external integrations from settings pages. Google Calendar, Notion, Linear (including webhook secret configuration), WhatsApp (including phone verification), mobile notifications, worker configuration, API keys, and LLM pricing are configured in one place.

**Example:** Your Google Calendar token expires. The settings page shows "Reconnect required". One tap opens the OAuth flow, and you're back in business.

## Use Case

You wake up and open IntexuraOS on your phone. The inbox shows 5 items from overnight: 3 WhatsApp messages auto-classified as research, todos, and a note, plus 2 calendar actions awaiting approval. You tap approve on the calendar events after verifying times, then review the research report. One tap archives completed items. You check the chat to ask "what's on my plate today?" and get a summary. Then you submit a code task to fix a bug described in a Linear issue, and watch the terminal logs as it runs. You never opened WhatsApp, calendar, GitHub, or a notes app.

## Key Benefits

- Single interface for all IntexuraOS services
- Real-time updates without page refresh
- Works offline as an installed PWA
- Unified approval workflow across all action types
- AI chat assistant for natural language interaction (works without login)
- Code task submission and real-time monitoring
- Dark mode support
- External service management in one place

## Limitations

- Requires network connection for most operations (PWA caching available for static assets)
- Mobile interface optimized but some features like chart configuration and terminal logs work best on desktop
- Auth0 authentication required for most features (chat available as guest with rate limits)

---

_Part of [IntexuraOS](../overview.md) — Your AI-Native Personal Operating System_
