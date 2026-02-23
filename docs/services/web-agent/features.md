# Web Agent

Web content extraction and AI summarization -- fetch link previews and generate prose summaries in any language.

## The Problem

Web content is hard to work with:

1. **Raw URLs lack context** -- Bare links don't reveal what content is about until you visit
2. **Manual reading takes time** -- Long articles require significant time investment
3. **Language barriers** -- AI summaries often lose the original language, creating jarring mixed-language content
4. **Bot detection** -- Simple scrapers get blocked by 403 responses from modern websites
5. **LLM format issues** -- AI models sometimes return JSON instead of prose, breaking user experience

## How It Helps

### Intelligent Page Summarization

Crawl web pages and generate clean prose summaries using the user's preferred LLM. Summaries focus on the actual page content rather than describing the platform or site structure.

**Example:** A Polish news article stays in Polish. You send a URL, get a 3-minute summary that reads naturally in the source language and focuses on what the article says, not what the platform is.

**How it works:**

1. PageContentFetcher crawls with Crawl4AI (headless browser)
2. LlmSummarizer resolves which LLM to use: user's own API key, then platform Gemini 2.5 Flash, then platform ZAI
3. Content focus instructions prevent platform descriptions (e.g., no "LinkedIn is a professional network" preambles)
4. Parser validates output and triggers self-repair if LLM returns JSON

### Rich Link Previews

Extract OpenGraph metadata for social-card-style previews.

**Example:** Share a GitHub link -- immediately see repository name, description, and preview image without visiting.

**Extracted fields:**

- `title` -- From og:title or HTML title
- `description` -- From og:description or meta description
- `image` -- Resolved absolute URL from og:image
- `favicon` -- From link rel="icon" or /favicon.ico
- `siteName` -- From og:site_name

### Bot-Detection Bypass

Browser-like request headers avoid 403 blocks from protective websites.

**Example:** News sites that block scrapers accept requests that look like Chrome browsers.

## Use Case

### Research workflow

1. User sends article URLs to research-agent
2. research-agent calls web-agent's `/internal/page-summaries`
3. web-agent crawls each URL with Crawl4AI
4. User's LLM API key (or platform Gemini fallback) generates prose summary
5. If LLM returns JSON, repair prompt triggers automatic retry
6. Summary returns in the article's original language

### Bookmark enrichment flow

1. User saves a link via WhatsApp: "Save this article"
2. bookmarks-agent calls `/internal/link-previews`
3. web-agent fetches OpenGraph metadata
4. Bookmark displays with title, description, and image

## Key Benefits

**Works without user API keys** -- Platform Gemini 2.5 Flash fallback means summaries work even before users configure their own LLM keys

**User-controlled costs** -- When users add their own API keys, those are used instead of shared infrastructure

**Language preservation** -- Polish stays Polish, German stays German

**Content-focused summaries** -- Summarizes what the page says, not what the platform is

**Self-healing AI** -- Parser detects JSON format and auto-triggers repair prompt

**Bot-resistant** -- Browser-like headers for higher success rate

**Rate limit awareness** -- Crawl4AI 429 responses return a specific RATE_LIMITED error code for proper backoff handling

**Partial success** -- Batch requests return individual results; one failure does not block others

**Memory safe** -- 2MB cap prevents out-of-memory errors from huge pages

**Observable** -- Distributed tracing via Dash0 OpenTelemetry for latency and error tracking

## Limitations

**HTTP/HTTPS only** -- No support for ftp://, file://, or other protocols

**JavaScript-rendered content** -- Crawl4AI handles SPAs, but some dynamic content may be missed

**No caching** -- Every request fetches fresh content

**No authentication** -- Cannot access paywalled or login-protected content

**403 still possible** -- Browser-like headers help but do not guarantee access to all sites

**Response size** -- Pages over 2MB return TOO_LARGE error

---

_Part of [IntexuraOS](../overview.md) -- Extract meaning from any webpage._
