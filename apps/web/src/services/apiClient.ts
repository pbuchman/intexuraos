import type { ApiResponse } from '@/types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
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
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

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
    // Disable caching to always get fresh data
    cache: 'no-store',
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  // Handle 204 No Content - successful response with no body
  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json()) as ApiResponse<T>;

  if (!data.success) {
    throw new ApiError(data.error.code, data.error.message, data.error.details);
  }

  return data.data;
}
