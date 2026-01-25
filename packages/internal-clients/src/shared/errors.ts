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
 * Wrapper for HTTP calls to internal services with authentication.
 */
export async function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: RequestInit
): Promise<Result<T, ServiceClientError>> {
  const { err, ok } = await import('@intexuraos/common-core');
  const { getErrorMessage } = await import('@intexuraos/common-core');

  try {
    const headersInit = options?.headers as Record<string, string> | undefined;
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: {
        ...(headersInit ?? {}),
        'X-Internal-Auth': config.internalAuthToken,
      },
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
