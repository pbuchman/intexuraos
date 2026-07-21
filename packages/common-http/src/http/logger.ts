/**
 * Shared logger configuration for Fastify services.
 *
 * Provides consistent logging behavior across all services:
 * - Suppresses health check endpoint logs (Cloud Run probes)
 * - Uses JSON format in production
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const COARSE_DIAGNOSTIC_HEADERS = ['content-type', 'content-length'] as const;
const AUTHENTICATION_HEADERS = ['authorization', 'x-internal-auth'] as const;
const REDACTED_HEADER_VALUE = '[REDACTED]';

/**
 * Paths that should not be logged (e.g., health checks from Cloud Run).
 */
const SILENT_PATHS = new Set(['/health']);

/**
 * Hook to determine if a request should be logged.
 * Returns false for health check endpoints to suppress logging.
 */
export function shouldLogRequest(url: string | undefined): boolean {
  if (url === undefined) return true;
  // Extract path without query string
  const path = url.split('?')[0];
  return path === undefined || !SILENT_PATHS.has(path);
}

/**
 * Registers request logging hooks that skip health check endpoints.
 * Use this after creating the Fastify instance with `disableRequestLogging: true`.
 *
 * @example
 * const app = Fastify({
 *   logger: true,
 *   disableRequestLogging: true,
 * });
 * registerQuietHealthCheckLogging(app);
 */
export function registerQuietHealthCheckLogging(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (shouldLogRequest(request.url)) {
      request.log.info(
        {
          req: {
            method: request.method,
            url: getSafeRequestRoute(request),
            host: request.headers.host,
            remoteAddress: request.ip,
          },
        },
        'incoming request'
      );
    }
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    if (shouldLogRequest(request.url)) {
      request.log.info(
        {
          res: { statusCode: reply.statusCode },
          responseTime: reply.elapsedTime,
        },
        'request completed'
      );
    }
    done();
  });
}

/**
 * Return only the registered route pattern. Dynamic path values and query
 * strings can contain user or conversation data and must never enter logs.
 */
export function getSafeRequestRoute(request: FastifyRequest): string {
  const routeTemplate = request.routeOptions.url;
  return typeof routeTemplate === 'string' && routeTemplate.length > 0
    ? routeTemplate
    : 'unmatched_route';
}

/**
 * Options for logging incoming requests with a safe header allowlist.
 */
export interface LogIncomingRequestOptions {
  /**
   * Maximum length of body preview in log output.
   * @default 500
   */
  bodyPreviewLength?: number;

  /**
   * Whether to include request.params in the log output.
   * @default false
   */
  includeParams?: boolean;

  /**
   * Custom log message.
   * @default 'Incoming request'
   */
  message?: string;

  /**
   * Additional fields to include in structured log output.
   * These will be merged with standard fields (event, headers, bodyPreview).
   * @default {}
   */
  additionalFields?: Record<string, unknown>;
}

/**
 * Safely log an incoming request without copying arbitrary headers.
 *
 * Use this at the start of internal endpoints (before auth validation) to capture
 * diagnostic information while protecting secrets in logs.
 *
 * Features:
 * - Includes only coarse diagnostic headers (content type and length)
 * - Replaces authentication values with a fixed marker
 * - Truncates body preview to prevent log bloat
 * - Best-effort error handling (won't crash request on logging failure)
 *
 * @example
 * ```typescript
 * async (request: FastifyRequest, reply: FastifyReply) => {
 *   logIncomingRequest(request, {
 *     message: 'Received PubSub push to /internal/bookmarks',
 *     bodyPreviewLength: 200,
 *   });
 *
 *   // ... rest of handler
 * }
 * ```
 *
 * @param request - Fastify request object
 * @param options - Logging configuration options
 */
export function logIncomingRequest(
  request: FastifyRequest,
  options: LogIncomingRequestOptions = {}
): void {
  const {
    bodyPreviewLength = 500,
    includeParams = false,
    message = 'Incoming request',
    additionalFields = {},
  } = options;

  try {
    // Build log payload
    // Handle undefined/null bodies (JSON.stringify returns undefined for undefined)
    const bodyString = request.body === undefined ? 'undefined' : JSON.stringify(request.body);
    const logPayload: Record<string, unknown> = {
      event: 'incoming_request',
      headers: selectSafeRequestHeaders(request.headers),
      bodyPreview: bodyString.substring(0, bodyPreviewLength),
      ...additionalFields,
    };

    // Conditionally include params
    if (includeParams) {
      logPayload['params'] = request.params;
    }

    request.log.info(logPayload, message);
  } catch (logErr) {
    // Best-effort logging: don't crash request if logging fails
    request.log.debug({ error: logErr }, 'Failed to log incoming request');
  }
}

function selectSafeRequestHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};

  for (const header of COARSE_DIAGNOSTIC_HEADERS) {
    const value = headers[header];
    if (typeof value === 'string') {
      safeHeaders[header] = value;
    }
  }

  for (const header of AUTHENTICATION_HEADERS) {
    if (headers[header] !== undefined) {
      safeHeaders[header] = REDACTED_HEADER_VALUE;
    }
  }

  return safeHeaders;
}
