# Replace Crawl4AI with Cloudflare Markdown Endpoint - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Crawl4AI page content extraction client in `web-agent` with Cloudflare's Browser Rendering `/markdown` REST API endpoint, achieving better reliability, lower maintenance, and reduced extraction failures.

**Architecture:** The `PageContentFetcher` interface remains unchanged -- only the underlying HTTP client implementation swaps from Crawl4AI to Cloudflare. A new `cloudflareMarkdownClient.ts` replaces both `crawl4aiClient.ts` (legacy) and `pageContentFetcher.ts` (current). Consumers (`internalRoutes.ts`, `bookmarks-agent`) require zero changes because the interface contract is preserved.

**Tech Stack:** TypeScript, Fastify, Cloudflare Browser Rendering REST API (`/markdown` endpoint), Terraform (GCP Secret Manager), `nock` for HTTP mocking in tests.

---

## Investigation Findings

### Why `/markdown` Instead of `/crawl`

The issue title references "crawl endpoint" but after investigating all Cloudflare Browser Rendering REST API endpoints (as of 2026-03-29), the **`/markdown` endpoint** is the correct choice:

| Endpoint    | Type                           | Use Case                             | Fit                                 |
| ----------- | ------------------------------ | ------------------------------------ | ----------------------------------- |
| `/crawl`    | **Async** (job-based, polling) | Crawl entire websites, discover URLs | Overkill -- we extract single pages |
| `/markdown` | **Sync** (immediate response)  | Extract markdown from a single URL   | Perfect fit                         |

The `/markdown` endpoint:
- Renders the page in a headless browser (handles JS-rendered content)
- Returns cleaned markdown directly in the response
- No job polling complexity
- Same authentication and rate limits as `/crawl`

### Cloudflare API Contract

**Endpoint:**
```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/markdown
```

**Authentication:** Bearer token via `Authorization: Bearer <api_token>`

**Request body:**
```json
{
  "url": "https://example.com",
  "rejectResourceTypes": ["image", "media", "font", "stylesheet"]
}
```

Key parameters:
- `url` (string, required) -- the page to extract markdown from
- `rejectResourceTypes` (string[], optional) -- skip unnecessary resources for faster rendering
- `gotoOptions` (object, optional) -- control page load behavior (e.g., `waitUntil`)
- `setExtraHTTPHeaders` (object, optional) -- custom headers for the target page

**Response (Cloudflare v4 API envelope):**
```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": "<markdown content as string>"
}
```

> **Implementation note:** The exact shape of `result` (string vs object with `markdown` field) must be verified during TDD by the implementing agent. The test mocks should be structured to match the real API response. If `result` is an object, extract the markdown field. The client code should handle both cases defensively.

### Rate Limits & Free Tier

| Resource              | Free Tier       | Paid Tier ($5+/mo)        |
| --------------------- | --------------- | ------------------------- |
| Browser time/day      | 10 minutes      | Usage-based (unlimited)   |
| Concurrent browsers   | 3               | 30                        |
| REST API requests/min | 6 (1 every 10s) | 600 (10/s)                |
| Timeout per request   | 60 seconds      | 60s (extensible to 10min) |

**Free tier capacity estimate:** At ~5-10 seconds browser time per page, the free tier supports ~60-120 bookmark extractions/day. For heavier usage, upgrade to the paid Workers plan.

### Environment Variables

**New (add):**
- `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID` -- Cloudflare account ID (found in dashboard URL)
- `INTEXURAOS_CLOUDFLARE_API_TOKEN` -- API token with "Browser Rendering - Edit" permission

**Removed (delete):**
- `INTEXURAOS_CRAWL4AI_APP_API_KEY` -- no longer needed

These must be updated in all three locations per CLAUDE.md rules:
1. `apps/web-agent/src/index.ts` (`REQUIRED_ENV` array)
2. `terraform/environments/dev/main.tf` (secret definitions + web-agent module)
3. `ecosystem.config.cjs` (web-agent env block)

---

## Endpoint Changes

- **Modified:** None -- the internal API endpoint `POST /internal/page-summaries` is unchanged.
- **Created:** None.
- **Removed:** None.
- **Unchanged:** `POST /internal/page-summaries` -- same request/response contract. Consumers (bookmarks-agent) require zero changes.

---

## File Structure

### Created
| File                                                                              | Responsibility                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/web-agent/src/infra/pagesummary/cloudflareMarkdownClient.ts`                | Cloudflare `/markdown` HTTP client implementing `PageContentFetcher` |
| `apps/web-agent/src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts` | Unit tests for the Cloudflare client (nock-based)                    |
| `docs/guides/cloudflare-browser-rendering-setup.md`                               | Setup guide: account creation, API token, IntexuraOS configuration   |

### Modified
| File                                            | Change                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web-agent/src/infra/pagesummary/index.ts` | Export new client, remove Crawl4AI exports                               |
| `apps/web-agent/src/infra/index.ts`             | Re-export new client, remove Crawl4AI re-exports                         |
| `apps/web-agent/src/services.ts`                | Change `ServiceDependencies` and `initServices` to use Cloudflare config |
| `apps/web-agent/src/index.ts`                   | Swap env vars in `REQUIRED_ENV` and `initServices()` call                |
| `apps/web-agent/src/__tests__/services.test.ts` | Update env var stubs                                                     |
| `terraform/environments/dev/main.tf`            | Remove Crawl4AI secret, add Cloudflare secrets                           |
| `ecosystem.config.cjs`                          | Swap env vars in web-agent block                                         |
| `docs/services/web-agent/technical.md`          | Update dependency references from Crawl4AI to Cloudflare                 |

### Deleted
| File                                                                        | Reason                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/web-agent/src/infra/pagesummary/crawl4aiClient.ts`                    | Legacy deprecated client -- fully replaced                      |
| `apps/web-agent/src/infra/pagesummary/pageContentFetcher.ts`                | Current Crawl4AI client -- replaced by cloudflareMarkdownClient |
| `apps/web-agent/src/__tests__/infra/pagesummary/crawl4aiClient.test.ts`     | Tests for deleted client                                        |
| `apps/web-agent/src/__tests__/infra/pagesummary/pageContentFetcher.test.ts` | Tests for deleted client                                        |

### Unchanged (verified no changes needed)
| File                                                                | Reason                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web-agent/src/routes/internalRoutes.ts`                       | Uses `PageContentFetcher` interface via `getServices()` -- interface unchanged |
| `apps/web-agent/src/__tests__/fakes.ts`                             | `FakePageContentFetcher` implements same interface -- no change                |
| `apps/web-agent/src/domain/pagesummary/models/PageSummary.ts`       | Domain models unchanged                                                        |
| `apps/web-agent/src/domain/pagesummary/ports/pageSummaryService.ts` | Port interface unchanged                                                       |
| `apps/web-agent/src/infra/pagesummary/llmSummarizer.ts`             | LLM summarizer is independent of content fetcher                               |
| `apps/bookmarks-agent/src/infra/summary/webAgentSummaryClient.ts`   | Calls internal API -- endpoint contract unchanged                              |

---

## Subtask Boundary Contracts

### Shared Constants (defined here, used by both subtasks)

```typescript
// Environment variable names -- exact strings
const CLOUDFLARE_ACCOUNT_ID_ENV = 'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID';
const CLOUDFLARE_API_TOKEN_ENV = 'INTEXURAOS_CLOUDFLARE_API_TOKEN';
const REMOVED_ENV = 'INTEXURAOS_CRAWL4AI_APP_API_KEY';

// Cloudflare API
const CLOUDFLARE_MARKDOWN_URL = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/markdown';
```

### Subtask 1 Contract (web-agent service)
- **Owns:** All files under `apps/web-agent/`
- **Reads env vars:** `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID`, `INTEXURAOS_CLOUDFLARE_API_TOKEN`
- **Removes env var:** `INTEXURAOS_CRAWL4AI_APP_API_KEY`
- **Preserves interface:** `PageContentFetcher { fetchPageContent(url: string): Promise<Result<string, PageContentError>> }`
- **Preserves error codes:** `'FETCH_FAILED' | 'TIMEOUT' | 'INVALID_URL' | 'NO_CONTENT' | 'API_ERROR' | 'RATE_LIMITED'`
- **Does NOT touch:** `terraform/`, `ecosystem.config.cjs`, `docs/guides/`, `docs/services/`

### Subtask 2 Contract (infrastructure & documentation)
- **Owns:** `terraform/environments/dev/main.tf`, `ecosystem.config.cjs`, `docs/guides/`, `docs/services/web-agent/technical.md`
- **Adds secrets:** `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID`, `INTEXURAOS_CLOUDFLARE_API_TOKEN`
- **Removes secret:** `INTEXURAOS_CRAWL4AI_APP_API_KEY`
- **Documents:** Full Cloudflare account setup from scratch (assume no existing account)
- **Does NOT touch:** Any file under `apps/`

---

## Task 1: Create Cloudflare Markdown Client

**Subtask:** web-agent service
**Files:**
- Create: `apps/web-agent/src/infra/pagesummary/cloudflareMarkdownClient.ts`
- Test: `apps/web-agent/src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts`

### Step 1.1: Write the failing test -- successful markdown extraction

- [ ] **Write test file with first test case**

```typescript
// apps/web-agent/src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createCloudflareMarkdownClient } from '../../../infra/pagesummary/cloudflareMarkdownClient.js';
import { createTestLogger } from '../../testHelpers.js'; // or pino({ level: 'silent' })

const ACCOUNT_ID = 'test-account-id';
const API_TOKEN = 'test-api-token';
const BASE_URL = 'https://api.cloudflare.com';

function createClient(overrides?: { timeoutMs?: number }) {
  return createCloudflareMarkdownClient(
    {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      timeoutMs: overrides?.timeoutMs ?? 60000,
    },
    createTestLogger()
  );
}

describe('cloudflareMarkdownClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns markdown content on successful response', async () => {
    const markdown = '# Example Page\n\nThis is the page content.';

    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: true,
        errors: [],
        messages: [],
        result: markdown,
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(markdown);
    }
  });
});
```

- [ ] **Run test to verify it fails**

Run: `cd apps/web-agent && npx vitest run src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts`
Expected: FAIL -- module `cloudflareMarkdownClient.js` not found.

### Step 1.2: Implement minimal Cloudflare client

- [ ] **Create the client implementation**

```typescript
// apps/web-agent/src/infra/pagesummary/cloudflareMarkdownClient.ts

import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';

export interface CloudflareMarkdownClientConfig {
  accountId: string;
  apiToken: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Error from page content fetching.
 * Preserved from previous PageContentFetcher interface for consumer compatibility.
 */
export interface PageContentError {
  code: 'FETCH_FAILED' | 'TIMEOUT' | 'INVALID_URL' | 'NO_CONTENT' | 'API_ERROR' | 'RATE_LIMITED';
  message: string;
}

/**
 * Client interface for fetching page content only (no summarization).
 */
export interface PageContentFetcher {
  fetchPageContent(url: string): Promise<Result<string, PageContentError>>;
}

interface CloudflareApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: unknown;
}

/**
 * Creates a page content fetcher that uses Cloudflare Browser Rendering /markdown endpoint.
 *
 * API: POST /client/v4/accounts/{account_id}/browser-rendering/markdown
 * Auth: Bearer token
 * Docs: https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/
 */
export function createCloudflareMarkdownClient(
  config: Partial<CloudflareMarkdownClientConfig> & { accountId: string; apiToken: string },
  logger: Logger
): PageContentFetcher {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpointUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/browser-rendering/markdown`;

  return {
    async fetchPageContent(url: string): Promise<Result<string, PageContentError>> {
      logger.info({ url }, 'Starting page content fetch via Cloudflare');

      const controller = new AbortController();
      const timeoutId = setTimeout((): void => {
        logger.warn({ url, timeoutMs }, 'Request timed out');
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify({
            url,
            rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn(
            { url, status: response.status, statusText: response.statusText },
            'Cloudflare API error response'
          );

          if (response.status === 429) {
            return err({
              code: 'RATE_LIMITED',
              message: `Cloudflare rate limited: HTTP ${String(response.status)}`,
            });
          }

          return err({
            code: 'API_ERROR',
            message: `Cloudflare API error: HTTP ${String(response.status)}`,
          });
        }

        let data: CloudflareApiResponse;
        try {
          data = (await response.json()) as CloudflareApiResponse;
        } catch (jsonError) {
          logger.error(
            { url, error: getErrorMessage(jsonError) },
            'Invalid JSON response from Cloudflare'
          );
          return err({
            code: 'API_ERROR',
            message: 'Cloudflare returned invalid JSON response',
          });
        }

        if (!data.success) {
          const errorMsg = data.errors[0]?.message ?? 'Cloudflare request failed';
          logger.warn({ url, errors: data.errors }, 'Cloudflare extraction failed');
          return err({
            code: 'FETCH_FAILED',
            message: errorMsg,
          });
        }

        // result may be a string directly or an object with a markdown field
        const markdown =
          typeof data.result === 'string'
            ? data.result.trim()
            : typeof data.result === 'object' &&
                data.result !== null &&
                'markdown' in data.result &&
                typeof (data.result as Record<string, unknown>)['markdown'] === 'string'
              ? ((data.result as Record<string, unknown>)['markdown'] as string).trim()
              : undefined;

        if (markdown === undefined || markdown === '') {
          logger.info({ url }, 'No markdown content extracted from page');
          return err({
            code: 'NO_CONTENT',
            message: 'No content could be extracted from the page',
          });
        }

        logger.info({ url, contentLength: markdown.length }, 'Page content fetched successfully');

        return ok(markdown);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            logger.warn({ url, timeoutMs }, 'Request timed out (AbortError)');
            return err({
              code: 'TIMEOUT',
              message: `Request timed out after ${String(timeoutMs)}ms`,
            });
          }

          logger.error({ url, error: error.message }, 'Cloudflare request failed');
          return err({
            code: 'FETCH_FAILED',
            message: error.message,
          });
        }

        logger.error({ url }, 'Unknown error during Cloudflare request');
        return err({
          code: 'FETCH_FAILED',
          message: 'Unknown error',
        });
      }
    },
  };
}
```

- [ ] **Run test to verify it passes**

Run: `cd apps/web-agent && npx vitest run src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts`
Expected: PASS

- [ ] **Commit**

```bash
git add apps/web-agent/src/infra/pagesummary/cloudflareMarkdownClient.ts apps/web-agent/src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts
git commit -m "feat(web-agent): add Cloudflare markdown client with first test"
```

### Step 1.3: Add remaining test cases

- [ ] **Add tests for error scenarios**

Add these test cases to the existing `describe` block:

```typescript
it('sends correct Authorization header and request body', async () => {
  nock(BASE_URL)
    .post(
      `/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`,
      (body: Record<string, unknown>) => {
        expect(body).toEqual({
          url: 'https://example.com/page',
          rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
        });
        return true;
      }
    )
    .matchHeader('Authorization', `Bearer ${API_TOKEN}`)
    .matchHeader('Content-Type', 'application/json')
    .reply(200, { success: true, errors: [], messages: [], result: '# Content' });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com/page');

  expect(result.ok).toBe(true);
});

it('returns RATE_LIMITED on HTTP 429', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(429, { success: false, errors: [{ code: 10000, message: 'Rate limited' }] });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('RATE_LIMITED');
  }
});

it('returns API_ERROR on HTTP 401', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(401, { success: false, errors: [{ code: 10000, message: 'Unauthorized' }] });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('API_ERROR');
    expect(result.error.message).toContain('401');
  }
});

it('returns API_ERROR on HTTP 500', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(500, 'Internal Server Error');

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('API_ERROR');
  }
});

it('returns FETCH_FAILED when success is false', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, {
      success: false,
      errors: [{ code: 1001, message: 'Page could not be loaded' }],
      messages: [],
      result: null,
    });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('FETCH_FAILED');
    expect(result.error.message).toBe('Page could not be loaded');
  }
});

it('returns NO_CONTENT when result is empty string', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, { success: true, errors: [], messages: [], result: '   ' });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('NO_CONTENT');
  }
});

it('returns NO_CONTENT when result is null', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, { success: true, errors: [], messages: [], result: null });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('NO_CONTENT');
  }
});

it('returns API_ERROR on invalid JSON response', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, 'not json', { 'Content-Type': 'text/plain' });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('API_ERROR');
  }
});

it('returns TIMEOUT on AbortError', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .delay(200)
    .reply(200, { success: true, errors: [], messages: [], result: '# Content' });

  const client = createClient({ timeoutMs: 50 });
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('TIMEOUT');
  }
});

it('returns FETCH_FAILED on network error', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .replyWithError('Connection refused');

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('FETCH_FAILED');
    expect(result.error.message).toContain('Connection refused');
  }
});

it('trims whitespace from markdown result', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, {
      success: true,
      errors: [],
      messages: [],
      result: '  \n# Trimmed Content\n  ',
    });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe('# Trimmed Content');
  }
});

it('handles result as object with markdown field', async () => {
  nock(BASE_URL)
    .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
    .reply(200, {
      success: true,
      errors: [],
      messages: [],
      result: { markdown: '# Object Format Content' },
    });

  const client = createClient();
  const result = await client.fetchPageContent('https://example.com');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe('# Object Format Content');
  }
});
```

- [ ] **Run all tests to verify they pass**

Run: `cd apps/web-agent && npx vitest run src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts`
Expected: ALL PASS

- [ ] **Commit**

```bash
git add apps/web-agent/src/__tests__/infra/pagesummary/cloudflareMarkdownClient.test.ts
git commit -m "test(web-agent): add comprehensive Cloudflare markdown client tests"
```

---

## Task 2: Update Service Wiring & Module Exports

**Subtask:** web-agent service
**Files:**
- Modify: `apps/web-agent/src/infra/pagesummary/index.ts`
- Modify: `apps/web-agent/src/infra/index.ts`
- Modify: `apps/web-agent/src/services.ts`
- Modify: `apps/web-agent/src/index.ts`
- Modify: `apps/web-agent/src/__tests__/services.test.ts`

### Step 2.1: Update module exports

- [ ] **Update pagesummary/index.ts to export new client**

Replace contents of `apps/web-agent/src/infra/pagesummary/index.ts` with:

```typescript
export {
  createCloudflareMarkdownClient,
  type CloudflareMarkdownClientConfig,
  type PageContentFetcher,
  type PageContentError,
} from './cloudflareMarkdownClient.js';
export {
  createLlmSummarizer,
  type LlmSummarizer,
  type PageSummary,
  type PageSummaryError,
  type SummarizeOptions,
} from './llmSummarizer.js';
```

- [ ] **Update infra/index.ts to re-export new client**

Replace contents of `apps/web-agent/src/infra/index.ts` with:

```typescript
export { OpenGraphFetcher, type OpenGraphFetcherConfig } from './linkpreview/index.js';
export {
  createCloudflareMarkdownClient,
  type CloudflareMarkdownClientConfig,
  type PageContentFetcher,
  type PageContentError,
} from './pagesummary/index.js';
export {
  createLlmSummarizer,
  type LlmSummarizer,
  type PageSummary,
  type PageSummaryError,
  type SummarizeOptions,
} from './pagesummary/llmSummarizer.js';
export {
  createUserServiceClient,
  type UserServiceClient,
  type UserServiceConfig,
  type UserServiceError,
} from '@intexuraos/internal-clients';
```

- [ ] **Commit**

```bash
git add apps/web-agent/src/infra/pagesummary/index.ts apps/web-agent/src/infra/index.ts
git commit -m "refactor(web-agent): update module exports for Cloudflare client"
```

### Step 2.2: Write failing test for updated ServiceDependencies

- [ ] **Update services.test.ts with new env var expectations**

In `apps/web-agent/src/__tests__/services.test.ts`, find and update the env var stubs:
- Replace `INTEXURAOS_CRAWL4AI_APP_API_KEY` references with `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID` and `INTEXURAOS_CLOUDFLARE_API_TOKEN`
- Update the `initServices()` call to pass `cloudflareAccountId` and `cloudflareApiToken` instead of `crawl4aiApiKey`

- [ ] **Run test to verify it fails**

Run: `cd apps/web-agent && npx vitest run src/__tests__/services.test.ts`
Expected: FAIL -- `ServiceDependencies` type mismatch

### Step 2.3: Update services.ts

- [ ] **Modify ServiceDependencies and initServices**

In `apps/web-agent/src/services.ts`:

Change the import line:
```typescript
// OLD:
import {
  OpenGraphFetcher,
  createPageContentFetcher,
  createLlmSummarizer,
  createUserServiceClient,
  type PageContentFetcher,
  type UserServiceClient,
  type LlmSummarizer,
} from './infra/index.js';

// NEW:
import {
  OpenGraphFetcher,
  createCloudflareMarkdownClient,
  createLlmSummarizer,
  createUserServiceClient,
  type PageContentFetcher,
  type UserServiceClient,
  type LlmSummarizer,
} from './infra/index.js';
```

Change `ServiceDependencies`:
```typescript
// OLD:
export interface ServiceDependencies {
  crawl4aiApiKey: string;
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

// NEW:
export interface ServiceDependencies {
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}
```

Change `initServices()`:
```typescript
// OLD:
pageContentFetcher: createPageContentFetcher(
  { apiKey: dependencies.crawl4aiApiKey },
  createAppLogger({ name: 'pageContentFetcher' })
),

// NEW:
pageContentFetcher: createCloudflareMarkdownClient(
  {
    accountId: dependencies.cloudflareAccountId,
    apiToken: dependencies.cloudflareApiToken,
  },
  createAppLogger({ name: 'pageContentFetcher' })
),
```

- [ ] **Run test to verify it passes**

Run: `cd apps/web-agent && npx vitest run src/__tests__/services.test.ts`
Expected: PASS

- [ ] **Commit**

```bash
git add apps/web-agent/src/services.ts apps/web-agent/src/__tests__/services.test.ts
git commit -m "refactor(web-agent): wire Cloudflare client into ServiceDependencies"
```

### Step 2.4: Update index.ts env vars

- [ ] **Update REQUIRED_ENV and initServices call**

In `apps/web-agent/src/index.ts`:

Change `REQUIRED_ENV`:
```typescript
// OLD:
const REQUIRED_ENV = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_CRAWL4AI_APP_API_KEY',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

// NEW:
const REQUIRED_ENV = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
  'INTEXURAOS_CLOUDFLARE_API_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];
```

Change `initServices()` call:
```typescript
// OLD:
initServices({
  crawl4aiApiKey: process.env['INTEXURAOS_CRAWL4AI_APP_API_KEY'] ?? '',
  userServiceUrl: USER_SERVICE_URL,
  internalAuthToken: INTERNAL_AUTH_TOKEN,
  pricingContext,
});

// NEW:
initServices({
  cloudflareAccountId: process.env['INTEXURAOS_CLOUDFLARE_ACCOUNT_ID'] ?? '',
  cloudflareApiToken: process.env['INTEXURAOS_CLOUDFLARE_API_TOKEN'] ?? '',
  userServiceUrl: USER_SERVICE_URL,
  internalAuthToken: INTERNAL_AUTH_TOKEN,
  pricingContext,
});
```

- [ ] **Commit**

```bash
git add apps/web-agent/src/index.ts
git commit -m "refactor(web-agent): swap env vars from Crawl4AI to Cloudflare"
```

---

## Task 3: Remove Legacy Crawl4AI Code

**Subtask:** web-agent service
**Files:**
- Delete: `apps/web-agent/src/infra/pagesummary/crawl4aiClient.ts`
- Delete: `apps/web-agent/src/infra/pagesummary/pageContentFetcher.ts`
- Delete: `apps/web-agent/src/__tests__/infra/pagesummary/crawl4aiClient.test.ts`
- Delete: `apps/web-agent/src/__tests__/infra/pagesummary/pageContentFetcher.test.ts`

### Step 3.1: Delete old files

- [ ] **Delete Crawl4AI client files and their tests**

```bash
rm apps/web-agent/src/infra/pagesummary/crawl4aiClient.ts
rm apps/web-agent/src/infra/pagesummary/pageContentFetcher.ts
rm apps/web-agent/src/__tests__/infra/pagesummary/crawl4aiClient.test.ts
rm apps/web-agent/src/__tests__/infra/pagesummary/pageContentFetcher.test.ts
```

- [ ] **Verify no remaining imports reference deleted files**

Run: `rg "crawl4ai|crawl4AIClient|pageContentFetcher" apps/web-agent/src/ --type ts`
Expected: No matches (all references should have been updated in Task 2).

If any references remain, update them to import from the new module paths.

- [ ] **Run full web-agent test suite**

Run: `pnpm run verify:workspace:tracked -- web-agent`
Expected: ALL PASS with 100% coverage

- [ ] **Commit**

```bash
git add -A apps/web-agent/
git commit -m "refactor(web-agent): remove legacy Crawl4AI client and tests"
```

---

## Task 4: Infrastructure Changes

**Subtask:** infrastructure & documentation
**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`

### Step 4.1: Update Terraform secrets

- [ ] **In `terraform/environments/dev/main.tf`, update secret definitions**

Find the Crawl4AI secret definition block (around line 509) and replace it:

```terraform
# OLD (remove):
    "INTEXURAOS_CRAWL4AI_APP_API_KEY" = "Crawl4AI Cloud API key for web-agent"

# NEW (add):
    "INTEXURAOS_CLOUDFLARE_ACCOUNT_ID" = "Cloudflare account ID for Browser Rendering API"
    "INTEXURAOS_CLOUDFLARE_API_TOKEN"  = "Cloudflare API token with Browser Rendering Edit permission"
```

- [ ] **Update web-agent module secrets block**

Find the web-agent Cloud Run module (around line 1622-1624) and replace the secrets:

```terraform
# OLD:
  secrets = merge(local.common_service_secrets, {
    INTEXURAOS_CRAWL4AI_APP_API_KEY = module.secret_manager.secret_ids["INTEXURAOS_CRAWL4AI_APP_API_KEY"]
  })

# NEW:
  secrets = merge(local.common_service_secrets, {
    INTEXURAOS_CLOUDFLARE_ACCOUNT_ID = module.secret_manager.secret_ids["INTEXURAOS_CLOUDFLARE_ACCOUNT_ID"]
    INTEXURAOS_CLOUDFLARE_API_TOKEN  = module.secret_manager.secret_ids["INTEXURAOS_CLOUDFLARE_API_TOKEN"]
  })
```

- [ ] **Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "infra: replace Crawl4AI secrets with Cloudflare credentials in Terraform"
```

### Step 4.2: Update ecosystem.config.cjs

- [ ] **Update web-agent env block**

Find the `'web-agent'` block (around line 145-147) and replace:

```javascript
// OLD:
'web-agent': {
  INTEXURAOS_CRAWL4AI_APP_API_KEY: process.env.INTEXURAOS_CRAWL4AI_APP_API_KEY,
},

// NEW:
'web-agent': {
  INTEXURAOS_CLOUDFLARE_ACCOUNT_ID: process.env.INTEXURAOS_CLOUDFLARE_ACCOUNT_ID,
  INTEXURAOS_CLOUDFLARE_API_TOKEN: process.env.INTEXURAOS_CLOUDFLARE_API_TOKEN,
},
```

- [ ] **Commit**

```bash
git add ecosystem.config.cjs
git commit -m "config: swap Crawl4AI env vars for Cloudflare in ecosystem config"
```

---

## Task 5: Cloudflare Browser Rendering Setup Guide

**Subtask:** infrastructure & documentation
**Files:**
- Create: `docs/guides/cloudflare-browser-rendering-setup.md`

### Step 5.1: Write the setup guide

- [ ] **Create the setup guide document**

```markdown
# Cloudflare Browser Rendering Setup Guide

This guide walks through setting up Cloudflare Browser Rendering for IntexuraOS page content extraction. It assumes you are starting from scratch with no existing Cloudflare account.

## Prerequisites

- A valid email address for Cloudflare account registration
- Access to the IntexuraOS `.envrc` file (for storing secrets)
- Access to GCP Secret Manager (for production secret storage)

## Step 1: Create a Cloudflare Account

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Enter your email and password
3. Verify your email address
4. Complete account setup (no domain registration required for API-only usage)

## Step 2: Enable Workers & Browser Rendering

Browser Rendering is part of Cloudflare Workers. The free tier includes 10 minutes of browser rendering time per day.

1. In the Cloudflare dashboard, navigate to **Workers & Pages** in the left sidebar
2. If prompted, set up a Workers subdomain (e.g., `intexuraos.workers.dev`)
3. Browser Rendering is automatically available -- no explicit activation needed for REST API usage

## Step 3: Find Your Account ID

1. In the Cloudflare dashboard, click on any domain or go to the **Overview** page
2. Your **Account ID** is displayed in the right sidebar under "API"
3. Alternatively, it's in the dashboard URL: `https://dash.cloudflare.com/{account_id}/...`
4. Copy this value -- it will be stored as `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID`

## Step 4: Create an API Token

1. Go to **My Profile** (top-right avatar menu) > **API Tokens**
2. Click **Create Token**
3. Select **Create Custom Token**
4. Configure the token:
   - **Token name:** `IntexuraOS Browser Rendering`
   - **Permissions:**
     - Account > Browser Rendering > **Edit**
   - **Account Resources:**
     - Include > Your account
   - **Client IP Address Filtering:** (optional) restrict to your server IPs
   - **TTL:** (optional) set an expiry if desired
5. Click **Continue to summary** > **Create Token**
6. **Copy the token immediately** -- it is shown only once
7. This value will be stored as `INTEXURAOS_CLOUDFLARE_API_TOKEN`

## Step 5: Configure IntexuraOS

### Development Environment (.envrc)

Add to your `.envrc` file:

```bash
export INTEXURAOS_CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
export INTEXURAOS_CLOUDFLARE_API_TOKEN="your-api-token-here"
```

Then reload: `direnv allow`

### Production Environment (GCP Secret Manager)

The secrets are managed via Terraform. After running `terraform apply`, populate the secrets:

```bash
echo -n "your-account-id" | gcloud secrets versions add INTEXURAOS_CLOUDFLARE_ACCOUNT_ID \
  --project=intexuraos-dev-pbuchman --data-file=-

echo -n "your-api-token" | gcloud secrets versions add INTEXURAOS_CLOUDFLARE_API_TOKEN \
  --project=intexuraos-dev-pbuchman --data-file=-
```

### Remove Old Crawl4AI Secret

After verifying Cloudflare is working, remove the old secret:

```bash
# Remove from .envrc
# Delete the INTEXURAOS_CRAWL4AI_APP_API_KEY line

# Production cleanup (optional -- Terraform handles this)
gcloud secrets delete INTEXURAOS_CRAWL4AI_APP_API_KEY \
  --project=intexuraos-dev-pbuchman --quiet
```

## Step 6: Verify Integration

Test the endpoint manually:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${INTEXURAOS_CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown" \
  -H "Authorization: Bearer ${INTEXURAOS_CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' | jq .
```

Expected response:
```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": "# Example Domain\n\nThis domain is for use in illustrative examples..."
}
```

## Rate Limits

| Tier          | Browser Time/Day        | API Requests/Min   | Concurrent Browsers |
| ------------- | ----------------------- | ------------------ | ------------------- |
| Free          | 10 minutes              | 6                  | 3                   |
| Paid ($5+/mo) | Unlimited (usage-based) | 600                | 30                  |

The free tier supports approximately 60-120 page extractions per day (at ~5-10 seconds each). Monitor usage in the Cloudflare dashboard under **Workers & Pages > Browser Rendering**.

## Troubleshooting

| Error            | Cause                                         | Fix                                             |
| ---------------- | --------------------------------------------- | ----------------------------------------------- |
| HTTP 401         | Invalid or expired API token                  | Regenerate token in Cloudflare dashboard        |
| HTTP 403         | Missing "Browser Rendering - Edit" permission | Edit token to add the permission                |
| HTTP 429         | Rate limit exceeded                           | Wait and retry; consider upgrading to paid tier |
| `success: false` | Target page blocks headless browsers          | Expected for some sites; not fixable            |
```

- [ ] **Commit**

```bash
git add docs/guides/cloudflare-browser-rendering-setup.md
git commit -m "docs: add Cloudflare Browser Rendering setup guide"
```

---

## Task 6: Update Web-Agent Technical Documentation

**Subtask:** infrastructure & documentation
**Files:**
- Modify: `docs/services/web-agent/technical.md`

### Step 6.1: Update technical docs

- [ ] **Update dependency references in technical.md**

In `docs/services/web-agent/technical.md`, find all references to "Crawl4AI" and update them:

1. Replace "Crawl4AI" with "Cloudflare Browser Rendering" in text descriptions
2. Update the dependencies table: change `Crawl4AI` row to `Cloudflare Browser Rendering (/markdown endpoint)`
3. Update the architecture diagram if it references Crawl4AI
4. Update the configuration table:
   - Remove `INTEXURAOS_CRAWL4AI_APP_API_KEY`
   - Add `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID` and `INTEXURAOS_CLOUDFLARE_API_TOKEN`
5. Update any sequence diagrams showing the page content fetch flow
6. Add a reference to the setup guide: `See [Cloudflare Browser Rendering Setup Guide](../../guides/cloudflare-browser-rendering-setup.md)`

- [ ] **Commit**

```bash
git add docs/services/web-agent/technical.md
git commit -m "docs: update web-agent technical docs for Cloudflare migration"
```

---

## Verification

After all tasks are complete, run the full CI suite:

```bash
pnpm run ci:tracked
```

Expected: ALL PASS. No remaining references to `crawl4ai` or `CRAWL4AI` in any source files (Terraform, TypeScript, ecosystem config).

Final check:
```bash
rg -i "crawl4ai" --type ts --type tf --type js
```
Expected: Zero matches.
