# Web Agent -- Technical Reference

## Overview

Web-agent extracts web content and generates AI summaries. It uses Crawl4AI for headless browser crawling, Cheerio for OpenGraph parsing, and the user's configured LLM (with a platform Gemini 2.5 Flash, then ZAI fallback) for summarization with automatic response repair.

Runs on Cloud Run with auto-scaling (0-1 instances). Port 8127 on local/dev. Distributed tracing via Dash0 OpenTelemetry (transparent preload).

## Architecture

```mermaid
graph TB
    subgraph "Callers"
        RA[research-agent]
        BA[bookmarks-agent]
    end

    subgraph "web-agent"
        Routes[Fastify Routes]
        PCF[PageContentFetcher]
        LLM[LlmSummarizer]
        OGF[OpenGraphFetcher]
        Parser[parseSummaryResponse]
        Repair[summaryRepairPrompt]
    end

    subgraph "External"
        C4AI[Crawl4AI API]
        UserLLM[User's LLM Provider]
        PlatformLLM[Platform Gemini/ZAI]
        Target[Target URLs]
    end

    subgraph "Internal Services"
        US[user-service]
        AS[app-settings-service]
    end

    RA -->|POST /internal/page-summaries| Routes
    BA -->|POST /internal/link-previews| Routes

    Routes --> PCF
    Routes --> OGF

    PCF -->|crawl| C4AI
    C4AI -->|fetch| Target

    Routes --> LLM
    LLM -->|get user keys + fallback| US
    LLM -->|generate| UserLLM
    LLM -->|fallback| PlatformLLM
    LLM --> Parser
    Parser -->|invalid| Repair
    Repair -->|retry| LLM

    OGF -->|fetch HTML| Target
    OGF -->|parse| Cheerio[Cheerio]

    AS -.->|pricing at startup| Routes

    classDef service fill:#e1f5ff
    classDef external fill:#f0f0f0
    classDef internal fill:#fff4e6

    class Routes,PCF,LLM,OGF,Parser,Repair service
    class C4AI,UserLLM,PlatformLLM,Target external
    class US,AS internal
```

## Data Flow -- Page Summarization

```mermaid
sequenceDiagram
    autonumber
    participant Caller
    participant WebAgent as web-agent
    participant Crawl4AI
    participant UserService as user-service
    participant LLM as LLM (user's or platform)

    Caller->>+WebAgent: POST /internal/page-summaries<br/>{url, userId}
    WebAgent->>Crawl4AI: Crawl URL (browser strategy)
    Crawl4AI-->>WebAgent: markdown content
    WebAgent->>UserService: getLlmClient(userId)
    UserService-->>WebAgent: LLM client (user key -> Gemini fallback -> ZAI fallback)
    WebAgent->>LLM: Generate summary
    LLM-->>WebAgent: "Here is the summary: {...}"
    WebAgent->>WebAgent: parseSummaryResponse()
    alt Response is JSON
        WebAgent->>LLM: Repair prompt
        LLM-->>WebAgent: Clean prose
    end
    WebAgent-->>-Caller: {summary, wordCount, estimatedReadingMinutes}
```

## Recent Changes

| Commit     | Description                                                  | Date       |
| ---------- | ------------------------------------------------------------ | ---------- |
| `b3f34d85` | Release v3.1.0                                               | 2026-02-22 |
| `c8a42105` | Release v3.0.0                                               | 2026-02-19 |
| `884bc168` | Add semver `version` field to PromptBuilder (1.0.0)          | 2026-02-19 |
| `6063175b` | Add dev-mode log formatting for PM2 readability              | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration (transparent preload)    | 2026-02-16 |
| `e60eafc1` | Rename `CRAWL4AI_API_KEY` to `CRAWL4AI_APP_API_KEY`          | 2026-02-15 |
| `c72b7c53` | Switch default LLM to Gemini 2.5 Flash + add Gemini fallback | 2026-02-15 |
| `0f69a74b` | Add platform ZAI fallback for users without API keys         | 2026-02-09 |
| `3a5d9380` | INT-533 Add content focus instructions to summary prompt     | 2026-02-07 |
| `d105688f` | Add RATE_LIMITED error code for Crawl4AI 429 responses       | 2026-01-30 |
| `c3198407` | Fix response contract violations (reply.ok/reply.fail)       | 2026-01-30 |
| `dfd702f1` | Migrate to Sentry-enabled createAppLogger                    | 2026-01-30 |
| `5aa3e1bd` | INT-427 Enable strict 100% coverage enforcement              | 2026-01-31 |
| `73e8375f` | INT-408 Enforce mandatory env var registration               | 2026-01-28 |

## API Endpoints

### Internal Endpoints

| Method | Path                       | Description                                  | Auth           |
| ------ | -------------------------- | -------------------------------------------- | -------------- |
| POST   | `/internal/link-previews`  | Fetch OpenGraph metadata for URLs            | Internal token |
| POST   | `/internal/page-summaries` | Crawl and summarize a web page with user LLM | Internal token |

### System Endpoints

| Method | Path            | Description               | Auth |
| ------ | --------------- | ------------------------- | ---- |
| GET    | `/health`       | Health check              | None |
| GET    | `/docs`         | Swagger UI                | None |
| GET    | `/openapi.json` | OpenAPI spec (JSON)       | None |

### Link Previews Request

```typescript
interface FetchLinkPreviewsBody {
  urls: string[]; // 1-10 URLs
  timeoutMs?: number; // 1000-30000ms (default: 5000)
}
```

### Link Previews Response

```typescript
interface FetchLinkPreviewsResponse {
  results: LinkPreviewResult[];
  metadata: {
    requestedCount: number;
    successCount: number;
    failedCount: number;
    durationMs: number;
  };
}
```

### Page Summaries Request

```typescript
interface SummarizePageBody {
  url: string; // URL to summarize
  userId: string; // User ID for LLM key lookup
  maxSentences?: number; // 1-50 (default: 20)
  maxReadingMinutes?: number; // 1-10 (default: 3)
}
```

### Page Summaries Response

```typescript
interface SummarizePageResponse {
  result: PageSummaryResult;
  metadata: {
    durationMs: number;
  };
}

interface PageSummary {
  url: string;
  summary: string;
  wordCount: number;
  estimatedReadingMinutes: number;
}
```

## Domain Models

### LinkPreview

| Field         | Type                  | Description                 |
| ------------- | --------------------- | --------------------------- |
| `url`         | `string`              | Original URL                |
| `title`       | `string \             | undefined`                  | og:title or HTML title |
| `description` | `string \             | undefined`                  | og:description or meta desc |
| `image`       | `string \             | undefined`                  | Resolved absolute og:image |
| `favicon`     | `string \             | undefined`                  | Favicon URL |
| `siteName`    | `string \             | undefined`                  | og:site_name |

### LinkPreviewError

| Code            | Meaning                                 |
| --------------- | --------------------------------------- |
| `FETCH_FAILED`  | HTTP errors or network issues           |
| `TIMEOUT`       | Request exceeded timeout                |
| `TOO_LARGE`     | Response over 2MB                       |
| `INVALID_URL`   | Malformed URL or unsupported protocol   |
| `ACCESS_DENIED` | HTTP 403 -- website blocked the request |

### PageSummaryError

| Code           | Meaning                               |
| -------------- | ------------------------------------- |
| `FETCH_FAILED` | Crawl4AI failed to fetch page         |
| `TIMEOUT`      | Crawl exceeded 60s timeout            |
| `NO_CONTENT`   | No markdown extracted from page       |
| `API_ERROR`    | LLM API error or user service error   |
| `INVALID_URL`  | Malformed URL or unsupported protocol |
| `TOO_LARGE`    | Response exceeds size limit           |
| `RATE_LIMITED` | Crawl4AI returned HTTP 429 rate limit |

## Key Components

### PageContentFetcher

Crawls pages via Crawl4AI Cloud API without LLM extraction.

**Configuration:**

| Setting     | Default                    | Description             |
| ----------- | -------------------------- | ----------------------- |
| `baseUrl`   | `https://api.crawl4ai.com` | Crawl4AI Cloud endpoint |
| `timeoutMs` | 60000                      | Crawl timeout           |
| `apiKey`    | (required)                 | Crawl4AI API key        |

**Strategy:** Uses `browser` strategy for JavaScript rendering.

### LlmSummarizer

Generates prose summaries with automatic repair on parse failures.

**Flow:**

1. Build prompt with language preservation and content focus instructions
2. Send to user's LLM via `llm-factory` (or platform fallback)
3. Parse response with `parseSummaryResponse()`
4. If JSON detected, send repair prompt and retry once
5. Return `PageSummary` or error

**Key features:**

- Prompt includes "Write in SAME LANGUAGE as original content" instruction
- Content focus section guides LLM to summarize actual page content, not platform descriptions (INT-533)
- Both `summaryPrompt` and `summaryRepairPrompt` implement `PromptBuilder` with `version: '1.0.0'`

### parseSummaryResponse

Validates LLM output is clean prose.

**Checks:**

- Not empty after cleaning
- Not JSON format (objects/arrays)
- Strips unwanted prefixes ("Here is", "Summary:", etc.)
- Strips markdown code blocks

**Returns:** `{ summary: string, wordCount: number }` or `ParseError`

### OpenGraphFetcher

Fetches and parses OpenGraph metadata.

**Browser-like headers:**

```typescript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}
```

**Configuration:**

| Setting           | Default       | Description           |
| ----------------- | ------------- | --------------------- |
| `timeoutMs`       | 5000          | Request timeout       |
| `maxResponseSize` | 2097152 (2MB) | Maximum response size |

## Dependencies

### External Services

| Service    | Purpose            | Failure Mode        |
| ---------- | ------------------ | ------------------- |
| Crawl4AI   | Web page crawling  | Return FETCH_FAILED |
| User's LLM | Summary generation | Return API_ERROR    |
| Dash0      | OpenTelemetry sink | Silent (optional)   |

### Internal Services

| Service              | Endpoint               | Purpose                                        |
| -------------------- | ---------------------- | ---------------------------------------------- |
| user-service         | `getLlmClient(userId)` | Get LLM client (user key or platform fallback) |
| app-settings-service | `fetchAllPricing()`    | LLM pricing context at startup                 |

**Integration Note:** web-agent uses `@intexuraos/internal-clients/user-service` for type-safe, validated communication with user-service. This package provides:

- `createUserServiceClient()` -- Factory for configured client
- `UserServiceClient` interface with `getLlmClient()` method
- Automatic error handling and result types
- Platform Gemini 2.5 Flash, then ZAI fallback when user has no API key

## Configuration

| Variable                              | Purpose                            | Required |
| ------------------------------------- | ---------------------------------- | -------- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Internal service auth              | Yes      |
| `INTEXURAOS_CRAWL4AI_APP_API_KEY`     | Crawl4AI Cloud API key             | Yes      |
| `INTEXURAOS_USER_SERVICE_URL`         | User service base URL              | Yes      |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Pricing lookup                     | Yes      |
| `INTEXURAOS_SENTRY_DSN`               | Error tracking                     | Yes      |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | Platform Gemini 2.5 Flash fallback | Optional |
| `INTEXURAOS_ZAI_APP_API_KEY`          | Platform ZAI secondary fallback    | Optional |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`      | Dash0 OpenTelemetry endpoint       | Optional |

All five required vars are validated at startup via `validateRequiredEnv()`. Note that `INTEXURAOS_SENTRY_DSN` is validated separately with a direct check. Optional fallback keys are passed to `createUserServiceClient()` and are no-ops when unset.

## Gotchas

**Crawl vs Summary separation** -- PageContentFetcher only crawls; LlmSummarizer handles AI. This allows using user's LLM keys rather than shared infrastructure.

**Platform fallback chain** -- When a user has no API key for their chosen provider, `getLlmClient()` falls back to Gemini 2.5 Flash (platform key), then to ZAI (platform key). `API_ERROR` with "No API key" only surfaces if both platform keys are also unset.

**Repair mechanism** -- If LLM returns JSON, parser detects it and triggers repair prompt automatically. Only retries once.

**Language preservation** -- Summary prompt explicitly instructs "Write in SAME LANGUAGE as original content" to prevent English summaries of non-English articles.

**403 handling** -- Returns `ACCESS_DENIED` error code specifically for 403 responses, distinct from general `FETCH_FAILED`.

**Browser-like headers** -- OpenGraphFetcher sends Chrome-like headers including Sec-Fetch-* to bypass basic bot detection.

**User LLM client** -- Summaries use user's API key from user-service when available; pricing tracked per-user regardless of which key is used.

**Empty response handling** -- `nonEmpty()` helper treats empty strings same as undefined for fallback logic.

**Concurrent link previews** -- All URLs fetched in parallel via Promise.all. One timeout does not affect others.

**Rate limiting (429)** -- Crawl4AI 429 responses return `RATE_LIMITED` error code, distinct from general `API_ERROR`.

**Content focus prompting** -- Summary prompts include a CONTENT FOCUS section that prevents LLM from describing the platform instead of the actual content (e.g., avoids "LinkedIn is a professional network" preambles).

**PromptBuilder versioning** -- Both `summaryPrompt` and `summaryRepairPrompt` use the `PromptBuilder` interface with semver `version: '1.0.0'`. Bump the version when changing prompt content.

**Sentry logging** -- Uses `createAppLogger()` from `@intexuraos/infra-sentry` for automatic error forwarding to Sentry.

**Response contract** -- All internal routes use `reply.ok()` / `reply.fail()` instead of raw `reply.send()` / `reply.status()`.

**Dash0 OpenTelemetry** -- Distributed tracing is loaded via `--import ./dist/otel-register.js` in the Dockerfile CMD. It is a no-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset, so local dev is unaffected.

**No Firestore** -- This service is stateless. It does not own any Firestore collections.

**Pricing at startup** -- The service fetches LLM pricing from app-settings-service at startup and passes it to the user service client for cost tracking.

## File Structure

```
apps/web-agent/src/
  domain/
    linkpreview/
      models/
        LinkPreview.ts           # LinkPreview, LinkPreviewError types
      ports/
        linkPreviewFetcher.ts    # Fetcher interface
    pagesummary/
      models/
        PageSummary.ts           # PageSummary, PageSummaryError types
      ports/
        pageSummaryService.ts    # Service interface
  infra/
    linkpreview/
      openGraphFetcher.ts        # Cheerio-based OG extraction
    pagesummary/
      pageContentFetcher.ts      # Crawl4AI client (crawl only, with RATE_LIMITED handling)
      llmSummarizer.ts           # User's LLM summarization (with platform fallback)
      crawl4aiClient.ts          # Legacy combined client (deprecated)
      parseSummaryResponse.ts    # Response validation
      buildSummaryRepairPrompt.ts # PromptBuilder prompts v1.0.0 (with content focus section)
  routes/
    internalRoutes.ts            # /internal/* endpoints
    schemas/
      linkPreviewSchemas.ts      # Request/response schemas
      pageSummarySchemas.ts      # Request/response schemas
  services.ts                    # DI container
  server.ts                      # Fastify server
  index.ts                       # Entry point
```

**Package Dependencies:**

- `@intexuraos/internal-clients` -- Type-safe clients for internal services (with fallback chain)
- `@intexuraos/llm-pricing` -- Pricing context for LLM cost tracking
- `@intexuraos/llm-factory` -- User's LLM client generation
- `@intexuraos/infra-otel` -- OpenTelemetry preload for Dash0 tracing
- `@intexuraos/llm-prompts` -- PromptBuilder interface with semver versioning
- `@intexuraos/llm-utils` -- `createDetailedParseErrorMessage()` for structured LLM parse error context
- `cheerio` -- HTML parsing for OpenGraph metadata extraction
