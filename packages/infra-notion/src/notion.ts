/**
 * Notion client utilities.
 * Simple wrapper around @notionhq/client for common operations.
 */
import { APIErrorCode, Client, isNotionClientError, LogLevel } from '@notionhq/client';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';

/**
 * Logger interface for Notion API calls.
 */
export interface NotionLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Notion error codes.
 */
export type NotionErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Notion error type.
 */
export interface NotionError {
  code: NotionErrorCode;
  message: string;
}

/**
 * Map Notion SDK errors to domain errors.
 */
export function mapNotionError(error: unknown): NotionError {
  if (isNotionClientError(error)) {
    const errorCodeMap: Partial<Record<APIErrorCode, NotionErrorCode>> = {
      [APIErrorCode.Unauthorized]: 'UNAUTHORIZED',
      [APIErrorCode.ObjectNotFound]: 'NOT_FOUND',
      [APIErrorCode.RateLimited]: 'RATE_LIMITED',
      [APIErrorCode.ValidationError]: 'VALIDATION_ERROR',
      [APIErrorCode.InvalidJSON]: 'VALIDATION_ERROR',
    };

    // Narrow error.code to APIErrorCode for map lookup; fall back to INTERNAL_ERROR if not found
    const code = errorCodeMap[error.code as APIErrorCode] ?? 'INTERNAL_ERROR';

    return { code, message: error.message };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, 'Unknown Notion API error'),
  };
}

/**
 * Calculate body length for logging purposes.
 * @internal - exported for testing only
 */
export function calculateBodyLength(body: RequestInit['body']): number {
  if (typeof body === 'string') {
    return body.length;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  return 0;
}

/**
 * Create a logging fetch wrapper for Notion API calls.
 */
function createLoggingFetch(
  logger: NotionLogger
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now();
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const method = init?.method ?? 'GET';

    // Log request (redact auth header)
    const headersForLog: Record<string, string> = {};
    if (init?.headers !== undefined) {
      const headers =
        init.headers instanceof Headers
          ? Object.fromEntries((init.headers as Headers & { entries(): Iterable<[string, string]> }).entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers as [string, string][])
            : (init.headers as Record<string, string>);

      for (const [key, value] of Object.entries(headers)) {
        headersForLog[key] =
          key.toLowerCase() === 'authorization' ? value.substring(0, 20) + '...[REDACTED]' : value;
      }
    }

    const bodyLength = init?.body !== undefined ? calculateBodyLength(init.body) : 0;

    logger.info('Notion API request', {
      method,
      url: urlString,
      headers: headersForLog,
      bodyLength,
    });

    try {
      const response = await fetch(url, init);
      const durationMs = Date.now() - startTime;

      const responseClone = response.clone();
      let responseBodyPreview: string;
      try {
        const responseText = await responseClone.text();
        responseBodyPreview =
          responseText.length > 500
            ? responseText.substring(0, 500) + '...[TRUNCATED]'
            : responseText;
      } catch {
        responseBodyPreview = '[unable to read response body]';
      }

      if (response.ok) {
        logger.info('Notion API response', {
          method,
          url: urlString,
          status: response.status,
          durationMs,
        });
      } else {
        logger.warn('Notion API error response', {
          method,
          url: urlString,
          status: response.status,
          durationMs,
          body: responseBodyPreview,
        });
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('Notion API network error', {
        method,
        url: urlString,
        durationMs,
        error: getErrorMessage(error),
      });
      throw error;
    }
  };
}

/**
 * Create a Notion client with logging.
 */
export function createNotionClient(token: string, logger: NotionLogger): Client {
  return new Client({
    auth: token,
    logLevel: LogLevel.DEBUG,
    fetch: createLoggingFetch(logger),
  });
}

// Re-export useful types from Notion SDK
export { Client as NotionClient } from '@notionhq/client';
export type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

// =============================================================================
// Notion API utilities
// =============================================================================

/**
 * Page preview structure.
 */
export interface NotionPagePreview {
  id: string;
  title: string;
  url: string;
  blocks: { type: string; content: string }[];
}

/**
 * Validate a Notion token by calling the users.me endpoint.
 * Returns ok(true) if valid, ok(false) if unauthorized, err for other errors.
 */
export async function validateNotionToken(
  token: string,
  logger: NotionLogger
): Promise<Result<boolean, NotionError>> {
  try {
    const client = createNotionClient(token, logger);
    await client.users.me({});
    return ok(true);
  } catch (error) {
    const e = mapNotionError(error);
    if (e.code === 'UNAUTHORIZED') return ok(false);
    return err(e);
  }
}

/**
 * Get page with preview blocks (first 10 blocks).
 */
export async function getPageWithPreview(
  token: string,
  pageId: string,
  logger: NotionLogger
): Promise<Result<NotionPagePreview, NotionError>> {
  try {
    const client = createNotionClient(token, logger);

    const pageResponse = await client.pages.retrieve({ page_id: pageId });

    if (!('properties' in pageResponse)) {
      return err({ code: 'INTERNAL_ERROR', message: 'Unexpected page response format' });
    }

    const title = extractPageTitle(pageResponse.properties);
    const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;

    const blocksResponse = await client.blocks.children.list({ block_id: pageId, page_size: 10 });

    const blocks: { type: string; content: string }[] = [];
    for (const block of blocksResponse.results) {
      if ('type' in block) {
        const type = block.type;
        let content = '';
        const blockData = block[type as keyof typeof block] as
          | { rich_text?: { plain_text?: string }[] }
          | undefined;
        if (blockData?.rich_text) {
          content = blockData.rich_text.map((t) => t.plain_text ?? '').join('');
        }
        blocks.push({ type, content });
      }
    }

    return ok({ id: pageResponse.id, title, url, blocks });
  } catch (error) {
    return err(mapNotionError(error));
  }
}

/**
 * Extract title from Notion page properties.
 */
export function extractPageTitle(properties: Record<string, unknown>): string {
  const titleProp =
    properties['title'] ?? properties['Title'] ?? properties['Name'] ?? properties['name'];

  if (
    titleProp !== null &&
    typeof titleProp === 'object' &&
    'title' in titleProp &&
    Array.isArray((titleProp as { title: unknown[] }).title)
  ) {
    const titleArray = (titleProp as { title: { plain_text?: string }[] }).title;
    return titleArray.map((t) => t.plain_text ?? '').join('');
  }

  return 'Untitled';
}
