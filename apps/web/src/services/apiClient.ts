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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
    'Content-Type': 'application/json',
    ...headers,
  };

  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  const data = (await response.json()) as ApiResponse<T>;

  if (!data.success) {
    throw new ApiError(data.error.code, data.error.message, data.error.details);
  }

  return data.data;
}
