/**
 * Shared logger configuration for Fastify services.
 *
 * Provides consistent logging behavior across all services:
 * - Suppresses health check endpoint logs (Cloud Run probes)
 * - Uses JSON format in production
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-common';

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
            url: request.url,
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
 * Options for logging incoming requests with sensitive data redaction.
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
 * Safely log incoming request with automatic redaction of sensitive headers.
 *
 * Use this at the start of internal endpoints (before auth validation) to capture
 * diagnostic information while protecting secrets in logs.
 *
 * Features:
 * - Redacts sensitive headers (x-internal-auth, authorization, etc.)
 * - Truncates body preview to prevent log bloat
 * - Best-effort error handling (won't crash request on logging failure)
 *
 * @example
 * ```typescript
 * async (request: FastifyRequest, reply: FastifyReply) => {
 *   logIncomingRequest(request, {
 *     message: 'Received PubSub push to /internal/commands',
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
    // Clone headers and redact sensitive fields
    const headersObj = { ...(request.headers as Record<string, unknown>) };
    const redactedHeaders = redactObject(headersObj, [...SENSITIVE_FIELDS]);

    // Build log payload
    // Handle undefined/null bodies (JSON.stringify returns undefined for undefined)
    const bodyString = request.body === undefined ? 'undefined' : JSON.stringify(request.body);
    const logPayload: Record<string, unknown> = {
      event: 'incoming_request',
      headers: redactedHeaders,
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
