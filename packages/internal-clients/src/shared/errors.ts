import type { Result } from '@intexuraos/common-core';

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
 * Automatically includes X-Trace-Id header if traceId is provided in options.
 */
export async function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: ServiceClientOptions
): Promise<Result<T, ServiceClientError>> {
  const { err, ok } = await import('@intexuraos/common-core');
  const { getErrorMessage } = await import('@intexuraos/common-core');

  try {
    const headersInit = options?.headers;

    // Build headers
    const headers: Record<string, string> = {
      ...(headersInit ?? {}),
      'X-Internal-Auth': config.internalAuthToken,
    };

    // Include traceId in headers if provided
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
