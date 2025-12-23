/**
 * Notion client utilities.
 * Simple wrapper around @notionhq/client for common operations.
 */
import { Client, isNotionClientError, APIErrorCode, LogLevel } from '@notionhq/client';
import { getErrorMessage } from './http/errors.js';

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
    let code: NotionErrorCode;

    switch (error.code) {
      case APIErrorCode.Unauthorized:
        code = 'UNAUTHORIZED';
        break;
      case APIErrorCode.ObjectNotFound:
        code = 'NOT_FOUND';
        break;
      case APIErrorCode.RateLimited:
        code = 'RATE_LIMITED';
        break;
      case APIErrorCode.ValidationError:
      case APIErrorCode.InvalidJSON:
        code = 'VALIDATION_ERROR';
        break;
      default:
        code = 'INTERNAL_ERROR';
    }

    return { code, message: error.message };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, 'Unknown Notion API error'),
  };
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
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers as [string, string][])
            : (init.headers as Record<string, string>);

      for (const [key, value] of Object.entries(headers)) {
        headersForLog[key] =
          key.toLowerCase() === 'authorization' ? value.substring(0, 20) + '...[REDACTED]' : value;
      }
    }

    let bodyLength = 0;
    if (init?.body !== undefined) {
      if (typeof init.body === 'string') {
        bodyLength = init.body.length;
      } else if (init.body instanceof ArrayBuffer) {
        bodyLength = init.body.byteLength;
      }
    }

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
 * Create a Notion client with optional logging.
 */
export function createNotionClient(token: string, logger?: NotionLogger): Client {
  if (logger !== undefined) {
    return new Client({
      auth: token,
      logLevel: LogLevel.DEBUG,
      fetch: createLoggingFetch(logger),
    });
  }
  return new Client({ auth: token });
}

// Re-export useful types from Notion SDK
export { Client as NotionClient } from '@notionhq/client';
export type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
