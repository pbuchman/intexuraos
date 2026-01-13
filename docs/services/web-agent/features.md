# Web Agent

OpenGraph metadata extraction - fetch rich link previews from URLs with title, description, images, and favicon.

## The Problem

URLs shared by users lack context:

1. **No metadata** - Bare URLs don't show what content is about
2. **Manual scraping** - Each service would need to implement its own fetcher
3. **Error handling** - Network failures, timeouts, large responses need management
4. **Image resolution** - Relative image paths need proper URL resolution

## How It Helps

Web-agent provides centralized link preview extraction:

1. **OpenGraph parsing** - Extracts og:title, og:description, og:image, og:site_name
2. **Fallback metadata** - Falls back to HTML title and meta description tags
3. **Favicon detection** - Finds favicon from multiple link rel attributes
4. **URL resolution** - Converts relative image paths to absolute URLs
5. **Size limits** - Caps response at 2MB to prevent memory issues
6. **Timeout handling** - 5-second default timeout per request
7. **Batch processing** - Fetch multiple URLs in parallel

## Key Features

**Extracted Metadata:**
- `title` - From og:title or HTML title
- `description` - From og:description or meta description
- `image` - Resolved absolute URL from og:image
- `favicon` - From icon link tags or /favicon.ico fallback
- `siteName` - From og:site_name

**Error Codes:**
- `FETCH_FAILED` - HTTP errors or network issues
- `TIMEOUT` - Request exceeded timeout
- `TOO_LARGE` - Response over 2MB
- `INVALID_URL` - Malformed URL or unsupported protocol

**Partial Success:** Batch requests return individual results - some may succeed while others fail.

## Use Cases

### Bookmark creation flow

1. User shares URL via WhatsApp: "Save this link"
2. commands-agent classifies as `link`
3. bookmarks-agent calls web-agent to fetch preview
4. Preview stored with bookmark for rich display

### Research citation flow

1. User provides article URLs in research query
2. research-agent calls web-agent for metadata
3. Citations formatted with title and description

### Message link preview flow

1. User sends message containing URLs
2. whatsapp-service detects URLs in text
3. web-agent fetches preview via Pub/Sub
4. Message updated with og:image and title

## Key Benefits

**Centralized fetching** - Single service for all link preview needs

**Parallel processing** - Multiple URLs fetched simultaneously

**Graceful degradation** - Failed URLs don't block successful ones

**Memory safe** - 2MB cap prevents out-of-memory errors

**Standard protocol** - Respects robots.txt, follows redirects

**Browser-like UA** - Uses IntexuraOSBot user agent for identification

## Limitations

**HTTP/HTTPS only** - No support for ftp://, file://, or other protocols

**No JavaScript** - Cannot extract content rendered client-side

**No caching** - Every request hits the target server

**No authentication** - Cannot access paywalled or auth-protected content

**Single-page apps** - Limited metadata on JS-rendered sites

**Rate limiting** - No built-in rate limiting (caller must implement)

**Response size** - Pages over 2MB return TOO_LARGE error
