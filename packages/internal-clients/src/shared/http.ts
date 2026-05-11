export type { ServiceClientConfig, ServiceClientError } from './errors.js';
import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { sendInternalRequest } from './request.js';
import type { ServiceClientConfig, ServiceClientError } from './errors.js';

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
 * Automatically attaches the active request context as outbound propagation
 * headers. For backwards compatibility, the legacy `X-Trace-Id` header is
 * still set when `options.traceId` is provided.
 */
export async function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: ServiceClientOptions
): Promise<Result<T, ServiceClientError>> {
  try {
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };
    if (options?.traceId !== undefined) {
      headers['X-Trace-Id'] = options.traceId;
    }

    const response = await sendInternalRequest({
      baseUrl: config.baseUrl,
      path,
      method: options?.method ?? 'GET',
      token: config.internalAuthToken,
      logger: config.logger,
      headers,
      body: options?.body,
    });

    if (!response.ok) {
      return err({
        code: response.error.code === 'TIMEOUT' ? 'NETWORK_ERROR' : response.error.code,
        message: response.error.message,
      });
    }

    if (!response.response.ok) {
      return err({
        code: 'API_ERROR',
        message: `HTTP ${String(response.response.status)}`,
      });
    }

    const data = response.body as T;
    return ok(data);
  } catch (error) {
    const message = getErrorMessage(error);
    return err({
      code: 'NETWORK_ERROR',
      message,
    });
  }
}
