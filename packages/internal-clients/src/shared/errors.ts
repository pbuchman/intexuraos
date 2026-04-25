import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, getRequestContext, ok } from '@intexuraos/common-core';

/**
 * Error from service client operations.
 */
export interface ServiceClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

/**
 * Configuration for internal service clients.
 */
export interface ServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: import('@intexuraos/common-core').Logger;
}

/**
 * Options for internal service calls.
 */
export interface ServiceClientOptions {
  traceId?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string | null | ArrayBuffer | ReadableStream<Uint8Array>;
}

/**
 * Wrapper for HTTP calls to internal services with authentication.
 *
 * Automatically attaches the active {@link RequestContext} as outbound
 * propagation headers when one is in scope (plan §4):
 *
 * - `x-request-id` — current request id (always)
 * - `x-correlation-id` — correlation id (always; mirrors request id at the edge)
 * - `traceparent` — emitted by `@opentelemetry/instrumentation-http` when an
 *   active span exists; this helper does NOT synthesise one to avoid
 *   competing with the OTel auto-instrumentation.
 *
 * For backwards compatibility, the legacy `X-Trace-Id` header is still set
 * when `options.traceId` is provided.
 */
export async function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: ServiceClientOptions
): Promise<Result<T, ServiceClientError>> {
  try {
    const headersInit = options?.headers;

    // Build headers
    const headers: Record<string, string> = {
      ...(headersInit ?? {}),
      'X-Internal-Auth': config.internalAuthToken,
    };

    // Plan §4 — propagate request/correlation ids from AsyncLocalStorage when
    // a request context is in scope. Caller-supplied non-empty headers win;
    // empty strings are treated as missing to mirror the inbound side
    // (`buildRequestContext` in `@intexuraos/http-server`), preventing the
    // wire from carrying a useless `x-request-id: ` header.
    const ctx = getRequestContext();
    if (ctx !== undefined) {
      const existingRequestId = headers['x-request-id'];
      if (existingRequestId === undefined || existingRequestId === '') {
        headers['x-request-id'] = ctx.requestId;
      }
      const existingCorrelationId = headers['x-correlation-id'];
      if (existingCorrelationId === undefined || existingCorrelationId === '') {
        headers['x-correlation-id'] = ctx.correlationId;
      }
    }

    // Include traceId in legacy header if provided
    if (options?.traceId !== undefined) {
      headers['X-Trace-Id'] = options.traceId;
    }

    // Build request init without traceId (it's now in headers)
    const { traceId: _traceId, body, ...requestInit } = options ?? {};

    const response = await fetch(`${config.baseUrl}${path}`, {
      ...requestInit,
      headers,
      ...(body !== undefined && { body }),
    });

    if (!response.ok) {
      return err({
        code: 'API_ERROR',
        message: `HTTP ${String(response.status)}`,
      });
    }

    const data = (await response.json()) as T;
    return ok(data);
  } catch (error) {
    const message = getErrorMessage(error);
    return err({
      code: 'NETWORK_ERROR',
      message,
    });
  }
}
