import type { ApiResponse } from '@/types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number; // Timeout in milliseconds (default: 30000ms)
}

const DEFAULT_TIMEOUT_MS = 30000;

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT_MS } = options;

  // AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  const url = `${baseUrl}${path}`;
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...headers,
  };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
    signal: controller.signal,
    // Disable caching to always get fresh data
    cache: 'no-store',
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    // Rethrow with clearer message for abort/timeout errors
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Request timed out. Please check your connection and try again.', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle 204 No Content - successful response with no body
  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json()) as ApiResponse<T>;

  if (!data.success) {
    throw new ApiError(data.error.code, data.error.message, response.status, data.error.details);
  }

  return data.data;
}
