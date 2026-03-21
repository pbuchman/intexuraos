# Web Agent

The eyes of the system — reads the internet so you don't have to.

## The Problem

The modern web is vast, noisy, and multilingual. When you save a link or start a research session, you face the same friction every time:

1. **Bare URLs say nothing** — A raw link gives no hint of what is on the other side until you click through and read
2. **Reading takes time** — A ten-minute article demands ten minutes, even when you only need the gist
3. **Summaries lose the language** — Most AI tools default to English, so a Polish article comes back in English, stripping context and nuance

## Use Case

Web Agent is a behind-the-scenes utility. It has no user-facing interface of its own. Instead, other agents call on it when they need to understand a web page:

### Research enrichment

When the research agent digests source articles, it asks Web Agent to fetch and summarize each URL. The researcher gets clean, readable summaries alongside AI-generated analysis — all in the language the article was written in.

### Bookmark previews

When you save a link through WhatsApp, the bookmarks agent asks Web Agent to pull the page's metadata: title, description, cover image, favicon, and site name. The result is a rich visual card in your bookmarks dashboard — no manual entry, no guessing what the link was about.

## How It Helps

### Page summarization in the original language

Send a URL, get back a focused summary of what the page actually says. The summarization pipeline fetches the full page content through a headless browser, then passes it through an LLM with strict instructions: summarize the content, not the platform, and write in the same language as the source material.

A Polish news article stays in Polish. A German blog post stays in German. The summary focuses on what was said — not on explaining that "LinkedIn is a professional networking site" or "Medium is a publishing platform."

You can control the length by setting a maximum number of sentences or a target reading time in minutes. The response includes a word count and estimated reading time so downstream agents can decide how to present it.

### Rich link previews

Given a batch of URLs, Web Agent fetches OpenGraph metadata from each page and returns structured preview data: title, description, image, favicon, and site name. This is the same metadata that powers social media link cards, extracted and delivered as clean data.

Batch requests support partial success — if one URL in a set fails, the rest still return. Each result carries its own status, so the calling agent knows exactly which links succeeded and which did not.

### Works without user API keys

Summarization uses the user's own LLM credentials when available, keeping costs under the user's control. But if no API key is configured, the platform provides a fallback model automatically. New users get working summaries from day one, with no setup required.

## Key Benefits

- **Language preservation** — Polish stays Polish, German stays German, English stays English
- **Content-focused** — Summaries capture what the page says, not what the website is
- **Zero-configuration start** — Platform fallback means summaries work before users add their own API keys
- **User-controlled costs** — When users bring their own keys, their keys are used
- **Batch-friendly** — Link preview requests handle multiple URLs at once with per-URL success tracking
- **Reads pages that block scrapers** — Realistic browser headers mean sites that reject automated requests still return content

## Limitations

- **Works behind the scenes** — End users never interact with this service directly; it runs in the background, called by other agents in the platform
- **Summarization quality varies** — Pages with poor structure, heavy JavaScript rendering, or minimal text content may produce weaker summaries
- **Some sites block automated access** — Despite browser-like headers, certain websites still reject non-browser requests
- **No result caching** — Every request fetches fresh content from the source URL
- **No authenticated content** — Cannot access paywalled or login-protected pages

---

_Part of [IntexuraOS](../overview.md) — reads the web so the rest of the system doesn't have to._
