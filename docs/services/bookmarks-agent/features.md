# Bookmarks Agent

Save and organize links with automatic metadata extraction and AI-powered summaries delivered to your WhatsApp.

## The Problem

Web bookmarking is broken in multiple ways:

1. **No context** - You save a link, but weeks later you can't remember why it mattered or what it contains
2. **Manual metadata** - Browser bookmarks store just the URL and maybe a title
3. **Lost links** - URLs change, pages disappear, content gets paywalled
4. **No mobile access** - Saving links from WhatsApp conversations requires app-switching

## How It Helps

### Automatic OpenGraph Extraction

Every saved link is enriched with metadata fetched from the page: title, description, images, favicon, and site name. No manual entry required.

**Example:** You save a Medium article. Bookmarks-agent automatically captures the article title, author byline, cover image, and publication name.

### AI-Powered Summaries with WhatsApp Delivery

Links are analyzed by AI to generate concise summaries of the content. After summarization, you receive the summary directly in WhatsApp, so you can review it without opening any app.

**Example:** You bookmark a 20-minute read. Within seconds, you receive a WhatsApp message with a 3-sentence summary and key takeaways.

### Event-Driven Enrichment Pipeline

Bookmarks are processed asynchronously through a three-stage pipeline: create, enrich (fetch metadata), and summarize (AI analysis). Each stage is decoupled via Pub/Sub, ensuring reliability and scalability.

**Example:** Bookmark creation returns immediately. Metadata fetching and AI summarization happen in the background, with WhatsApp notification on completion.

### Tag-Based Organization

Organize bookmarks with custom tags. Filter by tags, archived status, or processing state to find what you need.

**Example:** Tag links with `#reading-list`, `#work`, or `#research` and quickly filter to find relevant bookmarks.

### Duplicate Detection

Prevents saving the same URL twice per user. If you try to bookmark an existing URL, you get the existing bookmark ID back.

**Example:** Someone shares the same article in two group chats. You save it once, and the second attempt returns the existing bookmark without creating a duplicate.

## Use Cases

### Save a Link from WhatsApp

1. User shares a URL in WhatsApp conversation
2. WhatsApp-service detects the link and creates a bookmark via actions-agent
3. Bookmarks-agent stores the bookmark and triggers enrichment
4. Web-agent fetches OpenGraph metadata and updates the bookmark
5. AI generates a summary and updates the bookmark
6. User receives the summary in WhatsApp via Pub/Sub event
7. Bookmark is ready for browsing in the web dashboard

### Force Refresh Stale Metadata

1. A bookmarked page has been updated
2. User requests force refresh via the web dashboard
3. Bookmarks-agent fetches fresh metadata, bypassing cache
4. OpenGraph preview is updated with new title/description/image

## Key Benefits

- **Zero-friction capture** - Save links from WhatsApp without app-switching
- **Rich metadata** - Title, description, images automatically extracted
- **AI summaries** - Quick overview without visiting the page
- **WhatsApp delivery** - Summaries sent directly to your chat (INT-210)
- **Reliable processing** - Event-driven pipeline handles failures gracefully
- **Tag-based filtering** - Organize by project, topic, or priority

## Limitations

- **No full-text search** - Can only filter by tags and processing status
- **No link validation** - Does not periodically check if URLs still work
- **No folder hierarchy** - Tags are flat, no nested organization
- **No sharing** - Bookmarks are private to each user
- **No import/export** - Cannot bulk import browser bookmarks
- **Metadata depends on page** - Some sites block scrapers or lack OpenGraph tags

---

_Part of [IntexuraOS](../overview.md) - Capture, summarize, and organize your web._
