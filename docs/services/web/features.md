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

### External Integration Management

Connect and manage all your external integrations from settings pages. Google Calendar, Notion, Linear, WhatsApp, mobile notifications, and API keys are configured in one place.

**Example:** Your Google Calendar token expires. The settings page shows "Reconnect required". One tap opens the OAuth flow, and you're back in business.

## Use Case

You wake up and open IntexuraOS on your phone. The inbox shows 5 items from overnight: 3 WhatsApp messages auto-classified as research, todos, and a note, plus 2 calendar actions awaiting approval. You tap approve on the calendar events after verifying times, then review the research report. One tap archives completed items. You never opened WhatsApp, calendar, or a notes app.

## Key Benefits

- Single interface for all IntexuraOS services
- Real-time updates without page refresh
- Works offline as an installed PWA
- Unified approval workflow across all action types
- External service management in one place

## Limitations

- Requires network connection for most operations (PWA caching available for static assets)
- Mobile interface optimized but some features like chart configuration work best on desktop
- Auth0 authentication required (no guest access)

---

_Part of [IntexuraOS](../overview.md) — Your AI-Native Personal Operating System_
