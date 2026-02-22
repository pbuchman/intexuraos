# Web App

The single-page Progressive Web App that brings all of IntexuraOS into one unified dashboard.

## The Problem

Managing your digital life across multiple services creates constant friction. Switching between WhatsApp for messages, calendar for events, notes for thoughts, and bookmarks for links breaks your flow. Each interface has different patterns, requires context switching, and lacks unified visibility into what needs your attention.

## How It Helps

### Unified Command Center

Access all IntexuraOS capabilities from a single, fast interface. Inbox, research, calendar, notes, todos, bookmarks, Linear issues, and data insights are one tap away.

**Example:** Open the app to see 3 actions awaiting approval, 2 research reports ready, and calendar events for today -- no tab switching required.

### Real-Time Action Inbox

Watch actions arrive and update in real-time via Firestore listeners. Approve, reject, or execute with a single tap. Filter by status, archive completed items, and deep-link to specific actions.

**Example:** You send a WhatsApp message "schedule team standup for Tuesday 2pm". Within seconds, a calendar preview appears in your inbox. You review the event details and tap approve -- it is created immediately.

### Configurable Action Buttons

Every action displays dynamically generated buttons based on YAML configuration. Approve, reject, retry, delete, or custom actions execute directly from the UI with standardized confirmation dialogs across all pages.

**Example:** A research action shows "Approve", "Retry with different models", and "Delete" buttons. A calendar action shows "Approve" with the event preview card, or "Reject" if the time doesn't work. Delete actions always prompt for confirmation before proceeding.

### Progressive Web App

Install IntexuraOS on your home screen for an app-like experience on mobile. Offline support, push notifications, and background sync keep you productive without a constant connection.

**Example:** Commuting without signal? Open the app to review previously loaded actions. Your actions queue locally and execute when connectivity returns.

### Intex Chat Assistant

Talk to IntexuraOS using natural language through the floating chat bubble. Ask questions, create commands, and get context-aware responses. Works for both authenticated users and guests.

**Example:** You type "remind me to call the dentist tomorrow" in the chat. The assistant suggests creating a todo command. You confirm, and it appears in your inbox within seconds.

### Code Task Management with Two-Phase Execution

Submit code generation tasks with markdown instructions, choose a model (Auto, Opus, or GLM via default model selector), and link to Linear issues. Filter tasks by multiple statuses simultaneously and paginate through results. Tasks support a two-phase design/execution flow: when a design task produces an implementation plan, the UI shows a banner linking directly to the implementation task.

Monitor task execution through a live log stream that color-codes each log line by type -- user messages, prompts, tool calls, errors, and orchestrator output each render in distinct colors. Tool output blocks collapse into expandable sections so long tool results do not overwhelm the log view. Send follow-up messages in a queue without interrupting the running task. Retry interrupted or failed tasks from the task detail page.

**Example:** You describe a refactoring task, select Auto worker, and submit. The log stream shows live progress with color-coded lines. A tool call returns 200 lines of output -- it collapses automatically with a "Show tool output" toggle. When the design phase completes, a "View implementation task" banner appears. One click takes you to the execution task already in progress.

### GitHub PR Events

View aggregated GitHub pull request activity: reviews, comments, pushes, and status checks grouped by PR. PR groups load summaries immediately; full event details load lazily when you expand a group. Comment bodies render in GitHub style with HTML support. Synchronize events show the compare URL for the push.

**Example:** You open the PR Events page and see that PR #762 received 2 reviews and 3 inline comments since yesterday, all collapsed into a single expandable group. You click the group to expand it and read the inline comment text without leaving IntexuraOS.

### Linear Issues Dashboard

View your Linear board as a 3-column layout: Planning, Work, and Closed. Sub-issues appear indented under their parent. Labels show as colored badges on each issue. Assignee names display on issue cards with emerald green badges. The board updates in real-time via Firestore -- no manual sync needed.

**Example:** You open Linear and see a parent issue with 3 child tasks. One child just moved to "In Review" and its badge updated without you refreshing. The assignee badge shows who is working on it.

### Saved Data Visualizations

Create Vega/Vega-Lite chart visualizations from your composite data feeds and save them. Browse saved visualizations globally or per-feed. Charts persist across sessions and are shareable within your account.

**Example:** You build a weekly spending chart from a composite feed, save it, and pin it to your Data Insights dashboard. It reloads automatically the next time you open the app.

### Dark Mode

Switch between light, dark, and system-following themes. The preference persists across sessions and applies throughout the entire UI.

**Example:** You toggle to dark mode in the header. Every page, modal, and component instantly adapts to the dark palette.

### Developer Toolbar (DevBar)

Available in dev environments (local and dev machine), the DevBar provides tabs for running commands against backend services, viewing real-time PM2 logs via SSE, and monitoring Pub/Sub events. State and logs persist across page reloads.

**Example:** While developing on the dev machine, you expand the DevBar to see real-time logs from all backend services, filter to just calendar-agent, and spot a payload parsing error.

### External Integration Management

Connect and manage all your external integrations from settings pages. Google Calendar, Notion, Linear (including webhook secret configuration), WhatsApp (including phone verification), mobile notifications, worker configuration (with drag-and-drop priority reordering), API keys, and LLM pricing are configured in one place. Worker secret fields prevent browser autofill for security.

**Example:** Your Google Calendar token expires. The settings page shows "Reconnect required". One tap opens the OAuth flow, and you are back in business.

### Persistent User Preferences

Filter selections, sidebar collapse state, active tab choices, and status filters persist across page refreshes via localStorage. Navigate away and return to find the UI exactly as you left it.

**Example:** You collapse the sidebar, filter the inbox to show only "awaiting_approval" actions, switch to the commands tab, and then close the browser. When you return, the sidebar is still collapsed, the filter is active, and the commands tab is selected.

## Use Case

You wake up and open IntexuraOS on your phone. The inbox shows 5 items from overnight: 3 WhatsApp messages auto-classified as research, todos, and a note, plus 2 calendar actions awaiting approval. You tap approve on the calendar events after verifying times, then review the research report. One tap archives completed items. You check the chat to ask "what's on my plate today?" and get a summary. Then you submit a code task to fix a bug described in a Linear issue, filter the task list to show only running and failed tasks, and watch the live log stream as it runs. Tool output from long commands collapses into expandable blocks. When the design phase finishes, you navigate to the implementation task from the banner. You never opened WhatsApp, calendar, GitHub, or a notes app.

## Key Benefits

- Single interface for all IntexuraOS services
- Real-time updates without page refresh
- Works offline as an installed PWA
- Unified approval workflow across all action types
- AI chat assistant for natural language interaction (works without login)
- Code task submission with two-phase design/execution tracking
- Real-time log stream with color-coded lines, collapsible tool output, follow mode, and message queuing
- Multi-status code task filtering with persistent filter state
- GitHub PR events with lazy loading and HTML comment rendering
- Linear board with sub-issues, assignee badges, labels, and Firestore real-time updates
- Saved data visualizations per feed
- Dark mode support
- External service management in one place
- All user preferences persist across sessions

## Limitations

- Requires network connection for most operations (PWA caching available for static assets)
- Mobile interface optimized but some features like chart configuration and terminal logs work best on desktop
- Auth0 authentication required for most features (chat available as guest with rate limits)

---

_Part of [IntexuraOS](../overview.md) -- Your AI-Native Personal Operating System_
