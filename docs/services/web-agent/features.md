# Web Agent

Web content extraction and AI summarization - fetch link previews and generate prose summaries in any language.

## The Problem

Web content is hard to work with:

1. **Raw URLs lack context** - Bare links don't reveal what content is about until you visit
2. **Manual reading takes time** - Long articles require significant time investment
3. **Language barriers** - AI summaries often lose the original language, creating jarring mixed-language content
4. **Bot detection** - Simple scrapers get blocked by 403 responses from modern websites
5. **LLM format issues** - AI models sometimes return JSON instead of prose, breaking user experience

## How It Helps

### Intelligent Page Summarization

Crawl web pages and generate clean prose summaries using the user's preferred LLM.

**Example:** A Polish news article stays in Polish. You send a URL, get a 3-minute summary that reads naturally in the source language.

**How it works:**

1. PageContentFetcher crawls with Crawl4AI (headless browser)
2. LlmSummarizer uses your LLM API key (not ours - you control costs)
3. Parser validates output and triggers self-repair if LLM returns JSON

### Rich Link Previews

Extract OpenGraph metadata for social-card-style previews.

**Example:** Share a GitHub link - immediately see repository name, description, and preview image without visiting.

**Extracted fields:**

- `title` - From og:title or HTML title
- `description` - From og:description or meta description
- `image` - Resolved absolute URL from og:image
- `favicon` - From link rel="icon" or /favicon.ico
- `siteName` - From og:site_name

### Bot-Detection Bypass

Browser-like request headers avoid 403 blocks from protective websites.

**Example:** News sites that block scrapers accept requests that look like Chrome browsers.

## Use Case

### Research workflow

1. User sends article URLs to research-agent
2. research-agent calls web-agent's `/internal/page-summaries`
3. web-agent crawls each URL with Crawl4AI
4. User's LLM API key generates prose summary
5. If LLM returns JSON, repair prompt triggers automatic retry
6. Summary returns in the article's original language

### Bookmark enrichment flow

1. User saves a link via WhatsApp: "Save this article"
2. bookmarks-agent calls `/internal/link-previews`
3. web-agent fetches OpenGraph metadata
4. Bookmark displays with title, description, and image

## Key Benefits

**User-controlled costs** - Summaries use your API keys, not shared infrastructure

**Language preservation** - Polish stays Polish, German stays German

**Self-healing AI** - Parser detects JSON format and auto-triggers repair prompt

**Bot-resistant** - Browser-like headers for higher success rate

**Partial success** - Batch requests return individual results; one failure doesn't block others

**Memory safe** - 2MB cap prevents out-of-memory errors from huge pages

## Limitations

**HTTP/HTTPS only** - No support for ftp://, file://, or other protocols

**JavaScript-rendered content** - Crawl4AI handles SPAs, but some dynamic content may be missed

**No caching** - Every request fetches fresh content

**No authentication** - Cannot access paywalled or login-protected content

**LLM API key required** - Summarization fails without user's configured API key

**403 still possible** - Browser-like headers help but don't guarantee access to all sites

**Response size** - Pages over 2MB return TOO_LARGE error

---

_Part of [IntexuraOS](../overview.md) - Extract meaning from any webpage._
